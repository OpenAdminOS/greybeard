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
  apiVersion: z.literal("beta").optional().default("beta"),
  path: z.string().min(1),
  query: z.record(z.string(), queryValueSchema.optional()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  fetchAll: z.boolean().optional().default(false),
  maxItems: z.number().int().positive().optional().default(1000)
};

const structuredOutputSchema = z.object({}).catchall(z.unknown());

export function createGreybeardGraphMcpServer(service: GraphService): McpServer {
  const server = new McpServer({
    name: "greybeard-graph",
    version: "0.1"
  });

  server.registerTool(
    "graph",
    {
      title: "Microsoft Graph read tool",
      description: "Read selected Microsoft Graph capabilities through explicit beta requests, bounded paging, and validated all-GET batches.",
      inputSchema: graphInputSchema,
      outputSchema: structuredOutputSchema
    },
    async (input) => withMcpErrors(() => service.graph(input))
  );

  server.registerTool(
    "get-auth-status",
    {
      title: "Get auth status",
      description: "Report the connected application identity and checked roles without exposing a token. User roles and license state are not probed.",
      outputSchema: structuredOutputSchema
    },
    async () => withMcpErrors(() => service.getAuthStatus())
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
  const structuredContent = isObject(value) ? value : { value };
  return {
    isError,
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
