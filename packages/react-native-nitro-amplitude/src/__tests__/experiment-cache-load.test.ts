jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
}));

import { ExperimentClient } from "../experiment/experimentClient";
import { SingleValueStoreCache } from "../experiment/storage/cache";
import type { Storage } from "../experiment/types/storage";

type DeferredStorage = Storage & {
  values: Map<string, string>;
  releaseReads: () => void;
};

function createDeferredStorage(
  initial: Record<string, string>,
): DeferredStorage {
  const values = new Map(Object.entries(initial));
  const waiting: (() => void)[] = [];
  let released = false;
  return {
    values,
    releaseReads: () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
    get: (key) =>
      new Promise((resolve) => {
        const snapshot = values.get(key) ?? null;
        if (released) resolve(snapshot);
        else waiting.push(() => resolve(snapshot));
      }),
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

function storedVariantsKey(storage: DeferredStorage): string {
  const key = [...storage.values.keys()].find(
    (candidate) =>
      candidate.startsWith("amp-exp-") &&
      !candidate.includes("-flags") &&
      !candidate.includes("-variants-options"),
  );
  if (key === undefined) throw new Error("variant namespace not found");
  return key;
}

function createClient(storage: Storage, body: string): ExperimentClient {
  return new ExperimentClient("cache-load-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    storage,
    httpClient: {
      request: async () => ({ status: 200, body }),
    },
  });
}

async function seedNamespace(): Promise<string> {
  const probe = createDeferredStorage({});
  probe.releaseReads();
  const client = createClient(probe, '{"seed":{"key":"on","value":"on"}}');
  await client.cacheReady();
  await client.fetchOrThrow({ user_id: "seed" });
  client.stop();
  return storedVariantsKey(probe);
}

async function flush(): Promise<void> {
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
}

describe("variant cache loading", () => {
  let namespace: string;

  beforeAll(async () => {
    namespace = await seedNamespace();
  });

  it("keeps a variant fetched before the stored variants finish loading", async () => {
    const storage = createDeferredStorage({
      [namespace]: JSON.stringify({ a: { key: "old", value: "old" } }),
    });
    const client = createClient(storage, '{"a":{"key":"new","value":"new"}}');
    try {
      const fetched = client.fetchOrThrow({ user_id: "user" });
      await flush();
      storage.releaseReads();
      await fetched;
      await client.cacheReady();
      await flush();

      expect(client.variant("a").value).toBe("new");
      expect(JSON.parse(storage.values.get(namespace) ?? "{}")).toEqual({
        a: expect.objectContaining({ value: "new" }),
      });
    } finally {
      client.stop();
    }
  });

  it("keeps stored keys that a partial fetch before load did not request", async () => {
    const storage = createDeferredStorage({
      [namespace]: JSON.stringify({
        a: { key: "old", value: "old" },
        b: { key: "kept", value: "kept" },
      }),
    });
    const client = createClient(storage, '{"a":{"key":"new","value":"new"}}');
    try {
      const fetched = client.fetchOrThrow(
        { user_id: "user" },
        { flagKeys: ["a"] },
      );
      await flush();
      storage.releaseReads();
      await fetched;
      await client.cacheReady();
      await flush();

      expect(client.variant("a").value).toBe("new");
      expect(client.variant("b").value).toBe("kept");
      expect(JSON.parse(storage.values.get(namespace) ?? "{}")).toEqual({
        a: expect.objectContaining({ value: "new" }),
        b: expect.objectContaining({ value: "kept" }),
      });
    } finally {
      client.stop();
    }
  });

  it("does not restore variants cleared before the stored variants finish loading", async () => {
    const storage = createDeferredStorage({
      [namespace]: JSON.stringify({ a: { key: "old", value: "old" } }),
    });
    const client = createClient(storage, "{}");
    try {
      client.clear();
      storage.releaseReads();
      await client.cacheReady();
      await flush();

      expect(client.hasCachedVariant("a")).toBe(false);
    } finally {
      client.stop();
    }
  });
});

describe("single value cache loading", () => {
  it("keeps a value put before the stored value finishes loading", async () => {
    const storage = createDeferredStorage({ options: '"stored"' });
    const cache = new SingleValueStoreCache<string>("options", storage);
    const loading = cache.load();
    cache.put("fresh");
    storage.releaseReads();
    await loading;

    expect(cache.get()).toBe("fresh");
  });
});

describe("exposure without an assigned variant", () => {
  it("logs that no exposure was tracked", async () => {
    const debug = jest.fn();
    const track = jest.fn();
    const storage = createDeferredStorage({});
    storage.releaseReads();
    const client = new ExperimentClient("exposure-log-deployment-key", {
      retryFetchOnFailure: false,
      fetchOnStart: false,
      pollOnStart: false,
      storage,
      logLevel: 4,
      loggerProvider: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug,
        verbose: jest.fn(),
      },
      exposureTrackingProvider: { track },
      httpClient: { request: async () => ({ status: 200, body: "{}" }) },
    });
    try {
      await client.cacheReady();
      client.exposure("missing-flag");

      expect(track).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining("missing-flag"),
      );
    } finally {
      client.stop();
    }
  });
});
