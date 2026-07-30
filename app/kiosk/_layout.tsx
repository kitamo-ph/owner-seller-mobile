import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiPrimaryButton } from "@/components/gabi/GabiButton";
import { GabiText } from "@/components/gabi/GabiText";
import { useOwnerAccessStore } from "@/state/ownerAccessStore";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export default function KioskLayout() {
  const lockOwnerAccess = useOwnerAccessStore((state) => state.lock);
  const activeBusinessId = useAppStore((state) => state.activeBusinessId);
  const activeBranchId = useAppStore((state) => state.activeBranchId);
  const kioskSessionBranchId = useAppStore((state) => state.kioskSessionBranchId);
  const pathname = usePathname();

  useEffect(() => {
    lockOwnerAccess();
  }, [lockOwnerAccess]);

  if (
    pathname !== "/kiosk" &&
    (!activeBusinessId || !activeBranchId || !kioskSessionBranchId || activeBranchId !== kioskSessionBranchId)
  ) {
    return <ExpiredKioskSession />;
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: "transparent" },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Kiosk" }} />
      <Stack.Screen name="sell" options={{ title: "Sell" }} />
      <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
      <Stack.Screen name="orders" options={{ title: "Orders" }} />
      <Stack.Screen name="stock" options={{ title: "Stock" }} />
      <Stack.Screen name="shift" options={{ title: "Shift" }} />
      <Stack.Screen name="help" options={{ title: "Help & Reports" }} />
      <Stack.Screen name="report-problem" options={{ title: "Report Problem" }} />
      <Stack.Screen name="problem-reports" options={{ title: "My Problem Reports" }} />
    </Stack>
  );
}

function ExpiredKioskSession() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useGabiTheme();

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/kiosk"), 1100);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.expiredScreen,
        {
          backgroundColor: palette.background,
          paddingBottom: insets.bottom + spacing.lg,
          paddingTop: insets.top + spacing.lg,
        },
      ]}
    >
      <View style={[styles.expiredIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name="lock-closed" size={30} />
      </View>
      <View style={styles.expiredCopy}>
        <GabiText variant="h1">Natapos ang Kiosk session</GabiText>
        <GabiText tone="muted" variant="body">
          Nagbago ang stall context. Pumili at kumpirmahin ulit ang stall.
        </GabiText>
      </View>
      <GabiPrimaryButton icon="storefront-outline" label="Pumili ng stall" onPress={() => router.replace("/kiosk")} />
    </View>
  );
}

const styles = StyleSheet.create({
  expiredScreen: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  expiredIcon: {
    alignItems: "center",
    borderRadius: 22,
    height: 68,
    justifyContent: "center",
    width: 68,
  },
  expiredCopy: {
    gap: spacing.sm,
  },
});
