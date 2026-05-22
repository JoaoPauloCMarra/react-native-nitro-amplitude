import { Storage } from "../types/storage";

export class MemoryStorage implements Storage {
  private static readonly memoryStorage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return MemoryStorage.memoryStorage.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    MemoryStorage.memoryStorage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    MemoryStorage.memoryStorage.delete(key);
  }

  async reset(): Promise<void> {
    MemoryStorage.memoryStorage.clear();
  }
}

export class LocalStorage extends MemoryStorage {}
