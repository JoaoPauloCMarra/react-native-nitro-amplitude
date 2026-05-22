import {
  Experiment,
  VERSION,
  createInstance,
  prefetchNativeContext,
  nitroHttpClient,
} from "../src";
import type { ExperimentConfig } from "../src/experiment/types/config";
import type { Variant } from "../src/experiment/types/variant";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

const version = VERSION satisfies string;
void version;

const initClient = createInstance;
void initClient;

prefetchNativeContext();

const config: ExperimentConfig = {
  instanceName: "type-test",
  automaticExposureTracking: true,
};
void config;

const variant: Variant = { key: "on", value: "on" };
void variant;

const factoryInit: typeof Experiment.initialize = Experiment.initialize;
void factoryInit;

const httpRequest = nitroHttpClient.request.bind(nitroHttpClient);
void httpRequest;
