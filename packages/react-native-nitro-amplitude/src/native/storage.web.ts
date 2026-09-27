import type {
  Event,
  UserSession,
  Storage as AnalyticsStorage,
} from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "../experiment/types/storage";
import { BrowserStringStorage } from "./browser-string-storage";

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
  private readonly storage: BrowserStringStorage;

  constructor(namespace: string) {
    this.storage = new BrowserStringStorage(namespace);
  }

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
    return this.storage.get(key);
  }

  async set(key: string, value: T): Promise<void> {
    this.storage.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.storage.remove(key);
  }

  async reset(): Promise<void> {
    this.storage.reset();
  }
}

export class NitroExperimentStorage implements ExperimentStorage {
  private readonly storage: BrowserStringStorage;

  constructor(namespace: string) {
    this.storage = new BrowserStringStorage(namespace);
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.remove(key);
  }

  async reset(): Promise<void> {
    this.storage.reset();
  }
}

export class NitroMemoryStorage implements ExperimentStorage {
  private static readonly values = new Map<string, string>();

  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    return (
      NitroMemoryStorage.values.get(namespaceKey(this.namespace, key)) ?? null
    );
  }

  async put(key: string, value: string): Promise<void> {
    NitroMemoryStorage.values.set(namespaceKey(this.namespace, key), value);
  }

  async delete(key: string): Promise<void> {
    NitroMemoryStorage.values.delete(namespaceKey(this.namespace, key));
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    for (const key of NitroMemoryStorage.values.keys()) {
      if (key.startsWith(prefix)) {
        NitroMemoryStorage.values.delete(key);
      }
    }
  }
}
