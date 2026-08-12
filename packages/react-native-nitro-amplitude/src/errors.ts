export type AmplitudeErrorCode =
  | "not_initialized"
  | "network_error"
  | "storage_error"
  | "invalid_api_key"
  | "invalid_deployment_key"
  | "experiment_fetch_failed"
  | "native_unavailable"
  | "serialization_error"
  | "event_too_large"
  | "timeout"
  | "unknown";

export class AmplitudeError extends Error {
  readonly code: AmplitudeErrorCode;
  readonly cause?: unknown;

  constructor(code: AmplitudeErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AmplitudeError";
    this.code = code;
    this.cause = cause;
  }
}

export function createAmplitudeError(
  code: AmplitudeErrorCode,
  message: string,
  cause?: unknown,
): AmplitudeError {
  return new AmplitudeError(code, message, cause);
}

const NATIVE_ERROR_CODES: Record<string, AmplitudeErrorCode> = {
  invalid_url: "network_error",
  network_error: "network_error",
  timeout: "timeout",
  invalid_http_response: "network_error",
  cancelled: "network_error",
  queue_full: "network_error",
  adapter_unavailable: "native_unavailable",
  disk_adapter_unavailable: "storage_error",
  storage_error: "storage_error",
  invalid_api_key: "invalid_api_key",
  invalid_deployment_key: "invalid_deployment_key",
  serialization_error: "serialization_error",
  event_too_large: "event_too_large",
  experiment_fetch_failed: "experiment_fetch_failed",
  not_initialized: "not_initialized",
  unknown: "unknown",
};

export function getAmplitudeErrorCode(error: unknown): AmplitudeErrorCode {
  if (error instanceof AmplitudeError) {
    return error.code;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.startsWith("NitroAmplitude:")) {
      const code = message.slice("NitroAmplitude:".length).trim();
      const mapped = NATIVE_ERROR_CODES[code];
      if (mapped !== undefined) {
        return mapped;
      }
    }
    const directCode = NATIVE_ERROR_CODES[message];
    if (directCode !== undefined) {
      return directCode;
    }
    const normalized = message.toLowerCase();
    if (normalized.includes("deployment key")) {
      return "invalid_deployment_key";
    }
    if (normalized.includes("api key")) {
      return "invalid_api_key";
    }
    if (normalized.includes("timeout")) {
      return "timeout";
    }
    if (normalized.includes("network") || normalized.includes("fetch")) {
      return "network_error";
    }
    if (normalized.includes("storage")) {
      return "storage_error";
    }
    if (normalized.includes("nitro") || normalized.includes("native")) {
      return "native_unavailable";
    }
  }
  return "unknown";
}
