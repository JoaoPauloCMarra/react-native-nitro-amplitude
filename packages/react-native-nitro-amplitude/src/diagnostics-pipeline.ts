import type { AmplitudeHealthCheckResult } from "./analytics/react-native-client";
import type { AmplitudeDiagnosticFailure } from "./diagnostic-failures";
import type { AmplitudeNetworkTiming } from "./network";

export type DiagnosticEvent =
  | {
      type: "failure";
      recordedAt: number;
      failure: AmplitudeDiagnosticFailure;
    }
  | {
      type: "network_timing";
      recordedAt: number;
      timing: AmplitudeNetworkTiming;
    }
  | {
      type: "health";
      recordedAt: number;
      health: AmplitudeHealthCheckResult;
    };

const MAX_EVENTS = 200;

const events: DiagnosticEvent[] = [];

export function recordDiagnosticEvent(event: DiagnosticEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
  return events.map((event) => ({ ...event }));
}

export function getDiagnosticEventsByType<T extends DiagnosticEvent["type"]>(
  type: T,
): Extract<DiagnosticEvent, { type: T }>[] {
  return events.filter(
    (event): event is Extract<DiagnosticEvent, { type: T }> =>
      event.type === type,
  );
}

export function clearDiagnosticEvents(): void {
  events.length = 0;
}
