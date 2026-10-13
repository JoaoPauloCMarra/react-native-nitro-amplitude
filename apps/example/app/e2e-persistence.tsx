import { useLocalSearchParams } from "expo-router";
import {
  NitroExperimentStorage,
  NitroMemoryStorage,
  createAmplitudeClient,
} from "react-native-nitro-amplitude";
import { ANALYTICS_API_KEY, delay } from "../components/fixture";
import {
  LabBlockedPage,
  LabCasesScreen,
  countFailedCases,
  useLabCases,
} from "../components/lab-runner";

const DURABLE_NAMESPACE = "e2e-durable-identity";
const STORAGE_NAMESPACE = "e2e-experiment-storage";
const STORAGE_KEY = "relaunch-marker";

type Phase = "write" | "read";

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
  const { cases, done } = useLabCases(
    dryRun && phase !== undefined && runId !== undefined,
    () =>
      phase === undefined || runId === undefined
        ? []
        : [
            ["durable-identity", () => runDurableIdentityCase(phase, runId)],
            [
              "experiment-storage",
              () => runExperimentStorageCase(phase, runId),
            ],
          ],
    `${phase ?? ""}:${runId ?? ""}`,
  );

  if (!dryRun) {
    return <LabBlockedPage prefix="persistence" title="Persistence lab" />;
  }

  const summary =
    phase && runId
      ? done
        ? `persistence-${phase}-done:fail=${countFailedCases(cases)};`
        : "running"
      : "blocked:phase-and-run-id-required";

  return (
    <LabCasesScreen
      prefix="persistence"
      title="Persistence lab"
      cardTitle="Relaunch persistence"
      cardSubtitle="Native durable and memory storage"
      cases={cases}
      summary={summary}
    />
  );
}
