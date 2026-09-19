import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  Identify,
  createAmplitudeClient,
  createInstance,
  getConnectorIdentity,
} from "react-native-nitro-amplitude";
import { DryRunTransport } from "react-native-nitro-amplitude/network";
import { Card, Page, StatusRow } from "../components/shared";

const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
const EXPERIMENT_API_KEY = "nitro-amplitude-dry-run-experiment-key";

type CaseStatus = "pass" | "fail" | "skip";
type LabCase = {
  name: string;
  status: CaseStatus;
  detail?: string;
};

type IdentityReport = {
  fail: number;
  pass: number;
  skip: number;
  cases: LabCase[];
};

declare global {
  var __identityReport: IdentityReport | undefined;
}

function runCase(
  name: string,
  fn: () => string | void | Promise<string | void>,
): Promise<LabCase> {
  return Promise.resolve()
    .then(fn)
    .then((detail) => ({
      name,
      status: "pass" as const,
      detail: detail ?? "ok",
    }))
    .catch((error: unknown) => ({
      name,
      status: "fail" as const,
      detail: error instanceof Error ? error.message : String(error),
    }));
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runIdentitySweep(): Promise<IdentityReport> {
  const cases: LabCase[] = [];

  cases.push(
    await runCase("instance-set-reset", async () => {
      const instance = createInstance();
      await instance.init(ANALYTICS_API_KEY, "identity-user", {
        instanceName: "e2e-identity-instance",
        trackingSessionEvents: false,
        transportProvider: new DryRunTransport(),
      }).promise;
      instance.setUserId("identity-user-2");
      assert(
        instance.getUserId() === "identity-user-2",
        `setUserId=${String(instance.getUserId())}`,
      );
      instance.identify(new Identify().set("lab", "identity"));
      instance.reset();
      assert(
        instance.getUserId() === undefined,
        `reset user=${String(instance.getUserId())}`,
      );
      return "set+identify+reset";
    }),
  );

  cases.push(
    await runCase("combined-reset", async () => {
      const client = createAmplitudeClient({
        analyticsApiKey: ANALYTICS_API_KEY,
        experimentDeploymentKey: EXPERIMENT_API_KEY,
        userId: "identity-combined",
        dryRun: true,
        instanceName: "e2e-identity-combined",
        durableStorage: false,
      });
      await client.init({ user_id: "identity-combined" });
      assert(
        client.getUserId() === "identity-combined",
        `init user=${String(client.getUserId())}`,
      );
      const connector = getConnectorIdentity("e2e-identity-combined");
      assert(
        connector.userId === "identity-combined",
        `connector=${String(connector.userId)}`,
      );
      client.reset();
      assert(
        client.getUserId() === undefined,
        `reset user=${String(client.getUserId())}`,
      );
      return "init+connector+reset";
    }),
  );

  const report: IdentityReport = {
    fail: cases.filter((item) => item.status === "fail").length,
    pass: cases.filter((item) => item.status === "pass").length,
    skip: cases.filter((item) => item.status === "skip").length,
    cases,
  };
  globalThis.__identityReport = report;
  return report;
}

export default function AmplitudeIdentityLabScreen() {
  const [report, setReport] = useState<IdentityReport | null>(null);
  const dryRun = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";

  useEffect(() => {
    if (!dryRun) {
      return;
    }
    let cancelled = false;
    void runIdentitySweep().then((next) => {
      if (!cancelled) {
        setReport(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dryRun]);

  if (!dryRun) {
    return (
      <Page title="Identity lab" subtitle="Start the example in fixture mode">
        <StatusRow
          testID="e2e-identity-blocked"
          label="state"
          value="blocked: fixture mode required"
        />
      </Page>
    );
  }

  const summary = report
    ? `fail=${report.fail} pass=${report.pass} skip=${report.skip}`
    : "running";

  return (
    <View
      testID="e2e-identity-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Identity lab"
    >
      <Page
        title="Identity lab"
        subtitle="Deep link nitroamplitude://e2e-identity"
      >
        <StatusRow testID="e2e-identity-ready" label="state" value="ready" />
        <StatusRow
          testID="e2e-identity-mode"
          label="mode"
          value="dry-run fixture"
        />
        <StatusRow
          testID="e2e-identity-summary"
          label="summary"
          value={summary}
        />
        <Card
          title="Reset / identify"
          subtitle="Local dry-run only; no Amplitude keys"
        >
          {(report?.cases ?? []).map((item) => (
            <StatusRow
              key={item.name}
              testID={`e2e-identity-${item.name}`}
              label={item.name}
              value={`${item.status}:${item.detail ?? ""}`}
            />
          ))}
        </Card>
      </Page>
    </View>
  );
}
