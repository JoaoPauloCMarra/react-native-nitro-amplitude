import {
  classifyDiagnosticFailure,
  clearDiagnosticFailures,
  getDiagnosticFailures,
  recordDiagnosticFailure,
} from "../diagnostic-failures";
import {
  getDiagnosticEventsByType,
  recordDiagnosticEvent,
} from "../diagnostics-pipeline";
import { createAmplitudeError, parseNativeError } from "../errors";

function nativeError(raw: string): Error {
  const parsed = parseNativeError(raw);
  return createAmplitudeError(
    "network_error",
    parsed.nativeCode,
    new Error(raw),
    parsed,
  );
}

const ios = (code: number) =>
  nativeError(`network_error|nsurl:${code}|NSURLErrorDomain|description`);
const android = (exception: string, message = "") =>
  nativeError(`network_error|${exception}|${message}`);

describe("classifyDiagnosticFailure with native detail", () => {
  it.each([
    [-1003, "dns_or_hostname_resolution"],
    [-1006, "dns_or_hostname_resolution"],
    [-1009, "offline"],
    [-1004, "connect_failed"],
    [-1005, "connection_lost"],
    [-1200, "tls_failure"],
    [-1203, "tls_failure"],
    [-1206, "tls_failure"],
    [-2000, "tls_failure"],
    [-1100, "network_error"],
  ])("classifies iOS code %i as %s", (code, kind) => {
    expect(classifyDiagnosticFailure(ios(code))).toBe(kind);
  });

  it.each([
    ["java.net.UnknownHostException", "dns_or_hostname_resolution"],
    ["java.net.ConnectException", "connect_failed"],
    ["javax.net.ssl.SSLHandshakeException", "tls_failure"],
    ["javax.net.ssl.SSLPeerUnverifiedException", "tls_failure"],
    ["javax.net.ssl.SSLException", "tls_failure"],
    ["java.security.cert.CertPathValidatorException", "tls_failure"],
    ["java.net.SocketException", "connection_lost"],
    ["java.io.EOFException", "connection_lost"],
    ["java.io.IOException", "network_error"],
  ])("classifies Android %s as %s", (exception, kind) => {
    expect(classifyDiagnosticFailure(android(exception))).toBe(kind);
  });

  it("classifies unreachable network as offline", () => {
    expect(
      classifyDiagnosticFailure(
        android("java.net.ConnectException", "connect failed: ENETUNREACH"),
      ),
    ).toBe("offline");
  });

  it("classifies a raw native string error", () => {
    expect(
      classifyDiagnosticFailure(
        new Error("network_error|nsurl:-1009|NSURLErrorDomain|offline"),
      ),
    ).toBe("offline");
  });

  it("keeps the message based classification", () => {
    expect(classifyDiagnosticFailure(new Error("request timeout"))).toBe(
      "timeout",
    );
    expect(classifyDiagnosticFailure(new Error("network_error"))).toBe(
      "network_error",
    );
    expect(classifyDiagnosticFailure(new Error("boom"))).toBe("unknown");
    expect(classifyDiagnosticFailure(undefined, 500)).toBe("http_status");
  });
});

describe("diagnostic failure buffer", () => {
  beforeEach(() => {
    clearDiagnosticFailures();
  });

  it("clearDiagnosticFailures keeps network timings", () => {
    const timingsBefore = getDiagnosticEventsByType("network_timing").length;
    recordDiagnosticEvent({
      type: "network_timing",
      recordedAt: 1,
      timing: {
        kind: "analytics",
        url: "https://example.com/events",
        method: "POST",
        startedAt: 1,
        finishedAt: 2,
        durationMillis: 1,
        status: 200,
      },
    });
    recordDiagnosticFailure({ operation: "experiment_fetch", kind: "timeout" });
    expect(getDiagnosticFailures()).toHaveLength(1);

    clearDiagnosticFailures();

    expect(getDiagnosticFailures()).toHaveLength(0);
    expect(getDiagnosticEventsByType("network_timing")).toHaveLength(
      timingsBefore + 1,
    );
  });

  it("every operation maps to its surface", () => {
    recordDiagnosticFailure({
      operation: "session_storage_read",
      kind: "storage_error",
    });
    recordDiagnosticFailure({ operation: "analytics_upload", kind: "unknown" });
    recordDiagnosticFailure({ operation: "experiment_fetch", kind: "unknown" });

    expect(
      getDiagnosticFailures().map(({ operation, surface }) => [
        operation,
        surface,
      ]),
    ).toEqual([
      ["session_storage_read", "session_storage"],
      ["analytics_upload", "analytics_upload"],
      ["experiment_fetch", "experiment_variant_fetch"],
    ]);
  });
});
