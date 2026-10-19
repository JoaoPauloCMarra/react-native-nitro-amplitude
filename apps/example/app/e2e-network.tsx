import { useLocalSearchParams } from "expo-router";
import {
  Experiment,
  clearDiagnosticFailures,
  createInstance,
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  getAmplitudeErrorCode,
  getDiagnostics,
  getLastNativeError,
  getNativeStartupDiagnostics,
  nitroHttpClient,
} from "react-native-nitro-amplitude";
import {
  DryRunTransport,
  clearDryRunTransportRecords,
  getDryRunAnalyticsEvents,
} from "react-native-nitro-amplitude/network";
import {
  ANALYTICS_API_KEY,
  EXPERIMENT_API_KEY,
  fixtureEndpoint,
} from "../components/fixture";
import {
  LabBlockedPage,
  LabCasesScreen,
  countFailedCases,
  useLabCases,
} from "../components/lab-runner";

function closedPortUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/:\d+$/, "")}:1/health`;
}

async function expectRequestError(
  run: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function runTimeoutCase(fixtureUrl: string): Promise<string> {
  const error = await expectRequestError(() =>
    nitroHttpClient.request(
      fixtureEndpoint(fixtureUrl, "/delay/3000"),
      "GET",
      {},
      null,
      500,
    ),
  );
  return error !== undefined && getAmplitudeErrorCode(error) === "timeout"
    ? "ok:native-http=timeout"
    : `fail:native-http=timeout:${getAmplitudeErrorCode(error)}`;
}

async function runRefusedCase(fixtureUrl: string): Promise<string> {
  const error = await expectRequestError(() =>
    nitroHttpClient.request(closedPortUrl(fixtureUrl), "GET", {}, null, 3000),
  );
  return error !== undefined && getAmplitudeErrorCode(error) === "network_error"
    ? "ok:native-http=refused"
    : `fail:native-http=refused:${getAmplitudeErrorCode(error)}`;
}

async function runInvalidUrlCase(): Promise<string> {
  const error = await expectRequestError(() =>
    nitroHttpClient.request("not-a-url", "GET", {}, null, 3000),
  );
  return error !== undefined && getAmplitudeErrorCode(error) === "network_error"
    ? "ok:native-http=invalid-url"
    : `fail:native-http=invalid-url:${getAmplitudeErrorCode(error)}`;
}

async function runNativeTransportCase(fixtureUrl: string): Promise<string> {
  const instance = createInstance();
  try {
    await instance.init(ANALYTICS_API_KEY, "e2e-native-transport-user", {
      instanceName: "e2e-native-transport",
      serverUrl: fixtureEndpoint(fixtureUrl, "/2/httpapi"),
      trackingSessionEvents: false,
      flushIntervalMillis: 60000,
    }).promise;
    instance.track("e2e_native_transport_probe");
    const result = await instance.flushWithResult();
    return result.ok && result.sent >= 1 && result.dropped === 0
      ? "ok:native-transport=ingested"
      : `fail:native-transport=ok=${result.ok}:sent=${result.sent}`;
  } finally {
    instance.shutdown();
  }
}

async function runNativeTransportFailureCase(
  fixtureUrl: string,
): Promise<string> {
  const instance = createInstance();
  try {
    await instance.init(ANALYTICS_API_KEY, "e2e-native-transport-user", {
      instanceName: "e2e-native-transport-retry",
      serverUrl: fixtureEndpoint(fixtureUrl, "/2/httpapi/503"),
      trackingSessionEvents: false,
      flushIntervalMillis: 60000,
    }).promise;
    instance.track("e2e_native_transport_failure_probe");
    const result = await instance.flushWithResult();
    const diagnosed = getDiagnostics().diagnosticFailures.some(
      (failure) =>
        failure.operation === "analytics_upload" &&
        failure.kind === "http_status" &&
        failure.httpStatus === 503,
    );
    return !result.ok && result.dropped >= 1 && diagnosed
      ? "ok:native-transport=status=503:dropped+diagnosed"
      : `fail:native-transport=status=503:ok=${result.ok}:dropped=${result.dropped}:diagnosed=${diagnosed}`;
  } finally {
    instance.shutdown();
  }
}

async function runNativeExperimentCase(fixtureUrl: string): Promise<string> {
  const client = Experiment.initialize(EXPERIMENT_API_KEY, {
    instanceName: "e2e-native-experiment",
    serverUrl: fixtureUrl,
    flagsServerUrl: fixtureUrl,
    fetchOnStart: false,
    pollOnStart: false,
    automaticExposureTracking: false,
    retryFetchOnFailure: false,
  });
  try {
    await client.start({ user_id: "e2e-user" });
    const result = await client.fetchWithMetadata(
      { user_id: "e2e-user" },
      { flagKeys: ["demo-flag"] },
    );
    const value = client.variantWithMetadata("demo-flag").variant.value;
    return result.fetched && value === "on"
      ? "ok:experiment-native=flag=on"
      : `fail:experiment-native=fetched=${result.fetched}:value=${String(value)}`;
  } finally {
    client.stop();
  }
}

async function runDiagnosticsCase(fixtureUrl: string): Promise<string> {
  const timings = createNetworkTimingBuffer();
  const timedHttpClient = createTimedHttpClient(
    nitroHttpClient,
    timings.record,
  );
  const response = await timedHttpClient.request(
    fixtureEndpoint(fixtureUrl, "/health"),
    "GET",
    {},
    null,
    5000,
  );
  clearDryRunTransportRecords();
  const instance = createInstance();
  try {
    await instance.init(ANALYTICS_API_KEY, "e2e-diagnostics-user", {
      instanceName: "e2e-diagnostics",
      trackingSessionEvents: false,
      flushIntervalMillis: 60000,
      transportProvider: createTimedAnalyticsTransport(
        new DryRunTransport(),
        timings.record,
      ),
    }).promise;
    instance.track("e2e_diagnostics_probe");
    await instance.flushWithResult();
  } finally {
    instance.shutdown();
  }
  const recorded = timings.getTimings();
  const timingsPresent =
    response.status === 200 &&
    recorded.some(
      (timing) => timing.kind === "experiment" && timing.status === 200,
    ) &&
    recorded.some((timing) => timing.kind === "analytics") &&
    getDryRunAnalyticsEvents().length > 0;
  const native = getNativeStartupDiagnostics();
  const nativeReady =
    native.nitroModulesAvailable &&
    native.contextAvailable &&
    native.storageAvailable &&
    native.workerAvailable &&
    native.nativeAvailable &&
    getLastNativeError() === undefined;
  const diagnostics = getDiagnostics();
  const workerReady = diagnostics.workerMetrics !== undefined;
  const pipelineTimings = diagnostics.networkTimings.length > 0;
  clearDiagnosticFailures();
  const cleared = getDiagnostics().diagnosticFailures.length === 0;
  return nativeReady &&
    workerReady &&
    timingsPresent &&
    pipelineTimings &&
    cleared
    ? "ok:diagnostics=native+worker+timings"
    : `fail:diagnostics=native=${nativeReady}:worker=${workerReady}:timings=${timingsPresent}:pipeline=${pipelineTimings}:cleared=${cleared}`;
}

export default function AmplitudeNetworkLabScreen() {
  const searchParams = useLocalSearchParams<{ fixtureUrl?: string }>();
  const fixtureUrl =
    typeof searchParams.fixtureUrl === "string"
      ? searchParams.fixtureUrl
      : undefined;
  const dryRun = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
  const { cases, done } = useLabCases(
    dryRun && fixtureUrl !== undefined,
    () =>
      fixtureUrl === undefined
        ? []
        : [
            ["timeout", () => runTimeoutCase(fixtureUrl)],
            ["refused", () => runRefusedCase(fixtureUrl)],
            ["invalid-url", () => runInvalidUrlCase()],
            ["native-transport", () => runNativeTransportCase(fixtureUrl)],
            [
              "native-transport-failure",
              () => runNativeTransportFailureCase(fixtureUrl),
            ],
            ["experiment-native", () => runNativeExperimentCase(fixtureUrl)],
            ["diagnostics", () => runDiagnosticsCase(fixtureUrl)],
          ],
    fixtureUrl ?? "",
  );

  if (!dryRun) {
    return <LabBlockedPage prefix="network" title="Network lab" />;
  }

  const summary = fixtureUrl
    ? done
      ? `network-done:fail=${countFailedCases(cases)};`
      : "running"
    : "blocked:local-fixture-url-required";

  return (
    <LabCasesScreen
      prefix="network"
      title="Network lab"
      cardTitle="Native network"
      cardSubtitle="Local fixture only; no Amplitude keys"
      cases={cases}
      summary={summary}
    />
  );
}
