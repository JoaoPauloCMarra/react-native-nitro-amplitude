import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  NitroExperimentStorage,
  NitroMemoryStorage,
  createAmplitudeClient,
} from "react-native-nitro-amplitude";
import { Card, Page, StatusRow } from "../components/shared";

const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
const DURABLE_NAMESPACE = "e2e-durable-identity";
const STORAGE_NAMESPACE = "e2e-experiment-storage";
const STORAGE_KEY = "relaunch-marker";

type Phase = "write" | "read";

type PersistenceCase = {
  name: string;
  status: string;
};

function delay(millis: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, millis));
}

function createDurableClient() {
  return createAmplitudeClient({
    analyticsApiKey: ANALYTICS_API_KEY,
    instanceName: "e2e-durable-identity",
    durableStorage: { namespace: DURABLE_NAMESPACE, dryRun: true },
    analytics: { trackingSessionEvents: false, flushIntervalMillis: 60000 },
  });
}

async function runDurableIdentityCase(
  phase: Phase,
  runId: string,
): Promise<string> {
  const expectedDeviceId = `e2e-durable-${runId}`;
  const client = createDurableClient();
  try {
    await client.init();
    if (phase === "write") {
      client.analytics.setDeviceId(expectedDeviceId);
      await client.analytics.flushWithResult();
      await delay(300);
      return client.getDeviceId() === expectedDeviceId
        ? "ok:durable-identity=written"
        : "fail:durable-identity=write";
    }
    return client.getDeviceId() === expectedDeviceId
      ? "ok:durable-identity=restored"
      : "fail:durable-identity=missing-or-stale";
  } finally {
    client.analytics.shutdown();
  }
}

async function runExperimentStorageCase(
  phase: Phase,
  runId: string,
): Promise<string> {
  const disk = new NitroExperimentStorage(STORAGE_NAMESPACE);
  const memory = new NitroMemoryStorage(STORAGE_NAMESPACE);
  if (phase === "write") {
    await disk.put(STORAGE_KEY, runId);
    await memory.put(STORAGE_KEY, runId);
    await delay(300);
    return (await disk.get(STORAGE_KEY)) === runId &&
      (await memory.get(STORAGE_KEY)) === runId
      ? "ok:exp-storage=written"
      : "fail:exp-storage=write";
  }
  const diskValue = await disk.get(STORAGE_KEY);
  const memoryValue = await memory.get(STORAGE_KEY);
  return diskValue === runId && memoryValue === null
    ? "ok:exp-storage=disk-kept:memory-cleared"
    : `fail:exp-storage=disk=${diskValue === runId}:memory=${String(memoryValue === null)}`;
}

async function runCase(
  name: string,
  run: () => Promise<string>,
): Promise<PersistenceCase> {
  try {
    return { name, status: await run() };
  } catch (error) {
    return {
      name,
      status: `fail:${name}=${error instanceof Error ? error.message.slice(0, 40) : "error"}`,
    };
  }
}

export default function AmplitudePersistenceLabScreen() {
  const searchParams = useLocalSearchParams<{
    phase?: string;
    runId?: string;
  }>();
  const phase: Phase | undefined =
    searchParams.phase === "write" || searchParams.phase === "read"
      ? searchParams.phase
      : undefined;
  const runId =
    typeof searchParams.runId === "string" && searchParams.runId.length > 0
      ? searchParams.runId
      : undefined;
  const dryRun = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
  const [cases, setCases] = useState<PersistenceCase[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!dryRun || !phase || !runId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const steps: [string, () => Promise<string>][] = [
        ["durable-identity", () => runDurableIdentityCase(phase, runId)],
        ["experiment-storage", () => runExperimentStorageCase(phase, runId)],
      ];
      for (const [name, run] of steps) {
        const result = await runCase(name, run);
        if (cancelled) {
          return;
        }
        setCases((previous) => [...previous, result]);
      }
      if (!cancelled) {
        setDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dryRun, phase, runId]);

  if (!dryRun) {
    return (
      <Page
        title="Persistence lab"
        subtitle="Start the example in fixture mode"
      >
        <StatusRow
          testID="e2e-persistence-blocked"
          label="state"
          value="blocked: fixture mode required"
        />
      </Page>
    );
  }

  const failed = cases.filter((item) => !item.status.startsWith("ok:")).length;
  const summary =
    phase && runId
      ? done
        ? `persistence-${phase}-done:fail=${failed};`
        : "running"
      : "blocked:phase-and-run-id-required";

  return (
    <View
      testID="e2e-persistence-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Persistence lab"
    >
      <Page
        title="Persistence lab"
        subtitle="Deep link nitroamplitude://e2e-persistence"
      >
        <StatusRow
          testID="e2e-persistence-mode"
          label="mode"
          value="dry-run fixture"
        />
        <View
          testID="e2e-persistence-results"
          accessible
          accessibilityLabel={[
            ...cases.map((item) => item.status),
            summary,
          ].join(" ")}
          style={localStyles.resultsProbe}
        />
        <StatusRow
          testID="e2e-persistence-summary"
          label="summary"
          value={summary}
        />
        <Card
          title="Relaunch persistence"
          subtitle="Native durable and memory storage"
        >
          {cases.map((item) => (
            <StatusRow
              key={item.name}
              testID={`e2e-persistence-${item.name}`}
              label={item.name}
              value={item.status}
            />
          ))}
        </Card>
      </Page>
    </View>
  );
}

const localStyles = StyleSheet.create({
  resultsProbe: {
    height: 1,
  },
});
