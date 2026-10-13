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
