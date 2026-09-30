import { Storage, getGlobalScope } from "@amplitude/analytics-core";
import { BrowserStringStorage } from "../../native/browser-string-storage";
import { isNative } from "../utils/platform";

export class MemoryStorage<T> implements Storage<T> {
  private readonly memoryStorage = new Map<string, unknown>();

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
    const value = this.memoryStorage.get(key);
    if (typeof value !== "string") {
      return undefined;
    }
    return value;
  }

  async set(key: string, value: T): Promise<void> {
    try {
      this.memoryStorage.set(key, JSON.stringify(value));
    } catch {
      //
    }
  }

  async remove(key: string): Promise<void> {
    try {
      this.memoryStorage.delete(key);
    } catch {
      //
    }
  }

  async reset(): Promise<void> {
    try {
      this.memoryStorage.clear();
    } catch {
      //
    }
  }
}

class BrowserLocalStorage<T> implements Storage<T> {
  private readonly storage = new BrowserStringStorage("nitro-amplitude::local");

  private getRawValue(key: string): string | undefined {
    return this.storage.get(key);
  }

  private setRawValue(key: string, value: string): void {
    this.storage.set(key, value);
  }

  private removeRawValue(key: string): void {
    this.storage.remove(key);
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
    this.storage.reset();
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
