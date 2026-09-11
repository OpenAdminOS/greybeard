import { APPLICATION_CAPABILITIES } from "./appOnlyAuth.js";
import { isGreybeardGraphError } from "./errors.js";
import type { AppOnlyProfile } from "./writeGateTypes.js";
import type { GraphReader } from "./readRecipes.js";

export type CapabilityReadiness = {
  key: string; label: string; permission: string; endpoint: string; fields: string; selected: boolean;
  state: "not-selected" | "unverified" | "ready" | "blocked" | "error";
  checkedAt?: string; diagnostic?: { message: string; httpStatus?: number; graphCode?: string; guidance: string };
};
export async function previewCapabilities(profile?: AppOnlyProfile, reader?: GraphReader) {
  const capabilities: CapabilityReadiness[] = [];
  for (const [key, capability] of Object.entries(APPLICATION_CAPABILITIES)) {
    const selected = profile?.capabilities.includes(key) ?? false;
    const item: CapabilityReadiness = { key, label: capability.label, permission: capability.permission,
      endpoint: `/beta${capability.path}`, fields: capability.select, selected, state: selected ? "unverified" : "not-selected" };
    if (selected && reader) {
      item.checkedAt = new Date().toISOString();
      try {
        const result = await reader.graph({ method: "GET", apiVersion: "beta", path: capability.path,
          query: { "$select": capability.select, "$top": 1 }, fetchAll: false, maxPages: 1 });
        if (!result.data || typeof result.data !== "object" || !Array.isArray((result.data as Record<string, unknown>).value)) throw new Error("The read probe returned an unexpected response shape.");
        item.state = "ready";
      } catch (error) {
        const payload = isGreybeardGraphError(error) ? error.payload : undefined;
        item.state = payload?.httpStatus === 401 || payload?.httpStatus === 403 ? "blocked" : "error";
        item.diagnostic = {
          message: String(payload?.details?.graphMessage ?? (error instanceof Error ? error.message : "Read probe failed.")),
          ...(payload?.httpStatus ? { httpStatus: payload.httpStatus } : {}),
          ...(payload?.details?.graphCode ? { graphCode: String(payload.details.graphCode) } : {}),
          guidance: "Review this endpoint and diagnostic with the selected application permission in Entra. No access was added. A failed probe does not by itself identify a missing grant or license."
        };
      }
    }
    capabilities.push(item);
  }
  return { configured: Boolean(profile), mentorAvailable: true, tenantId: profile?.tenantId, clientId: profile?.clientId,
    verifiedNow: Boolean(profile && reader), capabilities,
    minimumGrantsVerified: false,
    explanation: "Readiness covers the selected one-page probe at the shown time. It does not verify every related endpoint, current tenant health, or isolated minimum grants. No permissions are selected automatically." };
}
