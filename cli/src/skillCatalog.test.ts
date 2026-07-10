import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIER1_SCOPES, DEFAULT_WRITE_SCOPES, TIER2_SCOPES } from "@greybeard/graph";
import { SERVER_CATALOG } from "./serverCatalog.js";
import {
  KNOWN_LICENSES,
  loadSkillManifests,
  parseSkillFrontmatter,
  ROLE_GROUPS
} from "./skillManifest.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skillsRoot = resolve(repoRoot, ".agents/skills");

const expectedCatalog: Record<string, string[]> = {
  read: [
    "tenant-pulse",
    "ask-my-tenant",
    "intune-assignments",
    "intune-compliance",
    "entra-identity",
    "conditional-access-review",
    "license-optimizer"
  ],
  write: ["change-plan"],
  craft: ["posture-script", "graph-patterns", "kql-authoring", "least-privilege-scopes", "entra-app-credentials"],
  mentor: ["grill-my-change", "tenant-decisions", "diagnose", "handoff", "learn-my-tenant"]
};

const expectedSkills: Array<{ category: string; name: string }> = Object.entries(expectedCatalog)
  .flatMap(([category, names]) => names.map((name) => ({ category, name })));
const knownServers = SERVER_CATALOG.map((server) => server.name);
const knownScopes = new Set(
  [...DEFAULT_TIER1_SCOPES, ...TIER2_SCOPES, ...DEFAULT_WRITE_SCOPES].map((scope) => scope.toLowerCase())
);

describe("Greybeard skill catalog", () => {
  it("contains all expected category and skill folders and no unexpected ones", async () => {
    const categoryEntries = await readdir(skillsRoot, { withFileTypes: true });
    const categories = categoryEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(categories).toEqual(Object.keys(expectedCatalog).sort());

    for (const [category, names] of Object.entries(expectedCatalog)) {
      const entries = await readdir(resolve(skillsRoot, category), { withFileTypes: true });
      const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      expect(folders, category).toEqual([...names].sort());
    }
  });

  it("uses two-field portable frontmatter with unique trigger descriptions", async () => {
    const seenNames = new Set<string>();
    const seenPrefixes = new Map<string, string>();
    for (const { category, name: skillName } of expectedSkills) {
      const content = normalize(await readFile(resolve(skillsRoot, category, skillName, "SKILL.md"), "utf8"));
      const { fields, requires } = parseSkillFrontmatter(content);
      expect(Object.keys(fields).sort(), skillName).toEqual(["description", "name"]);
      expect(requires, skillName).toBeUndefined();
      expect(fields.name, skillName).toBe(skillName);
      expect(seenNames.has(skillName), skillName).toBe(false);
      seenNames.add(skillName);
      expect(fields.description, skillName).toMatch(/^Use when\b/);
      const prefix = String(fields.description).split(/\s+/u).slice(0, 8).join(" ");
      expect(seenPrefixes.get(prefix), `${skillName} trigger overlaps`).toBeUndefined();
      seenPrefixes.set(prefix, skillName);
      expect(content, skillName).not.toMatch(/^Version:/mu);
      expect(content, skillName).not.toMatch(/^## CHANGELOG$/mu);
    }
  });

  it("loads versions and requirements from the central manifest", async () => {
    const { manifests, errors } = await loadSkillManifests(repoRoot);
    expect(errors).toEqual([]);
    expect(manifests.map((manifest) => manifest.name).sort()).toEqual(expectedSkills.map((skill) => skill.name).sort());

    for (const manifest of manifests) {
      expect(manifest.version, manifest.name).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(manifest.category, manifest.name).toBe(expectedSkills.find((skill) => skill.name === manifest.name)?.category);
      for (const server of manifest.requires?.servers ?? []) {
        expect(knownServers, `${manifest.name} requires unknown server ${server}`).toContain(server);
      }
      for (const scope of manifest.requires?.scopes ?? []) {
        expect(knownScopes.has(scope.toLowerCase()), `${manifest.name} requires unknown scope ${scope}`).toBe(true);
      }
      if (manifest.requires?.license) {
        expect(KNOWN_LICENSES, manifest.name).toContain(manifest.requires.license);
      }
      for (const role of manifest.requires?.roles ?? []) {
        expect(Object.keys(ROLE_GROUPS), `${manifest.name} requires unknown role group ${role}`).toContain(role);
      }
    }
  });

  it("includes UI metadata, memory preamble, and a trigger test for every skill", async () => {
    const preamble = [
      "Before other work, when `greybeard-memory` tools are available, call `recall` with a one-line task summary.",
      "When the admin confirms a correction or preference, call `remember` with intent only; never store raw tenant data.",
      "When a crafted query, script, or approach is confirmed working, or a durable fact about the environment surfaces, `recall` for an equivalent memory first, then `remember` the reusable intent; ask before storing anything the admin has not explicitly confirmed."
    ].join("\n");

    for (const { category, name } of expectedSkills) {
      const dir = resolve(skillsRoot, category, name);
      const content = normalize(await readFile(resolve(dir, "SKILL.md"), "utf8"));
      expect(content, name).toContain(preamble);
      await expect(access(resolve(dir, "test.md"), constants.R_OK), name).resolves.toBeUndefined();
      const metadata = await readFile(resolve(dir, "agents", "openai.yaml"), "utf8");
      expect(metadata, name).toContain("interface:");
      expect(metadata, name).toContain("display_name:");
      expect(metadata, name).toContain("short_description:");
      expect(metadata, name).toContain(`$${name}`);
    }
  });
});

function normalize(content: string): string {
  return content.replace(/\r\n/gu, "\n");
}
