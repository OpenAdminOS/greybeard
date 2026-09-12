import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getGreybeardAppDataPath } from "./appData.js";
import { readGreybeardConfig } from "./config.js";
import { AppOnlyGraphAuthProvider } from "./appOnlyAuth.js";
import { GraphService } from "./graphService.js";
import { createGreybeardGraphMcpServer } from "./mcpServer.js";

export async function runGraphServer(): Promise<void> {
  const appDataPath = getGreybeardAppDataPath();
  const config = await readGreybeardConfig(appDataPath);
  if (!config.appOnlyProfile) throw new Error("Tenant is not connected. Continue using the local mentor or run greybeard connect with your own app registration.");
  if ((process.env.GREYBEARD_TENANT_ID && process.env.GREYBEARD_TENANT_ID !== config.appOnlyProfile.tenantId)
    || (process.env.GREYBEARD_CLIENT_ID && process.env.GREYBEARD_CLIENT_ID !== config.appOnlyProfile.clientId)) throw new Error("Client connection identity changed. Rerun setup and reconnect this AI client.");
  const auth = await AppOnlyGraphAuthProvider.create(config.appOnlyProfile, appDataPath);
  const service = new GraphService({ auth, appDataPath });
  const server = createGreybeardGraphMcpServer(service);
  await server.connect(new StdioServerTransport());
}
