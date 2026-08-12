import { BaseTransport } from "@amplitude/analytics-core";
import type { Payload, Response, Transport } from "@amplitude/analytics-core";
import type { HttpClient, SimpleResponse } from "./experiment/types/transport";
import { createAmplitudeError } from "./errors";
import { recordDiagnosticEvent } from "./diagnostics-pipeline";

let networkEnabled = true;

export type DryRunRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  data: string | null;
  timeoutMillis: number;
  createdAt: number;
};

export type DryRunEvent = {
  serverUrl: string;
  payload: Payload;
  createdAt: number;
};

export type AmplitudeNetworkTiming = {
  kind: "analytics" | "experiment";
  url: string;
  method: string;
  startedAt: number;
  finishedAt: number;
  durationMillis: number;
  status?: number | string;
  error?: string;
};

export type AmplitudeNetworkTimingRecorder = (
  timing: AmplitudeNetworkTiming,
) => void;

export type AmplitudeNetworkTimingBuffer = {
  record: AmplitudeNetworkTimingRecorder;
  getTimings: () => AmplitudeNetworkTiming[];
  clear: () => void;
};

const dryRunRequests: DryRunRequest[] = [];
const dryRunEvents: DryRunEvent[] = [];

export function setNetworkEnabled(enabled: boolean): void {
  networkEnabled = enabled;
}

export function getNetworkEnabled(): boolean {
  return networkEnabled;
}

export function clearDryRunTransportRecords(): void {
  dryRunRequests.length = 0;
  dryRunEvents.length = 0;
}

export function getDryRunTransportRecords(): DryRunRequest[] {
  return dryRunRequests.map((request) => ({ ...request }));
}

export function getDryRunAnalyticsEvents(): DryRunEvent[] {
  return dryRunEvents.map((event) => ({
    ...event,
    payload: { ...event.payload },
  }));
}

export function assertNetworkEnabled(): void {
  if (!networkEnabled) {
    throw createAmplitudeError(
      "network_error",
      "Amplitude network traffic is disabled",
    );
  }
}

function nowMillis(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function createTiming(
  kind: AmplitudeNetworkTiming["kind"],
  url: string,
  method: string,
  startedAt: number,
  status?: number | string,
  error?: unknown,
): AmplitudeNetworkTiming {
  const finishedAt = nowMillis();
  return {
    kind,
    url,
    method,
    startedAt,
    finishedAt,
    durationMillis: Math.round((finishedAt - startedAt) * 10) / 10,
    status,
    error:
      error === undefined
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

function recordTiming(
  record: AmplitudeNetworkTimingRecorder,
  timing: AmplitudeNetworkTiming,
): void {
  record(timing);
  recordDiagnosticEvent({
    type: "network_timing",
    recordedAt: Date.now(),
    timing,
  });
}

export function createNetworkTimingBuffer(
  limit = 20,
): AmplitudeNetworkTimingBuffer {
  const timings: AmplitudeNetworkTiming[] = [];
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
  return {
    record: (timing) => {
      timings.push(timing);
      while (timings.length > normalizedLimit) {
        timings.shift();
      }
    },
    getTimings: () => timings.map((timing) => ({ ...timing })),
    clear: () => {
      timings.length = 0;
    },
  };
}

export function createTimedAnalyticsTransport(
  transport: Transport,
  record: AmplitudeNetworkTimingRecorder,
): Transport {
  return {
    async send(
      serverUrl: string,
      payload: Payload,
      enableRequestBodyCompression?: boolean,
    ): Promise<Response | null> {
      const startedAt = nowMillis();
      try {
        const response = await transport.send(
          serverUrl,
          payload,
          enableRequestBodyCompression,
        );
        recordTiming(
          record,
          createTiming(
            "analytics",
            serverUrl,
            "POST",
            startedAt,
            response?.status,
          ),
        );
        return response;
      } catch (error) {
        recordTiming(
          record,
          createTiming(
            "analytics",
            serverUrl,
            "POST",
            startedAt,
            undefined,
            error,
          ),
        );
        throw error;
      }
    },
  };
}

export function createTimedHttpClient(
  httpClient: HttpClient,
  record: AmplitudeNetworkTimingRecorder,
): HttpClient {
  return {
    async request(
      requestUrl: string,
      method: string,
      headers: Record<string, string>,
      data: string | null,
      timeoutMillis?: number,
    ): Promise<SimpleResponse> {
      const startedAt = nowMillis();
      try {
        const response = await httpClient.request(
          requestUrl,
          method,
          headers,
          data,
          timeoutMillis,
        );
        recordTiming(
          record,
          createTiming(
            "experiment",
            requestUrl,
            method,
            startedAt,
            response.status,
          ),
        );
        return response;
      } catch (error) {
        recordTiming(
          record,
          createTiming(
            "experiment",
            requestUrl,
            method,
            startedAt,
            undefined,
            error,
          ),
        );
        throw error;
      }
    },
  };
}

export class DryRunHttpClient implements HttpClient {
  async request(
    requestUrl: string,
    method: string,
    headers: Record<string, string>,
    data: string | null,
    timeoutMillis = 10000,
  ): Promise<SimpleResponse> {
    dryRunRequests.push({
      url: requestUrl,
      method,
      headers: { ...headers },
      data,
      timeoutMillis,
      createdAt: Date.now(),
    });
    return {
      status: 202,
      body: JSON.stringify({ code: 202, dryRun: true }),
    };
  }
}

export class DryRunTransport extends BaseTransport implements Transport {
  override async send(
    serverUrl: string,
    payload: Payload,
  ): Promise<Response | null> {
    dryRunEvents.push({
      serverUrl,
      payload: { ...payload },
      createdAt: Date.now(),
    });
    return this.buildResponse({ code: 202, dryRun: true });
  }
}

export const dryRunHttpClient = new DryRunHttpClient();
export const dryRunTransport = new DryRunTransport();
