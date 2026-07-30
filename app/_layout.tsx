import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AppShell } from "@/components/common/AppShell";
import { ProblemReportBreadcrumbTracker } from "@/components/common/ProblemReportBreadcrumbTracker";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes } from "@/theme/colors";

export default function RootLayout() {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];

  return (
    <AppShell>
      <ProblemReportBreadcrumbTracker />
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} backgroundColor={palette.background} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: "transparent" },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: false }} />
        <Stack.Screen name="owner" options={{ headerShown: false }} />
        <Stack.Screen name="kiosk" options={{ headerShown: false }} />
      </Stack>
    </AppShell>
  );
}
