import {
  Experiment,
  Source,
  Types,
  VERSION,
  createInstance,
  prefetchNativeContext,
  nitroHttpClient,
} from "../src";
import { init, track } from "../src/analytics";
import {
  Experiment as ExperimentSubpath,
  type ExperimentConfig as ExperimentSubpathConfig,
} from "../src/experiment";
import type { ExperimentConfig } from "../src/experiment/types/config";
import type { Variant } from "../src/experiment/types/variant";
import {
  Experiment as WebExperiment,
  createInstance as createWebInstance,
  init as webInit,
  nitroHttpClient as webNitroHttpClient,
} from "../src/index.web";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Extends<A, B> = A extends B ? true : false;
type Assert<T extends true> = T;

const version = VERSION satisfies string;
void version;

const initClient = createInstance;
void initClient;
type CreateInstanceClient = ReturnType<typeof createInstance>;
type WebCreateInstanceClient = ReturnType<typeof createWebInstance>;
type CreateInstanceHasTrack = Assert<
  Extends<CreateInstanceClient["track"], Types.ReactNativeClient["track"]>
>;
type WebCreateInstanceHasTrack = Assert<
  Extends<WebCreateInstanceClient["track"], Types.ReactNativeClient["track"]>
>;
const createInstanceHasTrack: CreateInstanceHasTrack = true;
const webCreateInstanceHasTrack: WebCreateInstanceHasTrack = true;
void createInstanceHasTrack;
void webCreateInstanceHasTrack;

prefetchNativeContext();

const analyticsConfig = {
  instanceName: "type-test",
  trackingSessionEvents: true,
  trackingOptions: {
    ipAddress: false,
    platform: true,
  },
} satisfies Types.ReactNativeOptions;
void analyticsConfig;

const config: ExperimentConfig = {
  instanceName: "type-test",
  automaticExposureTracking: true,
  serverZone: "US",
  source: Source.LocalStorage,
};
void config;

const variant: Variant = { key: "on", value: "on" };
void variant;

const factoryInit: typeof Experiment.initialize = Experiment.initialize;
void factoryInit;

const httpRequest = nitroHttpClient.request.bind(nitroHttpClient);
void httpRequest;

const analyticsInit = init satisfies typeof import("../src").init;
const analyticsTrack = track satisfies typeof import("../src").track;
const experimentSubpathInit = ExperimentSubpath.initialize;
const experimentSubpathConfig: ExperimentSubpathConfig = {
  instanceName: "subpath-type-test",
};
const webInitExport = webInit satisfies typeof import("../src").init;
const webExperimentInit = WebExperiment.initialize satisfies typeof Experiment.initialize;
const webHttpRequest = webNitroHttpClient.request.bind(webNitroHttpClient);
void analyticsInit;
void analyticsTrack;
void experimentSubpathInit;
void experimentSubpathConfig;
void webInitExport;
void webExperimentInit;
void webHttpRequest;
