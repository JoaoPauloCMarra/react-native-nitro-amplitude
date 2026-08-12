import type {
  Event,
  UserSession,
  Storage as AnalyticsStorage,
} from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "../experiment/types/storage";
import { getAmplitudeStorage } from "./hybrid";

export const BATCH_MISSING_SENTINEL = "__nitro_amplitude_batch_missing__::v1";

export function getBatchValues(
  keys: string[],
  persist: boolean,
): (string | undefined)[] {
  const storage = getAmplitudeStorage();
  return storage
    .getBatch(keys, persist)
    .map((value, index) =>
      value === BATCH_MISSING_SENTINEL &&
      !storage.has(keys[index] ?? "", persist)
        ? undefined
        : value,
    );
}

function namespaceKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

export type NamespacedStores = {
  analyticsEvents: NitroAnalyticsStorage<Event[]>;
  analyticsSession: NitroAnalyticsStorage<UserSession>;
  experimentVariants: NitroExperimentStorage;
};

export function createNamespacedStores(namespace: string): NamespacedStores {
  return {
    analyticsEvents: new NitroAnalyticsStorage<Event[]>(
      `${namespace}:analytics-events`,
    ),
    analyticsSession: new NitroAnalyticsStorage<UserSession>(
      `${namespace}:analytics-session`,
    ),
    experimentVariants: new NitroExperimentStorage(
      `${namespace}:experiment-variants`,
    ),
  };
}

export class NitroAnalyticsStorage<T> implements AnalyticsStorage<T> {
  constructor(private readonly namespace: string) {}

  async isEnabled(): Promise<boolean> {
    return true;
  }

  async get(key: string): Promise<T | undefined> {
    const raw = await this.getRaw(key);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async getRaw(key: string): Promise<string | undefined> {
    const storage = getAmplitudeStorage();
    return storage.get(namespaceKey(this.namespace, key), true);
  }

  async set(key: string, value: T): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.set(namespaceKey(this.namespace, key), JSON.stringify(value), true);
  }

  async remove(key: string): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.remove(namespaceKey(this.namespace, key), true);
  }

  async reset(): Promise<void> {
    const storage = getAmplitudeStorage();
    const prefix = `${this.namespace}::`;
    const keys = storage.getKeysByPrefix(prefix, true);
    if (keys.length > 0) {
      storage.removeBatch(keys, true);
    }
  }
}

export class NitroExperimentStorage implements ExperimentStorage {
  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    const storage = getAmplitudeStorage();
    const value = storage.get(namespaceKey(this.namespace, key), true);
    return value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.set(namespaceKey(this.namespace, key), value, true);
  }

  async delete(key: string): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.remove(namespaceKey(this.namespace, key), true);
  }

  async reset(): Promise<void> {
    const storage = getAmplitudeStorage();
    const prefix = `${this.namespace}::`;
    const keys = storage.getKeysByPrefix(prefix, true);
    if (keys.length > 0) {
      storage.removeBatch(keys, true);
    }
  }
}

export class NitroMemoryStorage implements ExperimentStorage {
  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    const storage = getAmplitudeStorage();
    const value = storage.get(namespaceKey(this.namespace, key), false);
    return value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.set(namespaceKey(this.namespace, key), value, false);
  }

  async delete(key: string): Promise<void> {
    const storage = getAmplitudeStorage();
    storage.remove(namespaceKey(this.namespace, key), false);
  }

  async reset(): Promise<void> {
    const storage = getAmplitudeStorage();
    const prefix = `${this.namespace}::`;
    const keys = storage.getKeysByPrefix(prefix, false);
    if (keys.length > 0) {
      storage.removeBatch(keys, false);
    }
  }
}
