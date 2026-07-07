import { homedir } from "node:os";
import { join } from "node:path";

export function getGreybeardAppDataPath(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "greybeard");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "greybeard");
  }

  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "greybeard");
}

export function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
