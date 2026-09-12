import type { MemoryExport } from "@greybeard/memory";

export function buildMemoryMap(memory: MemoryExport, options: Record<string, unknown>) {
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const source = typeof options.source === "string" ? options.source : "";
  const status = ["candidate", "confirmed", "superseded"].includes(String(options.status)) ? options.status : "";
  const since = typeof options.since === "number" && Number.isFinite(options.since) ? options.since : 0;
  const until = typeof options.until === "number" && Number.isFinite(options.until) ? options.until : Infinity;
  const limit = [200, 500, 1000].includes(Number(options.limit)) ? Number(options.limit) : 200;
  const matched = memory.nodes.filter(node => (!query || node.content.toLowerCase().includes(query))
    && (!source || node.source === source)
    && (!status || (status === "superseded" ? node.supersededAt !== null : node.status === status && node.supersededAt === null))
    && node.createdAt >= since && node.createdAt <= until)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  const nodes = matched.slice(0, limit);
  const ids = new Set(nodes.map(node => node.id));
  const edges = memory.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .map(edge => ({ ...edge, kind: "recorded" as const }));
  const corrections = nodes.filter(node => node.supersedes !== null && ids.has(node.supersedes))
    .map(node => ({ source: node.id, target: node.supersedes!, relation: "corrects", weight: 1, kind: "correction" as const }));
  return {
    profileId: memory.profileId, tenant: memory.tenant, nodes, edges: [...edges, ...corrections],
    total: memory.nodes.length, matched: matched.length, limit,
    sources: [...new Set(memory.nodes.map(node => node.source))].sort(),
    earliest: memory.nodes.length ? memory.nodes.reduce((value, node) => Math.min(value, node.createdAt), Infinity) : null,
    latest: memory.nodes.length ? memory.nodes.reduce((value, node) => Math.max(value, node.createdAt), -Infinity) : null
  };
}
