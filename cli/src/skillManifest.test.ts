import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter, ROLE_GROUPS, type SkillRequires } from "./skillManifest.js";

function frontmatter(lines: string[]): string {
  return ["---", ...lines, "---", "", "# Body"].join("\n");
}

describe("parseSkillFrontmatter", () => {
  it("parses scalar keys and a nested requires block", () => {
    const parsed = parseSkillFrontmatter(frontmatter([
      "name: tenant-pulse",
      "description: Use when the user asks about tenant health.",
      "version: 0.2.0",
      "requires:",
      "  servers: [greybeard-graph]",
      "  scopes: [User.Read.All, AuditLog.Read.All]",
      "  license: entra-p1",
      "  roles: [reporting]",
      "  writes: false"
    ]));

    expect(parsed.fields.name).toBe("tenant-pulse");
    expect(parsed.fields.version).toBe("0.2.0");
    expect(parsed.requires).toEqual({
      servers: ["greybeard-graph"],
      scopes: ["User.Read.All", "AuditLog.Read.All"],
      license: "entra-p1",
      roles: ["reporting"],
      writes: false
    } satisfies SkillRequires);
  });

  it("parses quoted flow-list items and boolean writes", () => {
    const parsed = parseSkillFrontmatter(frontmatter([
      "name: change-plan",
      "description: Use when writing.",
      "version: 0.2.0",
      "requires:",
      "  servers: [\"greybeard-graph\"]",
      "  writes: true"
    ]));

    expect(parsed.requires).toEqual({
      servers: ["greybeard-graph"],
      writes: true
    });
  });

  it("keeps parsing top-level keys after the requires block ends", () => {
    const parsed = parseSkillFrontmatter(frontmatter([
      "name: x",
      "requires:",
      "  writes: true",
      "version: 0.1.0"
    ]));

    expect(parsed.fields.version).toBe("0.1.0");
    expect(parsed.requires).toEqual({ writes: true });
  });

  it("accepts an empty frontmatter block and treats dash-prefixed lines as content, not closers", () => {
    expect(parseSkillFrontmatter("---\n---\n# Title\n")).toEqual({ fields: {} });
    expect(() => parseSkillFrontmatter("---\nname: x\n----\n---\n"))
      .toThrow(/Invalid frontmatter line: ----/);
    expect(() => parseSkillFrontmatter("---\nname: x\n"))
      .toThrow(/not closed/);
  });

  it("rejects tabs, deep indentation, unknown keys, and duplicates", () => {
    expect(() => parseSkillFrontmatter(frontmatter(["name: x", "requires:", "\twrites: true"])))
      .toThrow(/tabs/);
    expect(() => parseSkillFrontmatter(frontmatter(["name: x", "requires:", "    writes: true"])))
      .toThrow(/one level of two-space indentation/);
    expect(() => parseSkillFrontmatter(frontmatter(["name: x", "requires:", "  gpus: [a100]"])))
      .toThrow(/Unknown requires key: gpus/);
    expect(() => parseSkillFrontmatter(frontmatter(["name: x", "name: y"])))
      .toThrow(/Duplicate frontmatter key: name/);
    expect(() => parseSkillFrontmatter(frontmatter(["name: x", "requires:", "  writes: true", "  writes: false"])))
      .toThrow(/Duplicate requires key: writes/);
  });

  it("rejects malformed requires values", () => {
    expect(() => parseSkillFrontmatter(frontmatter(["requires: greybeard-graph"])))
      .toThrow(/nested block/);
    expect(() => parseSkillFrontmatter(frontmatter(["requires:", "  servers: greybeard-graph"])))
      .toThrow(/flow-style list/);
    expect(() => parseSkillFrontmatter(frontmatter(["requires:", "  scopes: []"])))
      .toThrow(/empty list/);
    expect(() => parseSkillFrontmatter(frontmatter(["requires:", "  writes: yes"])))
      .toThrow(/must be true or false/);
    expect(() => parseSkillFrontmatter(frontmatter(["requires:", "  license:"])))
      .toThrow(/must carry a value/);
  });

  it("exposes role groups that resolve to concrete directory roles", () => {
    expect(Object.keys(ROLE_GROUPS)).toContain("reporting");
    expect(ROLE_GROUPS.reporting).toContain("Reports Reader");
    expect(ROLE_GROUPS.reporting).toContain("Global Administrator");
  });
});
