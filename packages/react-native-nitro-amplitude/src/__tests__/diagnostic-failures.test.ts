import { classifyDiagnosticFailure } from "../diagnostic-failures";
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
