import { graphAuthConfig, readGreybeardConfig } from "./config.js";
import {
  AddScopeInput,
  AddScopeResult,
  AuthStatus,
  AuthToken,
  FetchLike,
  GraphAuthProvider,
  RemoveScopeInput,
  RemoveScopeResult
} from "./types.js";

type AuthFactory = (options: ReturnType<typeof graphAuthConfig> & {
  appDataPath: string;
  fetcher?: FetchLike;
}) => Promise<GraphAuthProvider>;

export class ConfigReloadingAuthProvider implements GraphAuthProvider {
  private provider: GraphAuthProvider | null = null;
  private fingerprint = "";
  private loading: Promise<GraphAuthProvider> | null = null;

  constructor(private readonly params: {
    appDataPath: string;
    authFactory: AuthFactory;
    fetcher?: FetchLike;
  }) {}

  getToken(scopes: string[]): Promise<AuthToken> {
    return this.withProvider((provider) => provider.getToken(scopes));
  }

  getStatus(): Promise<AuthStatus> {
    return this.withProvider((provider) => provider.getStatus());
  }

  addScopes(input: AddScopeInput): Promise<AddScopeResult> {
    return this.withProvider((provider) => provider.addScopes(input));
  }

  removeScopes(input: RemoveScopeInput): Promise<RemoveScopeResult> {
    return this.withProvider((provider) => {
      if (!provider.removeScopes) {
        throw new Error("The active authentication provider does not support scope removal.");
      }
      return provider.removeScopes(input);
    });
  }

  private async withProvider<T>(operation: (provider: GraphAuthProvider) => Promise<T>): Promise<T> {
    return operation(await this.currentProvider());
  }

  private async currentProvider(): Promise<GraphAuthProvider> {
    const config = await readGreybeardConfig(this.params.appDataPath);
    const authConfig = graphAuthConfig(config);
    const nextFingerprint = JSON.stringify({
      revision: config.configRevision ?? 0,
      ...authConfig
    });
    if (this.provider && this.fingerprint === nextFingerprint) {
      return this.provider;
    }

    if (!this.loading) {
      this.loading = this.params.authFactory({
        ...authConfig,
        appDataPath: this.params.appDataPath,
        fetcher: this.params.fetcher
      }).then((provider) => {
        this.provider = provider;
        this.fingerprint = nextFingerprint;
        return provider;
      }).finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }
}
