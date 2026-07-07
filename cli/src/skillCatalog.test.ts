import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skillsRoot = resolve(repoRoot, ".agents/skills");

const expectedSkills = [
  "tenant-pulse",
  "ask-my-tenant",
  "posture-script",
  "change-plan",
  "least-privilege-scopes",
  "graph-patterns",
  "kql-authoring",
  "intune-assignments",
  "intune-compliance",
  "entra-identity",
  "conditional-access-review",
  "license-optimizer"
];

describe("Greybeard skill catalog", () => {
  it("contains all v1 skill folders and no unexpected skill folders", async () => {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(folders).toEqual([...expectedSkills].sort());
  });

  it("uses portable frontmatter with unique trigger descriptions", async () => {
    const seenNames = new Set<string>();
    const seenPrefixes = new Map<string, string>();

    for (const skillName of expectedSkills) {
      const skillPath = resolve(skillsRoot, skillName, "SKILL.md");
      const content = normalizeLineEndings(await readFile(skillPath, "utf8"));
      const frontmatter = parseFrontmatter(content);
      const keys = Object.keys(frontmatter).sort();

      expect(keys, skillName).toEqual(["description", "name", "version"]);
      expect(frontmatter.name, skillName).toBe(skillName);
      expect(frontmatter.version, skillName).toBe("0.1.0");
      expect(seenNames.has(frontmatter.name), skillName).toBe(false);
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
    for (const skillName of expectedSkills) {
      await expect(access(resolve(skillsRoot, skillName, "test.md"), constants.R_OK), skillName)
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
