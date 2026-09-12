import { homedir } from "node:os";
import { join } from "node:path";

export function getGreybeardAppDataPath(): string {
  if (process.env.GREYBEARD_APP_DATA) return process.env.GREYBEARD_APP_DATA;
  const home = process.env.GREYBEARD_HOME || homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "greybeard");
  }

  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "greybeard");
  }

  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "greybeard");
}

export function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
