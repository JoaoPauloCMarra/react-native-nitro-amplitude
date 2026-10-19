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
    };

const MAX_EVENTS = 200;

const events: DiagnosticEvent[] = [];

export function recordDiagnosticEvent(event: DiagnosticEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getDiagnosticEventsByType<T extends DiagnosticEvent["type"]>(
  type: T,
): Extract<DiagnosticEvent, { type: T }>[] {
  return events.filter(
    (event): event is Extract<DiagnosticEvent, { type: T }> =>
      event.type === type,
  );
}

export function clearDiagnosticEvents(type?: DiagnosticEvent["type"]): void {
  if (type === undefined) {
    events.length = 0;
    return;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) {
      events.splice(index, 1);
    }
  }
}
