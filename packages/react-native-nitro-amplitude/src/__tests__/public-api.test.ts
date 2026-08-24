const mockMemory = new Map<string, string>();
const mockDisk = new Map<string, string>();
const mockHybridObjects: Record<string, Record<string, jest.Mock>> = {};

function createStorageHybrid() {
  const selectStore = (persist: boolean) => (persist ? mockDisk : mockMemory);
  return {
    set: jest.fn((key: string, value: string, persist: boolean) => {
      selectStore(persist).set(key, value);
    }),
    get: jest.fn((key: string, persist: boolean) => {
      return selectStore(persist).get(key);
    }),
    remove: jest.fn((key: string, persist: boolean) => {
      selectStore(persist).delete(key);
    }),
    clear: jest.fn((persist: boolean) => {
      selectStore(persist).clear();
    }),
    has: jest.fn((key: string, persist: boolean) => {
      return selectStore(persist).has(key);
    }),
    getAllKeys: jest.fn((persist: boolean) => {
      return Array.from(selectStore(persist).keys());
    }),
    getKeysByPrefix: jest.fn((prefix: string, persist: boolean) => {
      return Array.from(selectStore(persist).keys()).filter((key) =>
        key.startsWith(prefix),
      );
    }),
    setBatch: jest.fn((keys: string[], values: string[], persist: boolean) => {
      if (keys.length !== values.length) {
        throw new Error("NitroAmplitude: setBatch key/value length mismatch");
      }
      keys.forEach((key, index) => {
        selectStore(persist).set(key, values[index] ?? "");
      });
    }),
    getBatch: jest.fn((keys: string[], persist: boolean) => {
      return keys.map(
        (key) =>
          selectStore(persist).get(key) ??
          "__nitro_amplitude_batch_missing__::v1",
      );
    }),
    removeBatch: jest.fn((keys: string[], persist: boolean) => {
      keys.forEach((key) => selectStore(persist).delete(key));
    }),
  };
}

function createContextHybrid() {
  return {
    prefetch: jest.fn(),
    getApplicationContextJson: jest.fn(() =>
      JSON.stringify({ platform: "iOS", version: "1.0.0" }),
    ),
    getLegacySessionDataJson: jest.fn(() => "{}"),
    getLegacyEventsJson: jest.fn(() => []),
    removeLegacyEvent: jest.fn(),
  };
}

function createWorkerHybrid() {
  const listeners = new Set<
    (requestId: string, statusCode: number, body: string, error: string) => void
  >();
  return {
    enqueue: jest.fn(
      (
        requestId: string,
        url: string,
        _method: string,
        _headers: Record<string, string>,
        body: string,
      ) => {
        setTimeout(() => {
          const responseBody = url.includes("amplitude.com")
            ? JSON.stringify({
                code: 200,
                events_ingested: 1,
                payload_size_bytes: body.length,
                server_upload_time: 1,
              })
            : JSON.stringify({ ok: true, echoedBody: body });
          listeners.forEach((listener) =>
            listener(requestId, 200, responseBody, ""),
          );
        }, 0);
      },
    ),
    cancel: jest.fn((requestId: string) => {
      listeners.forEach((listener) => listener(requestId, 0, "", "cancelled"));
    }),
    addOnComplete: jest.fn((callback) => {
      listeners.add(callback);
      return jest.fn(() => listeners.delete(callback));
    }),
    queueSize: jest.fn(() => 0),
    inFlightCount: jest.fn(() => 0),
    pendingBodyBytes: jest.fn(() => 0),
  };
}

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn((name: string) => {
      const hybrid =
        name === "AmplitudeContext"
          ? createContextHybrid()
          : name === "AmplitudeStorage"
            ? createStorageHybrid()
            : createWorkerHybrid();
      mockHybridObjects[name] = hybrid;
      return hybrid;
    }),
  },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {},
}));

import type { Payload, Response, Transport } from "@amplitude/analytics-core";
import { Destination, Status } from "@amplitude/analytics-core";
import { NetworkGuardedFetchTransport } from "../analytics/network-guarded-fetch-transport";
import {
  clearDryRunTransportRecords,
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  dryRunHttpClient,
  dryRunTransport,
  getDryRunAnalyticsEvents,
  getDryRunTransportRecords,
  getNetworkEnabled,
  setNetworkEnabled,
} from "../network";
import {
  createFakeExperimentStorage,
  createMockExperimentClient,
} from "../testing";
import {
  clearDiagnosticFailures,
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  Experiment,
  createInstance,
  getAmplitudeErrorCode,
  getDiagnostics,
  getLastNativeError,
  getNativeStartupDiagnostics,
  getSafeAmplitudeDiagnostics,
  prefetchNativeContext,
  nitroHttpClient,
  variantBoolean,
  variantString,
} from "../index";
import * as AnalyticsCompat from "../analytics";
import * as ExperimentCompat from "../experiment";
import { AmplitudeReactNative } from "../analytics/react-native-client";
import { Backoff } from "../experiment/util/backoff";
import { getNativeApplicationContext } from "../native/context";
import { resetHybridInstancesForTests } from "../native/hybrid";
import {
  flushPendingDiskWrites,
  NitroAnalyticsStorage,
  NitroExperimentStorage,
  NitroMemoryStorage,
} from "../native/storage";
import {
  NitroAnalyticsStorage as WebAnalyticsStorage,
  NitroExperimentStorage as WebExperimentStorage,
  NitroMemoryStorage as WebMemoryStorage,
} from "../native/storage.web";
import {
  getNativeApplicationContext as getWebApplicationContext,
  prefetchNativeContext as prefetchWebNativeContext,
} from "../native/context.web";
import { nitroHttpClient as webNitroHttpClient } from "../native/http.web";
import * as WebEntry from "../index.web";
import { getDiagnosticEvents } from "../diagnostics-pipeline";
import {
  LocalStorage,
  MemoryStorage,
} from "../analytics/storage/local-storage";

function getRawBatchValue(key: string): string | undefined {
  return mockDisk.get(key);
}

type ConnectorGlobal = typeof globalThis & {
  analyticsConnectorInstances?: unknown;
};

type ReactNativeMock = {
  Platform: { OS: string };
};

describe("react-native-nitro-amplitude", () => {
  beforeEach(() => {
    jest.useRealTimers();
    (jest.requireMock("react-native") as ReactNativeMock).Platform.OS = "ios";
    (globalThis as ConnectorGlobal).analyticsConnectorInstances = undefined;
    flushPendingDiskWrites();
    mockMemory.clear();
    mockDisk.clear();
    for (const key of Object.keys(mockHybridObjects)) {
      delete mockHybridObjects[key];
    }
    resetHybridInstancesForTests();
    clearDiagnosticFailures();
  });

  it("exports analytics and experiment factories", () => {
    expect(typeof createInstance).toBe("function");
    expect(typeof createAmplitudeClient).toBe("function");
    expect(typeof Experiment.initialize).toBe("function");
    expect(typeof Experiment.initializeWithAmplitudeAnalytics).toBe("function");
  });

  it("exports durable storage presets and root experiment storage", async () => {
    const preset = createDurableAmplitudeStoragePreset({
      namespace: "preset-test",
      dryRun: true,
    });

    await preset.analytics.storageProvider?.set("events", [
      { event_type: "demo" },
    ]);
    await preset.analytics.cookieStorage?.set("session", {
      deviceId: "device",
      sessionId: 1,
    });
    await preset.experiment.storage?.put("variant", "on");

    expect(await preset.analytics.storageProvider?.get("events")).toEqual([
      { event_type: "demo" },
    ]);
    expect(await preset.analytics.cookieStorage?.get("session")).toMatchObject({
      deviceId: "device",
      sessionId: 1,
    });
    expect(await preset.experiment.storage?.get("variant")).toBe("on");

    await preset.clear();

    expect(
      await preset.analytics.storageProvider?.get("events"),
    ).toBeUndefined();
    expect(await preset.experiment.storage?.get("variant")).toBeNull();
  });

  it("shares named analytics identity with named experiment clients", async () => {
    const analytics = createInstance();
    await analytics.init("analytics-key", "named-user", {
      instanceName: "named",
    }).promise;

    const experiment = Experiment.initializeWithAmplitudeAnalytics(
      "deployment-key",
      {
        instanceName: "named",
      },
    );

    await expect(experiment.getUserProvider().getUser()).resolves.toMatchObject(
      {
        user_id: "named-user",
        device_id: analytics.getDeviceId(),
      },
    );

    analytics.shutdown();
  });

  it("uses Nitro transport by default for analytics flushes", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "default-user", {
        instanceName: "default-transport",
        migrateLegacyData: false,
      }).promise;

      await analytics.track("default_transport").promise;

      expect(mockHybridObjects.AmplitudeStorage?.set).toHaveBeenCalledWith(
        expect.stringContaining("analytics-events::AMP_unsent_analytics-"),
        expect.any(String),
        true,
      );
      await expect(analytics.flushWithResult()).resolves.toMatchObject({
        ok: true,
        failed: 0,
      });
      expect(mockHybridObjects.AmplitudeWorker?.enqueue).toHaveBeenCalled();
    } finally {
      analytics.shutdown();
    }
  });

  it("keeps analytics and experiment compatibility subpaths", () => {
    expect(typeof AnalyticsCompat.init).toBe("function");
    expect(typeof AnalyticsCompat.track).toBe("function");
    expect(typeof AnalyticsCompat.createInstance).toBe("function");
    expect(typeof ExperimentCompat.Experiment.initialize).toBe("function");
    expect(typeof ExperimentCompat.ExperimentClient).toBe("function");
  });

  it("reads native context through Nitro and normalizes null values", () => {
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
    expect(mockHybridObjects.AmplitudeContext?.prefetch).toHaveBeenCalled();

    const hybrid = mockHybridObjects.AmplitudeContext;
    hybrid.getApplicationContextJson.mockReturnValue(
      JSON.stringify({ version: null, platform: "Android", osName: 7 }),
    );
    const normalized = getNativeApplicationContext({
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
    expect(normalized.version).toBe("");
    expect(normalized.platform).toBe("Android");
    expect(normalized.osName).toBeUndefined();
  });

  it("retains deprecated legacy ABI stubs without SQLite migration", () => {
    expect(mockHybridObjects.AmplitudeContext).toBeUndefined();
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
    expect(context).toEqual({ platform: "iOS", version: "1.0.0" });
    expect(
      Object.keys(mockHybridObjects.AmplitudeContext ?? {}).sort(),
    ).toEqual([
      "getApplicationContextJson",
      "getLegacyEventsJson",
      "getLegacySessionDataJson",
      "prefetch",
      "removeLegacyEvent",
    ]);
    expect(mockHybridObjects.AmplitudeContext?.getLegacySessionDataJson()).toBe(
      "{}",
    );
    expect(mockHybridObjects.AmplitudeContext?.getLegacyEventsJson()).toEqual(
      [],
    );
  });

  it("clears stale native diagnostics after successful probes", () => {
    const nitroModules = jest.requireMock("react-native-nitro-modules") as {
      NitroModules: {
        createHybridObject: jest.Mock;
      };
    };
    const createHybridObject = nitroModules.NitroModules.createHybridObject;
    const originalCreateHybridObject =
      createHybridObject.getMockImplementation();

    createHybridObject.mockImplementationOnce(() => {
      throw new Error("native unavailable");
    });

    expect(getNativeStartupDiagnostics()).toMatchObject({
      nativeAvailable: false,
      lastError: {
        message: "native unavailable",
      },
    });
    expect(getLastNativeError()?.message).toBe("native unavailable");

    resetHybridInstancesForTests();
    if (originalCreateHybridObject) {
      createHybridObject.mockImplementation(originalCreateHybridObject);
    }

    expect(getNativeStartupDiagnostics()).toMatchObject({
      nativeAvailable: true,
    });
    expect(getLastNativeError()).toBeUndefined();
  });

  it("reports root diagnostics with native and network status", () => {
    const diagnostics = getDiagnostics();

    expect(diagnostics.native).toMatchObject({
      nativeAvailable: true,
      contextAvailable: true,
      storageAvailable: true,
      workerAvailable: true,
    });
    expect(diagnostics.networkEnabled).toBe(true);
    expect(diagnostics.activeInstanceNames).toEqual([]);
  });

  it("reports safe diagnostics without identity fields", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("safe-diagnostics-key", "safe-user", {
        instanceName: "safe-diagnostics",
        transportProvider: dryRunTransport,
      }).promise;

      const diagnostics = getSafeAmplitudeDiagnostics(analytics);

      expect(diagnostics).toMatchObject({
        initialized: true,
        instanceName: "safe-diagnostics",
        queueSize: 0,
        networkEnabled: true,
      });
      expect(diagnostics).not.toHaveProperty("userId");
      expect(diagnostics).not.toHaveProperty("deviceId");
      expect(diagnostics).not.toHaveProperty("sessionId");
    } finally {
      analytics.shutdown();
    }
  });

  it("stores analytics values in Nitro disk storage with namespace reset", async () => {
    const storage = new NitroAnalyticsStorage<{ enabled: boolean }>(
      "analytics",
    );

    await storage.set("config", { enabled: true });
    await storage.set("other", { enabled: false });

    expect(await storage.get("config")).toEqual({ enabled: true });
    expect(await storage.getRaw("config")).toBe('{"enabled":true}');

    await storage.reset();

    expect(await storage.get("config")).toBeUndefined();
    expect(await storage.get("other")).toBeUndefined();
  });

  it("isolates experiment disk and memory storage namespaces", async () => {
    const disk = new NitroExperimentStorage("experiment");
    const memory = new NitroMemoryStorage("experiment");

    await disk.put("flag", "disk-on");
    await memory.put("flag", "memory-on");

    expect(await disk.get("flag")).toBe("disk-on");
    expect(await memory.get("flag")).toBe("memory-on");

    await memory.reset();

    expect(await disk.get("flag")).toBe("disk-on");
    expect(await memory.get("flag")).toBeNull();
  });

  it("shares web memory storage across instances in the same namespace", async () => {
    const first = new WebMemoryStorage("shared");
    const second = new WebMemoryStorage("shared");
    const isolated = new WebMemoryStorage("isolated");

    await first.put("flag", "on");

    expect(await second.get("flag")).toBe("on");
    expect(await isolated.get("flag")).toBeNull();

    await second.reset();

    expect(await first.get("flag")).toBeNull();
  });

  it("bridges Nitro HTTP requests through the worker", async () => {
    jest.useFakeTimers();

    const request = nitroHttpClient.request(
      "https://example.com",
      "POST",
      { authorization: "redacted" },
      '{"event":"demo"}',
      1000,
    );

    await jest.runOnlyPendingTimersAsync();
    await expect(request).resolves.toEqual({
      status: 200,
      body: '{"ok":true,"echoedBody":"{\\"event\\":\\"demo\\"}"}',
    });
    expect(mockHybridObjects.AmplitudeWorker?.enqueue).toHaveBeenCalledWith(
      expect.stringMatching(/^req_/),
      "https://example.com",
      "POST",
      { authorization: "redacted" },
      '{"event":"demo"}',
      1000,
    );
  });

  it("supports global network disable and dry-run transport records", async () => {
    clearDryRunTransportRecords();
    expect(getNetworkEnabled()).toBe(true);
    setNetworkEnabled(false);
    await expect(
      nitroHttpClient.request("https://example.com", "POST", {}, null, 1000),
    ).rejects.toMatchObject({ code: "network_error" });
    setNetworkEnabled(true);

    await dryRunHttpClient.request(
      "https://example.com/dry-run",
      "POST",
      { accept: "application/json" },
      "{}",
      1000,
    );
    await dryRunTransport.send("https://example.com/events", {
      events: [{ event_type: "demo" }],
    });

    expect(getDryRunTransportRecords()).toEqual([
      expect.objectContaining({
        url: "https://example.com/dry-run",
        method: "POST",
      }),
    ]);
  });

  it("records bounded analytics and experiment request timings", async () => {
    const buffer = createNetworkTimingBuffer(1);
    const analyticsTransport = createTimedAnalyticsTransport(
      dryRunTransport,
      buffer.record,
    );
    const experimentHttpClient = createTimedHttpClient(
      dryRunHttpClient,
      buffer.record,
    );

    await analyticsTransport.send("https://example.com/events", {
      events: [{ event_type: "demo" }],
    });
    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "analytics",
        method: "POST",
        status: "success",
      }),
    ]);

    await experimentHttpClient.request(
      "https://example.com/variants",
      "GET",
      {},
      null,
      1000,
    );

    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "experiment",
        method: "GET",
        status: 202,
      }),
    ]);
  });

  it("preserves analytics transport compression options when timing requests", async () => {
    const calls: Array<{
      payload: Payload;
      compression?: boolean;
    }> = [];
    const transport: Transport = {
      async send(
        _serverUrl: string,
        payload: Payload,
        enableRequestBodyCompression?: boolean,
      ): Promise<Response | null> {
        calls.push({ payload, compression: enableRequestBodyCompression });
        return {
          status: "success",
          statusCode: 200,
          body: {
            eventsIngested: 1,
            payloadSizeBytes: 1,
            serverUploadTime: 1,
          },
        };
      },
    };

    await createTimedAnalyticsTransport(transport, jest.fn()).send(
      "https://example.com/events",
      { events: [{ event_type: "demo" }] },
      true,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        compression: true,
      }),
    ]);
  });

  it("records timing failures before rethrowing network errors", async () => {
    const buffer = createNetworkTimingBuffer();
    const experimentHttpClient = createTimedHttpClient(
      {
        async request() {
          throw new Error("offline");
        },
      },
      buffer.record,
    );

    await expect(
      experimentHttpClient.request(
        "https://example.com/variants",
        "GET",
        {},
        null,
        1000,
      ),
    ).rejects.toThrow("offline");

    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "experiment",
        method: "GET",
        error: "offline",
      }),
    ]);
  });

  it("reports failed flushes when events stay queued for retry", async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const analytics = createInstance();
    const otherAnalytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-failure",
        flushIntervalMillis: 60000,
        transportProvider: {
          async send() {
            throw new Error(
              "A server with the specified hostname could not be found.",
            );
          },
        },
      }).promise;
      await otherAnalytics.init("other-analytics-key", "other-user", {
        instanceName: "flush-other",
        transportProvider: dryRunTransport,
      }).promise;

      analytics.track("flush_failure");

      const result = await analytics.flushWithResult();

      expect(result).toMatchObject({
        ok: false,
        sent: 0,
        failed: 0,
        retried: 1,
      });
      expect(result.reason).toContain("queued event");
      expect(analytics.getDiagnostics().lastFlushError).toContain(
        "queued event",
      );
      expect(otherAnalytics.getDiagnostics().lastFlushError).toBeUndefined();
      expect(otherAnalytics.getDiagnostics().lastFlushTime).toBeUndefined();
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(getDiagnostics().diagnosticFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "analytics_upload",
            surface: "analytics_upload",
            kind: "dns_or_hostname_resolution",
            targetHost: "api2.amplitude.com",
            batchSize: 1,
            queuedEventCount: 1,
            throttledCount: expect.any(Number),
            packageVersion: expect.any(String),
          }),
        ]),
      );
    } finally {
      analytics.shutdown();
      otherAnalytics.shutdown();
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("counts events still in the timeline queue during flush", async () => {
    clearDryRunTransportRecords();
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-timeline-queue",
        migrateLegacyData: false,
        transportProvider: dryRunTransport,
      }).promise;

      const trackPromise = analytics.track("flush_timeline_queue").promise;

      const result = await analytics.flushWithResult();
      await expect(trackPromise).resolves.toMatchObject({ code: 202 });

      expect(result).toMatchObject({
        ok: true,
        failed: 0,
        dropped: 0,
      });
      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(analytics.getDiagnostics().queueSize).toBe(0);
    } finally {
      analytics.shutdown();
    }
  });

  it("tracks screen views and deduplicates unchanged navigation state", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "screen-user", {
        instanceName: "screen-views",
        migrateLegacyData: false,
        transportProvider: dryRunTransport,
      }).promise;

      const directResult = analytics.trackScreenView("Home").promise;
      const navigationState = {
        index: 0,
        routes: [
          {
            name: "Root",
            state: {
              index: 0,
              routes: [{ name: "Details" }],
            },
          },
        ],
      };
      const navigationResult =
        analytics.trackScreenViewOnNavigationStateChange(
          navigationState,
        ).promise;
      const duplicateResult =
        analytics.trackScreenViewOnNavigationStateChange(
          navigationState,
        ).promise;

      await analytics.flushWithResult();

      await expect(directResult).resolves.toMatchObject({ code: 202 });
      await expect(navigationResult).resolves.toMatchObject({ code: 202 });
      await expect(duplicateResult).resolves.toBeUndefined();
    } finally {
      analytics.shutdown();
    }
  });

  it("reports server-dropped flushes as failed", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-dropped",
        migrateLegacyData: false,
        transportProvider: {
          async send(): Promise<Response> {
            return {
              status: Status.Invalid,
              statusCode: 400,
              body: {
                error: "Invalid API key",
                missingField: "api_key",
                eventsWithInvalidFields: {},
                eventsWithMissingFields: {},
                eventsWithInvalidIdLengths: {},
                epsThreshold: 0,
                exceededDailyQuotaDevices: {},
                silencedDevices: [],
                silencedEvents: [],
                throttledDevices: {},
                throttledEvents: [],
              },
            };
          },
        },
      }).promise;

      analytics.track("flush_dropped");

      const result = await analytics.flushWithResult();

      expect(result).toMatchObject({
        ok: false,
        sent: 0,
        failed: 1,
        dropped: 1,
        retried: 0,
      });
      expect(result.reason).toContain("Invalid API key");
      expect(analytics.getDiagnostics().lastFlushError).toContain(
        "Invalid API key",
      );
      expect(analytics.getDiagnostics().queueSize).toBe(0);
    } finally {
      analytics.shutdown();
    }
  });

  it("records fetch failures for existing experiment fetch APIs", async () => {
    const experiment = Experiment.initialize("fetch-failure-key", {
      retryFetchOnFailure: false,
      httpClient: {
        async request() {
          throw new Error("fetch offline");
        },
      },
    });

    await expect(
      experiment.fetchOrThrow(
        { user_id: "fetch-failure-user" },
        { flagKeys: ["missing-flag"] },
      ),
    ).rejects.toThrow("fetch offline");

    expect(experiment.variantWithMetadata("missing-flag")).toMatchObject({
      reason: "fetch_failure",
    });
    expect(getDiagnostics().diagnosticFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "experiment_fetch",
          surface: "experiment_variant_fetch",
          kind: "network_error",
          targetHost: "api.lab.amplitude.com",
          packageVersion: expect.any(String),
        }),
      ]),
    );
  });

  it("records flag config fetch failures separately from variant fetches", async () => {
    const experiment = Experiment.initialize("flag-fetch-failure-key", {
      instanceName: "flag-fetch-failure",
      retryFetchOnFailure: false,
      httpClient: {
        async request(requestUrl) {
          if (requestUrl.includes("/sdk/v2/flags")) {
            throw new Error("Request timeout after 10000 milliseconds");
          }
          return {
            status: 200,
            body: "{}",
          };
        },
      },
    });

    await expect(
      experiment.start({ user_id: "flag-fetch-failure-user" }),
    ).rejects.toThrow("Request timeout");

    expect(getDiagnostics().diagnosticFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "experiment_fetch",
          surface: "experiment_flag_fetch",
          kind: "timeout",
          targetHost: "flag.lab.amplitude.com",
          packageVersion: expect.any(String),
        }),
      ]),
    );

    experiment.stop();
  });

  it("uses durable experiment storage by default for cached feature availability", async () => {
    let failFetch = false;
    const httpClient = {
      async request(requestUrl: string) {
        if (failFetch) {
          throw new Error(
            "A server with the specified hostname could not be found.",
          );
        }
        if (requestUrl.includes("/sdk/v2/flags")) {
          return {
            status: 200,
            body: "[]",
          };
        }
        return {
          status: 200,
          body: JSON.stringify({
            "irl-mode": {
              key: "on",
              value: "on",
            },
          }),
        };
      },
    };
    const firstClient = new ExperimentCompat.ExperimentClient(
      "durable-feature-key",
      {
        fetchOnStart: false,
        pollOnStart: false,
        retryFetchOnFailure: false,
        httpClient,
      },
    );

    await firstClient.fetchOrThrow(
      { user_id: "goodword-user" },
      { flagKeys: ["irl-mode"] },
    );

    expect(firstClient.variantWithMetadata("irl-mode")).toMatchObject({
      variant: { value: "on" },
      fallback: false,
    });
    expect(Array.from(mockDisk.keys())).toEqual(
      expect.arrayContaining([
        expect.stringContaining("experiment::amp-exp-$default_instance"),
      ]),
    );

    failFetch = true;
    const restartedClient = new ExperimentCompat.ExperimentClient(
      "durable-feature-key",
      {
        fetchOnStart: false,
        pollOnStart: false,
        retryFetchOnFailure: false,
        httpClient,
      },
    );
    await restartedClient.cacheReady();

    await expect(
      restartedClient.fetchOrThrow(
        { user_id: "goodword-user" },
        { flagKeys: ["irl-mode"] },
      ),
    ).rejects.toThrow("hostname");

    expect(restartedClient.variantWithMetadata("irl-mode")).toMatchObject({
      variant: { value: "on" },
      fallback: false,
    });
    expect(getDiagnostics().diagnosticFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "experiment_fetch",
          surface: "experiment_variant_fetch",
          kind: "dns_or_hostname_resolution",
        }),
      ]),
    );
  });

  it("wires combined dry-run clients across analytics and experiment", async () => {
    clearDryRunTransportRecords();
    const amplitude = createAmplitudeClient({
      analyticsApiKey: "analytics-dry-run-key",
      experimentDeploymentKey: "deployment-dry-run-key",
      instanceName: "dry-run",
      userId: "dry-run-user",
      durableStorage: false,
      dryRun: true,
      experiment: { retryFetchOnFailure: false },
    });

    await amplitude.init();
    await amplitude.experiment?.fetchWithMetadata(
      { user_id: "dry-run-user" },
      { flagKeys: ["demo-flag"] },
    );

    expect(getDryRunTransportRecords()).toEqual([
      expect.objectContaining({
        url: expect.stringContaining("amplitude"),
        method: "GET",
      }),
    ]);
  });

  it("classifies deployment-key errors distinctly", () => {
    expect(getAmplitudeErrorCode(new Error("Missing deployment key"))).toBe(
      "invalid_deployment_key",
    );
  });

  it("provides typed testing helpers and variant helpers", async () => {
    const storage = createFakeExperimentStorage({ flag: "on" });
    expect(await storage.get("flag")).toBe("on");

    const experiment = createMockExperimentClient({
      bool: { value: "true" },
      string: { value: "enabled" },
    });

    expect(variantBoolean(experiment, "bool", false)).toBe(true);
    expect(variantString(experiment, "string", "fallback")).toBe("enabled");
  });

  it("provides web storage and context fallbacks without Nitro", async () => {
    const analytics = new WebAnalyticsStorage<{ value: string }>("web");
    const disk = new WebExperimentStorage("web-experiment");
    const experiment = new WebMemoryStorage("web-experiment");

    await analytics.set("event", { value: "queued" });
    await disk.put("variant", "disk-on");
    await experiment.put("variant", "on");

    expect(await analytics.get("event")).toEqual({ value: "queued" });
    expect(await disk.get("variant")).toBe("disk-on");
    expect(await experiment.get("variant")).toBe("on");
    expect(getWebApplicationContext({ platform: true }).platform).toBe("Web");
    expect(prefetchWebNativeContext()).toBeUndefined();

    await analytics.reset();
    await disk.reset();
    await experiment.reset();

    expect(await analytics.get("event")).toBeUndefined();
    expect(await disk.get("variant")).toBeNull();
    expect(await experiment.get("variant")).toBeNull();
  });

  it("uses browser storage and fetch for web fallbacks", async () => {
    const values = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    const originalFetch = globalThis.fetch;
    (jest.requireMock("react-native") as ReactNativeMock).Platform.OS = "web";

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });
    globalThis.fetch = jest.fn(async () => ({
      status: 202,
      text: async () => "accepted",
    })) as unknown as typeof fetch;

    try {
      expect(WebEntry.nitroTransport).toBeInstanceOf(
        NetworkGuardedFetchTransport,
      );

      const analytics = new WebEntry.NitroAnalyticsStorage<{ value: string }>(
        "persisted",
      );
      const experiment = new WebEntry.NitroExperimentStorage("persisted");

      await analytics.set("event", { value: "stored" });
      await experiment.put("flag", "enabled");

      expect(await analytics.get("event")).toEqual({ value: "stored" });
      expect(await experiment.get("flag")).toBe("enabled");
      const webAnalytics = createInstance();
      await webAnalytics.init("analytics-key", "web-user", {
        instanceName: "web-default",
        migrateLegacyData: false,
      }).promise;
      webAnalytics.track("web_default_transport");
      await expect(webAnalytics.flushWithResult()).resolves.toMatchObject({
        ok: true,
        failed: 0,
      });
      webAnalytics.shutdown();
      expect(mockHybridObjects.AmplitudeWorker).toBeUndefined();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("amplitude"),
        expect.objectContaining({
          method: "POST",
        }),
      );
      await webAnalytics.reset();
      (globalThis.fetch as jest.Mock).mockClear();
      setNetworkEnabled(false);
      const blockedAnalytics = createInstance();
      await blockedAnalytics.init("analytics-key", "web-user", {
        instanceName: "web-blocked",
        migrateLegacyData: false,
      }).promise;
      blockedAnalytics.track("web_blocked_transport");
      await expect(blockedAnalytics.flushWithResult()).resolves.toMatchObject({
        ok: false,
        retried: 1,
      });
      await blockedAnalytics.reset();
      blockedAnalytics.shutdown();
      setNetworkEnabled(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      await expect(
        WebEntry.nitroHttpClient.request(
          "https://example.com/variants",
          "POST",
          { authorization: "redacted" },
          null,
          1000,
        ),
      ).resolves.toEqual({ status: 202, body: "accepted" });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://example.com/variants",
        expect.objectContaining({
          method: "POST",
          headers: { authorization: "redacted" },
          body: "",
        }),
      );
      await expect(
        webNitroHttpClient.request(
          "https://example.com/variants",
          "GET",
          { authorization: "redacted" },
          null,
          1000,
        ),
      ).resolves.toEqual({ status: 202, body: "accepted" });

      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "https://example.com/variants",
        expect.not.objectContaining({
          body: expect.any(String),
        }),
      );

      (globalThis.fetch as jest.Mock).mockClear();
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            "web-flag": { key: "on", value: "enabled" },
          }),
      });

      const webExperiment = WebEntry.Experiment.initialize(
        "web-experiment-key",
        {
          instanceName: "web-experiment-defaults",
          retryFetchOnFailure: false,
        },
      );
      await expect(
        webExperiment.fetchWithMetadata(
          { user_id: "web-user" },
          { flagKeys: ["web-flag"] },
        ),
      ).resolves.toMatchObject({
        flagKeys: ["web-flag"],
      });
      expect(webExperiment.variant("web-flag")).toMatchObject({
        value: "enabled",
      });
      expect(mockHybridObjects.AmplitudeStorage).toBeUndefined();

      await analytics.reset();
      await new WebAnalyticsStorage("analytics-events").reset();

      expect(
        Array.from(values.keys()).filter((key) =>
          key.includes("analytics-events"),
        ),
      ).toEqual([]);
      expect(Array.from(values.keys())).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "experiment::amp-exp-web-experiment-defaults",
          ),
        ]),
      );
    } finally {
      setNetworkEnabled(true);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
      globalThis.fetch = originalFetch;
    }
  });

  it("persists analytics identity across restarts through durable storage", async () => {
    const first = createInstance();
    try {
      await first.init("durable-identity-key", "durable-user", {
        instanceName: "durable-identity",
        migrateLegacyData: false,
      }).promise;
    } finally {
      first.shutdown();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const deviceId = first.getDeviceId();
    const sessionId = first.getSessionId();

    const second = createInstance();
    try {
      await second.init("durable-identity-key", undefined, {
        instanceName: "durable-identity",
        migrateLegacyData: false,
      }).promise;
      expect(second.getDeviceId()).toBe(deviceId);
      expect(second.getUserId()).toBe("durable-user");
      expect(second.getSessionId()).toBe(sessionId);
    } finally {
      second.shutdown();
    }
  });

  it("keeps LocalStorage durable while MemoryStorage stays process-local", async () => {
    const first = new LocalStorage<{ ok: boolean }>();
    const second = new LocalStorage<{ ok: boolean }>();
    const memory = new MemoryStorage<{ ok: boolean }>();

    await first.set("durable", { ok: true });
    await memory.set("memory", { ok: true });

    expect(await second.get("durable")).toEqual({ ok: true });
    expect(await first.get("durable")).toEqual({ ok: true });
    expect(await memory.get("memory")).toEqual({ ok: true });

    await first.remove("durable");
    expect(await second.get("durable")).toBeUndefined();
  });

  it("scopes web LocalStorage reset to package keys", async () => {
    const values = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    (jest.requireMock("react-native") as ReactNativeMock).Platform.OS = "web";

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });

    try {
      values.set("unrelated-app-key", "keep");
      const storage = new LocalStorage<{ ok: boolean }>();
      await storage.set("own", { ok: true });

      expect(values.get("unrelated-app-key")).toBe("keep");
      expect(values.has("nitro-amplitude::local::own")).toBe(true);

      await storage.reset();

      expect(values.has("nitro-amplitude::local::own")).toBe(false);
      expect(values.get("unrelated-app-key")).toBe("keep");
      expect(await storage.get("own")).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });

  it("coalesces analytics disk writes behind a short debounce", async () => {
    jest.useFakeTimers();
    try {
      const storage = new NitroAnalyticsStorage<{ ok: boolean }>("coalesce");
      await storage.set("events", { ok: true });
      expect(getRawBatchValue("coalesce::events")).toBeUndefined();
      expect(await storage.get("events")).toEqual({ ok: true });

      jest.advanceTimersByTime(200);

      expect(getRawBatchValue("coalesce::events")).toBe('{"ok":true}');
      const reopened = new NitroAnalyticsStorage<{ ok: boolean }>("coalesce");
      expect(await reopened.get("events")).toEqual({ ok: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it("persists coalesced analytics writes immediately on explicit flush", async () => {
    const storage = new NitroAnalyticsStorage<{ ok: boolean }>("flush-now");
    await storage.set("events", { ok: true });
    expect(getRawBatchValue("flush-now::events")).toBeUndefined();
    flushPendingDiskWrites();
    expect(getRawBatchValue("flush-now::events")).toBe('{"ok":true}');
    expect(mockHybridObjects.AmplitudeStorage?.set).toHaveBeenCalledWith(
      "flush-now::events",
      '{"ok":true}',
      true,
    );
  });

  it("persists writes created during the core flush before flush resolves", async () => {
    const analytics = new AmplitudeReactNative();
    const storage = new NitroAnalyticsStorage<{ ok: boolean }>("core-flush");
    const timeline = (
      analytics as unknown as {
        timeline: { flush: () => Promise<void> };
      }
    ).timeline;
    timeline.flush = async () => {
      await storage.set("events", { ok: true });
    };

    const flushResult = analytics.flush();
    expect(getRawBatchValue("core-flush::events")).toBeUndefined();
    await flushResult.promise;

    expect(getRawBatchValue("core-flush::events")).toBe('{"ok":true}');
  });

  it("serializes overlapping flushes and automatic destination flushes", async () => {
    const analytics = new AmplitudeReactNative();
    const storage = new NitroAnalyticsStorage<{ value: string }>(
      "overlapping-flush",
    );
    const timeline = (
      analytics as unknown as {
        timeline: {
          plugins: Array<{
            type: string;
            queue: unknown[];
            flush: (useRetry?: boolean) => Promise<void>;
          }>;
        };
      }
    ).timeline;
    let releaseFirstFlush!: () => void;
    const firstFlushReady = new Promise<void>((resolve) => {
      releaseFirstFlush = resolve;
    });
    let firstFlushStarted!: () => void;
    const firstFlushStartedPromise = new Promise<void>((resolve) => {
      firstFlushStarted = resolve;
    });
    const flushCalls: boolean[] = [];
    const destination = {
      type: "destination",
      queue: [],
      flush: jest.fn(async (useRetry = false) => {
        flushCalls.push(useRetry);
        if (flushCalls.length === 1) {
          firstFlushStarted();
          await firstFlushReady;
          await storage.set("events", { value: "manual" });
          return;
        }
        await storage.set("events", { value: "automatic" });
      }),
    };
    timeline.plugins = [destination];

    const first = analytics.flush().promise;
    await firstFlushStartedPromise;
    const automatic = destination.flush(true);
    const second = analytics.flush().promise;

    expect(flushCalls).toEqual([false]);
    releaseFirstFlush();

    await first;
    await automatic;
    await second;

    expect(flushCalls).toEqual([false, true, false]);
    expect(await storage.get("events")).toEqual({ value: "automatic" });
    expect(getRawBatchValue("overlapping-flush::events")).toBe(
      '{"value":"automatic"}',
    );
  });

  it("does not poison follow-up flushes after a core flush failure", async () => {
    const analytics = new AmplitudeReactNative();
    const storage = new NitroAnalyticsStorage<{ value: string }>(
      "follow-up-flush",
    );
    const timeline = (
      analytics as unknown as {
        timeline: { flush: jest.Mock<Promise<void>, []> };
      }
    ).timeline;
    timeline.flush = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("core flush failed"))
      .mockImplementationOnce(async () => {
        await storage.set("events", { value: "recovered" });
      });

    await expect(analytics.flush().promise).rejects.toThrow(
      "core flush failed",
    );
    await expect(analytics.flush().promise).resolves.toBeUndefined();
    expect(await storage.get("events")).toEqual({ value: "recovered" });
    expect(getRawBatchValue("follow-up-flush::events")).toBe(
      '{"value":"recovered"}',
    );
  });

  it("recovers Core destination scheduling after repeated flush rejection", async () => {
    const analytics = new AmplitudeReactNative();
    try {
      await analytics.init("destination-recovery-key", undefined, {
        instanceName: "destination-recovery",
        flushIntervalMillis: 60_000,
        migrateLegacyData: false,
        trackingSessionEvents: false,
        transportProvider: dryRunTransport,
      }).promise;

      const timeline = (
        analytics as unknown as {
          timeline: { plugins: unknown[] };
        }
      ).timeline;
      const destination = timeline.plugins.find(
        (plugin): plugin is Destination => plugin instanceof Destination,
      );
      expect(destination).toBeDefined();
      if (!destination) {
        return;
      }

      const firstError = new Error("first destination flush failed");
      const secondError = new Error("second destination flush failed");
      const send = jest
        .spyOn(destination, "send")
        .mockRejectedValueOnce(firstError)
        .mockRejectedValueOnce(secondError)
        .mockImplementationOnce(async (list) => {
          destination.fulfillRequest(list, 200, "sent");
        });
      const eventResult = destination.execute({
        event_type: "destination_recovery_event",
        device_id: "destination-recovery-device",
        time: Date.now(),
      });

      await expect(analytics.flush().promise).rejects.toBe(firstError);
      expect(destination.flushId).toBeNull();
      expect(destination.scheduleId).not.toBeNull();

      const secondFlush = analytics.flush().promise;
      const thirdFlush = analytics.flush().promise;
      await expect(secondFlush).rejects.toBe(secondError);
      await expect(thirdFlush).resolves.toBeUndefined();
      await expect(eventResult).resolves.toMatchObject({ code: 200 });

      expect(destination.flushId).toBeNull();
      expect(destination.scheduleId).toBeNull();
      expect(destination.queue).toHaveLength(0);
      expect(send).toHaveBeenCalledTimes(3);
    } finally {
      analytics.shutdown();
    }
  });

  it("serializes overlapping flushWithResult calls with writes near completion", async () => {
    const analytics = new AmplitudeReactNative();
    const storage = new NitroAnalyticsStorage<{ value: string }>(
      "overlapping-result-flush",
    );
    const timeline = (
      analytics as unknown as {
        timeline: { flush: jest.Mock<Promise<void>, []> };
      }
    ).timeline;
    let flushCount = 0;
    timeline.flush = jest.fn(async () => {
      flushCount += 1;
      await storage.set("events", { value: `flush-${flushCount}` });
      await Promise.resolve();
      await storage.set("events", { value: `late-${flushCount}` });
    });

    const first = analytics.flushWithResult();
    const second = analytics.flushWithResult();

    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(timeline.flush).toHaveBeenCalledTimes(2);
    expect(await storage.get("events")).toEqual({ value: "late-2" });
    expect(getRawBatchValue("overlapping-result-flush::events")).toBe(
      '{"value":"late-2"}',
    );
  });

  it("reports durable storage failures from flushWithResult and retains the write", async () => {
    const analytics = new AmplitudeReactNative();
    const storage = new NitroAnalyticsStorage<{ ok: boolean }>("flush-error");
    const timeline = (
      analytics as unknown as {
        timeline: { flush: () => Promise<void> };
      }
    ).timeline;
    timeline.flush = async () => {
      await storage.set("events", { ok: true });
    };
    await storage.get("missing");
    mockHybridObjects.AmplitudeStorage?.set.mockImplementationOnce(() => {
      throw new Error("NitroAmplitude: storage_error");
    });

    await expect(analytics.flushWithResult()).resolves.toMatchObject({
      ok: false,
      reason: "NitroAmplitude: storage_error",
    });
    expect(await storage.get("events")).toEqual({ ok: true });

    flushPendingDiskWrites();
    expect(getRawBatchValue("flush-error::events")).toBe('{"ok":true}');
  });

  it("preserves write ordering and last-write-wins under coalescing", async () => {
    jest.useFakeTimers();
    try {
      const first = new NitroAnalyticsStorage<{ n: number }>("ordered");
      const second = new NitroAnalyticsStorage<{ n: number }>("ordered");
      await first.set("a", { n: 1 });
      await second.set("b", { n: 2 });
      await first.set("a", { n: 3 });

      jest.advanceTimersByTime(200);

      expect(
        mockHybridObjects.AmplitudeStorage?.set.mock.calls.map(
          (call) => [call[0], call[1]] as const,
        ),
      ).toEqual([
        ["ordered::a", '{"n":3}'],
        ["ordered::b", '{"n":2}'],
      ]);
      expect(getRawBatchValue("ordered::a")).toBe('{"n":3}');
      expect(getRawBatchValue("ordered::b")).toBe('{"n":2}');
    } finally {
      jest.useRealTimers();
    }
  });

  it("applies controlled jitter and caps the maximum backoff delay", async () => {
    jest.useFakeTimers();
    try {
      for (const [randomValue, expectedDelays] of [
        [0, [800, 1600, 3200, 6400, 6400]],
        [1, [1200, 2400, 4800, 8000, 8000]],
      ] as const) {
        const randomSpy = jest
          .spyOn(Math, "random")
          .mockReturnValue(randomValue);
        try {
          const backoff = new Backoff(5, 1000, 8000, 2);
          const attempts = jest.fn(async () => {
            throw new Error("offline");
          });
          backoff.start(attempts);

          let elapsed = 0;
          for (const [index, expectedDelay] of expectedDelays.entries()) {
            await jest.advanceTimersByTimeAsync(expectedDelay);
            elapsed += expectedDelay;
            expect(attempts).toHaveBeenCalledTimes(index + 1);
          }
          expect(elapsed).toBe(
            expectedDelays.reduce((total, delay) => total + delay, 0),
          );
        } finally {
          randomSpy.mockRestore();
          jest.clearAllTimers();
        }
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("retains failed and unattempted disk writes for a later retry", async () => {
    const first = new NitroAnalyticsStorage<{ n: number }>("retry");
    const second = new NitroAnalyticsStorage<{ n: number }>("retry");
    await first.set("first", { n: 1 });
    await second.set("second", { n: 2 });
    await first.get("missing");

    const storageSet = mockHybridObjects.AmplitudeStorage?.set;
    expect(storageSet).toBeDefined();
    storageSet?.mockImplementationOnce(() => {
      throw new Error("NitroAmplitude: storage_error");
    });

    expect(() => flushPendingDiskWrites()).toThrow(
      "NitroAmplitude: storage_error",
    );
    expect(await first.get("first")).toEqual({ n: 1 });
    expect(await second.get("second")).toEqual({ n: 2 });
    expect(getRawBatchValue("retry::first")).toBeUndefined();
    expect(getRawBatchValue("retry::second")).toBeUndefined();

    flushPendingDiskWrites();

    expect(getRawBatchValue("retry::first")).toBe('{"n":1}');
    expect(getRawBatchValue("retry::second")).toBe('{"n":2}');
  });

  it("retries a failed timer flush without an uncaught rejection", async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const storage = new NitroAnalyticsStorage<{ n: number }>("timer-retry");
      await storage.get("missing");
      const storageSet = mockHybridObjects.AmplitudeStorage?.set;
      storageSet?.mockImplementationOnce(() => {
        throw new Error("NitroAmplitude: timer_storage_error");
      });

      await storage.set("value", { n: 1 });
      jest.advanceTimersByTime(200);

      expect(getRawBatchValue("timer-retry::value")).toBeUndefined();
      expect(await storage.get("value")).toEqual({ n: 1 });

      jest.advanceTimersToNextTimer();
      expect(getRawBatchValue("timer-retry::value")).toBe('{"n":1}');
    } finally {
      mockHybridObjects.AmplitudeStorage?.set.mockImplementation(
        (key: string, value: string) => mockDisk.set(key, value),
      );
      flushPendingDiskWrites();
      jest.clearAllTimers();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it("backs off repeated timer flush failures with a bounded delay", async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const storage = new NitroAnalyticsStorage<{ n: number }>("timer-backoff");
      await storage.get("missing");
      const attemptTimes: number[] = [];
      mockHybridObjects.AmplitudeStorage?.set.mockImplementation(() => {
        attemptTimes.push(Date.now());
        throw new Error("NitroAmplitude: repeated_storage_error");
      });

      await storage.set("value", { n: 1 });
      jest.advanceTimersByTime(200);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        jest.advanceTimersToNextTimer();
      }

      const delays = attemptTimes.slice(1).map((time, index) => {
        return time - attemptTimes[index]!;
      });
      expect(attemptTimes.length).toBe(9);
      expect(delays[0]).toBeGreaterThanOrEqual(200);
      expect(delays[1]).toBeGreaterThan(delays[0]!);
      expect(Math.max(...delays)).toBeLessThanOrEqual(5000);
      expect(await storage.get("value")).toEqual({ n: 1 });
    } finally {
      mockHybridObjects.AmplitudeStorage?.set.mockImplementation(
        (key: string, value: string) => mockDisk.set(key, value),
      );
      flushPendingDiskWrites();
      jest.clearAllTimers();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it("keeps the newest replacement when a timer flush fails", async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const storage = new NitroAnalyticsStorage<{ n: number }>(
        "timer-replacement",
      );
      await storage.get("missing");
      const storageSet = mockHybridObjects.AmplitudeStorage?.set;
      storageSet?.mockImplementationOnce(() => {
        void storage.set("value", { n: 2 });
        throw new Error("NitroAmplitude: replacement_storage_error");
      });

      await storage.set("value", { n: 1 });
      jest.advanceTimersByTime(200);
      expect(await storage.get("value")).toEqual({ n: 2 });

      jest.advanceTimersToNextTimer();
      expect(getRawBatchValue("timer-replacement::value")).toBe('{"n":2}');
    } finally {
      mockHybridObjects.AmplitudeStorage?.set.mockImplementation(
        (key: string, value: string) => mockDisk.set(key, value),
      );
      flushPendingDiskWrites();
      jest.clearAllTimers();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it("cancels the coalescing timer for explicit flush and reschedules after failure", async () => {
    jest.useFakeTimers();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const storage = new NitroAnalyticsStorage<{ n: number }>(
        "explicit-retry",
      );
      await storage.get("missing");
      const storageSet = mockHybridObjects.AmplitudeStorage?.set;
      storageSet?.mockImplementationOnce(() => {
        throw new Error("NitroAmplitude: explicit_storage_error");
      });

      await storage.set("value", { n: 1 });
      expect(() => flushPendingDiskWrites()).toThrow(
        "NitroAmplitude: explicit_storage_error",
      );
      expect(jest.getTimerCount()).toBe(1);

      flushPendingDiskWrites();
      expect(jest.getTimerCount()).toBe(0);
      expect(getRawBatchValue("explicit-retry::value")).toBe('{"n":1}');
    } finally {
      mockHybridObjects.AmplitudeStorage?.set.mockImplementation(
        (key: string, value: string) => mockDisk.set(key, value),
      );
      flushPendingDiskWrites();
      jest.clearAllTimers();
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it("flushes accepted events before shutdown teardown", async () => {
    clearDryRunTransportRecords();
    const analytics = createInstance();
    try {
      await analytics.init("shutdown-flush-key", "shutdown-user", {
        instanceName: "shutdown-flush",
        migrateLegacyData: false,
        transportProvider: dryRunTransport,
      }).promise;
      analytics.track("shutdown_flush_event");
    } finally {
      analytics.shutdown();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const events = getDryRunAnalyticsEvents();
    expect(
      events.some((entry) =>
        entry.payload.events.some(
          (event) => event.event_type === "shutdown_flush_event",
        ),
      ),
    ).toBe(true);
  });

  it("resets analytics identity and experiment state together", async () => {
    const client = createAmplitudeClient({
      analyticsApiKey: "combined-reset-analytics",
      experimentDeploymentKey: "combined-reset-key",
      instanceName: "combined-reset",
      userId: "reset-user",
      durableStorage: false,
      dryRun: true,
    });
    await client.init({ user_id: "reset-user" });
    const oldUserId = client.getUserId();
    const oldDeviceId = client.getDeviceId();
    expect(oldUserId).toBe("reset-user");
    client.reset();
    expect(client.getUserId()).toBeUndefined();
    expect(client.getDeviceId()).not.toBe(oldDeviceId);
    expect(client.experiment?.getUser().user_id).toBeUndefined();
  });

  it("reports variant freshness transitions", async () => {
    let failFetch = false;
    const httpClient = {
      async request(requestUrl: string) {
        if (failFetch) {
          throw new Error(
            "A server with the specified hostname could not be found.",
          );
        }
        if (requestUrl.includes("/sdk/v2/flags")) {
          return { status: 200, body: "[]" };
        }
        return {
          status: 200,
          body: JSON.stringify({
            "fresh-flag": { key: "on", value: "on" },
          }),
        };
      },
    };
    const client = new ExperimentCompat.ExperimentClient("freshness-key", {
      fetchOnStart: false,
      pollOnStart: false,
      retryFetchOnFailure: false,
      httpClient,
    });

    expect(client.variantWithMetadata("fresh-flag")).toMatchObject({
      freshness: "unknown",
    });

    await client.fetchOrThrow(
      { user_id: "freshness-user" },
      { flagKeys: ["fresh-flag"] },
    );
    expect(client.variantWithMetadata("fresh-flag")).toMatchObject({
      variant: { value: "on" },
      freshness: "fresh",
      stale: false,
    });

    failFetch = true;
    await expect(
      client.fetchOrThrow(
        { user_id: "freshness-user" },
        { flagKeys: ["fresh-flag"] },
      ),
    ).rejects.toThrow("hostname");
    expect(client.variantWithMetadata("fresh-flag")).toMatchObject({
      variant: { value: "on" },
      freshness: "stale",
      stale: true,
      reason: undefined,
    });
  });

  it("replaces experiment singletons on explicit reinitialize", () => {
    const first = Experiment.initialize("reinit-key", {
      instanceName: "reinit",
      fetchOnStart: false,
      pollOnStart: false,
      initialVariants: { flag: { value: "first" } },
    });
    expect(first.variant("flag")).toMatchObject({ value: "first" });

    const sameInstance = Experiment.initialize("reinit-key", {
      instanceName: "reinit",
      fetchOnStart: false,
      pollOnStart: false,
      initialVariants: { flag: { value: "ignored" } },
    });
    expect(sameInstance).toBe(first);
    expect(first.variant("flag")).toMatchObject({ value: "first" });

    const replacement = Experiment.reinitialize("reinit-key", {
      instanceName: "reinit",
      fetchOnStart: false,
      pollOnStart: false,
      initialVariants: { flag: { value: "second" } },
    });
    expect(replacement).not.toBe(first);
    expect(replacement.variant("flag")).toMatchObject({ value: "second" });
    expect(
      Experiment.initialize("reinit-key", {
        instanceName: "reinit",
        fetchOnStart: false,
        pollOnStart: false,
      }),
    ).toBe(replacement);
  });

  it("reports per-capability native availability", () => {
    const nitroModules = jest.requireMock("react-native-nitro-modules") as {
      NitroModules: {
        createHybridObject: jest.Mock;
      };
    };
    const createHybridObject = nitroModules.NitroModules.createHybridObject;
    const originalCreateHybridObject =
      createHybridObject.getMockImplementation();

    createHybridObject.mockImplementation((name: string) => {
      if (name === "AmplitudeStorage") {
        throw new Error("storage unavailable");
      }
      return originalCreateHybridObject?.(name);
    });

    expect(getNativeStartupDiagnostics()).toMatchObject({
      contextAvailable: true,
      storageAvailable: false,
      workerAvailable: true,
      nativeAvailable: false,
    });

    resetHybridInstancesForTests();
    if (originalCreateHybridObject) {
      createHybridObject.mockImplementation(originalCreateHybridObject);
    }
  });

  it("probes durable storage and worker readiness in health checks", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("health-key", "health-user", {
        instanceName: "health-probe",
        migrateLegacyData: false,
      }).promise;
      const result = await analytics.healthCheck();
      expect(result).toMatchObject({
        ok: true,
        nativeAvailable: true,
        storageWritable: true,
        diskStorageWritable: true,
        workerReady: true,
        errors: [],
      });
      expect(mockHybridObjects.AmplitudeStorage?.set).toHaveBeenCalledWith(
        expect.stringContaining("health::"),
        "ok",
        true,
      );
      expect(mockHybridObjects.AmplitudeWorker?.queueSize).toHaveBeenCalled();
    } finally {
      analytics.shutdown();
    }
  });

  it("reports bounded worker metrics through diagnostics", () => {
    const diagnostics = getDiagnostics();
    expect(diagnostics.workerMetrics).toEqual({
      queueSize: 0,
      inFlightCount: 0,
      pendingBodyBytes: 0,
    });
    expect(mockHybridObjects.AmplitudeWorker?.inFlightCount).toHaveBeenCalled();
    expect(
      mockHybridObjects.AmplitudeWorker?.pendingBodyBytes,
    ).toHaveBeenCalled();
  });

  it("records network timing and health events in the bounded pipeline", async () => {
    clearDiagnosticFailures();
    const analytics = createInstance();
    try {
      const result = await analytics.healthCheck();
      expect(result.ok).toBe(true);
    } finally {
      analytics.shutdown();
    }
    const buffer = createNetworkTimingBuffer();
    await createTimedAnalyticsTransport(dryRunTransport, buffer.record).send(
      "https://example.com/events",
      { events: [{ event_type: "demo" }] },
    );
    const events = getDiagnosticEvents();
    expect(events.some((event) => event.type === "health")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "network_timing" && event.timing.kind === "analytics",
      ),
    ).toBe(true);
  });
});
