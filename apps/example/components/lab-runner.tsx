import { useEffect, useEffectEvent, useState } from "react";
import { View } from "react-native";
import { Card, Page, ResultsProbe, StatusRow } from "./shared";

export type LabCaseResult = {
  name: string;
  status: string;
};

export type LabStep = [name: string, run: () => Promise<string>];

async function runLabCase(
  name: string,
  run: () => Promise<string>,
): Promise<LabCaseResult> {
  try {
    return { name, status: await run() };
  } catch (error) {
    return {
      name,
      status: `fail:${name}=${error instanceof Error ? error.message.slice(0, 40) : "error"}`,
    };
  }
}

export function useLabCases(
  enabled: boolean,
  createSteps: () => LabStep[],
  runKey: string,
) {
  const [cases, setCases] = useState<LabCaseResult[]>([]);
  const [done, setDone] = useState(false);
  const readSteps = useEffectEvent(createSteps);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const [name, run] of readSteps()) {
        const result = await runLabCase(name, run);
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
  }, [enabled, runKey]);

  return { cases, done };
}

export function countFailedCases(cases: LabCaseResult[]): number {
  return cases.filter((item) => !item.status.startsWith("ok:")).length;
}

export function LabBlockedPage({
  prefix,
  title,
}: {
  prefix: string;
  title: string;
}) {
  return (
    <Page title={title} subtitle="Start the example in fixture mode">
      <StatusRow
        testID={`e2e-${prefix}-blocked`}
        label="state"
        value="blocked: fixture mode required"
      />
    </Page>
  );
}

export function LabCasesScreen({
  prefix,
  title,
  cardTitle,
  cardSubtitle,
  cases,
  summary,
}: {
  prefix: string;
  title: string;
  cardTitle: string;
  cardSubtitle: string;
  cases: LabCaseResult[];
  summary: string;
}) {
  return (
    <View
      testID={`e2e-${prefix}-screen`}
      style={{ flex: 1 }}
      accessibilityLabel={title}
    >
      <Page title={title} subtitle={`Deep link nitroamplitude://e2e-${prefix}`}>
        <StatusRow
          testID={`e2e-${prefix}-mode`}
          label="mode"
          value="dry-run fixture"
        />
        <ResultsProbe
          testID={`e2e-${prefix}-results`}
          label={[...cases.map((item) => item.status), summary].join(" ")}
        />
        <StatusRow
          testID={`e2e-${prefix}-summary`}
          label="summary"
          value={summary}
        />
        <Card title={cardTitle} subtitle={cardSubtitle}>
          {cases.map((item) => (
            <StatusRow
              key={item.name}
              testID={`e2e-${prefix}-${item.name}`}
              label={item.name}
              value={item.status}
            />
          ))}
        </Card>
      </Page>
    </View>
  );
}
