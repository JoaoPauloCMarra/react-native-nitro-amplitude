import { Storage, getGlobalScope } from "@amplitude/analytics-core";

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

export class LocalStorage<T> extends MemoryStorage<T> {}

export { MemoryStorage as InMemoryStorage };
