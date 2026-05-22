import type { Storage as AnalyticsStorage } from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "../experiment/types/storage";

function namespaceKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

class WebStringStorage {
  private static readonly memory = new Map<string, string>();

  constructor(private readonly namespace: string) {}

  get(key: string): string | undefined {
    const storageKey = namespaceKey(this.namespace, key);
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(storageKey) ?? undefined;
      }
    } catch {}
    return WebStringStorage.memory.get(storageKey);
  }

  set(key: string, value: string): void {
    const storageKey = namespaceKey(this.namespace, key);
    WebStringStorage.memory.set(storageKey, value);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, value);
      }
    } catch {}
  }

  remove(key: string): void {
    const storageKey = namespaceKey(this.namespace, key);
    WebStringStorage.memory.delete(storageKey);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(storageKey);
      }
    } catch {}
  }

  reset(): void {
    const prefix = `${this.namespace}::`;
    for (const key of WebStringStorage.memory.keys()) {
      if (key.startsWith(prefix)) {
        WebStringStorage.memory.delete(key);
      }
    }
    try {
      if (typeof localStorage !== "undefined") {
        for (let index = localStorage.length - 1; index >= 0; index--) {
          const key = localStorage.key(index);
          if (key?.startsWith(prefix)) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch {}
  }
}

export class NitroAnalyticsStorage<T> implements AnalyticsStorage<T> {
  private readonly storage: WebStringStorage;

  constructor(namespace: string) {
    this.storage = new WebStringStorage(namespace);
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
  private readonly storage: WebStringStorage;

  constructor(namespace: string) {
    this.storage = new WebStringStorage(namespace);
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
  private readonly values = new Map<string, string>();

  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    return this.values.get(namespaceKey(this.namespace, key)) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(namespaceKey(this.namespace, key), value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(namespaceKey(this.namespace, key));
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) {
        this.values.delete(key);
      }
    }
  }
}
