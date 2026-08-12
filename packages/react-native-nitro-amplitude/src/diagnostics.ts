import type {
  AmplitudeAnalyticsDiagnostics,
  AmplitudeHealthCheckResult,
  AmplitudeReactNativeClient,
} from "./analytics/react-native-client";
import { isNative } from "./analytics/utils/platform";
import { getAmplitudeErrorCode } from "./errors";
import { getNetworkEnabled } from "./network";
import type { AmplitudeNetworkTiming } from "./network";
import type { AmplitudeDiagnosticFailure } from "./diagnostic-failures";
import { getDiagnosticFailures } from "./diagnostic-failures";
import {
  getDiagnosticEventsByType,
  recordDiagnosticEvent,
} from "./diagnostics-pipeline";

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

export type WorkerMetrics = {
  queueSize: number;
  inFlightCount: number;
  pendingBodyBytes: number;
};

export type AmplitudeDiagnostics = AmplitudeAnalyticsDiagnostics & {
  native: NativeStartupDiagnostics;
  networkEnabled: boolean;
  diagnosticFailures: AmplitudeDiagnosticFailure[];
  networkTimings: AmplitudeNetworkTiming[];
  workerMetrics: WorkerMetrics | undefined;
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

function recordNativeError(
  error: unknown,
): NativeStartupDiagnostics["lastError"] {
  return {
    code: getAmplitudeErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
  };
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
  let lastError: NativeStartupDiagnostics["lastError"] | undefined;

  try {
    const { getAmplitudeContext } = getHybridModule();
    getAmplitudeContext();
    result.contextAvailable = true;
  } catch (error) {
    lastError = recordNativeError(error);
  }

  try {
    const { getAmplitudeStorage } = getHybridModule();
    getAmplitudeStorage();
    result.storageAvailable = true;
  } catch (error) {
    lastError = recordNativeError(error);
  }

  try {
    const { getAmplitudeWorker } = getHybridModule();
    getAmplitudeWorker();
    result.workerAvailable = true;
  } catch (error) {
    lastError = recordNativeError(error);
  }

  result.nativeAvailable =
    result.contextAvailable &&
    result.storageAvailable &&
    result.workerAvailable;
  lastNativeError = lastError;
  result.lastError = lastError;

  return result;
}

function getWorkerMetrics(): WorkerMetrics | undefined {
  try {
    const { getAmplitudeWorker } = getHybridModule();
    const worker = getAmplitudeWorker();
    return {
      queueSize: worker.queueSize(),
      inFlightCount: worker.inFlightCount(),
      pendingBodyBytes: worker.pendingBodyBytes(),
    };
  } catch {
    return undefined;
  }
}

export function getAmplitudeDiagnostics(
  analytics: AmplitudeReactNativeClient,
): AmplitudeDiagnostics {
  return {
    ...analytics.getDiagnostics(),
    native: getNativeStartupDiagnostics(),
    networkEnabled: getNetworkEnabled(),
    diagnosticFailures: getDiagnosticFailures(),
    networkTimings: getDiagnosticEventsByType("network_timing").map(
      (event) => event.timing,
    ),
    workerMetrics: getWorkerMetrics(),
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
  let diskStorageWritable = false;
  let workerReady = false;

  try {
    const { getAmplitudeStorage } = getHybridModule();
    const storage = getAmplitudeStorage();
    const key = `health::${Date.now()}`;
    storage.set(key, "ok", true);
    diskStorageWritable = storage.get(key, true) === "ok";
    storage.remove(key, true);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const { getAmplitudeWorker } = getHybridModule();
    const worker = getAmplitudeWorker();
    workerReady = worker.queueSize() >= 0;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (!native.nativeAvailable && native.lastError) {
    errors.push(native.lastError.message);
  }

  const analyticsInitialized = analytics
    ? analytics.getDiagnostics().initialized
    : false;

  const result: AmplitudeHealthCheckResult = {
    ok: native.nativeAvailable && diskStorageWritable && workerReady,
    analyticsInitialized,
    nativeAvailable: native.nativeAvailable,
    storageWritable: diskStorageWritable,
    diskStorageWritable,
    workerReady,
    errors,
  };
  recordDiagnosticEvent({
    type: "health",
    recordedAt: Date.now(),
    health: result,
  });
  return result;
}
