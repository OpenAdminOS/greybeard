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

export interface SkillFrontmatter {
  fields: Record<string, string>;
  requires?: SkillRequires;
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

export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  if (lines[0] !== "---") {
    throw new Error("SKILL.md must start with a --- frontmatter block.");
  }

  const closer = lines.indexOf("---", 1);
  if (closer < 0) {
    throw new Error("SKILL.md frontmatter block is not closed with ---.");
  }

  const fields: Record<string, string> = {};
  let requires: SkillRequires | undefined;
  let inRequiresBlock = false;

  for (const line of lines.slice(1, closer)) {
    if (line.trim().length === 0) {
      continue;
    }

    if (line.includes("\t")) {
      throw new Error(`Frontmatter must not contain tabs: ${line}`);
    }

    if (inRequiresBlock && requires !== undefined && line.startsWith("  ")) {
      if (line.startsWith("   ")) {
        throw new Error(`The requires block supports one level of two-space indentation only: ${line}`);
      }

      parseRequiresLine(requires, line);
      continue;
    }

    inRequiresBlock = false;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!match?.[1]) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    const [, key, value] = match;
    if (key in fields || (key === "requires" && requires !== undefined)) {
      throw new Error(`Duplicate frontmatter key: ${key}`);
    }

    if (key === "requires") {
      if ((value ?? "").trim().length > 0) {
        throw new Error("The requires key opens a nested block and must not carry an inline value.");
      }

      requires = {};
      inRequiresBlock = true;
      continue;
    }

    fields[key] = value ?? "";
  }

  return {
    fields,
    ...(requires !== undefined ? { requires } : {})
  };
}

function parseRequiresLine(requires: SkillRequires, line: string): void {
  const match = /^  ([a-z]+):\s*(.*)$/u.exec(line);
  if (!match?.[1]) {
    throw new Error(`Invalid requires line: ${line}`);
  }

  const key = match[1];
  const value = (match[2] ?? "").trim();

  if (key === "servers" || key === "scopes" || key === "roles") {
    if (requires[key] !== undefined) {
      throw new Error(`Duplicate requires key: ${key}`);
    }

    requires[key] = parseFlowList(key, value);
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
  const tree = await listSkillSourceDirs(repoSkillsDir(repoRoot));
  const manifests: SkillManifest[] = [];
  const errors: Array<{ name: string; message: string }> = [];

  for (const skipped of tree.missingManifest) {
    errors.push({
      name: skipped.name,
      message: `SKILL.md is missing in ${skipped.category}/${skipped.name}.`
    });
  }

  for (const duplicate of tree.duplicates) {
    errors.push({
      name: `${duplicate.category}/${duplicate.name}`,
      message: `Duplicate skill folder name; "${duplicate.name}" already exists in "${duplicate.existingCategory}".`
    });
  }

  for (const source of tree.sources) {
    try {
      const content = await readFile(join(source.path, "SKILL.md"), "utf8");
      const frontmatter = parseSkillFrontmatter(content);
      manifests.push({
        name: source.name,
        category: source.category,
        dir: source.path,
        description: frontmatter.fields.description ?? "",
        version: frontmatter.fields.version ?? "",
        ...(frontmatter.requires !== undefined ? { requires: frontmatter.requires } : {})
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
