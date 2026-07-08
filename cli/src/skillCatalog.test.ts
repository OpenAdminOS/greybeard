import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIER1_SCOPES, DEFAULT_WRITE_SCOPES, TIER2_SCOPES } from "@greybeard/graph";
import { SERVER_CATALOG } from "./serverCatalog.js";
import {
  KNOWN_LICENSES,
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
  craft: ["posture-script", "graph-patterns", "kql-authoring", "least-privilege-scopes"],
  mentor: ["grill-my-change", "tenant-decisions", "diagnose", "handoff"]
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
      const folders = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      expect(folders, category).toEqual([...names].sort());
    }
  });

  it("uses portable frontmatter with unique trigger descriptions", async () => {
    const seenNames = new Set<string>();
    const seenPrefixes = new Map<string, string>();

    for (const { category, name: skillName } of expectedSkills) {
      const skillPath = resolve(skillsRoot, category, skillName, "SKILL.md");
      const content = (await readFile(skillPath, "utf8")).replace(/\r\n/gu, "\n");
      const { fields } = parseSkillFrontmatter(content);

      expect(Object.keys(fields).sort(), skillName).toEqual(["description", "name", "version"]);

      const { name, description, version } = fields;
      expect(name, skillName).toBe(skillName);
      expect(version, skillName).toMatch(/^\d+\.\d+\.\d+$/);
      expect(content, skillName).toContain(`\nVersion: ${version}\n`);
      expect(seenNames.has(name), `${skillName} duplicates a skill name in another category`).toBe(false);
      seenNames.add(name);

      expect(description, skillName).toMatch(/^Use when\b/);

      const firstEightWords = description.split(/\s+/).slice(0, 8).join(" ");
      const previous = seenPrefixes.get(firstEightWords);
      expect(previous, `${skillName} overlaps first 8 words with ${previous}`).toBeUndefined();
      seenPrefixes.set(firstEightWords, skillName);
    }
  });

  it("declares requires blocks that reference known servers, scopes, licenses, and role groups", async () => {
    for (const { category, name: skillName } of expectedSkills) {
      const skillPath = resolve(skillsRoot, category, skillName, "SKILL.md");
      const content = (await readFile(skillPath, "utf8")).replace(/\r\n/gu, "\n");
      const { requires } = parseSkillFrontmatter(content);
      if (requires === undefined) {
        continue;
      }

      for (const server of requires.servers ?? []) {
        expect(knownServers, `${skillName} requires unknown server ${server}`).toContain(server);
      }

      for (const scope of requires.scopes ?? []) {
        expect(knownScopes.has(scope.toLowerCase()), `${skillName} requires unknown scope ${scope}`).toBe(true);
      }

      if (requires.license !== undefined) {
        expect(KNOWN_LICENSES, skillName).toContain(requires.license);
      }

      for (const role of requires.roles ?? []) {
        expect(Object.keys(ROLE_GROUPS), `${skillName} requires unknown role group ${role}`).toContain(role);
      }
    }
  });

  it("includes a trigger test document for every skill", async () => {
    for (const { category, name: skillName } of expectedSkills) {
      await expect(access(resolve(skillsRoot, category, skillName, "test.md"), constants.R_OK), skillName)
        .resolves
        .toBeUndefined();
    }
  });
});
