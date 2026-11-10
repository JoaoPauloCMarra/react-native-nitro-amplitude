import { EvaluationFlag, GetVariantsOptions } from "@amplitude/experiment-core";

import { Storage } from "../types/storage";
import { Variant } from "../types/variant";

export const getVariantStorage = (
  deploymentKey: string,
  instanceName: string,
  storage: Storage,
): LoadStoreCache<Variant> => {
  const namespace = getNamespace(deploymentKey, instanceName);
  const legacyNamespace = getLegacyNamespace(deploymentKey, instanceName);
  return new LoadStoreCache<Variant>(
    namespace,
    storage,
    transformVariantFromStorage,
    [legacyNamespace],
  );
};

export const getFlagStorage = (
  deploymentKey: string,
  instanceName: string,
  storage: Storage,
): LoadStoreCache<EvaluationFlag> => {
  const namespace = `${getNamespace(deploymentKey, instanceName)}-flags`;
  const legacyNamespace = `${getLegacyNamespace(
    deploymentKey,
    instanceName,
  )}-flags`;
  return new LoadStoreCache<EvaluationFlag>(namespace, storage, undefined, [
    legacyNamespace,
  ]);
};

export const getVariantsOptionsStorage = (
  deploymentKey: string,
  instanceName: string,
  storage: Storage,
): SingleValueStoreCache<GetVariantsOptions> => {
  const namespace = `${getNamespace(
    deploymentKey,
    instanceName,
  )}-variants-options`;
  const legacyNamespace = `${getLegacyNamespace(
    deploymentKey,
    instanceName,
  )}-variants-options`;
  return new SingleValueStoreCache<GetVariantsOptions>(namespace, storage, [
    legacyNamespace,
  ]);
};

const getNamespace = (deploymentKey: string, instanceName: string): string => {
  return `amp-exp-${instanceName}-${hashString(deploymentKey)}`;
};

const getLegacyNamespace = (
  deploymentKey: string,
  instanceName: string,
): string => {
  const truncatedDeployment = deploymentKey.substring(deploymentKey.length - 6);
  return `amp-exp-${instanceName}-${truncatedDeployment}`;
};

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export class SingleValueStoreCache<V> {
  private readonly namespace: string;
  private readonly legacyNamespaces: string[];
  private readonly storage: Storage;
  private value: V | undefined;
  private loadState: SingleValueLoadState = "idle";

  constructor(
    namespace: string,
    storage: Storage,
    legacyNamespaces: string[] = [],
  ) {
    this.namespace = namespace;
    this.legacyNamespaces = legacyNamespaces;
    this.storage = storage;
    this.value = this.get();
  }

  public get(): V | undefined {
    return this.value;
  }

  public put(value: V): void {
    this.value = value;
    if (this.loadState === "loading") this.loadState = "written";
  }

  public async load(): Promise<void> {
    this.loadState = "loading";
    const value = await this.readStoredValue().catch((error: unknown) => {
      this.loadState = "idle";
      throw error;
    });
    const written = this.finishLoad();
    if (value && !written) {
      try {
        this.value = JSON.parse(value);
      } catch {
        this.value = undefined;
      }
    }
  }

  private async readStoredValue(): Promise<string | null> {
    let value = await this.storage.get(this.namespace);
    for (const legacyNamespace of this.legacyNamespaces) {
      if (value) {
        break;
      }
      value = await this.storage.get(legacyNamespace);
    }
    return value;
  }

  private finishLoad(): boolean {
    const written = this.loadState === "written";
    this.loadState = "idle";
    return written;
  }

  public async store(): Promise<void> {
    if (this.value === undefined) {
      // Delete the key if the value is undefined
      await this.storage.delete(this.namespace);
    } else {
      // Also store false or null values
      await this.storage.put(this.namespace, JSON.stringify(this.value));
    }
  }
}

export class LoadStoreCache<V> {
  private readonly namespace: string;
  private readonly legacyNamespaces: string[];
  private readonly storage: Storage;
  private readonly transformer?: (value: unknown) => V | undefined;
  private cache: Record<string, V> = {};
  private pendingStore: Promise<void> = Promise.resolve();
  private loadState: CacheLoadState = { status: "idle" };

  constructor(
    namespace: string,
    storage: Storage,
    transformer?: (value: unknown) => V | undefined,
    legacyNamespaces: string[] = [],
  ) {
    this.namespace = namespace;
    this.legacyNamespaces = legacyNamespaces;
    this.storage = storage;
    this.transformer = transformer;
  }

  public get(key: string): V | undefined {
    return this.cache[key];
  }

  public getAll(): Record<string, V> {
    return { ...this.cache };
  }

  public put(key: string, value: V): void {
    this.cache[key] = value;
    this.noteWrite(key);
  }

  public putAll(values: Record<string, V>): void {
    for (const key of Object.keys(values)) {
      const value = values[key];
      if (value === undefined) continue;
      this.put(key, value);
    }
  }

  public remove(key: string): void {
    delete this.cache[key];
    this.noteWrite(key);
  }

  public clear(): void {
    this.cache = {};
    if (this.loadState.status === "loading") {
      this.loadState = { ...this.loadState, cleared: true };
    }
  }

  public async load(initialValues?: Record<string, V>): Promise<void> {
    const loading = this.readStoredValues().then((stored) => {
      this.applyLoadedValues({ ...initialValues, ...stored });
    });
    this.loadState = {
      status: "loading",
      promise: loading,
      writtenKeys: new Set(),
      cleared: false,
    };
    try {
      await loading;
    } finally {
      if (
        this.loadState.status === "loading" &&
        this.loadState.promise === loading
      ) {
        this.loadState = { status: "idle" };
      }
    }
  }

  public async store(values?: Record<string, V>): Promise<void> {
    const write = async () => {
      if (this.loadState.status === "loading") {
        await this.loadState.promise.catch(() => undefined);
      }
      await this.storage.put(
        this.namespace,
        JSON.stringify(values ?? this.cache),
      );
    };
    this.pendingStore = this.pendingStore.then(write, write);
    await this.pendingStore;
  }

  private noteWrite(key: string): void {
    if (this.loadState.status === "loading") {
      this.loadState.writtenKeys.add(key);
    }
  }

  private applyLoadedValues(loaded: Record<string, V>): void {
    if (this.loadState.status !== "loading" || this.loadState.cleared) {
      return;
    }
    const next: Record<string, V> = {};
    for (const key of Object.keys(loaded)) {
      const value = loaded[key];
      if (value !== undefined && !this.loadState.writtenKeys.has(key)) {
        next[key] = value;
      }
    }
    for (const key of this.loadState.writtenKeys) {
      const value = this.cache[key];
      if (value !== undefined) next[key] = value;
    }
    this.cache = next;
  }

  private async readStoredValues(): Promise<Record<string, V>> {
    let rawValues = await this.storage.get(this.namespace);
    for (const legacyNamespace of this.legacyNamespaces) {
      if (rawValues) {
        break;
      }
      rawValues = await this.storage.get(legacyNamespace);
    }
    if (!rawValues) {
      return {};
    }
    let jsonValues: Record<string, unknown>;
    try {
      jsonValues = (JSON.parse(rawValues) as Record<string, unknown>) || {};
    } catch {
      return {};
    }
    const values: Record<string, V> = {};
    for (const key of Object.keys(jsonValues)) {
      try {
        const value = this.transformer
          ? this.transformer(jsonValues[key])
          : (jsonValues[key] as V);
        if (value !== undefined) {
          values[key] = value;
        }
      } catch {
        // Do nothing
      }
    }
    return values;
  }
}

type SingleValueLoadState = "idle" | "loading" | "written";

type CacheLoadState =
  | { status: "idle" }
  | {
      status: "loading";
      promise: Promise<void>;
      writtenKeys: Set<string>;
      cleared: boolean;
    };

export const transformVariantFromStorage = (
  storageValue: unknown,
): Variant | undefined => {
  if (typeof storageValue === "string") {
    // From v0 string format
    return {
      key: storageValue,
      value: storageValue,
    };
  } else if (typeof storageValue === "object" && storageValue !== null) {
    // From v1 or v2 object format
    const variantRecord = storageValue as Record<string, unknown>;
    const key = variantRecord.key;
    const value = variantRecord.value;
    const payload = variantRecord.payload;
    const rawMetadata = variantRecord.metadata;
    let metadata =
      rawMetadata && typeof rawMetadata === "object"
        ? ({ ...rawMetadata } as Record<string, unknown>)
        : undefined;
    let experimentKey =
      typeof variantRecord.expKey === "string"
        ? variantRecord.expKey
        : undefined;
    const metadataExperimentKey =
      metadata && typeof metadata.experimentKey === "string"
        ? metadata.experimentKey
        : undefined;

    if (metadataExperimentKey) {
      experimentKey = metadataExperimentKey;
    } else if (experimentKey) {
      metadata = metadata || {};
      metadata.experimentKey = experimentKey;
    }
    const variant: Variant = {};
    if (typeof key === "string") {
      variant.key = key;
    } else if (typeof value === "string") {
      variant.key = value;
    }
    if (typeof value === "string") variant.value = value;
    if (metadata) variant.metadata = metadata;
    if (payload) variant.payload = payload;
    if (experimentKey) variant.expKey = experimentKey;
    return variant;
  }
  return undefined;
};
