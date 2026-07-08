import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
  craft: ["posture-script", "graph-patterns", "kql-authoring", "least-privilege-scopes"]
};

const expectedSkills: Array<{ category: string; name: string }> = Object.entries(expectedCatalog)
  .flatMap(([category, names]) => names.map((name) => ({ category, name })));

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
      const content = normalizeLineEndings(await readFile(skillPath, "utf8"));
      const frontmatter = parseFrontmatter(content);
      const keys = Object.keys(frontmatter).sort();

      expect(keys, skillName).toEqual(["description", "name", "version"]);
      expect(frontmatter.name, skillName).toBe(skillName);
      expect(frontmatter.version, skillName).toBe("0.1.0");
      expect(seenNames.has(frontmatter.name), `${skillName} duplicates a skill name in another category`).toBe(false);
      seenNames.add(frontmatter.name);

      expect(frontmatter.description, skillName).toMatch(/^Use when\b/);

      const firstEightWords = frontmatter.description.split(/\s+/).slice(0, 8).join(" ");
      const previous = seenPrefixes.get(firstEightWords);
      expect(previous, `${skillName} overlaps first 8 words with ${previous}`).toBeUndefined();
      seenPrefixes.set(firstEightWords, skillName);

      expect(content, skillName).toMatch(/^Version: 0\.1\.0$/m);
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

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/gu, "\n");
}

function parseFrontmatter(content: string): Record<string, string> {
  const normalized = normalizeLineEndings(content);
  expect(normalized.startsWith("---\n")).toBe(true);
  const end = normalized.indexOf("\n---", 4);
  expect(end).toBeGreaterThan(0);

  const raw = normalized.slice(4, end);
  const parsed: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    expect(match, `invalid frontmatter line: ${line}`).not.toBeNull();
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    parsed[key] = value;
  }

  return parsed;
}
