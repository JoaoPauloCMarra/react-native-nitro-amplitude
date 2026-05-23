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

export function getAmplitudeErrorCode(error: unknown): AmplitudeErrorCode {
  if (error instanceof AmplitudeError) {
    return error.code;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("deployment key")) {
      return "invalid_deployment_key";
    }
    if (message.includes("api key")) {
      return "invalid_api_key";
    }
    if (message.includes("timeout")) {
      return "timeout";
    }
    if (message.includes("network") || message.includes("fetch")) {
      return "network_error";
    }
    if (message.includes("storage")) {
      return "storage_error";
    }
    if (message.includes("nitro") || message.includes("native")) {
      return "native_unavailable";
    }
  }
  return "unknown";
}
