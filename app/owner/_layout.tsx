import { Stack, useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { OwnerAccessGate } from "@/components/owner/OwnerAccessGate";
import { loadOwnerSetupStatus } from "@/services/ownerSetup";
import { useAppStore } from "@/state/appStore";
import { logDevError } from "@/utils/errors";

export default function OwnerLayout() {
  const clearKioskSession = useAppStore((state) => state.clearKioskSession);
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      clearKioskSession();
      void loadOwnerSetupStatus()
        .then((status) => {
          if (active) {
            setOwnerContext(status.activeBusiness, status.activeBranch);
          }
        })
        .catch((error) => logDevError("OwnerLayout.loadContext", error));

      return () => {
        active = false;
      };
    }, [clearKioskSession, setOwnerContext]),
  );

  return (
    <OwnerAccessGate>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: "transparent" },
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Owner" }} />
        <Stack.Screen name="ask" options={{ title: "Local Helper" }} />
        <Stack.Screen name="records" options={{ title: "Logbook" }} />
        <Stack.Screen name="inventory" options={{ title: "Paninda" }} />
        <Stack.Screen name="grocery" options={{ title: "Grocery Stock" }} />
        <Stack.Screen name="recipes" options={{ title: "Recipe Cost" }} />
        <Stack.Screen name="recipe-detail" options={{ title: "Recipe Detail" }} />
        <Stack.Screen name="production" options={{ title: "Niluto" }} />
        <Stack.Screen name="transfers" options={{ title: "Lipat" }} />
        <Stack.Screen name="fixed-costs" options={{ title: "Bayarin" }} />
        <Stack.Screen name="reports" options={{ title: "Kita Report" }} />
        <Stack.Screen name="pilot-guide" options={{ title: "Pilot Guide" }} />
        <Stack.Screen name="insights" options={{ title: "Insights" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="context" options={{ title: "Business & Stall Context" }} />
        <Stack.Screen name="business-settings" options={{ title: "Business & Stalls" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="about" options={{ title: "About KitaMo" }} />
        <Stack.Screen name="report-problem" options={{ title: "Report Problem" }} />
        <Stack.Screen name="problem-reports" options={{ title: "My Problem Reports" }} />
      </Stack>
    </OwnerAccessGate>
  );
}
