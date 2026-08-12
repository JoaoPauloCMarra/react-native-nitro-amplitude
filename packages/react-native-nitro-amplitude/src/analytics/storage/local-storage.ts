import { Storage, getGlobalScope } from "@amplitude/analytics-core";
import { isNative } from "../utils/platform";

export class MemoryStorage<T> implements Storage<T> {
  private static readonly memoryStorage = new Map<string, unknown>();

  async isEnabled(): Promise<boolean> {
    /* istanbul ignore if */
    if (!getGlobalScope()) {
      return false;
    }

    const random = String(Date.now());
    const testStorage = new MemoryStorage<string>();
    const testKey = "AMP_TEST";
    try {
      await testStorage.set(testKey, random);
      const value = await testStorage.get(testKey);
      return value === random;
    } catch {
      /* istanbul ignore next */
      return false;
    } finally {
      await testStorage.remove(testKey);
    }
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const value = await this.getRaw(key);
      if (!value) {
        return undefined;
      }

      return JSON.parse(value);
    } catch {
      /* istanbul ignore next */
      return undefined;
    }
  }

  async getRaw(key: string): Promise<string | undefined> {
    const value = MemoryStorage.memoryStorage.get(key);
    if (typeof value !== "string") {
      return undefined;
    }
    return value;
  }

  async set(key: string, value: T): Promise<void> {
    try {
      MemoryStorage.memoryStorage.set(key, JSON.stringify(value));
    } catch {
      //
    }
  }

  async remove(key: string): Promise<void> {
    try {
      MemoryStorage.memoryStorage.delete(key);
    } catch {
      //
    }
  }

  async reset(): Promise<void> {
    try {
      MemoryStorage.memoryStorage.clear();
    } catch {
      //
    }
  }
}

class BrowserLocalStorage<T> implements Storage<T> {
  private static readonly memory = new Map<string, string>();
  private static readonly keyPrefix = "nitro-amplitude::local::";

  private static namespaceKey(key: string): string {
    return `${BrowserLocalStorage.keyPrefix}${key}`;
  }

  private getRawValue(key: string): string | undefined {
    const storageKey = BrowserLocalStorage.namespaceKey(key);
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(storageKey) ?? undefined;
      }
    } catch {
      //
    }
    return BrowserLocalStorage.memory.get(storageKey);
  }

  private setRawValue(key: string, value: string): void {
    const storageKey = BrowserLocalStorage.namespaceKey(key);
    BrowserLocalStorage.memory.set(storageKey, value);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, value);
      }
    } catch {
      //
    }
  }

  private removeRawValue(key: string): void {
    const storageKey = BrowserLocalStorage.namespaceKey(key);
    BrowserLocalStorage.memory.delete(storageKey);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(storageKey);
      }
    } catch {
      //
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<T | undefined> {
    const raw = this.getRawValue(key);
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
    return this.getRawValue(key);
  }

  async set(key: string, value: T): Promise<void> {
    this.setRawValue(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.removeRawValue(key);
  }

  async reset(): Promise<void> {
    const prefix = BrowserLocalStorage.keyPrefix;
    for (const key of BrowserLocalStorage.memory.keys()) {
      if (key.startsWith(prefix)) {
        BrowserLocalStorage.memory.delete(key);
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
    } catch {
      //
    }
  }
}

export class LocalStorage<T> implements Storage<T> {
  private readonly storage: Storage<T>;

  constructor() {
    if (isNative()) {
      const { NitroAnalyticsStorage } =
        require("../../native/storage") as typeof import("../../native/storage");
      this.storage = new NitroAnalyticsStorage<T>("local");
      return;
    }
    this.storage = new BrowserLocalStorage<T>();
  }

  async isEnabled(): Promise<boolean> {
    return this.storage.isEnabled();
  }

  async get(key: string): Promise<T | undefined> {
    return this.storage.get(key);
  }

  async getRaw(key: string): Promise<string | undefined> {
    return this.storage.getRaw(key);
  }

  async set(key: string, value: T): Promise<void> {
    return this.storage.set(key, value);
  }

  async remove(key: string): Promise<void> {
    return this.storage.remove(key);
  }

  async reset(): Promise<void> {
    return this.storage.reset();
  }
}

export { MemoryStorage as InMemoryStorage };
