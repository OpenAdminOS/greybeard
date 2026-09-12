import type { GreybeardConfig, ServerPackageSource, ServerUpdateMode } from "@greybeard/graph";

export type CatalogServerSource =
  | { kind: "workspace"; packageName: "@greybeard/graph" | "@greybeard/memory"; packageDir: "graph" | "memory" }
  | { kind: "npm"; packageName: string; pinnedVersion: string };

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
    description: "Optional read-only tenant connection",
    required: false,
    defaultEnabled: false,
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
    defaultEnabled: false,
    source: {
      kind: "npm",
      packageName: "@ugurkocde/intuneautomation-mcp",
      pinnedVersion: "1.0.1"
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

export function isGreybeardManagedEntry(server: CatalogServer, entryText: string, repoRoot?: string): boolean {
  let command: unknown; let args: unknown; let marker: unknown;
  try {
    const entry = JSON.parse(entryText) as { command?: unknown; args?: unknown; env?: Record<string, unknown> };
    command = entry.command; args = entry.args; marker = entry.env?.GREYBEARD_MANAGED;
  } catch {
    // Our TOML writer uses JSON-compatible strings/arrays and an inline env table.
    try {
      command = JSON.parse(/^command\s*=\s*("(?:[^"\\]|\\.)*")\s*$/mu.exec(entryText)?.[1] ?? "null");
      args = JSON.parse(/^args\s*=\s*(\[.*\])\s*$/mu.exec(entryText)?.[1] ?? "null");
      const env = /^env\s*=\s*\{([^\n]*)\}\s*$/mu.exec(entryText)?.[1] ?? "";
      marker = /(?:^|,)\s*"GREYBEARD_MANAGED"\s*=\s*"0\.1"\s*(?:,|$)/u.test(env) ? "0.1" : undefined;
    } catch { return false; }
  }
  if (typeof command !== "string" || !Array.isArray(args) || !args.every(value => typeof value === "string")) return false;
  if (server.source.kind === "workspace" && marker === "0.1") {
    return args.length >= 2 && args.at(-2) === "mcp" && args.at(-1) === server.source.packageDir;
  }
  // Legacy entries without an ownership marker are only recognized at this
  // exact checkout path. An incidental package/path string is never ownership.
  const normalized = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (server.source.kind === "workspace" && repoRoot && args.length === 1 && /(?:^|[/\\])node(?:\.exe)?$/iu.test(command)) {
    return normalized(args[0]) === `${normalized(repoRoot)}/${server.source.packageDir}/dist/index.js`;
  }
  return false;
}

export function serverOptionsFromConfig(config: GreybeardConfig): {
  serverUpdate: ServerUpdateMode;
  serverPackageSource: ServerPackageSource;
  serverToggles: Record<string, boolean>;
} {
  return {
    serverUpdate: config.serverUpdate ?? "latest",
    serverPackageSource: config.serverPackageSource ?? "local",
    serverToggles: { ...config.mcpServers, "greybeard-graph": Boolean(config.appOnlyProfile) }
  };
}
