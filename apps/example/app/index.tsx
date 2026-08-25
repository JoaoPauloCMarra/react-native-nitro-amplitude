import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  Experiment,
  Identify,
  init,
  prefetchNativeContext,
  track,
  getDeviceId,
  flushWithResult,
  getDiagnostics,
  identify,
  nitroHttpClient,
  nitroTransport,
} from "react-native-nitro-amplitude";
import {
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  DryRunTransport,
} from "react-native-nitro-amplitude/network";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Input,
  Page,
  Section,
  StatusRow,
  styles,
} from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";
import type { AmplitudeNetworkTiming } from "react-native-nitro-amplitude/network";

const ANALYTICS_API_KEY = process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY ?? "";
const EXPERIMENT_API_KEY =
  process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY &&
  process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY.length > 0
    ? process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY
    : ANALYTICS_API_KEY;
const DRY_RUN = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";

const fixtureHttpClient = {
  async request(requestUrl: string) {
    if (requestUrl.includes("/sdk/v2/flags")) {
      return { status: 200, body: "[]" };
    }
    return {
      status: 200,
      body: JSON.stringify({ "demo-flag": { key: "on", value: "on" } }),
    };
  },
};

type TimingSample = {
  durationMillis: number;
  status?: number | string;
  error?: string;
};

type TimingKind = AmplitudeNetworkTiming["kind"];

type TimingTracker = {
  clearLatest: (kind: TimingKind) => void;
  getHistory: () => string;
  getLatest: (kind: TimingKind) => TimingSample | undefined;
  record: (timing: AmplitudeNetworkTiming) => void;
};

function nowMillis(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function elapsedSince(startedAt: number): number {
  return Math.round((nowMillis() - startedAt) * 10) / 10;
}

function formatMillis(value?: number): string {
  return typeof value === "number" ? `${value.toFixed(1)}ms` : "n/a";
}

function codeMillis(totalMillis: number, httpMillis?: number): number {
  return Math.max(0, totalMillis - (httpMillis ?? 0));
}

function formatTiming(totalMillis: number, http?: TimingSample): string {
  const httpMillis = http?.durationMillis;
  const suffix = http?.error
    ? ` error=${http.error}`
    : http?.status !== undefined
      ? ` status=${String(http.status)}`
      : "";
  return `http=${formatMillis(httpMillis)} code=${formatMillis(
    codeMillis(totalMillis, httpMillis),
  )} total=${formatMillis(totalMillis)}${suffix}`;
}

function formatTimingHistory(timings: AmplitudeNetworkTiming[]): string {
  if (timings.length === 0) {
    return "No requests measured yet";
  }
  return timings
    .slice()
    .reverse()
    .map((timing, index) => {
      const suffix = timing.error
        ? ` error=${timing.error}`
        : timing.status !== undefined
          ? ` status=${String(timing.status)}`
          : "";
      return `${index + 1}. ${timing.kind} ${timing.method} ${formatMillis(
        timing.durationMillis,
      )}${suffix}`;
    })
    .join("\n");
}

function createTimingTracker(limit: number): TimingTracker {
  const buffer = createNetworkTimingBuffer(limit);
  const latest: Partial<Record<TimingKind, TimingSample>> = {};

  return {
    clearLatest: (kind) => {
      latest[kind] = undefined;
    },
    getHistory: () => formatTimingHistory(buffer.getTimings()),
    getLatest: (kind) => latest[kind],
    record: (timing) => {
      buffer.record(timing);
      latest[timing.kind] = timing;
    },
  };
}

export default function HomeScreen() {
  const [status, setStatus] = useState("idle");
  const [eventName, setEventName] = useState("nitro_amplitude_demo");
  const [flagKey, setFlagKey] = useState("demo-flag");
  const [flagValue, setFlagValue] = useState("(not fetched)");
  const [deviceId, setDeviceId] = useState("(unknown)");
  const [analyticsResult, setAnalyticsResult] = useState("Not run");
  const [experimentResult, setExperimentResult] = useState("Not run");
  const [timingHistory, setTimingHistory] = useState(
    "No requests measured yet",
  );
  const [userId] = useState("demo-user");
  const [isReady, setIsReady] = useState(false);
  const [busyAction, setBusyAction] = useState<"flush" | "fetch">();
  const [timingTracker] = useState(() => createTimingTracker(8));

  const [experimentClient] = useState(() =>
    Experiment.initializeWithAmplitudeAnalytics(EXPERIMENT_API_KEY, {
      instanceName: "example",
      automaticExposureTracking: true,
      fetchOnStart: false,
      pollOnStart: false,
      httpClient: DRY_RUN
        ? fixtureHttpClient
        : createTimedHttpClient(nitroHttpClient, timingTracker.record),
    }),
  );

  const [analyticsTransport] = useState(() =>
    DRY_RUN
      ? new DryRunTransport()
      : createTimedAnalyticsTransport(nitroTransport, timingTracker.record),
  );

  const refreshTimingHistory = () => {
    setTimingHistory(timingTracker.getHistory());
  };

  useEffect(() => {
    let cancelled = false;
    prefetchNativeContext();
    void (async () => {
      if (!DRY_RUN && !ANALYTICS_API_KEY) {
        if (!cancelled) {
          setStatus(
            "missing EXPO_PUBLIC_AMPLITUDE_API_KEY in apps/example/.env.local",
          );
        }
        return;
      }

      if (cancelled) return;
      setStatus("initializing analytics");
      await init(ANALYTICS_API_KEY, userId, {
        instanceName: "example",
        trackingSessionEvents: true,
        transportProvider: analyticsTransport,
      }).promise;
      if (cancelled) return;
      setDeviceId(String(getDeviceId() ?? "(none)"));
      setStatus("analytics ready");
      await experimentClient.start({ user_id: userId });
      if (cancelled) return;
      setIsReady(true);
      setStatus("experiment ready");
    })().catch((error: unknown) => {
      if (!cancelled) {
        setStatus(`init failed: ${String(error)}`);
      }
    });

    return () => {
      cancelled = true;
      experimentClient.stop();
    };
  }, [analyticsTransport, experimentClient, userId]);

  return (
    <Page
      title="Nitro Amplitude"
      subtitle="Analytics + Experiment powered by Nitro C++"
    >
      <SmokeTestRunner />

      <Card title="Runtime Status" indicatorColor={Colors.primary}>
        <StatusRow testID="runtime-status" label="Status" value={status} />
        <StatusRow testID="device-id" label="Device ID" value={deviceId} />
        <StatusRow testID="user-id" label="User ID" value={userId} />
      </Card>

      <Card
        title="Analytics"
        subtitle="Native transport + context"
        indicatorColor={Colors.disk}
      >
        <Input
          testID="event-name-input"
          label="Event name"
          value={eventName}
          onChangeText={setEventName}
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="track-event"
            title="Track Event"
            disabled={!isReady || busyAction !== undefined || !eventName.trim()}
            onPress={() => {
              const startedAt = nowMillis();
              track(eventName, { source: "example", platform: "native" });
              const codeDuration = elapsedSince(startedAt);
              setAnalyticsResult(
                `Tracked ${eventName} code=${formatMillis(codeDuration)}`,
              );
              setStatus(`tracked ${eventName}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="identify-user"
            title="Identify"
            variant="secondary"
            disabled={!isReady || busyAction !== undefined}
            onPress={() => {
              const startedAt = nowMillis();
              const update = new Identify();
              update.set("example_screen", "validation");
              identify(update);
              const codeDuration = elapsedSince(startedAt);
              setAnalyticsResult(
                `Identified ${userId} code=${formatMillis(codeDuration)}`,
              );
              setStatus(`identified ${userId}`);
            }}
            style={styles.flex1}
          />
        </View>
        <View style={styles.row}>
          <Button
            testID="flush-events"
            title={busyAction === "flush" ? "Flushing..." : "Flush"}
            variant="secondary"
            disabled={!isReady || busyAction !== undefined}
            onPress={() => {
              timingTracker.clearLatest("analytics");
              const startedAt = nowMillis();
              setBusyAction("flush");
              setStatus("flushing analytics");
              void flushWithResult()
                .then((result) => {
                  const totalDuration = elapsedSince(startedAt);
                  setAnalyticsResult(
                    `Flush ${
                      result.ok ? "ok" : "failed"
                    } sent=${result.sent} failed=${result.failed} ${formatTiming(
                      totalDuration,
                      timingTracker.getLatest("analytics"),
                    )}`,
                  );
                  setStatus("flush complete");
                  refreshTimingHistory();
                })
                .catch((error: unknown) => {
                  const totalDuration = elapsedSince(startedAt);
                  setAnalyticsResult(
                    `Flush failed ${formatTiming(
                      totalDuration,
                      timingTracker.getLatest("analytics"),
                    )}: ${String(error)}`,
                  );
                  setStatus(`flush failed: ${String(error)}`);
                  refreshTimingHistory();
                })
                .finally(() => {
                  setBusyAction(undefined);
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="read-diagnostics"
            title="Diagnostics"
            variant="secondary"
            disabled={!isReady || busyAction !== undefined}
            onPress={() => {
              const startedAt = nowMillis();
              const diagnostics = getDiagnostics();
              const codeDuration = elapsedSince(startedAt);
              setAnalyticsResult(
                `queue=${diagnostics.queueSize} initialized=${String(
                  diagnostics.initialized,
                )} code=${formatMillis(codeDuration)}`,
              );
              setStatus("diagnostics read");
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="analytics-result"
          label="Result"
          value={analyticsResult}
        />
      </Card>

      <Card
        title="Experiment"
        subtitle="Variant lookup + exposure"
        indicatorColor={Colors.accent}
      >
        <Input
          testID="flag-key-input"
          label="Flag key"
          value={flagKey}
          onChangeText={setFlagKey}
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="fetch-variants"
            title={busyAction === "fetch" ? "Fetching..." : "Fetch"}
            disabled={!isReady || busyAction !== undefined || !flagKey.trim()}
            onPress={() => {
              timingTracker.clearLatest("experiment");
              const startedAt = nowMillis();
              setBusyAction("fetch");
              setStatus(`fetching ${flagKey}`);
              setExperimentResult(`Fetching ${flagKey}`);
              void experimentClient
                .fetchWithMetadata(
                  { user_id: userId },
                  { flagKeys: flagKey ? [flagKey] : undefined },
                )
                .then((metadata) => {
                  const fetchDuration = elapsedSince(startedAt);
                  const variantStartedAt = nowMillis();
                  const resolved =
                    experimentClient.variantWithMetadata(flagKey);
                  const variantDuration = elapsedSince(variantStartedAt);
                  setFlagValue(JSON.stringify(resolved ?? {}, null, 2));
                  setStatus(
                    resolved.variant?.value
                      ? `fetched ${flagKey}: ${String(resolved.variant.value)}`
                      : `fetched ${flagKey}: no variant`,
                  );
                  setExperimentResult(
                    `Fetched ${
                      metadata.flagKeys.length
                    } key(s) source=${metadata.source} sdk=${formatMillis(
                      metadata.durationMillis,
                    )} ${formatTiming(
                      fetchDuration,
                      timingTracker.getLatest("experiment"),
                    )} variant=${formatMillis(variantDuration)}`,
                  );
                  refreshTimingHistory();
                })
                .catch((error: unknown) => {
                  const fetchDuration = elapsedSince(startedAt);
                  setExperimentResult(
                    `Fetch failed ${formatTiming(
                      fetchDuration,
                      timingTracker.getLatest("experiment"),
                    )}: ${String(error)}`,
                  );
                  setStatus(`fetch failed: ${String(error)}`);
                  refreshTimingHistory();
                })
                .finally(() => {
                  setBusyAction(undefined);
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="read-variant"
            title="Read Variant"
            variant="secondary"
            disabled={!isReady || busyAction !== undefined || !flagKey.trim()}
            onPress={() => {
              const startedAt = nowMillis();
              const resolved = experimentClient.variantWithMetadata(flagKey);
              const codeDuration = elapsedSince(startedAt);
              setFlagValue(JSON.stringify(resolved ?? {}, null, 2));
              setExperimentResult(
                resolved.variant?.value
                  ? `Read ${flagKey}: ${String(
                      resolved.variant.value,
                    )} code=${formatMillis(codeDuration)}`
                  : `Read ${flagKey}: no variant code=${formatMillis(
                      codeDuration,
                    )}`,
              );
            }}
            style={styles.flex1}
          />
          <Button
            testID="send-exposure"
            title="Expose"
            variant="secondary"
            disabled={!isReady || busyAction !== undefined || !flagKey.trim()}
            onPress={() => {
              const startedAt = nowMillis();
              experimentClient.exposure(flagKey);
              const codeDuration = elapsedSince(startedAt);
              setExperimentResult(
                `Exposure queued for ${flagKey} code=${formatMillis(
                  codeDuration,
                )}`,
              );
              setStatus(`exposed ${flagKey}`);
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="experiment-result"
          label="Result"
          value={experimentResult}
        />
        <Section title="Resolved variant">
          <CodeBlock testID="variant-value">{flagValue}</CodeBlock>
        </Section>
        <Section title="Request timing history">
          <CodeBlock testID="timing-history">{timingHistory}</CodeBlock>
        </Section>
      </Card>
    </Page>
  );
}
