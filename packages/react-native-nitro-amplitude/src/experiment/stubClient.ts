import {
  Client,
  ExperimentFetchResult,
  ExperimentVariantResult,
  FetchOptions,
} from "./types/client";
import { Defaults } from "./types/config";
import { ExperimentUser, ExperimentUserProvider } from "./types/user";
import { Variant, Variants } from "./types/variant";

/**
 * A stub {@link Client} implementation that does nothing for all methods
 */
export class StubExperimentClient implements Client {
  public getUser(): ExperimentUser {
    return {};
  }

  public async start(_user?: ExperimentUser): Promise<void> {
    return;
  }

  public stop(): void {}

  public setUser(_user: ExperimentUser): void {}

  public async fetch(
    _user?: ExperimentUser,
    _options?: FetchOptions,
  ): Promise<StubExperimentClient> {
    return this;
  }

  public async fetchOrThrow(
    _user?: ExperimentUser,
    _options?: FetchOptions,
  ): Promise<StubExperimentClient> {
    return this;
  }

  public async fetchWithMetadata(
    _user?: ExperimentUser,
    _options?: FetchOptions,
  ): Promise<ExperimentFetchResult> {
    return {
      fetched: false,
      flagKeys: [],
      cacheHit: false,
      durationMillis: 0,
      source: "cache",
      failureReason: "stub_client",
    };
  }

  public getUserProvider(): ExperimentUserProvider {
    return {
      async getUser(): Promise<ExperimentUser> {
        return {};
      },
    };
  }

  public setUserProvider(
    _userProvider: ExperimentUserProvider,
  ): StubExperimentClient {
    return this;
  }

  public variant(_key: string, _fallback?: string | Variant): Variant {
    return Defaults.fallbackVariant ?? {};
  }

  public variantWithMetadata(
    _key: string,
    _fallback?: string | Variant,
  ): ExperimentVariantResult {
    return {
      variant: Defaults.fallbackVariant ?? {},
      fallback: true,
      stale: false,
      freshness: "unknown",
      reason: "fallback",
    };
  }

  public all(): Variants {
    return {};
  }

  public clear(): void {}

  public clearVariants(): void {}

  public hasCachedVariant(_key: string): boolean {
    return false;
  }

  public getLastFetchTime(): number | undefined {
    return undefined;
  }

  public exposure(_key: string): void {}
}
