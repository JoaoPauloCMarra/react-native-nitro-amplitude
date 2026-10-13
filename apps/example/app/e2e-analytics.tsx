import {
  Experiment,
  StubExperimentClient,
  VariantSource,
  createExperimentUser,
  createInstance,
  createPersistentAmplitudeConfig,
  isFallback,
  parseVariantJson,
  variantJson,
  variantNumber,
  variantPayload,
} from "react-native-nitro-amplitude";
import {
  DryRunTransport,
  clearDryRunTransportRecords,
  getDryRunAnalyticsEvents,
} from "react-native-nitro-amplitude/network";
import {
  ANALYTICS_API_KEY,
  EXPERIMENT_API_KEY,
  delay,
  fixtureHttpClient,
} from "../components/fixture";
import {
  LabBlockedPage,
  LabCasesScreen,
  countFailedCases,
  useLabCases,
} from "../components/lab-runner";
import type { Types } from "react-native-nitro-amplitude";

function recordedEvents() {
  return getDryRunAnalyticsEvents().flatMap((record) => record.payload.events);
}

async function runExposureCase(): Promise<string> {
  clearDryRunTransportRecords();
  const analytics = createInstance();
  const experiment = Experiment.initializeWithAmplitudeAnalytics(
    EXPERIMENT_API_KEY,
    {
      instanceName: "e2e-exposure",
      automaticExposureTracking: false,
      fetchOnStart: false,
      pollOnStart: false,
      httpClient: fixtureHttpClient,
    },
  );
  try {
    await analytics.init(ANALYTICS_API_KEY, "e2e-exposure-user", {
      instanceName: "e2e-exposure",
      trackingSessionEvents: false,
      flushIntervalMillis: 60000,
      transportProvider: new DryRunTransport(),
    }).promise;
    await experiment.fetch({ user_id: "e2e-exposure-user" });
    const value = experiment.variant("demo-flag").value;
    experiment.exposure("demo-flag");
    const result = await analytics.flushWithResult();
    const exposed = recordedEvents().some(
      (event) =>
        event.event_type === "$exposure" &&
        event.event_properties?.flag_key === "demo-flag",
    );
    return result.ok && value === "on" && exposed
      ? "ok:exposure=demo-flag"
      : `fail:exposure=value=${String(value)}:exposed=${exposed}`;
  } finally {
    experiment.stop();
    analytics.shutdown();
  }
}

async function runSessionCase(): Promise<string> {
  clearDryRunTransportRecords();
  const analytics = createInstance();
  try {
    await analytics.init(ANALYTICS_API_KEY, "e2e-session-user", {
      instanceName: "e2e-session",
      trackingSessionEvents: true,
      flushIntervalMillis: 60000,
      transportProvider: new DryRunTransport(),
    }).promise;
    const previousSessionId = analytics.getSessionId();
    const nextSessionId = Date.now() + 60000;
    analytics.setSessionId(nextSessionId);
    analytics.extendSession();
    const extendedSessionId = analytics.getSessionId();
    const result = await analytics.flushWithResult();
    const events = recordedEvents();
    const started = events.some(
      (event) =>
        event.event_type === "session_start" &&
        event.session_id === nextSessionId,
    );
    const ended = events.some(
      (event) =>
        event.event_type === "session_end" &&
        event.session_id === previousSessionId,
    );
    return result.ok &&
      previousSessionId !== undefined &&
      started &&
      ended &&
      extendedSessionId === nextSessionId
      ? "ok:session=start+end:extended"
      : `fail:session=start=${started}:end=${ended}:extended=${extendedSessionId === nextSessionId}`;
  } finally {
    analytics.shutdown();
  }
}

async function runPluginCase(): Promise<string> {
  clearDryRunTransportRecords();
  const analytics = createInstance();
  const plugin: Types.EnrichmentPlugin = {
    name: "e2e-enrichment",
    type: "enrichment",
    async execute(event) {
      return {
        ...event,
        event_properties: { ...event.event_properties, e2e_plugin: "added" },
      };
    },
  };
  try {
    await analytics.init(ANALYTICS_API_KEY, "e2e-plugin-user", {
      instanceName: "e2e-plugin",
      trackingSessionEvents: false,
      flushIntervalMillis: 60000,
      transportProvider: new DryRunTransport(),
    }).promise;
    const previousDeviceId = analytics.getDeviceId();
    await analytics.add(plugin).promise;
    analytics.setDeviceId("e2e-device");
    analytics.logEvent("e2e_plugin_added");
    const addedResult = await analytics.flushWithResult();
    const added = recordedEvents().some(
      (event) =>
        event.event_type === "e2e_plugin_added" &&
        event.device_id === "e2e-device" &&
        event.event_properties?.e2e_plugin === "added",
    );
    await analytics.remove("e2e-enrichment").promise;
    analytics.logEvent("e2e_plugin_removed");
    const removedResult = await analytics.flushWithResult();
    const removed = recordedEvents().some(
      (event) =>
        event.event_type === "e2e_plugin_removed" &&
        event.event_properties?.e2e_plugin === undefined,
    );
    if (previousDeviceId !== undefined) {
      analytics.setDeviceId(previousDeviceId);
    }
    const restored = analytics.getDeviceId() === previousDeviceId;
    return addedResult.ok && removedResult.ok && added && removed && restored
      ? "ok:plugin=added+removed:device=e2e-device"
      : `fail:plugin=added=${added}:removed=${removed}:restored=${restored}`;
  } finally {
    analytics.shutdown();
  }
}

async function runShutdownCase(): Promise<string> {
  clearDryRunTransportRecords();
  const analytics = createInstance();
  await analytics.init(ANALYTICS_API_KEY, "e2e-shutdown-user", {
    instanceName: "e2e-shutdown",
    trackingSessionEvents: false,
    flushIntervalMillis: 60000,
    transportProvider: new DryRunTransport(),
  }).promise;
  analytics.track("e2e_shutdown_probe");
  analytics.shutdown();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const flushed = recordedEvents().some(
      (event) => event.event_type === "e2e_shutdown_probe",
    );
    if (flushed && !analytics.getDiagnostics().initialized) {
      return "ok:shutdown=flushed";
    }
    await delay(100);
  }
  return `fail:shutdown=initialized=${analytics.getDiagnostics().initialized}`;
}

const helperVariantsHttpClient = {
  async request(requestUrl: string) {
    if (
      requestUrl.includes("/sdk/v2/flags") &&
      !requestUrl.includes("vardata")
    ) {
      return { status: 200, body: "[]" };
    }
    return {
      status: 200,
      body: JSON.stringify({
        "demo-flag": { key: "on", value: "on" },
        "e2e-number": { key: "42", value: "42" },
        "e2e-text": { key: "text", value: "not-a-number" },
        "e2e-json": {
          key: "json",
          value: '{"answer":42}',
          payload: { answer: 42 },
        },
      }),
    };
  },
};

async function runHelpersCase(): Promise<string> {
  const failures: string[] = [];
  const check = (name: string, passed: boolean) => {
    if (!passed) {
      failures.push(name);
    }
  };

  const initial = Experiment.initialize(EXPERIMENT_API_KEY, {
    instanceName: "e2e-helpers",
    fetchOnStart: false,
    pollOnStart: false,
    httpClient: fixtureHttpClient,
  });
  const client = Experiment.reinitialize(EXPERIMENT_API_KEY, {
    instanceName: "e2e-helpers",
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    retryFetchOnFailure: false,
    httpClient: helperVariantsHttpClient,
    fallbackVariant: { value: "config-fallback" },
  });
  try {
    check("reinitialize", initial !== client);
    check(
      "initialize-after-reinitialize",
      Experiment.initialize(EXPERIMENT_API_KEY, {
        instanceName: "e2e-helpers",
      }) === client,
    );

    const jsonFallback = { answer: -1 };
    const payloadFallback = { answer: -2 };
    check("absent-variantNumber", variantNumber(client, "e2e-absent", 7) === 7);
    check(
      "absent-variantJson",
      variantJson(client, "e2e-absent", jsonFallback) === jsonFallback,
    );
    check(
      "absent-variantPayload",
      variantPayload(client, "e2e-absent", payloadFallback) === payloadFallback,
    );
    check(
      "fallbackVariant",
      client.variant("e2e-absent").value === "config-fallback",
    );

    const fetched = await client.fetchWithMetadata(
      { user_id: "e2e-helpers-user" },
      { flagKeys: ["demo-flag", "e2e-number", "e2e-text", "e2e-json"] },
    );
    check("fetch", fetched.fetched);
    check("variantNumber", variantNumber(client, "e2e-number", 0) === 42);
    check(
      "variantNumber-non-numeric",
      variantNumber(client, "e2e-text", 5) === 5,
    );
    check(
      "variantJson",
      variantJson<{ answer?: number }>(client, "e2e-json", jsonFallback)
        .answer === 42,
    );
    check(
      "variantPayload",
      variantPayload<{ answer?: number }>(client, "e2e-json", payloadFallback)
        .answer === 42,
    );
    check(
      "parseVariantJson",
      parseVariantJson({ value: "not-json" }, "fallback") === "fallback" &&
        parseVariantJson<{ answer?: number }>({ value: '{"answer":42}' }, {})
          .answer === 42,
    );
    check(
      "isFallback",
      isFallback(VariantSource.FallbackConfig) &&
        isFallback(VariantSource.FallbackInline) &&
        isFallback(undefined) &&
        !isFallback(VariantSource.LocalStorage),
    );

    const cached =
      client.hasCachedVariant("demo-flag") &&
      client.hasCachedVariant("e2e-number");
    client.clearVariants();
    check(
      "clearVariants",
      cached &&
        !client.hasCachedVariant("demo-flag") &&
        !client.hasCachedVariant("e2e-number") &&
        variantNumber(client, "e2e-number", 0) === 0,
    );

    const userBeforeProvider = await client.getUserProvider().getUser();
    client.setUserProvider({
      async getUser() {
        return { user_id: "e2e-provider-user" };
      },
    });
    const providedUser = await client.getUserProvider().getUser();
    check(
      "setUserProvider",
      userBeforeProvider.user_id !== "e2e-provider-user" &&
        providedUser.user_id === "e2e-provider-user",
    );

    const stub = new StubExperimentClient();
    const stubResult = await stub.fetchWithMetadata();
    check(
      "StubExperimentClient",
      stubResult.failureReason === "stub_client" &&
        !stubResult.fetched &&
        !stub.hasCachedVariant("demo-flag"),
    );

    const userProperties = { plan: "e2e" };
    const user = createExperimentUser({
      user_id: "e2e-copy",
      user_properties: userProperties,
    });
    check(
      "createExperimentUser",
      user.user_id === "e2e-copy" &&
        user.user_properties !== userProperties &&
        user.user_properties?.plan === "e2e",
    );

    const persistent = createPersistentAmplitudeConfig({
      namespace: "e2e-helpers",
      dryRun: true,
    });
    check(
      "createPersistentAmplitudeConfig",
      persistent.analytics.storageProvider !== undefined &&
        persistent.analytics.cookieStorage !== undefined &&
        persistent.analytics.transportProvider !== undefined &&
        persistent.experiment.storage !== undefined,
    );
    await persistent.clear();
  } finally {
    client.stop();
  }
  return failures.length === 0
    ? "ok:experiment-helpers=all"
    : `fail:experiment-helpers=${failures.join(",")}`;
}

export default function AmplitudeAnalyticsLabScreen() {
  const dryRun = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
  const { cases, done } = useLabCases(
    dryRun,
    () => [
      ["exposure", runExposureCase],
      ["session", runSessionCase],
      ["plugin", runPluginCase],
      ["shutdown", runShutdownCase],
      ["experiment-helpers", runHelpersCase],
    ],
    "",
  );

  if (!dryRun) {
    return <LabBlockedPage prefix="analytics" title="Analytics lab" />;
  }

  const summary = done
    ? `analytics-done:fail=${countFailedCases(cases)};`
    : "running";

  return (
    <LabCasesScreen
      prefix="analytics"
      title="Analytics lab"
      cardTitle="Analytics and Experiment"
      cardSubtitle="Dry-run fixture only; no Amplitude keys"
      cases={cases}
      summary={summary}
    />
  );
}
