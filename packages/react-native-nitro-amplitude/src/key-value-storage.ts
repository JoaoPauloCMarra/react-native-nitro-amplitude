import type {
  Event,
  Storage as AnalyticsStorage,
  UserSession,
} from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "./experiment/types/storage";
import { recordDiagnosticFailure } from "./diagnostic-failures";
import type { AmplitudeDiagnosticSurface } from "./diagnostic-failures";

type MaybePromise<T> = T | Promise<T>;

export type AmplitudeKeyValueStore = {
  getItem: (key: string) => MaybePromise<string | null | undefined>;
  setItem: (key: string, value: string) => MaybePromise<void>;
  removeItem: (key: string) => MaybePromise<void>;
  removeItemsByPrefix: (prefix: string) => MaybePromise<void>;
};

export type AmplitudeKeyValueStoreName =
  "analytics-events" | "analytics-session" | "experiment-variants";

export type AmplitudeKeyValueStorageFailure = {
  store: AmplitudeKeyValueStoreName;
  operation: "get" | "set" | "remove" | "reset" | "parse";
  error: unknown;
};

export type AmplitudeKeyValueStorageOptions = {
  store: AmplitudeKeyValueStore;
  namespace?: string;
  experimentStore?: AmplitudeKeyValueStore;
  onError?: (failure: AmplitudeKeyValueStorageFailure) => void;
};

export type AmplitudeKeyValueStorage = {
  analytics: {
    storageProvider: AnalyticsStorage<Event[]>;
    cookieStorage: AnalyticsStorage<UserSession>;
  };
  experiment: { storage: ExperimentStorage };
  clear: () => Promise<void>;
};

const SURFACES: Record<AmplitudeKeyValueStoreName, AmplitudeDiagnosticSurface> =
  {
    "analytics-events": "event_storage",
    "analytics-session": "session_storage",
    "experiment-variants": "experiment_storage",
  };

type Report = (
  operation: AmplitudeKeyValueStorageFailure["operation"],
  error: unknown,
) => void;

function createReporter(
  store: AmplitudeKeyValueStoreName,
  onError: AmplitudeKeyValueStorageOptions["onError"],
): Report {
  return (operation, error) => {
    if (operation !== "get" && operation !== "parse") {
      recordDiagnosticFailure({
        operation: "storage_write",
        surface: SURFACES[store],
        kind: "storage_error",
      });
    }
    if (onError) {
      onError({ store, operation, error });
      return;
    }
    console.error(
      `NitroAmplitude: ${store} ${operation} failed: ${String(error)}`,
    );
  };
}

async function write(
  operation: "set" | "remove" | "reset",
  report: Report,
  apply: () => MaybePromise<void>,
): Promise<void> {
  try {
    await apply();
  } catch (error) {
    report(operation, error);
  }
}

async function read(
  report: Report,
  apply: () => MaybePromise<string | null | undefined>,
): Promise<string | undefined> {
  try {
    return (await apply()) ?? undefined;
  } catch (error) {
    report("get", error);
    throw error;
  }
}

class KeyValueAnalyticsStorage<T> implements AnalyticsStorage<T> {
  constructor(
    private readonly store: AmplitudeKeyValueStore,
    private readonly prefix: string,
    private readonly report: Report,
  ) {}

  async isEnabled(): Promise<boolean> {
    return true;
  }

  async get(key: string): Promise<T | undefined> {
    const raw = await this.getRaw(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.report("parse", error);
      await this.remove(key);
      return undefined;
    }
  }

  getRaw(key: string): Promise<string | undefined> {
    return read(this.report, () => this.store.getItem(this.prefix + key));
  }

  set(key: string, value: T): Promise<void> {
    return write("set", this.report, () =>
      this.store.setItem(this.prefix + key, JSON.stringify(value)),
    );
  }

  remove(key: string): Promise<void> {
    return write("remove", this.report, () =>
      this.store.removeItem(this.prefix + key),
    );
  }

  reset(): Promise<void> {
    return write("reset", this.report, () =>
      this.store.removeItemsByPrefix(this.prefix),
    );
  }
}

class KeyValueExperimentStorage implements ExperimentStorage {
  constructor(
    private readonly store: AmplitudeKeyValueStore,
    private readonly prefix: string,
    private readonly report: Report,
  ) {}

  async get(key: string): Promise<string | null> {
    return (
      (await read(this.report, () => this.store.getItem(this.prefix + key))) ??
      null
    );
  }

  put(key: string, value: string): Promise<void> {
    return write("set", this.report, () =>
      this.store.setItem(this.prefix + key, value),
    );
  }

  delete(key: string): Promise<void> {
    return write("remove", this.report, () =>
      this.store.removeItem(this.prefix + key),
    );
  }

  reset(): Promise<void> {
    return write("reset", this.report, () =>
      this.store.removeItemsByPrefix(this.prefix),
    );
  }
}

function storePrefix(
  namespace: string,
  store: AmplitudeKeyValueStoreName,
): string {
  return `${namespace}:${store}::`;
}

export function createKeyValueAmplitudeStorage(
  options: AmplitudeKeyValueStorageOptions,
): AmplitudeKeyValueStorage {
  const namespace = options.namespace ?? "default";
  const storageProvider = new KeyValueAnalyticsStorage<Event[]>(
    options.store,
    storePrefix(namespace, "analytics-events"),
    createReporter("analytics-events", options.onError),
  );
  const cookieStorage = new KeyValueAnalyticsStorage<UserSession>(
    options.store,
    storePrefix(namespace, "analytics-session"),
    createReporter("analytics-session", options.onError),
  );
  const experimentStorage = new KeyValueExperimentStorage(
    options.experimentStore ?? options.store,
    storePrefix(namespace, "experiment-variants"),
    createReporter("experiment-variants", options.onError),
  );
  return {
    analytics: { storageProvider, cookieStorage },
    experiment: { storage: experimentStorage },
    clear: async () => {
      await storageProvider.reset();
      await cookieStorage.reset();
      await experimentStorage.reset();
    },
  };
}
