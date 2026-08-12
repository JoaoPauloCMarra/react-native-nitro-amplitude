import analyticsClient, {
  createInstance,
} from "./analytics/react-native-client";
import type { Transport } from "@amplitude/analytics-core";
import { NetworkGuardedFetchTransport } from "./analytics/network-guarded-fetch-transport";
import type {
  AmplitudeDiagnostics,
  AmplitudeSafeDiagnostics,
  NativeStartupDiagnostics,
  WorkerMetrics,
} from "./diagnostics";
import {
  getAmplitudeDiagnostics,
  getLastNativeError,
  getNativeStartupDiagnostics,
  getSafeAmplitudeDiagnostics,
} from "./diagnostics";
import { prefetchNativeContext } from "./native/context.web";
import { clearDiagnosticFailures } from "./diagnostic-failures";
import type {
  AmplitudeDiagnosticFailure,
  AmplitudeDiagnosticFailureKind,
  AmplitudeDiagnosticOperation,
  AmplitudeDiagnosticSurface,
} from "./diagnostic-failures";
import {
  AmplitudeError,
  createAmplitudeError,
  getAmplitudeErrorCode,
} from "./errors";
import type { AmplitudeErrorCode } from "./errors";
import {
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  createExperimentUser,
  createPersistentAmplitudeConfig,
  getConnectorIdentity,
} from "./presets";
import type {
  AmplitudeCombinedClient,
  AmplitudeCombinedClientConfig,
  AmplitudeCombinedClientConfigWithExperiment,
  AmplitudeCombinedClientWithExperiment,
  DurableAmplitudeStoragePreset,
  DurableAmplitudeStoragePresetOptions,
} from "./presets";
import { Experiment } from "./experiment/factory";
import { ExperimentClient } from "./experiment/experimentClient";
import { StubExperimentClient } from "./experiment/stubClient";
import { ConsoleLogger } from "./experiment/logger/consoleLogger";
import { LogLevel } from "./experiment/types/logger";
import type { Logger } from "./experiment/types/logger";
import { Source, VariantSource, isFallback } from "./experiment/types/source";
import {
  variantBoolean,
  variantJson,
  variantNumber,
  variantPayload,
  variantString,
} from "./experiment/typed-variants";
import {
  LocalStorage as ExperimentLocalStorage,
  MemoryStorage as ExperimentMemoryStorage,
} from "./experiment/storage/local-storage";
import { PACKAGE_VERSION } from "./package-version";

import * as AnalyticsTypes from "./analytics/types";

export { createInstance };
export const {
  add,
  flush,
  getDeviceId,
  getSessionId,
  getUserId,
  groupIdentify,
  identify,
  init,
  logEvent,
  remove,
  reset,
  revenue,
  setDeviceId,
  setGroup,
  setOptOut,
  setSessionId,
  setUserId,
  shutdown,
  track,
  extendSession,
  flushWithResult,
  healthCheck,
} = analyticsClient;

export function getDiagnostics(): AmplitudeDiagnostics {
  return getAmplitudeDiagnostics(analyticsClient);
}

export function getSafeDiagnostics(): AmplitudeSafeDiagnostics {
  return getSafeAmplitudeDiagnostics(analyticsClient);
}

export { Revenue, Identify } from "@amplitude/analytics-core";
export {
  InMemoryStorage,
  LocalStorage,
  MemoryStorage,
} from "./analytics/storage/local-storage";
export {
  NitroAnalyticsStorage,
  NitroExperimentStorage,
  NitroMemoryStorage,
} from "./native/storage.web";
export { nitroHttpClient } from "./native/http.web";
export const nitroTransport: Transport = new NetworkGuardedFetchTransport();
export { prefetchNativeContext };
export { AnalyticsTypes as Types };
export {
  getAmplitudeDiagnostics,
  getLastNativeError,
  getNativeStartupDiagnostics,
  getSafeAmplitudeDiagnostics,
} from "./diagnostics";
export type {
  AmplitudeDiagnostics,
  AmplitudeSafeDiagnostics,
  NativeStartupDiagnostics,
  WorkerMetrics,
} from "./diagnostics";
export { clearDiagnosticFailures } from "./diagnostic-failures";
export type {
  AmplitudeDiagnosticFailure,
  AmplitudeDiagnosticFailureKind,
  AmplitudeDiagnosticOperation,
  AmplitudeDiagnosticSurface,
} from "./diagnostic-failures";
export {
  AmplitudeError,
  createAmplitudeError,
  getAmplitudeErrorCode,
} from "./errors";
export type { AmplitudeErrorCode } from "./errors";
export {
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  createExperimentUser,
  createPersistentAmplitudeConfig,
  getConnectorIdentity,
} from "./presets";
export type {
  AmplitudeCombinedClient,
  AmplitudeCombinedClientConfig,
  AmplitudeCombinedClientConfigWithExperiment,
  AmplitudeCombinedClientWithExperiment,
  DurableAmplitudeStoragePreset,
  DurableAmplitudeStoragePresetOptions,
} from "./presets";

export { Experiment };
export { ExperimentClient };
export { StubExperimentClient };
export { ConsoleLogger };
export { LogLevel };
export type { Logger } from "./experiment/types/logger";
export { Source, VariantSource, isFallback };
export {
  variantBoolean,
  variantJson,
  variantNumber,
  variantPayload,
  variantString,
} from "./experiment/typed-variants";
export {
  LocalStorage as ExperimentLocalStorage,
  MemoryStorage as ExperimentMemoryStorage,
} from "./experiment/storage/local-storage";
export type { ExperimentConfig } from "./experiment/types/config";
export { Defaults } from "./experiment/types/config";
export type {
  Client,
  ExperimentFetchResult,
  ExperimentVariantResult,
  FetchOptions,
} from "./experiment/types/client";
export type {
  ExperimentUser,
  ExperimentUserProvider,
} from "./experiment/types/user";
export type {
  Exposure,
  ExposureTrackingProvider,
} from "./experiment/types/exposure";
export type { Variant, Variants } from "./experiment/types/variant";
export type { Storage } from "./experiment/types/storage";

export type { AmplitudeContext } from "./AmplitudeContext.nitro";
export type { AmplitudeStorage } from "./AmplitudeStorage.nitro";
export type { AmplitudeWorker } from "./AmplitudeWorker.nitro";

export { PACKAGE_VERSION as VERSION } from "./package-version";
