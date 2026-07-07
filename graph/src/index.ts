#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getGreybeardAppDataPath } from "./appData.js";
import { graphAuthConfig, readGreybeardConfig } from "./config.js";
import { GraphService } from "./graphService.js";
import { createGreybeardGraphMcpServer } from "./mcpServer.js";
import { MsalGraphAuthProvider } from "./msalAuth.js";

async function main(): Promise<void> {
  const appDataPath = getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  const auth = await MsalGraphAuthProvider.create({
    ...graphAuthConfig(config),
    appDataPath
  });
  const service = new GraphService({ auth, appDataPath });
  const server = createGreybeardGraphMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
