import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Shared by every Greybeard read-modify-write of a client settings file.
 * External editors do not participate in this lock; close them during setup. */
export async function withClientConfigLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const canonical = join(await realpath(dirname(path)), basename(path));
  const lockPath = `${canonical}.greybeard.lock`;
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try { handle = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Client configuration is busy: ${path}. If a previous setup crashed, close Greybeard processes before removing ${lockPath}.`);
      await delay(10 + Math.floor(Math.random() * 20));
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, id: randomUUID() }));
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Preserved non-regular client configuration: ${path}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}

/** Must be called inside withClientConfigLock for read-modify-write operations. */
export async function writeClientConfigAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
