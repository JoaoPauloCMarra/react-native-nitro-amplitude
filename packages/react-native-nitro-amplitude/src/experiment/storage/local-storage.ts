import { Storage } from "../types/storage";

export class MemoryStorage implements Storage {
  private readonly memoryStorage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.memoryStorage.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.memoryStorage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.memoryStorage.delete(key);
  }

  async reset(): Promise<void> {
    this.memoryStorage.clear();
  }
}

/**
 * @deprecated Keeps variants in memory only, so they do not survive an app
 * restart. Use `NitroExperimentStorage` or `createDurableAmplitudeStoragePreset`
 * for durable variants.
 */
export class LocalStorage extends MemoryStorage {}
