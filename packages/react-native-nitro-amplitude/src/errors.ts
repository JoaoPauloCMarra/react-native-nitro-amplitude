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

export type AmplitudeErrorDetails = {
  readonly domain?: string;
  readonly code?: number;
  readonly description?: string;
  readonly exception?: string;
};

export type NativeErrorInfo = {
  readonly nativeCode?: string;
  readonly details?: AmplitudeErrorDetails;
};

export class AmplitudeError extends Error {
  readonly code: AmplitudeErrorCode;
  readonly cause?: unknown;
  readonly nativeCode?: string;
  readonly details?: AmplitudeErrorDetails;

  constructor(
    code: AmplitudeErrorCode,
    message: string,
    cause?: unknown,
    info?: NativeErrorInfo,
  ) {
    super(message);
    this.name = "AmplitudeError";
    this.code = code;
    this.cause = cause;
    this.nativeCode = info?.nativeCode;
    this.details = info?.details;
  }
}

export function createAmplitudeError(
  code: AmplitudeErrorCode,
  message: string,
  cause?: unknown,
  info?: NativeErrorInfo,
): AmplitudeError {
  return new AmplitudeError(code, message, cause, info);
}

const NATIVE_ERROR_PREFIX = "NitroAmplitude:";
const IOS_DETAIL_PREFIX = "nsurl:";
const TRANSPORT_NATIVE_CODE = "network_error";

function compactDetails(
  details: Record<string, string | number | undefined>,
): AmplitudeErrorDetails | undefined {
  const entries = Object.entries(details).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function parseNativeError(raw: string): {
  nativeCode: string;
  details?: AmplitudeErrorDetails;
} {
  let text = raw.trim();
  const prefixAt = text.indexOf(NATIVE_ERROR_PREFIX);
  if (prefixAt >= 0) {
    text = text.slice(prefixAt + NATIVE_ERROR_PREFIX.length).trim();
  }
  const [nativeCode = "", first = "", ...rest] = text.split("|");
  if (nativeCode !== TRANSPORT_NATIVE_CODE) {
    return { nativeCode };
  }
  if (first.startsWith(IOS_DETAIL_PREFIX)) {
    const [domain, ...description] = rest;
    const code = Number(first.slice(IOS_DETAIL_PREFIX.length) || Number.NaN);
    const details = compactDetails({
      code: Number.isFinite(code) ? code : undefined,
      domain,
      description: description.join("|"),
    });
    return details ? { nativeCode, details } : { nativeCode };
  }
  const details = compactDetails({
    exception: first,
    description: rest.join("|"),
  });
  return details ? { nativeCode, details } : { nativeCode };
}

const NATIVE_ERROR_CODES: Record<string, AmplitudeErrorCode> = {
  invalid_url: "network_error",
  network_error: "network_error",
  timeout: "timeout",
  invalid_http_response: "network_error",
  cancelled: "network_error",
  queue_full: "network_error",
  native_http_exception: "network_error",
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
    const mapped = NATIVE_ERROR_CODES[parseNativeError(message).nativeCode];
    if (mapped !== undefined) {
      return mapped;
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
