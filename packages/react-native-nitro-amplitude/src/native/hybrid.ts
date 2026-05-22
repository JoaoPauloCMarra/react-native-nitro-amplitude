import { NitroModules } from "react-native-nitro-modules";
import type { AmplitudeContext } from "../AmplitudeContext.nitro";
import type { AmplitudeStorage } from "../AmplitudeStorage.nitro";
import type { AmplitudeWorker } from "../AmplitudeWorker.nitro";

let contextInstance: AmplitudeContext | undefined;
let storageInstance: AmplitudeStorage | undefined;
let workerInstance: AmplitudeWorker | undefined;

export function getAmplitudeContext(): AmplitudeContext {
  contextInstance ??=
    NitroModules.createHybridObject<AmplitudeContext>("AmplitudeContext");
  return contextInstance;
}

export function getAmplitudeStorage(): AmplitudeStorage {
  storageInstance ??=
    NitroModules.createHybridObject<AmplitudeStorage>("AmplitudeStorage");
  return storageInstance;
}

export function getAmplitudeWorker(): AmplitudeWorker {
  workerInstance ??=
    NitroModules.createHybridObject<AmplitudeWorker>("AmplitudeWorker");
  return workerInstance;
}

export function resetHybridInstancesForTests(): void {
  contextInstance = undefined;
  storageInstance = undefined;
  workerInstance = undefined;
}
