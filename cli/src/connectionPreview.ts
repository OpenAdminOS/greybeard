import { AppOnlyGraphAuthProvider, GraphService, previewCapabilities, readGreybeardConfig, type FetchLike } from "@greybeard/graph";

/** Configuration-only unless verify is explicitly requested. No credential material leaves this boundary. */
export async function getConnectionPreview(appDataPath: string, options: { verify?: boolean; fetcher?: FetchLike } = {}) {
  const profile = (await readGreybeardConfig(appDataPath)).appOnlyProfile;
  if (!profile || !options.verify) return previewCapabilities(profile);
  try {
    const auth = await AppOnlyGraphAuthProvider.create(profile, appDataPath);
    await auth.getToken([]);
    const service = new GraphService({ auth, fetcher: options.fetcher, appDataPath });
    try { return await previewCapabilities(profile, service); }
    finally { await service.close(); }
  } catch (error) {
    const preview = await previewCapabilities(profile);
    return { ...preview, verifiedNow: false, connectionError: error instanceof Error ? error.message : "Application authentication failed.",
      capabilities: preview.capabilities.map((capability) => capability.selected ? { ...capability, state: "blocked" as const } : capability) };
  }
}
