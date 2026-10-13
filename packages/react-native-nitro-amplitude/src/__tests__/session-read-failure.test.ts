jest.mock("react-native", () => ({
  Platform: { OS: "web" },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
}));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
  prefetchNativeContext: () => undefined,
}));

import { MemoryStorage, getCookieName } from "@amplitude/analytics-core";
import type { UserSession } from "@amplitude/analytics-core";
import { AmplitudeReactNative } from "../analytics/react-native-client";
import {
  clearDiagnosticFailures,
  getDiagnosticFailures,
} from "../diagnostic-failures";
import {
  clearDryRunTransportRecords,
  dryRunTransport,
  getDryRunAnalyticsEvents,
} from "../network";

const API_KEY = "session-key";
const COOKIE = getCookieName(API_KEY);

class FlakyReadStorage extends MemoryStorage<UserSession> {
  failingReads = 0;
  failOtherKeys = false;

  override async getRaw(): Promise<string | undefined> {
    return undefined;
  }

  override async get(key: string): Promise<UserSession | undefined> {
    if (key !== COOKIE && this.failOtherKeys) {
      throw new Error(
        "[nitro-error:storage_full] NitroStorage: Disk SQLite exec failed",
      );
    }
    if (key === COOKIE && this.failingReads > 0) {
      this.failingReads -= 1;
      throw new Error(
        "[nitro-error:storage_full] NitroStorage: Disk SQLite exec failed",
      );
    }
    return super.get(key);
  }
}

function createLogger() {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    disable: jest.fn(),
    enable: jest.fn(),
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

async function initClient(
  store: FlakyReadStorage,
  options: Record<string, unknown> = {},
) {
  const client = new AmplitudeReactNative();
  const loggerProvider = createLogger();
  await client.init(API_KEY, undefined, {
    cookieStorage: store,
    disableCookies: true,
    transportProvider: dryRunTransport,
    storageProvider: new MemoryStorage() as never,
    loggerProvider,
    ...options,
  }).promise;
  return { client, loggerProvider };
}

describe("session storage read failures", () => {
  beforeEach(() => {
    clearDryRunTransportRecords();
    clearDiagnosticFailures();
  });

  it("keeps a stored opt-out across a normal init", async () => {
    const store = new FlakyReadStorage();
    await store.set(COOKIE, { deviceId: "stored-device", optOut: true });
    const { client } = await initClient(store);

    expect(client.config.optOut).toBe(true);
    expect((await store.get(COOKIE))?.optOut).toBe(true);
    client.shutdown();
  });

  it("fails closed, logs, records a diagnostic and keeps the stored session", async () => {
    const store = new FlakyReadStorage();
    await store.set(COOKIE, {
      deviceId: "stored-device",
      userId: "stored-user",
      optOut: true,
    });
    store.failingReads = 1;
    const { client, loggerProvider } = await initClient(store);

    expect(client.config.optOut).toBe(true);
    expect(loggerProvider.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read stored user session"),
    );
    expect(
      getDiagnosticFailures().some(
        (failure) => failure.operation === "session_storage_read",
      ),
    ).toBe(true);

    client.setUserId("new-user");
    await client.track("blocked_event").promise;
    await client.flush().promise;
    await settle();

    const stored = await store.get(COOKIE);
    expect(stored?.optOut).toBe(true);
    expect(stored?.deviceId).toBe("stored-device");
    expect(stored?.userId).toBe("new-user");
    expect(client.config.deviceId).toBe("stored-device");
    expect(
      getDryRunAnalyticsEvents().some((record) =>
        record.payload.events.some(
          (event) => event.event_type === "blocked_event",
        ),
      ),
    ).toBe(false);
    client.shutdown();
  });

  it("does not persist a session while reads keep failing", async () => {
    const store = new FlakyReadStorage();
    await store.set(COOKIE, { deviceId: "stored-device", optOut: true });
    store.failingReads = 100;
    const { client } = await initClient(store);
    client.setUserId("new-user");
    await settle();

    store.failingReads = 0;
    expect(await store.get(COOKIE)).toEqual({
      deviceId: "stored-device",
      optOut: true,
    });
    client.shutdown();
  });

  it("honours an explicit opt-out choice when the read failed", async () => {
    const store = new FlakyReadStorage();
    store.failingReads = 1;
    const { client } = await initClient(store, { optOut: false });

    expect(client.config.optOut).toBe(false);
    client.shutdown();
  });

  it("keeps init working and events flowing when the campaign read fails", async () => {
    const store = new FlakyReadStorage();
    store.failOtherKeys = true;
    const { client, loggerProvider } = await initClient(store, {
      optOut: false,
    });

    expect(loggerProvider.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read attribution storage"),
    );
    expect(
      getDiagnosticFailures().some(
        (failure) => failure.operation === "session_storage_read",
      ),
    ).toBe(true);

    await client.track("flowing_event").promise;
    await client.flush().promise;
    expect(
      getDryRunAnalyticsEvents().some((record) =>
        record.payload.events.some(
          (event) => event.event_type === "flowing_event",
        ),
      ),
    ).toBe(true);
    client.shutdown();
  });

  it("still suppresses events for a stored opt-out when the campaign read fails", async () => {
    const store = new FlakyReadStorage();
    await store.set(COOKIE, { deviceId: "stored-device", optOut: true });
    store.failOtherKeys = true;
    const { client } = await initClient(store);

    await client.track("blocked_event").promise;
    await client.flush().promise;
    expect(
      getDryRunAnalyticsEvents().some((record) =>
        record.payload.events.some(
          (event) => event.event_type === "blocked_event",
        ),
      ),
    ).toBe(false);
    client.shutdown();
  });
});
