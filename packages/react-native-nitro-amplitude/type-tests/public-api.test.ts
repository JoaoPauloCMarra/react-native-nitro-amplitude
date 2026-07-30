import {
  Experiment,
  NitroExperimentStorage,
  Source,
  Types,
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  createFakeExperimentStorage,
  createInstance,
  createNetworkTimingBuffer,
  dryRunTransport,
  getDiagnostics,
  prefetchNativeContext,
  nitroHttpClient,
  setNetworkEnabled,
  variantPayload,
} from "../src";
import { init, track } from "../src/analytics";
import {
  Experiment as ExperimentSubpath,
  type ExperimentConfig as ExperimentSubpathConfig,
} from "../src/experiment";
import type { AmplitudeNetworkTimingBuffer, ExperimentClient } from "../src";
import type { ExperimentConfig } from "../src/experiment/types/config";
import type { Variant } from "../src/experiment/types/variant";
import {
  Experiment as WebExperiment,
  createInstance as createWebInstance,
  getDiagnostics as getWebDiagnostics,
  init as webInit,
  nitroHttpClient as webNitroHttpClient,
} from "../src/index.web";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Extends<A, B> = A extends B ? true : false;
type Assert<T extends true> = T;

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
type CreateInstanceHasTrackScreenView = Assert<
  Extends<
    CreateInstanceClient["trackScreenView"],
    Types.ReactNativeClient["trackScreenView"]
  >
>;
type WebCreateInstanceHasTrackScreenView = Assert<
  Extends<
    WebCreateInstanceClient["trackScreenView"],
    Types.ReactNativeClient["trackScreenView"]
  >
>;
type CreateInstanceHasNavigationScreenView = Assert<
  Extends<
    CreateInstanceClient["trackScreenViewOnNavigationStateChange"],
    Types.ReactNativeClient["trackScreenViewOnNavigationStateChange"]
  >
>;
type WebCreateInstanceHasNavigationScreenView = Assert<
  Extends<
    WebCreateInstanceClient["trackScreenViewOnNavigationStateChange"],
    Types.ReactNativeClient["trackScreenViewOnNavigationStateChange"]
  >
>;
const createInstanceHasTrack: CreateInstanceHasTrack = true;
const webCreateInstanceHasTrack: WebCreateInstanceHasTrack = true;
const createInstanceHasTrackScreenView: CreateInstanceHasTrackScreenView = true;
const webCreateInstanceHasTrackScreenView: WebCreateInstanceHasTrackScreenView = true;
const createInstanceHasNavigationScreenView: CreateInstanceHasNavigationScreenView = true;
const webCreateInstanceHasNavigationScreenView: WebCreateInstanceHasNavigationScreenView = true;
void createInstanceHasTrack;
void webCreateInstanceHasTrack;
void createInstanceHasTrackScreenView;
void webCreateInstanceHasTrackScreenView;
void createInstanceHasNavigationScreenView;
void webCreateInstanceHasNavigationScreenView;

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

const experimentStorage = new NitroExperimentStorage("types");
void experimentStorage;

const preset = createDurableAmplitudeStoragePreset({
  namespace: "types",
  dryRun: true,
});
void preset;

const combinedClient = createAmplitudeClient({
  analyticsApiKey: "analytics-key",
  experimentDeploymentKey: "deployment-key",
  durableStorage: true,
});
const combinedExperiment: ExperimentClient = combinedClient.experiment;
void combinedClient;
void combinedExperiment;

const analyticsOnlyClient = createAmplitudeClient({
  analyticsApiKey: "analytics-key",
});
const maybeExperiment: ExperimentClient | undefined =
  analyticsOnlyClient.experiment;
void analyticsOnlyClient;
void maybeExperiment;

const timingBuffer: AmplitudeNetworkTimingBuffer = createNetworkTimingBuffer();
void timingBuffer;

setNetworkEnabled(true);
const dryRun = dryRunTransport;
void dryRun;

const diagnostics = getDiagnostics();
diagnostics.native.nativeAvailable satisfies boolean;
diagnostics.networkEnabled satisfies boolean;
const webDiagnostics = getWebDiagnostics();
webDiagnostics.native.nativeAvailable satisfies boolean;
webDiagnostics.networkEnabled satisfies boolean;

const fakeStorage = createFakeExperimentStorage();
void fakeStorage;

const typedPayload = variantPayload<{ enabled: boolean }>(
  Experiment.initialize("deployment-key"),
  "payload",
  { enabled: false },
);
type PayloadShape = Assert<Equals<typeof typedPayload, { enabled: boolean }>>;
const payloadShape: PayloadShape = true;
void payloadShape;

const analyticsInit = init satisfies typeof import("../src").init;
const analyticsTrack = track satisfies typeof import("../src").track;
const experimentSubpathInit = ExperimentSubpath.initialize;
const experimentSubpathConfig: ExperimentSubpathConfig = {
  instanceName: "subpath-type-test",
};
const webInitExport = webInit satisfies typeof import("../src").init;
const webExperimentInit =
  WebExperiment.initialize satisfies typeof Experiment.initialize;
const webHttpRequest = webNitroHttpClient.request.bind(webNitroHttpClient);
void analyticsInit;
void analyticsTrack;
void experimentSubpathInit;
void experimentSubpathConfig;
void webInitExport;
void webExperimentInit;
void webHttpRequest;
