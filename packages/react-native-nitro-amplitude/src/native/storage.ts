import type {
  Event,
  UserSession,
  Storage as AnalyticsStorage,
} from "@amplitude/analytics-core";
import type { Storage as ExperimentStorage } from "../experiment/types/storage";
import { getAmplitudeStorage } from "./hybrid";

const PERSIST_FLUSH_DEBOUNCE_MILLIS = 200;
const PERSIST_FLUSH_RETRY_BASE_MILLIS = 200;
const PERSIST_FLUSH_RETRY_MAX_MILLIS = 5000;

type PendingDiskWrite = {
  value: string;
  generation: number;
};

const pendingDiskWrites = new Map<string, PendingDiskWrite>();
let nextDiskWriteGeneration = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushRetryAttempt = 0;
let flushInProgress = false;

type DiskFlushErrorHandler = (message: string) => void;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportDiskFlushFailure(
  error: unknown,
  onError?: DiskFlushErrorHandler,
): void {
  const message = `NitroAmplitude: durable storage flush failed: ${getErrorMessage(
    error,
  )}`;
  if (onError) {
    onError(message);
    return;
  }
  console.error(message);
}

function clearFlushTimer(): void {
  if (flushTimer === undefined) {
    return;
  }
  clearTimeout(flushTimer);
  flushTimer = undefined;
}

function scheduleFlushTimer(delayMillis: number): void {
  if (flushTimer !== undefined) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    try {
      flushPendingDiskWrites();
    } catch {
      return;
    }
  }, delayMillis);
}

function scheduleDiskWriteRetry(): void {
  const delayMillis = Math.min(
    PERSIST_FLUSH_RETRY_BASE_MILLIS * 2 ** flushRetryAttempt,
    PERSIST_FLUSH_RETRY_MAX_MILLIS,
  );
  flushRetryAttempt += 1;
  scheduleFlushTimer(delayMillis);
}

function scheduleDiskWrite(fullKey: string, value: string): void {
  pendingDiskWrites.set(fullKey, {
    value,
    generation: ++nextDiskWriteGeneration,
  });
  scheduleFlushTimer(PERSIST_FLUSH_DEBOUNCE_MILLIS);
}

function flushPendingDiskWritesInternal(): void {
  clearFlushTimer();
  if (pendingDiskWrites.size === 0) {
    flushRetryAttempt = 0;
    return;
  }
  if (flushInProgress) {
    return;
  }

  flushInProgress = true;
  try {
    while (pendingDiskWrites.size > 0) {
      const writes = Array.from(pendingDiskWrites.entries());
      const storage = getAmplitudeStorage();
      for (const [key, pending] of writes) {
        storage.set(key, pending.value, true);
        const current = pendingDiskWrites.get(key);
        if (current?.generation === pending.generation) {
          pendingDiskWrites.delete(key);
        }
      }
    }
    flushRetryAttempt = 0;
  } catch (error) {
    scheduleDiskWriteRetry();
    throw error;
  } finally {
    flushInProgress = false;
  }
}

export function flushPendingDiskWrites(onError?: DiskFlushErrorHandler): void {
  try {
    flushPendingDiskWritesInternal();
  } catch (error) {
    reportDiskFlushFailure(error, onError);
    throw error;
  }
}

function getPendingDiskWrite(fullKey: string): string | undefined {
  return pendingDiskWrites.get(fullKey)?.value;
}

function discardPendingDiskWrite(fullKey: string): void {
  pendingDiskWrites.delete(fullKey);
  if (pendingDiskWrites.size === 0) {
    clearFlushTimer();
    flushRetryAttempt = 0;
  }
}

function discardPendingDiskWritesByPrefix(prefix: string): void {
  for (const key of Array.from(pendingDiskWrites.keys())) {
    if (key.startsWith(prefix)) {
      pendingDiskWrites.delete(key);
    }
  }
  if (pendingDiskWrites.size === 0) {
    clearFlushTimer();
    flushRetryAttempt = 0;
  }
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
    const fullKey = namespaceKey(this.namespace, key);
    const pending = getPendingDiskWrite(fullKey);
    if (pending !== undefined) {
      return pending;
    }
    const storage = getAmplitudeStorage();
    return storage.get(fullKey, true);
  }

  async set(key: string, value: T): Promise<void> {
    scheduleDiskWrite(namespaceKey(this.namespace, key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    const fullKey = namespaceKey(this.namespace, key);
    discardPendingDiskWrite(fullKey);
    const storage = getAmplitudeStorage();
    storage.remove(fullKey, true);
  }

  async reset(): Promise<void> {
    const prefix = `${this.namespace}::`;
    discardPendingDiskWritesByPrefix(prefix);
    const storage = getAmplitudeStorage();
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
