import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  Experiment,
  init,
  prefetchNativeContext,
  track,
  getDeviceId,
  flush,
} from "react-native-nitro-amplitude";
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

const ANALYTICS_API_KEY = process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY ?? "";
const EXPERIMENT_API_KEY =
  process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY &&
  process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY.length > 0
    ? process.env.EXPO_PUBLIC_AMPLITUDE_EXPERIMENT_KEY
    : ANALYTICS_API_KEY;

export default function HomeScreen() {
  const [status, setStatus] = useState("idle");
  const [eventName, setEventName] = useState("nitro_amplitude_demo");
  const [flagKey, setFlagKey] = useState("demo-flag");
  const [flagValue, setFlagValue] = useState("(not fetched)");
  const [deviceId, setDeviceId] = useState("(unknown)");
  const [analyticsResult, setAnalyticsResult] = useState("Not run");
  const [experimentResult, setExperimentResult] = useState("Not run");
  const [userId] = useState("demo-user");

  const experimentClient = useMemo(
    () =>
      Experiment.initializeWithAmplitudeAnalytics(EXPERIMENT_API_KEY, {
        instanceName: "example",
        automaticExposureTracking: true,
        fetchOnStart: false,
        pollOnStart: false,
      }),
    [],
  );

  useEffect(() => {
    prefetchNativeContext();
    void (async () => {
      if (!ANALYTICS_API_KEY) {
        setStatus(
          "missing EXPO_PUBLIC_AMPLITUDE_API_KEY in apps/example/.env.local",
        );
        return;
      }

      setStatus("initializing analytics");
      await init(ANALYTICS_API_KEY, userId, {
        instanceName: "example",
        trackingSessionEvents: true,
      }).promise;
      setDeviceId(String(getDeviceId() ?? "(none)"));
      setStatus("analytics ready");
      await experimentClient.start({ user_id: userId });
      setStatus("experiment ready");
    })().catch((error: unknown) => {
      setStatus(`init failed: ${String(error)}`);
    });

    return () => {
      experimentClient.stop();
    };
  }, [experimentClient, userId]);

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
            onPress={() => {
              track(eventName, { source: "example", platform: "native" });
              setAnalyticsResult(`Tracked ${eventName}`);
              setStatus(`tracked ${eventName}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="flush-events"
            title="Flush"
            variant="secondary"
            onPress={() => {
              void flush().promise.then(() => {
                setAnalyticsResult("Flush complete");
                setStatus("flush complete");
              });
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
            title="Fetch"
            onPress={() => {
              setStatus(`fetching ${flagKey}`);
              setExperimentResult(`Fetching ${flagKey}`);
              void experimentClient
                .fetchOrThrow(
                  { user_id: userId },
                  { flagKeys: flagKey ? [flagKey] : undefined },
                )
                .then(() => {
                  const resolved = experimentClient.variant(flagKey);
                  setFlagValue(JSON.stringify(resolved ?? {}, null, 2));
                  setStatus(
                    resolved?.value
                      ? `fetched ${flagKey}: ${String(resolved.value)}`
                      : `fetched ${flagKey}: no variant`,
                  );
                  setExperimentResult(
                    resolved?.value
                      ? `Fetched ${flagKey}: ${String(resolved.value)}`
                      : `Fetched ${flagKey}: no variant`,
                  );
                })
                .catch((error: unknown) => {
                  setExperimentResult(`Fetch failed: ${String(error)}`);
                  setStatus(`fetch failed: ${String(error)}`);
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="read-variant"
            title="Read Variant"
            variant="secondary"
            onPress={() => {
              const resolved = experimentClient.variant(flagKey);
              setFlagValue(JSON.stringify(resolved ?? {}, null, 2));
              setExperimentResult(
                resolved?.value
                  ? `Read ${flagKey}: ${String(resolved.value)}`
                  : `Read ${flagKey}: no variant`,
              );
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
      </Card>
    </Page>
  );
}
