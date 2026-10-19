import {
  EvaluationApi,
  EvaluationFlag,
  FlagApi,
  GetVariantsOptions,
  SdkEvaluationApi,
  SdkFlagApi,
} from "@amplitude/experiment-core";

import { AmpLogger } from "./logger/ampLogger";
import { ConsoleLogger } from "./logger/consoleLogger";
import {
  getFlagStorage,
  getVariantsOptionsStorage,
  getVariantStorage,
  LoadStoreCache,
  SingleValueStoreCache,
} from "./storage/cache";
import { MemoryStorage } from "./storage/local-storage";
import { WrapperClient } from "./transport/http";
import { createDiagnosticHttpClient } from "../diagnostic-failures";
import { DefaultUserProvider } from "./integration/default";
import { ExperimentConfig, Defaults } from "./types/config";
import { LogLevel } from "./types/logger";
import { Source } from "./types/source";
import { Variant, Variants } from "./types/variant";
import { ExperimentUserProvider } from "./types/user";

const euServerUrl = "https://api.lab.eu.amplitude.com";
const euFlagsServerUrl = "https://flag.lab.eu.amplitude.com";

export type ResolvedExperimentConfig = ExperimentConfig & {
  debug: boolean;
  logLevel: LogLevel;
  loggerProvider: NonNullable<ExperimentConfig["loggerProvider"]> | null;
  instanceName: string;
  fallbackVariant: Variant;
  initialVariants: Variants;
  source: Source;
  serverUrl: string;
  flagsServerUrl: string;
  serverZone: "US" | "EU";
  fetchTimeoutMillis: number;
  retryFetchOnFailure: boolean;
  automaticExposureTracking: boolean;
  pollOnStart: boolean;
  fetchOnStart: boolean;
  automaticFetchOnAmplitudeIdentityChange: boolean;
  userProvider: ExperimentUserProvider | null;
  exposureTrackingProvider: NonNullable<
    ExperimentConfig["exposureTrackingProvider"]
  > | null;
  httpClient: NonNullable<ExperimentConfig["httpClient"]>;
  storage: NonNullable<ExperimentConfig["storage"]> | null;
};

export function resolveExperimentConfig(
  apiKey: string,
  config: ExperimentConfig,
): ResolvedExperimentConfig {
  const serverZone = config?.serverZone ?? Defaults.serverZone;
  return {
    ...Defaults,
    ...config,
    debug: config?.debug ?? Defaults.debug,
    logLevel: config?.logLevel ?? Defaults.logLevel,
    loggerProvider: config?.loggerProvider ?? Defaults.loggerProvider,
    instanceName: config?.instanceName ?? Defaults.instanceName,
    fallbackVariant: config?.fallbackVariant ?? Defaults.fallbackVariant,
    initialVariants: config?.initialVariants ?? Defaults.initialVariants,
    source: config?.source ?? Defaults.source,
    serverZone,
    serverUrl:
      config?.serverUrl ??
      (serverZone === "EU" ? euServerUrl : Defaults.serverUrl),
    flagsServerUrl:
      config?.flagsServerUrl ??
      (serverZone === "EU" ? euFlagsServerUrl : Defaults.flagsServerUrl),
    fetchTimeoutMillis:
      config?.fetchTimeoutMillis ?? Defaults.fetchTimeoutMillis,
    retryFetchOnFailure:
      config?.retryFetchOnFailure ?? Defaults.retryFetchOnFailure,
    automaticExposureTracking:
      config?.automaticExposureTracking ?? Defaults.automaticExposureTracking,
    pollOnStart: config?.pollOnStart ?? Defaults.pollOnStart,
    fetchOnStart: config?.fetchOnStart ?? Defaults.fetchOnStart,
    automaticFetchOnAmplitudeIdentityChange:
      config?.automaticFetchOnAmplitudeIdentityChange ??
      Defaults.automaticFetchOnAmplitudeIdentityChange,
    userProvider: config?.userProvider ?? Defaults.userProvider,
    exposureTrackingProvider:
      config?.exposureTrackingProvider ?? Defaults.exposureTrackingProvider,
    httpClient: createDiagnosticHttpClient(
      config?.httpClient ?? Defaults.httpClient,
    ),
    storage: config?.storage ?? Defaults.storage,
  };
}

export type ExperimentProviders = {
  flagApi: FlagApi;
  evaluationApi: EvaluationApi;
  variants: LoadStoreCache<Variant>;
  flags: LoadStoreCache<EvaluationFlag>;
  fetchVariantsOptions: SingleValueStoreCache<GetVariantsOptions>;
};

export function createExperimentProviders(
  apiKey: string,
  config: ResolvedExperimentConfig,
): ExperimentProviders {
  const httpClient = new WrapperClient(config.httpClient);
  const storage = config.storage || new MemoryStorage();
  const variants = getVariantStorage(apiKey, config.instanceName, storage);
  const flags = getFlagStorage(apiKey, config.instanceName, storage);
  const fetchVariantsOptions = getVariantsOptionsStorage(
    apiKey,
    config.instanceName,
    storage,
  );
  return {
    flagApi: new SdkFlagApi(apiKey, config.flagsServerUrl, httpClient),
    evaluationApi: new SdkEvaluationApi(apiKey, config.serverUrl, httpClient),
    variants,
    flags,
    fetchVariantsOptions,
  };
}

export function createExperimentLogger(
  config: ResolvedExperimentConfig,
): AmpLogger {
  return new AmpLogger(
    config.loggerProvider || new ConsoleLogger(),
    getLogLevel(config),
  );
}

export function createDefaultUserProvider(
  config: ResolvedExperimentConfig,
): DefaultUserProvider {
  return new DefaultUserProvider(config.userProvider);
}

function getLogLevel(config: ResolvedExperimentConfig): LogLevel {
  if (config.debug === true) {
    return LogLevel.Debug;
  }
  return config.logLevel;
}
