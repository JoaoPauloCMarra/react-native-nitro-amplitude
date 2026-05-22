const unsupported = (name: string): never => {
  throw new Error(
    `react-native-nitro-amplitude: ${name} is not supported on web. Use native iOS/Android builds.`,
  );
};

export const init = () => unsupported("init");
export const track = () => unsupported("track");
export const identify = () => unsupported("identify");
export const createInstance = () => unsupported("createInstance");
export const Experiment = {
  initialize: () => unsupported("Experiment.initialize"),
  initializeWithAmplitudeAnalytics: () =>
    unsupported("Experiment.initializeWithAmplitudeAnalytics"),
};

export type { AmplitudeContext } from "./AmplitudeContext.nitro";
export type { AmplitudeStorage } from "./AmplitudeStorage.nitro";
export type { AmplitudeWorker } from "./AmplitudeWorker.nitro";
