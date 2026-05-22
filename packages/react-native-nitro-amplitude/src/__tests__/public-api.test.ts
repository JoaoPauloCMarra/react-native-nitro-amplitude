jest.mock("react-native-nitro-modules", () => {
  const memory = new Map<string, string>();
  return {
    NitroModules: {
      createHybridObject: jest.fn(() => ({
        prefetch: jest.fn(),
        getApplicationContextJson: jest.fn(() =>
          JSON.stringify({ platform: "iOS", version: "1.0.0" }),
        ),
        getLegacySessionDataJson: jest.fn(() => "{}"),
        getLegacyEventsJson: jest.fn(() => []),
        removeLegacyEvent: jest.fn(),
        set: jest.fn((key: string, value: string, persist: boolean) => {
          if (!persist) memory.set(key, value);
        }),
        get: jest.fn((key: string, persist: boolean) => {
          if (!persist) return memory.get(key);
          return undefined;
        }),
        remove: jest.fn((key: string, persist: boolean) => {
          if (!persist) memory.delete(key);
        }),
        clear: jest.fn(() => memory.clear()),
        has: jest.fn((key: string, persist: boolean) =>
          !persist ? memory.has(key) : false,
        ),
        getAllKeys: jest.fn(() => []),
        getKeysByPrefix: jest.fn(() => []),
        setBatch: jest.fn(),
        getBatch: jest.fn(() => []),
        removeBatch: jest.fn(),
        enqueue: jest.fn(),
        cancel: jest.fn(),
        addOnComplete: jest.fn(() => jest.fn()),
        queueSize: jest.fn(() => 0),
      })),
    },
  };
});

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {},
}));

import { VERSION, Experiment, prefetchNativeContext } from "../index";
import * as AnalyticsCompat from "../analytics";
import * as ExperimentCompat from "../experiment";
import { getNativeApplicationContext } from "../native/context";
import { NitroMemoryStorage } from "../native/storage";

describe("react-native-nitro-amplitude", () => {
  it("exports VERSION", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("exports Experiment factory", () => {
    expect(typeof Experiment.initialize).toBe("function");
    expect(typeof Experiment.initializeWithAmplitudeAnalytics).toBe("function");
  });

  it("keeps analytics and experiment compatibility subpaths", () => {
    expect(typeof AnalyticsCompat.init).toBe("function");
    expect(typeof AnalyticsCompat.track).toBe("function");
    expect(typeof AnalyticsCompat.createInstance).toBe("function");
    expect(typeof ExperimentCompat.Experiment.initialize).toBe("function");
    expect(typeof ExperimentCompat.ExperimentClient).toBe("function");
  });

  it("reads native application context via Nitro", () => {
    prefetchNativeContext();
    const context = getNativeApplicationContext({
      platform: true,
      language: true,
      osName: true,
      osVersion: true,
      deviceManufacturer: true,
      deviceModel: true,
      adid: false,
      carrier: false,
      ipAddress: false,
      appSetId: false,
      idfv: false,
      country: false,
    });
    expect(context.platform).toBe("iOS");
  });

  it("uses Nitro memory storage namespace isolation", async () => {
    const storage = new NitroMemoryStorage("test-ns");
    await storage.put("flag", "enabled");
    expect(await storage.get("flag")).toBe("enabled");
    await storage.delete("flag");
    expect(await storage.get("flag")).toBeNull();
  });
});
