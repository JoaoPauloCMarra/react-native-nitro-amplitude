import { Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { AmplitudeE2eLab } from "../components/e2e-lab";
import { Colors, Page, StatusRow } from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";

function LabLink({
  href,
  testID,
  label,
}: {
  href: Href;
  testID: string;
  label: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={{ paddingVertical: 8 }}
      >
        <Text style={{ color: Colors.primary, fontWeight: "600" }}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

export default function AmplitudeE2eScreen() {
  if (process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN !== "1") {
    return (
      <Page title="E2E lab" subtitle="Start the example in fixture mode">
        <StatusRow
          testID="e2e-blocked"
          label="state"
          value="blocked: fixture mode required"
        />
      </Page>
    );
  }
  return (
    <View testID="e2e-screen" style={{ flex: 1 }} accessibilityLabel="E2E lab">
      <Page title="E2E lab" subtitle="Deep link nitroamplitude://e2e">
        <StatusRow testID="runtime-mode" label="Mode" value="dry-run fixture" />
        <StatusRow testID="e2e-ready" label="state" value="e2e-ready" />
        <StatusRow
          testID="e2e-deeplink"
          label="link"
          value="nitroamplitude://e2e"
        />
        <LabLink
          href="/e2e-identity"
          testID="open-e2e-identity"
          label="Identity lab"
        />
        <AmplitudeE2eLab />
        <SmokeTestRunner />
      </Page>
    </View>
  );
}
