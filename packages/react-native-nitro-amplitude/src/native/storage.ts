import type { Storage as AnalyticsStorage } from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "../experiment/types/storage";
import { getAmplitudeStorage } from "./hybrid";

function namespaceKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
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
    return getAmplitudeStorage().get(namespaceKey(this.namespace, key), true);
  }

  async set(key: string, value: T): Promise<void> {
    getAmplitudeStorage().set(
      namespaceKey(this.namespace, key),
      JSON.stringify(value),
      true,
    );
  }

  async remove(key: string): Promise<void> {
    getAmplitudeStorage().remove(namespaceKey(this.namespace, key), true);
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    const keys = getAmplitudeStorage().getKeysByPrefix(prefix, true);
    if (keys.length > 0) {
      getAmplitudeStorage().removeBatch(keys, true);
    }
  }
}

export class NitroExperimentStorage implements ExperimentStorage {
  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    const value = getAmplitudeStorage().get(
      namespaceKey(this.namespace, key),
      true,
    );
    return value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    getAmplitudeStorage().set(namespaceKey(this.namespace, key), value, true);
  }

  async delete(key: string): Promise<void> {
    getAmplitudeStorage().remove(namespaceKey(this.namespace, key), true);
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    const keys = getAmplitudeStorage().getKeysByPrefix(prefix, true);
    if (keys.length > 0) {
      getAmplitudeStorage().removeBatch(keys, true);
    }
  }
}

export class NitroMemoryStorage implements ExperimentStorage {
  constructor(private readonly namespace: string) {}

  async get(key: string): Promise<string | null> {
    const value = getAmplitudeStorage().get(
      namespaceKey(this.namespace, key),
      false,
    );
    return value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    getAmplitudeStorage().set(namespaceKey(this.namespace, key), value, false);
  }

  async delete(key: string): Promise<void> {
    getAmplitudeStorage().remove(namespaceKey(this.namespace, key), false);
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    const keys = getAmplitudeStorage().getKeysByPrefix(prefix, false);
    if (keys.length > 0) {
      getAmplitudeStorage().removeBatch(keys, false);
    }
  }
}
