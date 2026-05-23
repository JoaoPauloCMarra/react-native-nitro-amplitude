import analyticsClient, {
  createInstance,
} from "./analytics/react-native-client";
import type { Transport } from "@amplitude/analytics-core";
import { NetworkGuardedFetchTransport } from "./analytics/network-guarded-fetch-transport";
import type { AmplitudeDiagnostics } from "./diagnostics";
import { getAmplitudeDiagnostics } from "./diagnostics";
import { prefetchNativeContext } from "./native/context.web";

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
} from "./diagnostics";
export type {
  AmplitudeDiagnostics,
  NativeStartupDiagnostics,
} from "./diagnostics";
export * from "./errors";
export * from "./network";
export * from "./presets";
export * from "./testing";

export * from "./experiment/types/config";
export { Experiment } from "./experiment/factory";
export { StubExperimentClient } from "./experiment/stubClient";
export { ExperimentClient } from "./experiment/experimentClient";
export * from "./experiment/types/client";
export { Source } from "./experiment/types/source";
export * from "./experiment/types/user";
export * from "./experiment/types/variant";
export * from "./experiment/types/exposure";
export * from "./experiment/types/storage";
export { LogLevel } from "./experiment/types/logger";
export type { Logger } from "./experiment/types/logger";
export { ConsoleLogger } from "./experiment/logger/consoleLogger";
export {
  LocalStorage as ExperimentLocalStorage,
  MemoryStorage as ExperimentMemoryStorage,
} from "./experiment/storage/local-storage";
export * from "./experiment/typed-variants";

export type { AmplitudeContext } from "./AmplitudeContext.nitro";
export type { AmplitudeStorage } from "./AmplitudeStorage.nitro";
export type { AmplitudeWorker } from "./AmplitudeWorker.nitro";

export const VERSION = "0.5.0";
