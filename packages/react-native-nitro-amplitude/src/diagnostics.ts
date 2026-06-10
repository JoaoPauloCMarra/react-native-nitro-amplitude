import type {
  AmplitudeAnalyticsDiagnostics,
  AmplitudeHealthCheckResult,
  AmplitudeReactNativeClient,
} from "./analytics/react-native-client";
import { isNative } from "./analytics/utils/platform";
import { getAmplitudeErrorCode } from "./errors";
import { getNetworkEnabled } from "./network";
import type { AmplitudeDiagnosticFailure } from "./diagnostic-failures";
import { getDiagnosticFailures } from "./diagnostic-failures";

type HybridModule = typeof import("./native/hybrid");

export type NativeStartupDiagnostics = {
  nitroModulesAvailable: boolean;
  contextAvailable: boolean;
  storageAvailable: boolean;
  workerAvailable: boolean;
  nativeAvailable: boolean;
  lastError?: {
    code: string;
    message: string;
  };
};

export type AmplitudeDiagnostics = AmplitudeAnalyticsDiagnostics & {
  native: NativeStartupDiagnostics;
  networkEnabled: boolean;
  diagnosticFailures: AmplitudeDiagnosticFailure[];
};

export type AmplitudeSafeDiagnostics = Omit<
  AmplitudeDiagnostics,
  "userId" | "deviceId" | "sessionId"
>;

let lastNativeError: NativeStartupDiagnostics["lastError"];

function getHybridModule(): HybridModule {
  if (isNative()) {
    return require("./native/hybrid") as HybridModule;
  }
  return require("./native/hybrid.web") as HybridModule;
}

export function getLastNativeError(): NativeStartupDiagnostics["lastError"] {
  return lastNativeError;
}

export function getNativeStartupDiagnostics(): NativeStartupDiagnostics {
  const result: NativeStartupDiagnostics = {
    nitroModulesAvailable: true,
    contextAvailable: false,
    storageAvailable: false,
    workerAvailable: false,
    nativeAvailable: false,
    lastError: lastNativeError,
  };

  try {
    const { getAmplitudeContext, getAmplitudeStorage, getAmplitudeWorker } =
      getHybridModule();
    getAmplitudeContext();
    result.contextAvailable = true;
    getAmplitudeStorage();
    result.storageAvailable = true;
    getAmplitudeWorker();
    result.workerAvailable = true;
    result.nativeAvailable = true;
    lastNativeError = undefined;
    result.lastError = undefined;
  } catch (error) {
    lastNativeError = {
      code: getAmplitudeErrorCode(error),
      message: error instanceof Error ? error.message : String(error),
    };
    result.nitroModulesAvailable = false;
    result.lastError = lastNativeError;
  }

  return result;
}

export function getAmplitudeDiagnostics(
  analytics: AmplitudeReactNativeClient,
): AmplitudeDiagnostics {
  return {
    ...analytics.getDiagnostics(),
    native: getNativeStartupDiagnostics(),
    networkEnabled: getNetworkEnabled(),
    diagnosticFailures: getDiagnosticFailures(),
  };
}

export function getSafeAmplitudeDiagnostics(
  analytics: AmplitudeReactNativeClient,
): AmplitudeSafeDiagnostics {
  const { userId, deviceId, sessionId, ...safeDiagnostics } =
    getAmplitudeDiagnostics(analytics);
  void userId;
  void deviceId;
  void sessionId;
  return safeDiagnostics;
}

export async function healthCheck(
  analytics?: AmplitudeReactNativeClient,
): Promise<AmplitudeHealthCheckResult> {
  const errors: string[] = [];
  const native = getNativeStartupDiagnostics();
  let storageWritable = false;

  try {
    const { getAmplitudeStorage } = getHybridModule();
    const storage = getAmplitudeStorage();
    const key = `health::${Date.now()}`;
    storage.set(key, "ok", false);
    storageWritable = storage.get(key, false) === "ok";
    storage.remove(key, false);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!native.nativeAvailable && native.lastError) {
    errors.push(native.lastError.message);
  }

  const analyticsInitialized = analytics
    ? analytics.getDiagnostics().initialized
    : false;

  return {
    ok: native.nativeAvailable && storageWritable,
    analyticsInitialized,
    nativeAvailable: native.nativeAvailable,
    storageWritable,
    errors,
  };
}
