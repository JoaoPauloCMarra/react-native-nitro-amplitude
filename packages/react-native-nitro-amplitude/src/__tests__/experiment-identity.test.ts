jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
}));

import { ExperimentClient } from "../experiment/experimentClient";

test("a failed request cannot restart old-user retries after clear", async () => {
  jest.useFakeTimers();
  let rejectRequest: ((error: Error) => void) | undefined;
  const request = jest.fn(
    () =>
      new Promise<{ status: number; body: string }>((_resolve, reject) => {
        rejectRequest = reject;
      }),
  );
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const fetch = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(rejectRequest).toBeDefined();
    client.clear();
    rejectRequest?.(new Error("offline"));
    await expect(fetch).rejects.toThrow("offline");
    jest.advanceTimersByTime(60_000);
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.hasCachedVariant("flag")).toBe(false);
  } finally {
    client.stop();
    jest.useRealTimers();
  }
});

test("a failed storage write does not block the next assignment", async () => {
  let writes = 0;
  let stored = "{}";
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    storage: {
      get: async () => null,
      delete: async () => {},
      put: async (_key, value) => {
        if (++writes === 1) throw new Error("storage unavailable");
        stored = value;
      },
    },
    httpClient: {
      request: async () => ({
        status: 200,
        body: '{"flag":{"key":"on","value":"on"}}',
      }),
    },
  });
  try {
    await client.cacheReady();
    await expect(client.fetchOrThrow({ user_id: "user-a" })).rejects.toThrow(
      "storage unavailable",
    );
    await client.fetchOrThrow({ user_id: "user-b" });
    expect(JSON.parse(stored)).toEqual({ flag: { key: "on", value: "on" } });
    expect(client.variant("flag").value).toBe("on");
  } finally {
    client.stop();
  }
});

test("clear remains durable when an older storage write completes later", async () => {
  let finishWrite: (() => void) | undefined;
  let stored = "{}";
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    storage: {
      get: async () => null,
      delete: async () => {},
      put: async (_key, value) => {
        if (value.includes('"on"')) {
          await new Promise<void>((resolve) => {
            finishWrite = resolve;
          });
        }
        stored = value;
      },
    },
    httpClient: {
      request: async () => ({
        status: 200,
        body: '{"flag":{"key":"on","value":"on"}}',
      }),
    },
  });
  try {
    await client.cacheReady();
    const request = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(finishWrite).toBeDefined();
    client.clear();
    finishWrite?.();
    await request;
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(JSON.parse(stored)).toEqual({});
    expect(client.hasCachedVariant("flag")).toBe(false);
  } finally {
    client.stop();
  }
});

test("explicit current-user properties win over stale analytics context", async () => {
  let sentUser: unknown;
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    userProvider: {
      getUser: async () => ({
        user_id: "old-user",
        user_properties: { email: "old@example.com", country: "US" },
      }),
    },
    httpClient: {
      request: async (_url, _method, headers) => {
        sentUser = JSON.parse(
          Buffer.from(headers["X-Amp-Exp-User"] ?? "", "base64url").toString(),
        );
        return { status: 200, body: "{}" };
      },
    },
  });
  try {
    await client.cacheReady();
    await client.fetchOrThrow({
      user_id: "current-user",
      user_properties: { email: "current@example.com" },
    });
    expect(sentUser).toEqual(
      expect.objectContaining({ user_id: "current-user" }),
    );
    expect(sentUser).toEqual(
      expect.objectContaining({
        user_properties: { email: "current@example.com", country: "US" },
      }),
    );
  } finally {
    client.stop();
  }
});

test("clearing assignments fences an outstanding response", async () => {
  let finish:
    ((response: { status: number; body: string }) => void) | undefined;
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: {
      request: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  try {
    await client.cacheReady();
    const request = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(finish).toBeDefined();
    client.clear();
    finish?.({
      status: 200,
      body: JSON.stringify({
        "enable-balance-assessment": { key: "on", value: "on" },
      }),
    });
    await request;
    expect(client.variant("enable-balance-assessment", "off").value).toBe(
      "off",
    );
  } finally {
    client.stop();
  }
});

test("a cleared request cannot replace or deduplicate the next identity request", async () => {
  const pending: ((response: { status: number; body: string }) => void)[] = [];
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: {
      request: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    },
  });
  try {
    await client.cacheReady();
    const oldRequest = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    client.clear();
    const newRequest = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[0]?.({ status: 200, body: '{"flag":{"key":"on","value":"on"}}' });
    await oldRequest;
    expect(client.variant("flag", "off").value).toBe("off");
    const deduplicated = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[1]?.({ status: 200, body: '{"flag":{"key":"off","value":"off"}}' });
    await Promise.all([newRequest, deduplicated]);
    expect(client.variant("flag").value).toBe("off");
  } finally {
    client.stop();
  }
});

test("clearing during storage prevents earlier responses from restoring assignments", async () => {
  const pending: ((response: { status: number; body: string }) => void)[] = [];
  let finishStorage: (() => void) | undefined;
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    storage: {
      get: async () => null,
      delete: async () => {},
      put: async (_key, value) => {
        if (value.includes('"on"')) {
          await new Promise<void>((resolve) => {
            finishStorage = resolve;
          });
        }
      },
    },
    httpClient: {
      request: () => new Promise((resolve) => pending.push(resolve)),
    },
  });
  try {
    await client.cacheReady();
    const first = client.fetchOrThrow({ user_id: "user-a" });
    const second = client.fetchOrThrow({ user_id: "user-b" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[0]?.({ status: 200, body: '{"flag":{"key":"on","value":"on"}}' });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(finishStorage).toBeDefined();
    client.clear();
    finishStorage?.();
    await first;
    pending[1]?.({ status: 200, body: '{"flag":{"key":"off","value":"off"}}' });
    await second;
    expect(client.hasCachedVariant("flag")).toBe(false);
  } finally {
    client.stop();
  }
});
