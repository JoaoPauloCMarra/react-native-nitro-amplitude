type Diagnostics = typeof import("../diagnostics");

function loadDiagnostics(
  os: "ios" | "web",
  nitroModules: "present" | "missing",
): Diagnostics {
  let loaded: Diagnostics | undefined;
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: os } }));
    if (nitroModules === "present") {
      jest.doMock("react-native-nitro-modules", () => ({
        NitroModules: { createHybridObject: () => ({}) },
      }));
    } else {
      jest.doMock("react-native-nitro-modules", () => {
        throw new Error("Cannot find module 'react-native-nitro-modules'");
      });
    }
    loaded = require("../diagnostics") as Diagnostics;
  });
  if (!loaded) {
    throw new Error("diagnostics module did not load");
  }
  return loaded;
}

describe("getNativeStartupDiagnostics nitroModulesAvailable", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("is true on native when react-native-nitro-modules loads", () => {
    const native = loadDiagnostics(
      "ios",
      "present",
    ).getNativeStartupDiagnostics();
    expect(native.nitroModulesAvailable).toBe(true);
    expect(native.nativeAvailable).toBe(true);
    expect(native.lastError).toBeUndefined();
  });

  it("is false on native when react-native-nitro-modules cannot load", () => {
    const native = loadDiagnostics(
      "ios",
      "missing",
    ).getNativeStartupDiagnostics();
    expect(native.nitroModulesAvailable).toBe(false);
    expect(native.nativeAvailable).toBe(false);
    expect(native.lastError?.code).toBe("native_unavailable");
  });

  it("is false on web", () => {
    const native = loadDiagnostics(
      "web",
      "present",
    ).getNativeStartupDiagnostics();
    expect(native.nitroModulesAvailable).toBe(false);
    expect(native.nativeAvailable).toBe(false);
  });
});

describe("healthCheck errors", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("lists each distinct native failure once on web", async () => {
    jest.resetModules();
    const result = await loadDiagnostics("web", "present").healthCheck();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(new Set(result.errors).size).toBe(result.errors.length);
  });
});
