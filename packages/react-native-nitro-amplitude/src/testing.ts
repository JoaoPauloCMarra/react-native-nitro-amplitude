import type { AmplitudeReturn, Result } from "@amplitude/analytics-core";
import type { AmplitudeReactNativeClient } from "./analytics/react-native-client";
import type { Client } from "./experiment/types/client";
import type { Storage } from "./experiment/types/storage";
import type { ExperimentUser } from "./experiment/types/user";
import type { Variant, Variants } from "./experiment/types/variant";

type MockFunction<Args extends unknown[], Return> = ((
  ...args: Args
) => Return) & {
  calls: Args[];
};

function createMockFunction<Args extends unknown[], Return>(
  implementation: (...args: Args) => Return,
): MockFunction<Args, Return> {
  const fn = ((...args: Args) => {
    fn.calls.push(args);
    return implementation(...args);
  }) as MockFunction<Args, Return>;
  fn.calls = [];
  return fn;
}

function createReturn(eventType: string): AmplitudeReturn<Result> {
  const result: Result = {
    event: { event_type: eventType },
    code: 200,
    message: "dry_run",
  };
  return {
    promise: Promise.resolve(result),
  };
}

export type FakeExperimentStorage = Storage & {
  values: Map<string, string>;
};

export function createFakeExperimentStorage(
  initialValues: Record<string, string> = {},
): FakeExperimentStorage {
  const values = new Map(Object.entries(initialValues));
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    reset: async () => {
      values.clear();
    },
  };
}

export function createMockAmplitudeClient(): AmplitudeReactNativeClient {
  let userId: string | undefined;
  let deviceId = "mock-device-id";
  let sessionId: number | undefined;
  const client = {
    init: createMockFunction((_: string, nextUserId?: string) => {
      userId = nextUserId;
      return createReturn("$init");
    }),
    track: createMockFunction(() => createReturn("$track")),
    logEvent: createMockFunction(() => createReturn("$track")),
    identify: createMockFunction(() => createReturn("$identify")),
    groupIdentify: createMockFunction(() => createReturn("$groupidentify")),
    setGroup: createMockFunction(() => createReturn("$groupidentify")),
    revenue: createMockFunction(() => createReturn("revenue_amount")),
    flush: createMockFunction(() => createReturn("$flush")),
    flushWithResult: createMockFunction(async () => ({
      ok: true,
      sent: 0,
      failed: 0,
      dropped: 0,
      retried: 0,
      finishedAt: Date.now(),
    })),
    add: createMockFunction(() => createReturn("$add")),
    remove: createMockFunction(() => createReturn("$remove")),
    setUserId: createMockFunction((nextUserId: string | undefined) => {
      userId = nextUserId;
    }),
    getUserId: createMockFunction(() => userId),
    setDeviceId: createMockFunction((nextDeviceId: string) => {
      deviceId = nextDeviceId;
    }),
    getDeviceId: createMockFunction(() => deviceId),
    setSessionId: createMockFunction((nextSessionId: number) => {
      sessionId = nextSessionId;
    }),
    getSessionId: createMockFunction(() => sessionId),
    extendSession: createMockFunction(() => undefined),
    setOptOut: createMockFunction(() => undefined),
    reset: createMockFunction(() => {
      userId = undefined;
      deviceId = "mock-device-id-reset";
    }),
    shutdown: createMockFunction(() => undefined),
    getDiagnostics: createMockFunction(() => ({
      initialized: true,
      userId,
      deviceId,
      sessionId,
      queueSize: 0,
      activeInstanceNames: ["$default_instance"],
    })),
    healthCheck: createMockFunction(async () => ({
      ok: true,
      analyticsInitialized: true,
      nativeAvailable: true,
      storageWritable: true,
      errors: [],
    })),
  };
  return client as unknown as AmplitudeReactNativeClient;
}

export function createMockExperimentClient(
  initialVariants: Variants = {},
): Client {
  let user: ExperimentUser = {};
  const variants = new Map<string, Variant>(Object.entries(initialVariants));
  let client: Client;
  client = {
    start: createMockFunction(async (nextUser?: ExperimentUser) => {
      user = nextUser ?? user;
    }),
    stop: createMockFunction(() => undefined),
    fetch: createMockFunction(async () => client),
    fetchWithMetadata: createMockFunction(async () => ({
      fetched: true,
      flagKeys: Array.from(variants.keys()),
      cacheHit: false,
      durationMillis: 0,
      source: "network" as const,
    })),
    fetchOrThrow: createMockFunction(async () => client),
    variant: createMockFunction((key: string, fallback?: string | Variant) => {
      return variants.get(key) ?? normalizeFallback(fallback);
    }),
    variantWithMetadata: createMockFunction(
      (key: string, fallback?: string | Variant) => ({
        variant: variants.get(key) ?? normalizeFallback(fallback),
        fallback: !variants.has(key),
        stale: false,
        freshness: variants.has(key) ? "fresh" : "unknown",
        reason: variants.has(key) ? undefined : "fallback",
      }),
    ),
    all: createMockFunction(() => Object.fromEntries(variants)),
    clear: createMockFunction(() => variants.clear()),
    clearVariants: createMockFunction(() => variants.clear()),
    hasCachedVariant: createMockFunction((key: string) => variants.has(key)),
    getLastFetchTime: createMockFunction(() => undefined),
    exposure: createMockFunction(() => undefined),
    getUser: createMockFunction(() => ({ ...user })),
    setUser: createMockFunction((nextUser: ExperimentUser) => {
      user = { ...nextUser };
    }),
    getUserProvider: createMockFunction(() => ({
      getUser: async () => ({ ...user }),
    })),
    setUserProvider: createMockFunction(() => client),
  };
  return client;

  function normalizeFallback(fallback?: string | Variant): Variant {
    if (typeof fallback === "string") {
      return { value: fallback };
    }
    return fallback ?? {};
  }
}
