import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listSkillSourceDirs, repoSkillsDir } from "./clients.js";

export interface SkillRequires {
  servers?: string[];
  scopes?: string[];
  license?: string;
  roles?: string[];
  writes?: boolean;
}

export interface SkillManifest {
  name: string;
  category: string;
  dir: string;
  description: string;
  version: string;
  requires?: SkillRequires;
}

export interface SkillManifestLoadResult {
  manifests: SkillManifest[];
  errors: Array<{ name: string; message: string }>;
}

export const REQUIRES_LIST_KEYS = ["servers", "scopes", "roles"] as const;
export const KNOWN_LICENSES = ["entra-p1"] as const;

export const ROLE_GROUPS: Record<string, string[]> = {
  reporting: [
    "Reports Reader",
    "Security Reader",
    "Security Administrator",
    "Global Reader",
    "Global Administrator"
  ],
  security: [
    "Security Reader",
    "Security Administrator",
    "Global Reader",
    "Global Administrator"
  ]
};

export function parseSkillFrontmatter(content: string): Record<string, string | SkillRequires> {
  const normalized = content.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("SKILL.md must start with a --- frontmatter block.");
  }

  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    throw new Error("SKILL.md frontmatter block is not closed with ---.");
  }

  const parsed: Record<string, string | SkillRequires> = {};
  let requires: SkillRequires | null = null;

  for (const line of normalized.slice(4, end).split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    if (line.includes("\t")) {
      throw new Error(`Frontmatter must not contain tabs: ${line}`);
    }

    if (requires !== null && line.startsWith("  ")) {
      if (line.startsWith("   ")) {
        throw new Error(`The requires block supports one level of two-space indentation only: ${line}`);
      }

      parseRequiresLine(requires, line);
      continue;
    }

    requires = null;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!match?.[1]) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const [, key, value] = match;
    if (key in parsed) {
      throw new Error(`Duplicate frontmatter key: ${key}`);
    }

    if (key === "requires") {
      if ((value ?? "").trim().length > 0) {
        throw new Error("The requires key opens a nested block and must not carry an inline value.");
      }

      requires = {};
      parsed[key] = requires;
      continue;
    }

    parsed[key] = value ?? "";
  }

  return parsed;
}

function parseRequiresLine(requires: SkillRequires, line: string): void {
  const match = /^  ([a-z]+):\s*(.*)$/u.exec(line);
  if (!match?.[1]) {
    throw new Error(`Invalid requires line: ${line}`);
  }

  const key = match[1];
  const value = (match[2] ?? "").trim();

  if ((REQUIRES_LIST_KEYS as readonly string[]).includes(key)) {
    const listKey = key as "servers" | "scopes" | "roles";
    if (requires[listKey] !== undefined) {
      throw new Error(`Duplicate requires key: ${key}`);
    }

    requires[listKey] = parseFlowList(key, value);
    return;
  }

  if (key === "license") {
    if (requires.license !== undefined) {
      throw new Error("Duplicate requires key: license");
    }

    if (value.length === 0) {
      throw new Error("requires.license must carry a value.");
    }

    requires.license = value;
    return;
  }

  if (key === "writes") {
    if (requires.writes !== undefined) {
      throw new Error("Duplicate requires key: writes");
    }

    if (value !== "true" && value !== "false") {
      throw new Error(`requires.writes must be true or false, got: ${value}`);
    }

    requires.writes = value === "true";
    return;
  }

  throw new Error(`Unknown requires key: ${key}. Allowed keys: servers, scopes, license, roles, writes.`);
}

function parseFlowList(key: string, value: string): string[] {
  const match = /^\[(.*)\]$/u.exec(value);
  if (!match) {
    throw new Error(`requires.${key} must be a flow-style list like [a, b]: ${value}`);
  }

  const inner = (match[1] ?? "").trim();
  if (inner.length === 0) {
    throw new Error(`requires.${key} must not be an empty list.`);
  }

  return inner.split(",").map((item) => {
    const trimmed = item.trim().replace(/^["']|["']$/gu, "");
    if (trimmed.length === 0) {
      throw new Error(`requires.${key} contains an empty list item: ${value}`);
    }

    return trimmed;
  });
}

export async function loadSkillManifests(repoRoot: string): Promise<SkillManifestLoadResult> {
  const sources = await listSkillSourceDirs(repoSkillsDir(repoRoot));
  const manifests: SkillManifest[] = [];
  const errors: Array<{ name: string; message: string }> = [];

  for (const source of sources) {
    try {
      const content = await readFile(join(source.path, "SKILL.md"), "utf8");
      const frontmatter = parseSkillFrontmatter(content);
      const requires = frontmatter.requires;
      manifests.push({
        name: source.name,
        category: source.category,
        dir: source.path,
        description: typeof frontmatter.description === "string" ? frontmatter.description : "",
        version: typeof frontmatter.version === "string" ? frontmatter.version : "",
        ...(requires !== undefined && typeof requires !== "string" ? { requires } : {})
      });
    } catch (error) {
      errors.push({
        name: source.name,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { manifests, errors };
}
