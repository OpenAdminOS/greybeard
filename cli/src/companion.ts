import { access, readFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { type CliRuntime, writeLine } from "./runtime.js";

/** CLI and MCP processes keep their own lifetime; opening the companion never opens a browser. */
export async function runCompanion(runtime: CliRuntime): Promise<number> {
  const folder = dirname(runtime.nodePath);
  let path = runtime.platform === "darwin"
    ? join(folder, "Greybeard")
    : runtime.platform === "win32" ? join(folder, "../../Greybeard.exe") : join(folder, "../../greybeard-companion");
  if (runtime.platform === "linux") {
    const { getGreybeardAppDataPath } = await import("@greybeard/graph");
    try {
      const location = JSON.parse(await readFile(join(runtime.env.GREYBEARD_APP_DATA || getGreybeardAppDataPath(), "companion-location.json"), "utf8"));
      if (typeof location.executable === "string" && isAbsolute(location.executable) && location.executable.endsWith(".AppImage")) path = location.executable;
    } catch {}
  }
  try { await access(path); }
  catch { writeLine(runtime.stderr, "Install the Greybeard companion application to manage memory in a window. CLI commands remain available; run greybeard --help."); return 1; }
  const { spawn } = await import("node:child_process");
  const env = { ...runtime.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path, [], { detached: true, stdio: "ignore", env });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return 0;
}
