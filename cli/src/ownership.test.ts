import { describe, expect, it } from "vitest";
import { findCatalogServer, isGreybeardManagedEntry } from "./serverCatalog.js";
const server = findCatalogServer("greybeard-memory")!;
describe("integration ownership", () => {
  it("recognizes a structured owner marker and exact subcommand in JSON and TOML", () => {
    expect(isGreybeardManagedEntry(server, JSON.stringify({ command: "/bin/greybeard", args: ["mcp", "memory"], env: { GREYBEARD_MANAGED: "0.1" } }))).toBe(true);
    expect(isGreybeardManagedEntry(server, '[mcp_servers.greybeard-memory]\ncommand = "/bin/greybeard"\nargs = ["mcp", "memory"]\nenv = { "GREYBEARD_MANAGED" = "0.1", "GREYBEARD_APP_DATA" = "/data" }')).toBe(true);
  });
  it("preserves incidental package names, arbitrary markers in arguments, and another checkout", () => {
    for (const entry of [
      { command: "foreign", args: ["@greybeard/memory"] },
      { command: "foreign", args: ["GREYBEARD_MANAGED", "0.1"] },
      { command: "foreign", args: ["other"], env: { GREYBEARD_MANAGED: "0.1" } },
      { command: "node", args: ["/other/memory/dist/index.js"] }
    ]) expect(isGreybeardManagedEntry(server, JSON.stringify(entry), "/ours")).toBe(false);
  });
  it("recognizes only this checkout's precise legacy node entry", () => {
    expect(isGreybeardManagedEntry(server, JSON.stringify({ command: "/bin/node", args: ["/ours/memory/dist/index.js"] }), "/ours")).toBe(true);
  });
});
