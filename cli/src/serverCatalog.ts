export type CatalogServerSource =
  | { kind: "workspace"; packageName: "@greybeard/graph" | "@greybeard/memory"; packageDir: "graph" | "memory" }
  | { kind: "npm"; packageName: string };

export type CatalogServer = {
  name: string;
  description: string;
  required: boolean;
  defaultEnabled: boolean;
  source: CatalogServerSource;
};

export const SERVER_CATALOG: readonly CatalogServer[] = [
  {
    name: "greybeard-graph",
    description: "Microsoft Graph access with the plan/approve write gate",
    required: true,
    defaultEnabled: true,
    source: {
      kind: "workspace",
      packageName: "@greybeard/graph",
      packageDir: "graph"
    }
  },
  {
    name: "greybeard-memory",
    description: "Tenant-scoped memory (recall/remember)",
    required: true,
    defaultEnabled: true,
    source: {
      kind: "workspace",
      packageName: "@greybeard/memory",
      packageDir: "memory"
    }
  },
  {
    name: "intuneautomation",
    description: "IntuneAutomation PowerShell script library",
    required: false,
    defaultEnabled: true,
    source: {
      kind: "npm",
      packageName: "@ugurkocde/intuneautomation-mcp"
    }
  }
];

export function isServerEnabled(server: CatalogServer, toggles: Record<string, boolean> | undefined): boolean {
  if (server.required) {
    return true;
  }

  return toggles?.[server.name] ?? server.defaultEnabled;
}

export function enabledCatalogServers(toggles: Record<string, boolean> | undefined): CatalogServer[] {
  return SERVER_CATALOG.filter((server) => isServerEnabled(server, toggles));
}

export function optionalCatalogServers(): CatalogServer[] {
  return SERVER_CATALOG.filter((server) => !server.required);
}

export function findCatalogServer(name: string): CatalogServer | undefined {
  return SERVER_CATALOG.find((server) => server.name === name);
}
