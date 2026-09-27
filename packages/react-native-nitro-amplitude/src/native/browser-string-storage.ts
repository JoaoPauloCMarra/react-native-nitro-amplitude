type BrowserStorageOverride =
  { kind: "set"; value: string } | { kind: "delete" };

const overrides = new Map<string, BrowserStorageOverride>();
const lastKnownValues = new Map<string, string>();
const keyRevisions = new Map<string, number>();
const resetRevisions = new Map<string, number>();
let revision = 0;

function getBrowserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function resetRevisionForKey(key: string): number | undefined {
  let latest: number | undefined;
  for (const [prefix, value] of resetRevisions) {
    if (key.startsWith(prefix) && (latest === undefined || value > latest)) {
      latest = value;
    }
  }
  return latest;
}

function isHiddenByReset(key: string): boolean {
  const resetRevision = resetRevisionForKey(key);
  return (
    resetRevision !== undefined && (keyRevisions.get(key) ?? 0) <= resetRevision
  );
}

export class BrowserStringStorage {
  constructor(private readonly namespace: string) {}

  get(key: string): string | undefined {
    const storageKey = this.storageKey(key);
    if (isHiddenByReset(storageKey)) {
      return undefined;
    }

    const override = overrides.get(storageKey);
    if (override?.kind === "set") {
      return override.value;
    }
    if (override?.kind === "delete") {
      return undefined;
    }

    const storage = getBrowserStorage();
    if (storage === undefined) {
      return lastKnownValues.get(storageKey);
    }
    try {
      return storage.getItem(storageKey) ?? undefined;
    } catch {
      return lastKnownValues.get(storageKey);
    }
  }

  set(key: string, value: string): void {
    const storageKey = this.storageKey(key);
    this.recordKeyRevision(storageKey);
    lastKnownValues.set(storageKey, value);
    const storage = getBrowserStorage();
    if (storage === undefined) {
      overrides.set(storageKey, { kind: "set", value });
      return;
    }
    try {
      storage.setItem(storageKey, value);
      overrides.delete(storageKey);
    } catch {
      overrides.set(storageKey, { kind: "set", value });
    }
  }

  remove(key: string): void {
    const storageKey = this.storageKey(key);
    this.recordKeyRevision(storageKey);
    lastKnownValues.delete(storageKey);
    const storage = getBrowserStorage();
    if (storage === undefined) {
      overrides.set(storageKey, { kind: "delete" });
      return;
    }
    try {
      storage.removeItem(storageKey);
      overrides.delete(storageKey);
    } catch {
      overrides.set(storageKey, { kind: "delete" });
    }
  }

  reset(): void {
    const prefix = `${this.namespace}::`;
    const resetRevision = ++revision;
    resetRevisions.set(prefix, resetRevision);
    const keys = new Set<string>();
    for (const key of lastKnownValues.keys()) {
      if (key.startsWith(prefix)) {
        keys.add(key);
        lastKnownValues.delete(key);
      }
    }
    for (const key of keyRevisions.keys()) {
      if (key.startsWith(prefix)) {
        keys.add(key);
      }
    }
    for (const key of overrides.keys()) {
      if (key.startsWith(prefix)) {
        keys.add(key);
        overrides.set(key, { kind: "delete" });
      }
    }

    const storage = getBrowserStorage();
    if (storage === undefined) {
      return;
    }

    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
          keys.add(key);
        }
      }
    } catch {
      return;
    }

    let removedAllKeys = true;
    for (const key of keys) {
      try {
        storage.removeItem(key);
        overrides.delete(key);
        lastKnownValues.delete(key);
        keyRevisions.delete(key);
      } catch {
        overrides.set(key, { kind: "delete" });
        removedAllKeys = false;
      }
    }

    if (removedAllKeys) {
      for (const resetPrefix of resetRevisions.keys()) {
        if (resetPrefix.startsWith(prefix)) {
          resetRevisions.delete(resetPrefix);
        }
      }
    }
  }

  private storageKey(key: string): string {
    return `${this.namespace}::${key}`;
  }

  private recordKeyRevision(key: string): void {
    if (resetRevisionForKey(key) === undefined) {
      keyRevisions.delete(key);
      return;
    }
    keyRevisions.set(key, ++revision);
  }
}
