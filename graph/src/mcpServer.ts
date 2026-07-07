import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GreybeardGraphError, isGreybeardGraphError } from "./errors.js";
import { GraphService } from "./graphService.js";

const queryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null()
]);

const graphInputSchema = {
  method: z.string().optional().default("GET"),
  apiVersion: z.enum(["v1.0", "beta"]).optional().default("beta"),
  path: z.string().min(1),
  query: z.record(z.string(), queryValueSchema.optional()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  fetchAll: z.boolean().optional().default(false),
  maxItems: z.number().int().positive().optional().default(1000)
};

const addScopeInputSchema = {
  scopes: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1)
};

const writeOperationSchema = z.object({
  method: z.string().min(1),
  apiVersion: z.enum(["v1.0", "beta"]).optional().default("beta"),
  path: z.string().min(1),
  body: z.unknown().optional(),
  reason: z.string().min(1)
});

const planWriteInputSchema = {
  summary: z.string().min(1),
  rollback: z.string().min(1),
  stopOnError: z.boolean().optional().default(true),
  prefetch: z.boolean().optional().default(true),
  operations: z.array(writeOperationSchema).min(1).max(50)
};

const checkPlanInputSchema = {
  planId: z.string().regex(/^gbp_[0-9a-f]{8}$/)
};

const executePlanInputSchema = {
  planId: z.string().regex(/^gbp_[0-9a-f]{8}$/),
  token: z.string().min(1)
};

export function createGreybeardGraphMcpServer(service: GraphService): McpServer {
  const server = new McpServer({
    name: "greybeard-graph",
    version: "0.1.0"
  });

  service.setClientContextProvider(() => ({
    clientInfo: server.server.getClientVersion(),
    clientCapabilities: server.server.getClientCapabilities(),
    elicitInput: async (params) => {
      const result = await server.server.elicitInput(params as never);
      return {
        action: result.action,
        content: result.content as Record<string, string | number | boolean | string[]> | undefined
      };
    }
  }));

  server.registerTool(
    "graph",
    {
      title: "Microsoft Graph read tool",
      description: "Read Microsoft Graph with GET requests, beta by default, scoped query parameters, fetchAll pagination, and all-GET batch passthrough.",
      inputSchema: graphInputSchema
    },
    async (input) => withMcpErrors(() => service.graph(input))
  );

  server.registerTool(
    "plan-write",
    {
      title: "Plan Microsoft Graph write",
      description: "Validate and store a Microsoft Graph write plan, then open a human approval channel without returning any approval URL or secret.",
      inputSchema: planWriteInputSchema
    },
    async (input) => withMcpErrors(() => service.planWrite(input))
  );

  server.registerTool(
    "check-plan",
    {
      title: "Check write plan",
      description: "Long-poll a write plan for approval, rejection, timeout, expiry, or execution results. Delivers an approval token exactly once.",
      inputSchema: checkPlanInputSchema
    },
    async (input) => withMcpErrors(() => service.checkPlan(input))
  );

  server.registerTool(
    "execute-plan",
    {
      title: "Execute approved write plan",
      description: "Replay the server-stored approved Microsoft Graph write operations with a single-use token.",
      inputSchema: executePlanInputSchema
    },
    async (input) => withMcpErrors(() => service.executePlan(input))
  );

  server.registerTool(
    "get-auth-status",
    {
      title: "Get auth status",
      description: "Report Greybeard Microsoft Graph sign-in, credential mode, granted scopes, Entra P1, directory roles, cache protection, and write gate state."
    },
    async () => withMcpErrors(() => service.getAuthStatus())
  );

  server.registerTool(
    "add-scope",
    {
      title: "Add Graph scope",
      description: "Request incremental Microsoft Graph delegated scopes on the active credential, with admin-consent handoff when needed.",
      inputSchema: addScopeInputSchema
    },
    async (input) => withMcpErrors(() => service.addScope(input))
  );

  return server;
}

export async function withMcpErrors<T>(operation: () => Promise<T>) {
  try {
    return toMcpJsonResult(await operation());
  } catch (error) {
    if (isGreybeardGraphError(error)) {
      return toMcpJsonResult({ error: error.toJSON() }, true);
    }

    const payload = new GreybeardGraphError({
      code: "graph-request-failed",
      message: error instanceof Error ? error.message : String(error),
      guidance: "Report the server error and retry only after the underlying issue is fixed."
    });
    return toMcpJsonResult({ error: payload.toJSON() }, true);
  }
}

function toMcpJsonResult(value: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
