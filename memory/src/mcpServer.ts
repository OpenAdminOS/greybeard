import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryService } from "./service.js";
import { EDGE_RELATIONS, MEMORY_TYPES, isGreybeardMemoryError } from "./types.js";

const memoryTypeSchema = z.enum(MEMORY_TYPES);
const edgeRelationSchema = z.enum(EDGE_RELATIONS);

const recallInputSchema = {
  query: z.string().min(1),
  limit: z.number().int().positive().optional().default(5)
};

const rememberInputSchema = {
  type: memoryTypeSchema,
  content: z.string().min(1),
  links: z.array(z.object({
    target: z.number().int().positive(),
    relation: edgeRelationSchema,
    weight: z.number().positive().optional()
  })).optional().default([])
};

const listInputSchema = {
  type: memoryTypeSchema.optional(),
  limit: z.number().int().positive().optional().default(50)
};

const forgetInputSchema = {
  id: z.number().int().positive().optional(),
  olderThanDays: z.number().positive().optional(),
  type: memoryTypeSchema.optional()
};

export function createGreybeardMemoryMcpServer(service: MemoryService): McpServer {
  const server = new McpServer({
    name: "greybeard-memory",
    version: "0.1.0"
  });

  server.registerTool(
    "recall",
    {
      title: "Recall Greybeard memory",
      description: "Search local Greybeard memory for the active tenant using a short task summary.",
      inputSchema: recallInputSchema
    },
    async (input) => withMemoryMcpErrors(() => service.recall(input))
  );

  server.registerTool(
    "remember",
    {
      title: "Remember Greybeard preference",
      description: "Store a local tenant-scoped intent, preference, script reference, fact, or scope note. Never store raw tenant output.",
      inputSchema: rememberInputSchema
    },
    async (input) => withMemoryMcpErrors(() => service.remember(input))
  );

  server.registerTool(
    "list",
    {
      title: "List Greybeard memory",
      description: "List local memory nodes for the active tenant, newest first.",
      inputSchema: listInputSchema
    },
    async (input) => withMemoryMcpErrors(() => service.list(input))
  );

  server.registerTool(
    "forget",
    {
      title: "Forget Greybeard memory",
      description: "Delete a local memory node by id, or prune old nodes of one type for the active tenant.",
      inputSchema: forgetInputSchema
    },
    async (input) => withMemoryMcpErrors(() => service.forget(input))
  );

  return server;
}

export async function withMemoryMcpErrors<T>(operation: () => Promise<T>) {
  try {
    return toMcpJsonResult(await operation());
  } catch (error) {
    if (isGreybeardMemoryError(error)) {
      return toMcpJsonResult({ error: error.toJSON() }, true);
    }

    return toMcpJsonResult({
      error: {
        code: "memory-server-error",
        message: error instanceof Error ? error.message : String(error),
        guidance: "Report the server error and retry only after the underlying issue is fixed."
      }
    }, true);
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
