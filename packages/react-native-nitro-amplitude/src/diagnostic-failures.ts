import type { Payload, Response, Transport } from "@amplitude/analytics-core";
import { Status } from "@amplitude/analytics-core";
import type { HttpClient, SimpleResponse } from "./experiment/types/transport";
import { PACKAGE_VERSION } from "./package-version";

export type AmplitudeDiagnosticFailureKind =
  | "network_error"
  | "timeout"
  | "dns_or_hostname_resolution"
  | "http_status"
  | "unknown";

export type AmplitudeDiagnosticOperation =
  | "analytics_upload"
  | "experiment_fetch";

export type AmplitudeDiagnosticSurface =
  | "analytics_upload"
  | "experiment_variant_fetch"
  | "experiment_flag_fetch";

export type AmplitudeDiagnosticFailure = {
  operation: AmplitudeDiagnosticOperation;
  surface: AmplitudeDiagnosticSurface;
  kind: AmplitudeDiagnosticFailureKind;
  targetHost?: string;
  httpStatus?: number;
  batchSize?: number;
  queuedEventCount?: number;
  retryCount?: number;
  maxRetriesExceeded?: boolean;
  lastFailureAt: number;
  throttledCount: number;
  packageVersion: string;
};

type RecordDiagnosticFailureInput = Omit<
  Partial<AmplitudeDiagnosticFailure>,
  "lastFailureAt" | "throttledCount" | "packageVersion"
> & {
  operation: AmplitudeDiagnosticOperation;
  kind: AmplitudeDiagnosticFailureKind;
};

const diagnosticFailures = new Map<string, AmplitudeDiagnosticFailure>();

function getPayloadBatchSize(payload: Payload): number | undefined {
  return Array.isArray(payload.events) ? payload.events.length : undefined;
}

function getHost(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

function getExperimentSurface(requestUrl: string): AmplitudeDiagnosticSurface {
  try {
    const url = new URL(requestUrl);
    const normalized = `${url.host}${url.pathname}`.toLowerCase();
    if (normalized.includes("flag.")) {
      return "experiment_flag_fetch";
    }
    if (normalized.includes("flag")) {
      return "experiment_flag_fetch";
    }
  } catch {
    if (requestUrl.toLowerCase().includes("flag")) {
      return "experiment_flag_fetch";
    }
  }
  return "experiment_variant_fetch";
}

function isHttpFailure(statusCode: number | undefined): statusCode is number {
  return (
    typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300)
  );
}

export function classifyDiagnosticFailure(
  input: unknown,
  statusCode?: number,
): AmplitudeDiagnosticFailureKind {
  if (isHttpFailure(statusCode)) {
    return "http_status";
  }
  const message =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : "";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("hostname") ||
    normalized.includes("dns") ||
    normalized.includes("could not be found") ||
    normalized.includes("enotfound")
  ) {
    return "dns_or_hostname_resolution";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "timeout";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("offline") ||
    normalized.includes("connection")
  ) {
    return "network_error";
  }
  return "unknown";
}

export function recordDiagnosticFailure(
  input: RecordDiagnosticFailureInput,
): void {
  const surface =
    input.surface ??
    (input.operation === "analytics_upload"
      ? "analytics_upload"
      : "experiment_variant_fetch");
  const key = [
    input.operation,
    surface,
    input.kind,
    input.targetHost ?? "",
    input.httpStatus ?? "",
    input.maxRetriesExceeded === true ? "max_retries" : "",
  ].join("|");
  const existing = diagnosticFailures.get(key);
  const lastFailureAt = Date.now();
  diagnosticFailures.set(key, {
    operation: input.operation,
    surface,
    kind: input.kind,
    targetHost: input.targetHost,
    httpStatus: input.httpStatus,
    batchSize: input.batchSize,
    queuedEventCount: input.queuedEventCount,
    retryCount: input.retryCount,
    maxRetriesExceeded: input.maxRetriesExceeded,
    lastFailureAt,
    throttledCount: existing ? existing.throttledCount + 1 : 0,
    packageVersion: PACKAGE_VERSION,
  });
}

export function getDiagnosticFailures(): AmplitudeDiagnosticFailure[] {
  return Array.from(diagnosticFailures.values()).map((failure) => ({
    ...failure,
  }));
}

export function clearDiagnosticFailures(): void {
  diagnosticFailures.clear();
}

export function createDiagnosticAnalyticsTransport(
  transport: Transport,
): Transport {
  return {
    async send(
      serverUrl: string,
      payload: Payload,
      enableRequestBodyCompression?: boolean,
    ): Promise<Response | null> {
      const batchSize = getPayloadBatchSize(payload);
      const targetHost = getHost(serverUrl);
      try {
        const response = await transport.send(
          serverUrl,
          payload,
          enableRequestBodyCompression,
        );
        if (!response) {
          recordDiagnosticFailure({
            operation: "analytics_upload",
            surface: "analytics_upload",
            kind: "unknown",
            targetHost,
            batchSize,
            queuedEventCount: batchSize,
          });
        } else if (
          response.status !== Status.Success ||
          isHttpFailure(response.statusCode)
        ) {
          recordDiagnosticFailure({
            operation: "analytics_upload",
            surface: "analytics_upload",
            kind: classifyDiagnosticFailure(
              response.status,
              response.statusCode,
            ),
            targetHost,
            httpStatus: response.statusCode,
            batchSize,
            queuedEventCount: batchSize,
          });
        }
        return response;
      } catch (error) {
        recordDiagnosticFailure({
          operation: "analytics_upload",
          surface: "analytics_upload",
          kind: classifyDiagnosticFailure(error),
          targetHost,
          batchSize,
          queuedEventCount: batchSize,
        });
        throw error;
      }
    },
  };
}

export function createDiagnosticHttpClient(httpClient: HttpClient): HttpClient {
  return {
    async request(
      requestUrl: string,
      method: string,
      headers: Record<string, string>,
      data: string | null,
      timeoutMillis?: number,
    ): Promise<SimpleResponse> {
      const targetHost = getHost(requestUrl);
      const surface = getExperimentSurface(requestUrl);
      try {
        const response = await httpClient.request(
          requestUrl,
          method,
          headers,
          data,
          timeoutMillis,
        );
        if (isHttpFailure(response.status)) {
          recordDiagnosticFailure({
            operation: "experiment_fetch",
            surface,
            kind: "http_status",
            targetHost,
            httpStatus: response.status,
          });
        }
        return response;
      } catch (error) {
        recordDiagnosticFailure({
          operation: "experiment_fetch",
          surface,
          kind: classifyDiagnosticFailure(error),
          targetHost,
        });
        throw error;
      }
    },
  };
}
