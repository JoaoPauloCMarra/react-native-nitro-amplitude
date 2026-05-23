import type { AmplitudeContext } from "../AmplitudeContext.nitro";
import type { AmplitudeStorage } from "../AmplitudeStorage.nitro";
import type { AmplitudeWorker } from "../AmplitudeWorker.nitro";

function unavailable(): never {
  throw new Error("Nitro Amplitude native bindings are not available on web");
}

export function getAmplitudeContext(): AmplitudeContext {
  return unavailable();
}

export function getAmplitudeStorage(): AmplitudeStorage {
  return unavailable();
}

export function getAmplitudeWorker(): AmplitudeWorker {
  return unavailable();
}

export function resetHybridInstancesForTests(): void {}
