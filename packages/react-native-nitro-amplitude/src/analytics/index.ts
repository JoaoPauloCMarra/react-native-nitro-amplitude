import client from "./react-native-client";
import type {
  AmplitudeDiagnostics,
  AmplitudeSafeDiagnostics,
} from "../diagnostics";
import {
  getAmplitudeDiagnostics,
  getSafeAmplitudeDiagnostics,
} from "../diagnostics";

// Export types to maintain backward compatibility with `analytics-types`.
// In the next major version, only export customer-facing types to reduce the public API surface.
import * as Types from "./types";
export { createInstance } from "./react-native-client";
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
} = client;

export function getDiagnostics(): AmplitudeDiagnostics {
  return getAmplitudeDiagnostics(client);
}

export function getSafeDiagnostics(): AmplitudeSafeDiagnostics {
  return getSafeAmplitudeDiagnostics(client);
}

export { Revenue, Identify } from "@amplitude/analytics-core";
export {
  InMemoryStorage,
  LocalStorage,
  MemoryStorage,
} from "./storage/local-storage";
export { Types };
