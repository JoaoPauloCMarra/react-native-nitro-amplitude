import { BrowserStringStorage } from "../native/browser-string-storage";

type BrowserStorageControls = {
  values: Map<string, string>;
  storage: Storage;
  setFailEnumeration: (fail: boolean) => void;
  setFailSet: (fail: boolean) => void;
  setFailRemove: (fail: boolean) => void;
};

function createBrowserStorage(): BrowserStorageControls {
  const values = new Map<string, string>();
  let failEnumeration = false;
  let failSet = false;
  let failRemove = false;
  const storage = {
    get length() {
      if (failEnumeration) throw new Error("storage enumeration failed");
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      if (failRemove) throw new Error("storage remove failed");
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (failSet) throw new Error("storage set failed");
      values.set(key, value);
    },
  } satisfies Storage;

  return {
    values,
    storage,
    setFailEnumeration: (fail) => {
      failEnumeration = fail;
    },
    setFailSet: (fail) => {
      failSet = fail;
    },
    setFailRemove: (fail) => {
      failRemove = fail;
    },
  };
}

function installStorage(storage: Storage): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  };
}

describe("BrowserStringStorage reset isolation", () => {
  it("reads ordinary cross-tab changes when no incomplete reset is active", () => {
    const browser = createBrowserStorage();
    const restoreStorage = installStorage(browser.storage);
    const storage = new BrowserStringStorage("ordinary-cross-tab");

    try {
      browser.values.set("ordinary-cross-tab::key", "first tab value");
      expect(storage.get("key")).toBe("first tab value");

      browser.values.set("ordinary-cross-tab::key", "external update");
      expect(storage.get("key")).toBe("external update");
    } finally {
      restoreStorage();
    }
  });

  it("keeps stale and external values hidden until a failed reset is cleared", () => {
    const browser = createBrowserStorage();
    const restoreStorage = installStorage(browser.storage);
    const storage = new BrowserStringStorage("fail-closed-reset");
    const staleKey = "fail-closed-reset::stale";
    const peerKey = "fail-closed-peer::keep";
    browser.values.set(staleKey, "before reset");
    browser.values.set(peerKey, "peer value");
    browser.setFailEnumeration(true);

    try {
      storage.reset();
      expect(storage.get("stale")).toBeUndefined();

      browser.values.set(staleKey, "external write after reset");
      expect(storage.get("stale")).toBeUndefined();
      expect(browser.values.get(peerKey)).toBe("peer value");

      browser.setFailEnumeration(false);
      storage.reset();
      expect(browser.values.has(staleKey)).toBe(false);
      expect(browser.values.get(peerKey)).toBe("peer value");

      browser.values.set(staleKey, "external write after successful reset");
      expect(storage.get("stale")).toBe(
        "external write after successful reset",
      );
    } finally {
      restoreStorage();
    }
  });

  it("does not subscribe to queued storage events that could revive stale data", () => {
    const browser = createBrowserStorage();
    const restoreStorage = installStorage(browser.storage);
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const storageListeners = new Set<EventListenerOrEventListenerObject>();
    const fakeWindow = {
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "storage") storageListeners.add(listener);
      },
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "storage") storageListeners.delete(listener);
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    const storage = new BrowserStringStorage("queued-storage-event");
    const key = "queued-storage-event::stale";
    browser.values.set(key, "old value");
    browser.setFailEnumeration(true);
    const queuedBeforeReset = {
      type: "storage",
      key,
      oldValue: "older value",
      newValue: "queued pre-reset write",
      storageArea: browser.storage,
    } as StorageEvent;
    browser.values.set(key, queuedBeforeReset.newValue ?? "");

    try {
      storage.reset();
      for (const listener of storageListeners) {
        if (typeof listener === "function") listener(queuedBeforeReset);
        else listener.handleEvent(queuedBeforeReset);
      }

      expect(storageListeners.size).toBe(0);
      expect(storage.get("stale")).toBeUndefined();
    } finally {
      restoreStorage();
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("keeps failed local writes and removes authoritative after reset", () => {
    const browser = createBrowserStorage();
    const restoreStorage = installStorage(browser.storage);
    const writeStorage = new BrowserStringStorage("failed-local-write");
    const removeStorage = new BrowserStringStorage("failed-local-remove");
    browser.values.set("failed-local-write::key", "stale write value");
    browser.values.set("failed-local-remove::key", "stale remove value");
    browser.setFailEnumeration(true);

    try {
      writeStorage.reset();
      removeStorage.reset();

      browser.setFailSet(true);
      writeStorage.set("key", "authoritative local write");
      browser.values.set("failed-local-write::key", "external overwrite");
      expect(writeStorage.get("key")).toBe("authoritative local write");

      browser.setFailEnumeration(false);
      browser.setFailRemove(true);
      removeStorage.remove("key");
      browser.values.set("failed-local-remove::key", "external overwrite");
      expect(removeStorage.get("key")).toBeUndefined();
    } finally {
      restoreStorage();
    }
  });

  it("does not throw when the localStorage getter is denied", () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("storage getter denied");
      },
    });
    const storage = new BrowserStringStorage("denied-storage-getter");

    try {
      expect(storage.get("missing")).toBeUndefined();
      expect(() => storage.set("key", "memory fallback")).not.toThrow();
      expect(storage.get("key")).toBe("memory fallback");
      expect(() => storage.remove("key")).not.toThrow();
      expect(storage.get("key")).toBeUndefined();
      expect(() => storage.reset()).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });
});
