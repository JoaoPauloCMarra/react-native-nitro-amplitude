jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
}));

import { ExperimentClient } from "../experiment/experimentClient";

test("equivalent user maps preserve retries across partial fetches", async () => {
  jest.useFakeTimers();
  let rejectFirst: ((error: Error) => void) | undefined;
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce({
      status: 200,
      body: '{"b":{"key":"on","value":"on"}}',
    })
    .mockResolvedValue({
      status: 200,
      body: '{"a":{"key":"on","value":"on"}}',
    });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const first = client.fetchOrThrow(
      { user_id: "user-a", user_properties: { country: "US", email: "x" } },
      { flagKeys: ["a"] },
    );
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(rejectFirst).toBeDefined();
    await client.fetchOrThrow(
      { user_properties: { email: "x", country: "US" }, user_id: "user-a" },
      { flagKeys: ["b"] },
    );
    rejectFirst?.(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    jest.advanceTimersByTime(60_000);
    for (let step = 0; step < 40; step += 1) await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(3);
    expect(client.variant("a").value).toBe("on");
    expect(client.variant("b").value).toBe("on");
  } finally {
    client.stop();
    jest.useRealTimers();
  }
});

test("successful partial fetch removes only omitted requested numeric flags", async () => {
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        "2": { key: "on", value: "on" },
        "42": { key: "on", value: "on" },
      }),
    })
    .mockResolvedValueOnce({ status: 200, body: "{}" });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const user = { user_id: "numeric-flags-user" };
    await client.fetchOrThrow(user);
    expect(client.hasCachedVariant("2")).toBe(true);
    expect(client.hasCachedVariant("42")).toBe(true);

    await client.fetchOrThrow(user, { flagKeys: ["42"] });

    expect(client.hasCachedVariant("2")).toBe(true);
    expect(client.hasCachedVariant("42")).toBe(false);
  } finally {
    client.stop();
  }
});

test.each(["clear", "user change"])(
  "a failed request cannot restart old-user retries after %s",
  async (action) => {
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
      if (action === "clear") client.clear();
      else client.setUser({ user_id: "user-b" });
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
  },
);

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

test.each(["clear", "user change"])(
  "%s fences an outstanding response",
  async (action) => {
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
      if (action === "clear") client.clear();
      else client.setUser({ user_id: "user-b" });
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
  },
);

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
    const first = client.fetchOrThrow(
      { user_id: "user-a" },
      { flagKeys: ["first"] },
    );
    const second = client.fetchOrThrow(
      { user_id: "user-a" },
      { flagKeys: ["flag"] },
    );
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[0]?.({ status: 200, body: '{"first":{"key":"on","value":"on"}}' });
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

test("stop cancels retries from every concurrent failed fetch", async () => {
  jest.useFakeTimers();
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockRejectedValueOnce(new Error("offline-a"))
    .mockRejectedValueOnce(new Error("offline-b"))
    .mockResolvedValue({
      status: 200,
      body: '{"a":{"key":"on","value":"old-user-variant"}}',
    });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const user = { user_id: "user-a" };
    const first = client.fetchOrThrow(user, { flagKeys: ["a"] });
    const second = client.fetchOrThrow(user, { flagKeys: ["b"] });
    await expect(first).rejects.toThrow("offline-a");
    await expect(second).rejects.toThrow("offline-b");
    expect(request).toHaveBeenCalledTimes(2);

    client.setUser({ user_id: "user-b" });
    client.stop();
    jest.advanceTimersByTime(120_000);
    for (let step = 0; step < 40; step += 1) await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(client.variant("a").value).toBeUndefined();
  } finally {
    client.stop();
    jest.useRealTimers();
  }
});

test("stopping a client that never started keeps its in-flight fetch result", async () => {
  const pending: ((response: { status: number; body: string }) => void)[] = [];
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: {
      request: () => new Promise((resolve) => pending.push(resolve)),
    },
  });
  try {
    await client.cacheReady();
    const request = client.fetchOrThrow({ user_id: "user-a" });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(1);
    client.stop();
    pending[0]?.({ status: 200, body: '{"flag":{"key":"on","value":"on"}}' });
    await request;
    expect(client.variant("flag").value).toBe("on");
  } finally {
    client.stop();
  }
});

test("exhausted retry backoffs leave the retry set", async () => {
  jest.useFakeTimers();
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockRejectedValue(new Error("offline"));
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    await expect(
      client.fetchOrThrow({ user_id: "user-a" }, { flagKeys: ["a"] }),
    ).rejects.toThrow("offline");
    const retrySet = (client as unknown as { retryBackoffs: Set<unknown> })
      .retryBackoffs;
    expect(retrySet.size).toBe(1);
    for (let round = 0; round < 20; round += 1) {
      jest.advanceTimersByTime(60_000);
      for (let step = 0; step < 20; step += 1) await Promise.resolve();
    }
    expect(retrySet.size).toBe(0);
  } finally {
    client.stop();
    jest.useRealTimers();
  }
});

test("stopping during startup prevents later fetch retries and polling", async () => {
  jest.useFakeTimers();
  let resolveStartupFlags:
    ((response: { status: number; body: string }) => void) | undefined;
  let rejectStartupFetch: ((error: Error) => void) | undefined;
  const startupFlags = new Promise<{ status: number; body: string }>(
    (resolve) => {
      resolveStartupFlags = resolve;
    },
  );
  const startupFetch = new Promise<{ status: number; body: string }>(
    (_resolve, reject) => {
      rejectStartupFetch = reject;
    },
  );
  let flagsCalls = 0;
  let fetchCalls = 0;
  const request = jest.fn((url: string) => {
    if (url.startsWith("https://flags.test")) {
      flagsCalls += 1;
      return flagsCalls === 1
        ? startupFlags
        : Promise.resolve({ status: 200, body: "[]" });
    }
    fetchCalls += 1;
    return fetchCalls === 1
      ? startupFetch
      : Promise.resolve({ status: 200, body: "{}" });
  });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: true,
    pollOnStart: true,
    serverUrl: "https://api.test",
    flagsServerUrl: "https://flags.test",
    httpClient: { request },
  });
  let startup: Promise<void> | undefined;
  try {
    await client.cacheReady();
    startup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(flagsCalls).toBe(1);
    expect(fetchCalls).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);

    client.stop();
    resolveStartupFlags?.({ status: 200, body: "[]" });
    rejectStartupFetch?.(new Error("startup fetch failed"));
    await startup;
    await jest.advanceTimersByTimeAsync(60_001);

    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    client.stop();
    resolveStartupFlags?.({ status: 200, body: "[]" });
    rejectStartupFetch?.(new Error("startup fetch cleanup"));
    await startup?.catch(() => {});
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("an older startup failure does not stop a restarted client", async () => {
  jest.useFakeTimers();
  let rejectOldStartup: ((error: Error) => void) | undefined;
  let flagsCalls = 0;
  const request = jest.fn((url: string) => {
    if (!url.includes("/flags")) {
      return Promise.resolve({ status: 200, body: "{}" });
    }
    flagsCalls += 1;
    if (flagsCalls === 1) {
      return new Promise<{ status: number; body: string }>(
        (_resolve, reject) => {
          rejectOldStartup = reject;
        },
      );
    }
    return Promise.resolve({ status: 200, body: "[]" });
  });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: true,
    httpClient: { request },
  });
  let oldStartup: Promise<void> | undefined;
  try {
    await client.cacheReady();
    oldStartup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(flagsCalls).toBe(1);

    client.stop();
    await client.start();
    const flagsCallsAfterRestart = flagsCalls;
    expect(flagsCallsAfterRestart).toBeGreaterThan(0);
    rejectOldStartup?.(new Error("old startup failed"));
    await expect(oldStartup).rejects.toThrow("old startup failed");

    await jest.advanceTimersByTimeAsync(60_001);
    expect(flagsCalls).toBeGreaterThan(flagsCallsAfterRestart);

    client.stop();
    const flagsCallsAfterStop = flagsCalls;
    await jest.advanceTimersByTimeAsync(60_001);
    expect(flagsCalls).toBe(flagsCallsAfterStop);
  } finally {
    client.stop();
    rejectOldStartup?.(new Error("old startup cleanup"));
    await oldStartup?.catch(() => {});
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("an older successful startup does not restart polling for a new run", async () => {
  jest.useFakeTimers();
  let resolveOldStartup:
    ((response: { status: number; body: string }) => void) | undefined;
  let resolveNewStartup:
    ((response: { status: number; body: string }) => void) | undefined;
  let flagsCalls = 0;
  const request = jest.fn((url: string) => {
    if (!url.includes("/flags")) {
      return Promise.resolve({ status: 200, body: "{}" });
    }
    flagsCalls += 1;
    if (flagsCalls === 1) {
      return new Promise<{ status: number; body: string }>((resolve) => {
        resolveOldStartup = resolve;
      });
    }
    if (flagsCalls === 2) {
      return new Promise<{ status: number; body: string }>((resolve) => {
        resolveNewStartup = resolve;
      });
    }
    return Promise.resolve({ status: 200, body: "[]" });
  });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: true,
    httpClient: { request },
  });
  let oldStartup: Promise<void> | undefined;
  let newStartup: Promise<void> | undefined;
  try {
    await client.cacheReady();
    oldStartup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(flagsCalls).toBe(1);

    client.stop();
    newStartup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(flagsCalls).toBe(2);
    resolveOldStartup?.({ status: 200, body: "[]" });
    await oldStartup;
    await jest.advanceTimersByTimeAsync(60_001);
    expect(flagsCalls).toBe(2);

    resolveNewStartup?.({ status: 200, body: "[]" });
    await newStartup;
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(flagsCalls).toBeGreaterThan(2);

    client.stop();
    const flagsCallsAfterStop = flagsCalls;
    await jest.advanceTimersByTimeAsync(60_001);
    expect(flagsCalls).toBe(flagsCallsAfterStop);
  } finally {
    client.stop();
    resolveOldStartup?.({ status: 200, body: "[]" });
    resolveNewStartup?.({ status: 200, body: "[]" });
    await oldStartup?.catch(() => {});
    await newStartup?.catch(() => {});
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("stopped startup flags cannot replace the flags from a restarted client", async () => {
  const pending: ((response: { status: number; body: string }) => void)[] = [];
  const response = (value: string) => ({
    status: 200,
    body: JSON.stringify([
      {
        key: "local-flag",
        metadata: { evaluationMode: "local" },
        variants: { selected: { key: "selected", value } },
        segments: [{ variant: "selected" }],
      },
    ]),
  });
  const client = new ExperimentClient("test-deployment-key", {
    fetchOnStart: false,
    pollOnStart: false,
    automaticExposureTracking: false,
    httpClient: {
      request: () => new Promise((resolve) => pending.push(resolve)),
    },
  });
  let oldStartup: Promise<void> | undefined;
  let newStartup: Promise<void> | undefined;
  try {
    await client.cacheReady();
    oldStartup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    client.stop();
    newStartup = client.start();
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[1]?.(response("new"));
    await newStartup;
    expect(client.variant("local-flag").value).toBe("new");
    pending[0]?.(response("old"));
    await oldStartup;
    expect(client.variant("local-flag").value).toBe("new");
  } finally {
    client.stop();
    for (const resolve of pending) resolve(response("cleanup"));
    await Promise.all([oldStartup, newStartup]);
  }
});

test("an older same-user success retains useful data without clearing a newer failure", async () => {
  let resolveOlder:
    ((response: { status: number; body: string }) => void) | undefined;
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockResolvedValueOnce({
      status: 200,
      body: '{"feature":{"key":"cached","value":"cached"}}',
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("newer request failed"));
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    const user = { user_id: "same-user" };
    await client.cacheReady();
    await client.fetchOrThrow(user);
    const lastFetchTime = client.getLastFetchTime();
    const older = client.fetchOrThrow(user, { flagKeys: ["feature", "other"] });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    await expect(
      client.fetchOrThrow(user, { flagKeys: ["feature"] }),
    ).rejects.toThrow("newer request failed");
    resolveOlder?.({
      status: 200,
      body: '{"feature":{"key":"late","value":"late"},"other":{"key":"on","value":"on"}}',
    });
    await older;
    expect(client.variant("other").value).toBe("on");
    expect(client.variantWithMetadata("feature")).toMatchObject({
      freshness: "stale",
      stale: true,
      variant: { value: "late" },
    });
    expect(client.getLastFetchTime()).toBe(lastFetchTime);
  } finally {
    client.stop();
  }
});

test("an old user response cannot mark the current assignments fresh", async () => {
  let resolveOldResponse:
    ((response: { status: number; body: string }) => void) | undefined;
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockResolvedValueOnce({
      status: 200,
      body: '{"feature":{"key":"cached","value":"cached"}}',
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldResponse = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("new user request failed"));
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: false,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const oldUser = { user_id: "user-a" };
    const newUser = { user_id: "user-b" };
    await client.fetchOrThrow(oldUser);
    const oldRequest = client.fetchOrThrow(oldUser);
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(resolveOldResponse).toBeDefined();

    client.setUser(newUser);
    await expect(client.fetchWithMetadata(newUser)).resolves.toMatchObject({
      fetched: false,
      failureReason: "new user request failed",
    });
    expect(client.variantWithMetadata("feature")).toMatchObject({
      freshness: "stale",
      stale: true,
      variant: { value: "cached" },
    });

    resolveOldResponse?.({
      status: 200,
      body: '{"feature":{"key":"late","value":"late"}}',
    });
    await oldRequest;

    expect(client.variantWithMetadata("feature")).toMatchObject({
      freshness: "stale",
      stale: true,
      variant: { value: "cached" },
    });
  } finally {
    client.stop();
  }
});

test("successful partial background retries refresh only requested assignments", async () => {
  jest.useFakeTimers();
  const request = jest
    .fn<Promise<{ status: number; body: string }>, []>()
    .mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        first: { key: "initial-first", value: "initial-first" },
        second: { key: "initial-second", value: "initial-second" },
      }),
    })
    .mockRejectedValueOnce(new Error("temporary outage"))
    .mockResolvedValueOnce({
      status: 200,
      body: '{"first":{"key":"retried-first","value":"retried-first"}}',
    });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: { request },
  });
  try {
    await client.cacheReady();
    const user = { user_id: "user-a" };
    await client.fetchOrThrow(user);
    const firstFetchTime = client.getLastFetchTime();
    await jest.advanceTimersByTimeAsync(1);

    await expect(
      client.fetchWithMetadata(user, { flagKeys: ["first"] }),
    ).resolves.toMatchObject({
      fetched: false,
      failureReason: "temporary outage",
    });
    expect(client.variantWithMetadata("first").freshness).toBe("stale");

    await jest.advanceTimersByTimeAsync(1_000);

    expect(request).toHaveBeenCalledTimes(3);
    expect(client.variant("first").value).toBe("retried-first");
    expect(client.variant("second").value).toBe("initial-second");
    expect(client.variantWithMetadata("first").freshness).toBe("fresh");
    expect(client.getLastFetchTime()).toBeGreaterThan(firstFetchTime ?? 0);
  } finally {
    client.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("restarting the same user starts and retries a new startup fetch", async () => {
  jest.useFakeTimers();
  let rejectOldFetch: ((error: Error) => void) | undefined;
  const oldFetch = new Promise<{ status: number; body: string }>(
    (_resolve, reject) => {
      rejectOldFetch = reject;
    },
  );
  let evaluationCalls = 0;
  const request = jest.fn((url: string) => {
    if (url.startsWith("https://flags.test")) {
      return Promise.resolve({ status: 200, body: "[]" });
    }
    evaluationCalls += 1;
    if (evaluationCalls === 1) return oldFetch;
    if (evaluationCalls === 2) {
      return Promise.reject(new Error("restarted fetch failed"));
    }
    return Promise.resolve({
      status: 200,
      body: '{"feature":{"key":"retried","value":"retried"}}',
    });
  });
  const client = new ExperimentClient("test-deployment-key", {
    retryFetchOnFailure: true,
    automaticExposureTracking: false,
    fetchOnStart: true,
    pollOnStart: false,
    serverUrl: "https://api.test",
    flagsServerUrl: "https://flags.test",
    httpClient: { request },
  });
  let oldStartup: Promise<void> | undefined;
  let newStartup: Promise<void> | undefined;
  try {
    await client.cacheReady();
    const user = { user_id: "user-a" };
    oldStartup = client.start(user);
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(evaluationCalls).toBe(1);

    client.stop();
    newStartup = client.start(user);
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(evaluationCalls).toBe(2);

    rejectOldFetch?.(new Error("stopped startup fetch failed"));
    await Promise.all([oldStartup, newStartup]);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(evaluationCalls).toBe(3);
    expect(client.variantWithMetadata("feature")).toMatchObject({
      freshness: "fresh",
      variant: { value: "retried" },
    });
  } finally {
    client.stop();
    rejectOldFetch?.(new Error("stopped startup cleanup"));
    await oldStartup?.catch(() => {});
    await newStartup?.catch(() => {});
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
