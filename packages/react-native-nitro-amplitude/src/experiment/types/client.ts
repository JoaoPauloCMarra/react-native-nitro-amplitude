import { ExperimentUser, ExperimentUserProvider } from "./user";
import { Variant, Variants } from "./variant";
import { VariantSource } from "./source";

/**
 * Interface for the main client.
 * @category Core Usage
 */
export interface Client {
  start(user?: ExperimentUser): Promise<void>;
  stop(): void;
  fetch(user?: ExperimentUser, options?: FetchOptions): Promise<Client>;
  fetchWithMetadata(
    user?: ExperimentUser,
    options?: FetchOptions,
  ): Promise<ExperimentFetchResult>;
  fetchOrThrow(user?: ExperimentUser, options?: FetchOptions): Promise<Client>;
  variant(key: string, fallback?: string | Variant): Variant;
  variantWithMetadata(
    key: string,
    fallback?: string | Variant,
  ): ExperimentVariantResult;
  all(): Variants;
  clear(): void;
  clearVariants(): void;
  hasCachedVariant(key: string): boolean;
  getLastFetchTime(): number | undefined;
  exposure(key: string): void;
  getUser(): ExperimentUser;
  setUser(user: ExperimentUser): void;

  /**
   * @deprecated use ExperimentConfig.userProvider instead
   */
  getUserProvider(): ExperimentUserProvider;
  /**
   * @deprecated use ExperimentConfig.userProvider instead
   */
  setUserProvider(userProvider: ExperimentUserProvider): Client;
}

/**
 * Options to modify the behavior of a remote evaluation fetch request.
 */
export type FetchOptions = {
  /**
   * Specific flag keys to evaluate and set variants for.
   */
  flagKeys?: string[];
};

export type ExperimentFetchResult = {
  fetched: boolean;
  flagKeys: string[];
  cacheHit: boolean;
  durationMillis: number;
  source: "network" | "cache";
  failureReason?: string;
};

export type ExperimentVariantResult = {
  variant: Variant;
  source?: VariantSource;
  fallback: boolean;
  stale: boolean;
  reason?: "missing_flag" | "fetch_failure" | "no_assignment" | "fallback";
};
