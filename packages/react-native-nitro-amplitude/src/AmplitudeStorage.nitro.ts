import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeStorage extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  set(key: string, value: string, persist: boolean): void;
  get(key: string, persist: boolean): string | undefined;
  remove(key: string, persist: boolean): void;
  clear(persist: boolean): void;
  has(key: string, persist: boolean): boolean;
  getAllKeys(persist: boolean): string[];
  getKeysByPrefix(prefix: string, persist: boolean): string[];
  setBatch(keys: string[], values: string[], persist: boolean): void;
  getBatch(keys: string[], persist: boolean): string[];
  removeBatch(keys: string[], persist: boolean): void;
}
