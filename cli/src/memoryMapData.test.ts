import { expect, it } from "vitest";
import type { MemoryExport, MemoryNode } from "@greybeard/memory";
import { buildMemoryMap } from "./memoryMapData.js";

function node(id: number, overrides: Partial<MemoryNode> = {}): MemoryNode {
  return { id, revision: String(id), type: "preference", content: `Pilot lesson ${id}`, tenant: "local", profileId: "local", createdAt: id, lastUsedAt: id, status: "confirmed", source: "automatic-cursor", scope: "global", confirmedAt: id, confirmationChannel: "local-ui", supersedes: null, supersededAt: null, ...overrides };
}
function data(nodes: MemoryNode[]): MemoryExport {
  return { version: 1, tenant: "local", profileId: "local", nodes, edges: [] };
}
it("preserves recorded provenance and only includes edges whose endpoints are visible", () => {
  const memory = data([node(1, { supersededAt: 3 }), node(2, { source: "mcp-agent", status: "candidate" }), node(3, { supersedes: 1 }), node(4, { content: "Different topic" })]);
  memory.edges = [{ source: 2, target: 4, relation: "depends_on", weight: .7 }];
  const map = buildMemoryMap(memory, {});
  expect(map.edges).toEqual([...memory.edges.map(edge => ({ ...edge, kind: "recorded" })), { source: 3, target: 1, relation: "corrects", weight: 1, kind: "correction" }]);
  expect(map.nodes.find(n => n.id === 2)?.source).toBe("mcp-agent");
  expect(buildMemoryMap(memory, { query: "PILOT", status: "confirmed" }).nodes.map(n => n.id)).toEqual([3]);
  expect(buildMemoryMap(memory, { query: "pilot", status: "confirmed" }).edges).toEqual([]);
  expect(buildMemoryMap(memory, { status: "superseded" }).nodes.map(n => n.id)).toEqual([1]);
  expect(buildMemoryMap(memory, { source: "mcp-agent", since: 2, until: 2 }).nodes.map(n => n.id)).toEqual([2]);
  // Forgetting either endpoint must also remove its connection from the map.
  memory.nodes = memory.nodes.filter(n => n.id !== 1 && n.id !== 4);
  expect(buildMemoryMap(memory, {}).edges).toEqual([]);
});
it("bounds the response, searches before truncation and handles large histories", () => {
  const memory = data(Array.from({ length: 150_000 }, (_, i) => node(i + 1)));
  const map = buildMemoryMap(memory, { limit: 100000 });
  expect(map.nodes).toHaveLength(200);
  expect(map.nodes[0].id).toBe(150000);
  expect(map.matched).toBe(150000);
  expect(map.earliest).toBe(1);
  expect(map.latest).toBe(150000);
  expect(buildMemoryMap(memory, { query: "Pilot lesson 1", limit: 500 }).nodes).toHaveLength(500);
  expect(buildMemoryMap(data([]), {})).toMatchObject({ nodes: [], edges: [], earliest: null, latest: null });
});
