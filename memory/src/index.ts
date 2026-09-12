#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createGreybeardMemoryMcpServer } from "./mcpServer.js";
import { MemoryService } from "./service.js";

async function main(): Promise<void> {
  const appDataPath = process.env.GREYBEARD_APP_DATA || defaultAppDataPath();
  try {
    const backend = JSON.parse(await readFile(join(appDataPath, "memory-backend.json"), "utf8"));
    if (backend.mode !== "local") throw new Error("Shared memory requires the bundled greybeard mcp memory command. Update this legacy MCP entry.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const service = new MemoryService({ appDataPath });
  const server = createGreybeardMemoryMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function defaultAppDataPath(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "greybeard");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "greybeard");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "greybeard");
}
