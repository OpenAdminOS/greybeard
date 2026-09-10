import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { withClientConfigLock, writeClientConfigAtomic } from "./clientConfigFile.js";
import { writeCodexMcpConfig } from "./clients.js";
import { createRuntime } from "./runtime.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporaryHome() { const home = await mkdtemp(join(tmpdir(), "greybeard-client-lock-")); directories.push(home); return home; }

describe("client configuration transactions", () => {
  it("preserves all independent settings across concurrent read-modify-write operations", async () => {
    const home = await temporaryHome();
    const path = join(home, "settings.json");
    await writeFile(path, JSON.stringify({ foreign: { enabled: true } }));
    await Promise.all(Array.from({ length: 20 }, (_, index) => withClientConfigLock(path, async () => {
      const current = JSON.parse(await readFile(path, "utf8"));
      await delay(2); // Force overlapping reads to lose updates if the lock is removed.
      current[`setting${index}`] = index;
      await writeClientConfigAtomic(path, JSON.stringify(current));
    })));
    const result = JSON.parse(await readFile(path, "utf8"));
    expect(result.foreign).toEqual({ enabled: true });
    for (let index = 0; index < 20; index++) expect(result[`setting${index}`]).toBe(index);
    expect(await readdir(home)).toEqual(["settings.json"]);
  });

  it("serializes the actual Codex writer with another settings transaction", async () => {
    const home = await temporaryHome();
    const path = join(home, ".codex", "config.toml");
    await mkdir(join(home, ".codex"));
    await writeFile(path, 'model = "existing-model"\n');
    let announce: () => void = () => {};
    const entered = new Promise<void>(resolveEntered => { announce = resolveEntered; });
    const foreignEdit = withClientConfigLock(path, async () => {
      const current = await readFile(path, "utf8");
      announce();
      await delay(50);
      await writeClientConfigAtomic(path, `${current}personality = "concise"\n`);
    });
    await entered;
    const runtime = { ...createRuntime(), homeDir: home, repoRoot: resolve(import.meta.dirname, "../.."), env: {}, packaged: true };
    await Promise.all([foreignEdit, writeCodexMcpConfig(runtime, { serverToggles: { "greybeard-graph": false, "greybeard-memory": true, intuneautomation: false } })]);
    const result = await readFile(path, "utf8");
    expect(result).toContain('personality = "concise"');
    expect(result).toContain('model = "existing-model"');
    expect(result).toContain('[mcp_servers.greybeard-memory]');
  });

  it("releases the lock on an operation error without changing the original file", async () => {
    const home = await temporaryHome();
    const path = join(home, "settings.json");
    await writeFile(path, '{"foreign":true}');
    await expect(withClientConfigLock(path, async () => { throw new Error("invalid candidate"); })).rejects.toThrow("invalid candidate");
    expect(await readFile(path, "utf8")).toBe('{"foreign":true}');
    await withClientConfigLock(path, () => writeClientConfigAtomic(path, '{"foreign":true,"later":true}'));
    expect(await readdir(home)).toEqual(["settings.json"]);
  });
});
