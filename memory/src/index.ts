#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getGreybeardAppDataPath } from "@greybeard/graph";
import { createGreybeardMemoryMcpServer } from "./mcpServer.js";
import { MemoryService } from "./service.js";

async function main(): Promise<void> {
  const appDataPath = process.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath();
  const service = new MemoryService({ appDataPath });
  const server = createGreybeardMemoryMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
