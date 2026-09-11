import { isGreybeardGraphError } from "./errors.js";
import type { GraphToolInput, GraphToolResult } from "./types.js";

export type GraphReader = { graph(input: GraphToolInput): Promise<GraphToolResult> };
export const READ_RECIPES = ["compliance-policies", "compliance-policy", "compliance-assignments", "compliance-actions", "managed-devices", "conditional-access", "groups"] as const;
export type ReadRecipe = typeof READ_RECIPES[number];
export type ReadRecipeInput = { recipe: ReadRecipe; policyId?: string; maxItems?: number; maxPages?: number };

export async function runReadRecipe(reader: GraphReader, input: ReadRecipeInput) {
  const maxItems = bounded(input.maxItems ?? 100, 5000, "maxItems");
  const maxPages = bounded(input.maxPages ?? 5, 50, "maxPages");
  const root = "/deviceManagement/deviceCompliancePolicies";
  let path: string;
  let select: string | undefined;
  let expand: string | undefined;
  let collection = true;
  switch (input.recipe) {
    case "compliance-policies": path = root; select = "id,displayName,lastModifiedDateTime,version"; break;
    case "compliance-policy": path = `${root}/${policyId(input.policyId)}`; collection = false; break;
    case "compliance-assignments": path = `${root}/${policyId(input.policyId)}/assignments`; select = "id,source,sourceId,target"; break;
    case "compliance-actions": path = `${root}/${policyId(input.policyId)}`; collection = false; expand = "scheduledActionsForRule($expand=scheduledActionConfigurations)"; break;
    case "managed-devices": path = "/deviceManagement/managedDevices"; select = "id,deviceName,operatingSystem,complianceState,lastSyncDateTime"; break;
    case "conditional-access": path = "/identity/conditionalAccess/policies"; select = "id,displayName,state,conditions,grantControls"; break;
    case "groups": path = "/groups"; select = "id,displayName"; break;
    default: throw new Error("Unknown read recipe.");
  }
  const request: GraphToolInput = { method: "GET", apiVersion: "beta", path, fetchAll: collection, maxItems, maxPages,
    query: { ...(select ? { "$select": select } : {}), ...(expand ? { "$expand": expand } : {}) } };
  const fallbacks: Array<{ path: string; httpStatus: number; graphCode?: unknown; reason: string }> = [];
  let result: GraphToolResult;
  try { result = await reader.graph(request); }
  catch (error) {
    // A base-resource select may be unsupported on a tenant's Intune route. Retry
    // once without projection on this already identified assignment collection only.
    // Never broaden a policy collection to full objects or change credentials/version.
    if (input.recipe !== "compliance-assignments" || !isGreybeardGraphError(error) || error.payload.httpStatus !== 400 ||
      !/select|property/i.test(String(error.payload.details?.graphMessage ?? error.message))) throw error;
    fallbacks.push({ path, httpStatus: 400, graphCode: error.payload.details?.graphCode, reason: "Unsupported selected field; retry the same assignment collection without projection." });
    result = await reader.graph({ ...request, query: {} });
  }
  const data = result.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || (collection ? !Array.isArray(data.value) : typeof data.id !== "string")) throw new Error(`Unexpected response shape for ${input.recipe}. No conclusions can be drawn.`);
  if (input.recipe === "compliance-actions" && !Array.isArray(data.scheduledActionsForRule)) throw new Error("Expanded compliance actions are unavailable; absence is not proof there are no actions.");
  // Nested OData continuations are not followed by the collection pager.
  const nestedIncomplete = hasContinuation(data);
  const meta = { ...result.meta, requests: result.meta.requests + fallbacks.length, truncated: result.meta.truncated || nestedIncomplete };
  return { ...result, meta, evidence: { observedAt: new Date().toISOString(), recipe: input.recipe, path: `/beta${path}`, maxItems, maxPages,
    complete: !meta.truncated, fallbacks, notes: [
      "Read-only observation. Configuration intent and current device health require separate evidence.",
      ...(input.recipe === "compliance-policy" ? ["One identified policy is read without subtype projection, which failed on the verified Intune base route."] : []),
      ...(input.recipe === "compliance-actions" ? ["Use parent expansion; direct action navigation returned a route error during live verification."] : []),
      ...(meta.truncated ? ["Partial results: item/page limits or a nested continuation prevent an exhaustive conclusion."] : [])
    ] } };
}
function hasContinuation(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasContinuation);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (key.endsWith("@odata.nextLink") && typeof child === "string") || hasContinuation(child));
}
function bounded(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  return value;
}
function policyId(value?: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("An exact compliance policy GUID is required. Discover it with compliance-policies first.");
  return value;
}
