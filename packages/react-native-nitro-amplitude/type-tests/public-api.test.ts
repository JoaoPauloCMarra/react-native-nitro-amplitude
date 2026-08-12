import {
  Experiment,
  NitroExperimentStorage,
  Source,
  Types,
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  createInstance,
  getDiagnostics,
  prefetchNativeContext,
  nitroHttpClient,
  variantPayload,
} from "../src";
import { init, track } from "../src/analytics";
import {
  Experiment as ExperimentSubpath,
  type ExperimentConfig as ExperimentSubpathConfig,
} from "../src/experiment";
import type { ExperimentClient } from "../src";
import type { ExperimentConfig } from "../src/experiment/types/config";
import type { Variant } from "../src/experiment/types/variant";
import {
  Experiment as WebExperiment,
  createInstance as createWebInstance,
  getDiagnostics as getWebDiagnostics,
  init as webInit,
  nitroHttpClient as webNitroHttpClient,
} from "../src/index.web";
import {
  AmplitudeNetworkTimingBuffer,
  createNetworkTimingBuffer,
  dryRunTransport,
  setNetworkEnabled,
} from "../src/network";
import { createFakeExperimentStorage } from "../src/testing";
import type { AmplitudeWorker } from "../src/AmplitudeWorker.nitro";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Extends<A, B> = A extends B ? true : false;
type Assert<T extends true> = T;

type RootExportSurface = typeof import("../src");
type WebExportSurface = typeof import("../src/index.web");
type ExperimentExportSurface = typeof import("../src/experiment");
type AnalyticsExportSurface = typeof import("../src/analytics");

type NoDryRunSingleton = Assert<
  Equals<"dryRunHttpClient" extends keyof RootExportSurface ? true : false, false>
>;
type NoDryRunTransportSingleton = Assert<
  Equals<"dryRunTransport" extends keyof RootExportSurface ? true : false, false>
>;
type NoWebDryRunSingleton = Assert<
  Equals<"dryRunHttpClient" extends keyof WebExportSurface ? true : false, false>
>;
type NoNetworkControlInRoot = Assert<
  Equals<"setNetworkEnabled" extends keyof RootExportSurface ? true : false, false>
>;
type NoNetworkControlInWebRoot = Assert<
  Equals<"getNetworkEnabled" extends keyof WebExportSurface ? true : false, false>
>;
type NoTimingHelpersInRoot = Assert<
  Equals<"createNetworkTimingBuffer" extends keyof RootExportSurface ? true : false, false>
>;
type NoTimingHelpersInWebRoot = Assert<
  Equals<"createTimedHttpClient" extends keyof WebExportSurface ? true : false, false>
>;
type NoDryRunClassesInRoot = Assert<
  Equals<"DryRunTransport" extends keyof RootExportSurface ? true : false, false>
>;
type NoTestingHelpersInRoot = Assert<
  Equals<"createMockExperimentClient" extends keyof RootExportSurface ? true : false, false>
>;
type NoTestingHelpersInWebRoot = Assert<
  Equals<"createFakeExperimentStorage" extends keyof WebExportSurface ? true : false, false>
>;
type NoBareExperiment = Assert<
  Equals<"experimentClient" extends keyof ExperimentExportSurface ? true : false, false>
>;
type NoBareFactory = Assert<
  Equals<"factory" extends keyof ExperimentExportSurface ? true : false, false>
>;
type HasAnalyticsCompat = Assert<
  Extends<AnalyticsExportSurface["init"], RootExportSurface["init"]>
>;
type HasExperimentCompat = Assert<
  Extends<ExperimentExportSurface["Experiment"], RootExportSurface["Experiment"]>
>;
type HasWorkerMetrics = Assert<
  Extends<
    ReturnType<RootExportSurface["getDiagnostics"]>["workerMetrics"],
    { queueSize: number; inFlightCount: number; pendingBodyBytes: number } | undefined
  >
>;
const noDryRunSingleton: NoDryRunSingleton = true;
const noDryRunTransportSingleton: NoDryRunTransportSingleton = true;
const noWebDryRunSingleton: NoWebDryRunSingleton = true;
const noNetworkControlInRoot: NoNetworkControlInRoot = true;
const noNetworkControlInWebRoot: NoNetworkControlInWebRoot = true;
const noTimingHelpersInRoot: NoTimingHelpersInRoot = true;
const noTimingHelpersInWebRoot: NoTimingHelpersInWebRoot = true;
const noDryRunClassesInRoot: NoDryRunClassesInRoot = true;
const noTestingHelpersInRoot: NoTestingHelpersInRoot = true;
const noTestingHelpersInWebRoot: NoTestingHelpersInWebRoot = true;
const noBareExperiment: NoBareExperiment = true;
const noBareFactory: NoBareFactory = true;
const hasAnalyticsCompat: HasAnalyticsCompat = true;
const hasExperimentCompat: HasExperimentCompat = true;
const hasWorkerMetrics: HasWorkerMetrics = true;
void noDryRunSingleton;
void noDryRunTransportSingleton;
void noWebDryRunSingleton;
void noNetworkControlInRoot;
void noNetworkControlInWebRoot;
void noTimingHelpersInRoot;
void noTimingHelpersInWebRoot;
void noDryRunClassesInRoot;
void noTestingHelpersInRoot;
void noTestingHelpersInWebRoot;
void noBareExperiment;
void noBareFactory;
void hasAnalyticsCompat;
void hasExperimentCompat;
void hasWorkerMetrics;
void (null as unknown as AmplitudeWorker);

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
