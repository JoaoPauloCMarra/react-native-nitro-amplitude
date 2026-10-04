import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { AppStateStatus } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { createInstance } from "react-native-nitro-amplitude";
import {
  DryRunTransport,
  clearDryRunTransportRecords,
  getDryRunAnalyticsEvents,
} from "react-native-nitro-amplitude/network";
import { Page, StatusRow } from "../components/shared";

const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
const PROBE_EVENT = "e2e_background_probe";
const FLUSH_INTERVAL_MILLIS = 600000;
const LATENCY_LIMIT_MILLIS = 120000;
const RESUME_POLL_MILLIS = 5000;
const RESUME_POLL_STEP_MILLIS = 250;

function delay(millis: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, millis));
}

function probeRecords(runId: string) {
  return getDryRunAnalyticsEvents().flatMap((record) =>
    record.payload.events
      .filter(
        (event) =>
          event.event_type === PROBE_EVENT &&
          event.event_properties?.run_id === runId,
      )
      .map(() => record.createdAt),
  );
}

export default function AmplitudeBackgroundLabScreen() {
  const searchParams = useLocalSearchParams<{ runId?: string }>();
  const runId =
    typeof searchParams.runId === "string" && searchParams.runId.length > 0
      ? searchParams.runId
      : undefined;
  const dryRun = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
  const [tokens, setTokens] = useState<string[]>([]);

  useEffect(() => {
    if (!dryRun || !runId) {
      return;
    }
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;
    const analytics = createInstance();
    const push = (token: string) => {
      if (!cancelled) {
        setTokens((previous) => [...previous, token]);
      }
    };

    const evaluateResume = async (armedAt: number) => {
      const deadline = Date.now() + RESUME_POLL_MILLIS;
      let recorded = probeRecords(runId);
      while (recorded.length === 0 && Date.now() < deadline) {
        await delay(RESUME_POLL_STEP_MILLIS);
        if (cancelled) {
          return;
        }
        recorded = probeRecords(runId);
      }
      if (recorded.length === 0) {
        push("bg:flushed=0;");
        return;
      }
      const latency = Math.max(...recorded) - armedAt;
      push(`bg:latency=${latency};`);
      push(
        latency >= 0 && latency < LATENCY_LIMIT_MILLIS
          ? `bg:flushed=${recorded.length}:latency-ok;`
          : "bg:flushed=0;",
      );
    };

    void (async () => {
      try {
        await analytics.init(ANALYTICS_API_KEY, "e2e-background-user", {
          instanceName: "e2e-background",
          trackingSessionEvents: false,
          flushIntervalMillis: FLUSH_INTERVAL_MILLIS,
          transportProvider: new DryRunTransport(),
        }).promise;
        if (cancelled) {
          return;
        }
        clearDryRunTransportRecords();
        void analytics.track(PROBE_EVENT, { run_id: runId });
        const armedAt = Date.now();
        push("bg:armed;");
        await delay(300);
        if (cancelled) {
          return;
        }
        if (probeRecords(runId).length !== 0) {
          push("bg:pending=early;");
          return;
        }
        push("bg:pending=0;");
        let leftForeground = false;
        let evaluated = false;
        subscription = AppState.addEventListener(
          "change",
          (nextAppState: AppStateStatus) => {
            if (nextAppState !== "active") {
              leftForeground = true;
              return;
            }
            if (leftForeground && !evaluated) {
              evaluated = true;
              void evaluateResume(armedAt);
            }
          },
        );
      } catch (error) {
        push(
          `bg:error=${error instanceof Error ? error.message.slice(0, 40) : "error"};`,
        );
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      analytics.shutdown();
    };
  }, [dryRun, runId]);

  if (!dryRun) {
    return (
      <Page title="Background lab" subtitle="Start the example in fixture mode">
        <StatusRow
          testID="e2e-background-blocked"
          label="state"
          value="blocked: fixture mode required"
        />
      </Page>
    );
  }

  const summary = runId
    ? tokens.join(" ") || "running"
    : "blocked:run-id-required";

  return (
    <View
      testID="e2e-background-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Background lab"
    >
      <Page
        title="Background lab"
        subtitle="Deep link nitroamplitude://e2e-background"
      >
        <StatusRow
          testID="e2e-background-mode"
          label="mode"
          value="dry-run fixture"
        />
        <View
          testID="e2e-background-results"
          accessible
          accessibilityLabel={summary}
          style={localStyles.resultsProbe}
        />
        <StatusRow
          testID="e2e-background-summary"
          label="summary"
          value={summary}
        />
      </Page>
    </View>
  );
}

const localStyles = StyleSheet.create({
  resultsProbe: {
    height: 1,
  },
});
