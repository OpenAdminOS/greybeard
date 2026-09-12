import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { saveClientSecret, loadClientSecret, removeClientSecret } from "./clientSecretStore.js";

it.runIf(process.platform === "darwin" || process.platform === "win32")("round-trips and deletes a synthetic secret through the actual OS store", async () => {
  const directory = await mkdtemp(join(tmpdir(),"greybeard-native-secret-"));
  const secret = 'Greybeard-test-only~#value+"quote\\tail';
  let ref: string | undefined;
  try {
    ref = await saveClientSecret(directory, secret);
    expect(await loadClientSecret(directory,ref)).toBe(secret);
    await removeClientSecret(directory,ref);
    await expect(loadClientSecret(directory,ref)).rejects.toThrow("credential store");
    ref = undefined;
  } finally {
    if (ref) await removeClientSecret(directory,ref).catch(()=>{});
    await rm(directory,{recursive:true,force:true});
  }
}, 60_000);
