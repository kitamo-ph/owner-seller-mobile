import Ionicons from "@expo/vector-icons/Ionicons";
import { type Href, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { useAppStore } from "@/state/appStore";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export const OWNER_CONTEXT_BAR_HEIGHT = 46;

export function OwnerContextBar({ mode }: { mode: "owner" | "kiosk" }) {
  const activeBusinessName = useAppStore((state) => state.activeBusinessName);
  const activeBranchName = useAppStore((state) => state.activeBranchName);
  const kioskSessionBranchId = useAppStore((state) => state.kioskSessionBranchId);
  const { palette, extended, isDark } = useGabiTheme();
  const router = useRouter();
  const kioskConfirmed = mode === "kiosk" && Boolean(kioskSessionBranchId && activeBranchName);
  const primaryLabel = activeBusinessName ?? "Choose a business";
  const secondaryLabel =
    mode === "kiosk"
      ? kioskConfirmed
        ? activeBranchName
        : "Pumili at kumpirmahin ang stall"
      : activeBranchName
        ? `Aktibong stall: ${activeBranchName}`
        : "Walang aktibong stall";

  function openContextPicker() {
    if (mode === "kiosk") {
      router.replace("/kiosk");
      return;
    }

    router.push("/owner/context" as Href);
  }

  if (mode === "kiosk") {
    return (
      <Pressable
        accessibilityHint="Bumalik sa Kiosk stall picker"
        accessibilityLabel={`${primaryLabel}. ${secondaryLabel}`}
        accessibilityRole="button"
        onPress={openContextPicker}
        style={({ pressed }) => [styles.kioskContainer, { backgroundColor: palette.kioskHeader }, pressed ? styles.pressed : null]}
      >
        <Ionicons color={palette.accent} name="storefront" size={18} />
        <View style={styles.copy}>
          <GabiText numberOfLines={1} style={{ color: extended.textOnPrimaryMuted }} variant="eyebrow">
            KIOSK · {primaryLabel}
          </GabiText>
          <GabiText numberOfLines={1} tone="inverse" variant="buttonSm">
            {secondaryLabel}
          </GabiText>
        </View>
        <View style={[styles.kioskAction, { borderColor: palette.accent }]}>
          <GabiText tone="accent" variant="caption">Palitan</GabiText>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityHint="Buksan ang business at stall switcher"
      accessibilityLabel={`${primaryLabel}. ${secondaryLabel}`}
      accessibilityRole="button"
      onPress={openContextPicker}
      style={({ pressed }) => [
        styles.ownerContainer,
        {
          backgroundColor: pressed ? palette.softPrimary : palette.surface,
          borderColor: palette.border,
        },
        isDark ? null : shadows.card,
      ]}
    >
      <View style={[styles.ownerIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name="storefront-outline" size={18} />
      </View>
      <View style={styles.copy}>
        <GabiText maxFontSizeMultiplier={1.2} numberOfLines={1} variant="buttonSm">
          {primaryLabel}
        </GabiText>
        <GabiText maxFontSizeMultiplier={1.2} numberOfLines={1} tone="faint" variant="caption">
          {secondaryLabel}
        </GabiText>
      </View>
      <GabiText maxFontSizeMultiplier={1.2} tone="primary" variant="caption">Palitan</GabiText>
      <Ionicons color={palette.primary} name="chevron-forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ownerContainer: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: OWNER_CONTEXT_BAR_HEIGHT,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  ownerIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  kioskContainer: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: -spacing.md,
    minHeight: OWNER_CONTEXT_BAR_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  kioskAction: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  pressed: {
    opacity: 0.84,
  },
});
