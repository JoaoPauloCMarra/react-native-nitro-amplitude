import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="e2e" />
        <Stack.Screen name="e2e-identity" />
        <Stack.Screen name="e2e-network" />
        <Stack.Screen name="e2e-analytics" />
        <Stack.Screen name="e2e-persistence" />
        <Stack.Screen name="e2e-background" />
      </Stack>
    </>
  );
}
