import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GabiText } from "./GabiText";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type GabiButtonProps = {
  label: string;
  onPress: () => void;
  icon?: IoniconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  compact?: boolean;
};

export function GabiPrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
  compact = false,
}: GabiButtonProps) {
  const { palette, extended, gradients, isDark } = useGabiTheme();
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      testID={testID}
    >
      {({ pressed }) => (
        // Keep Expo's native gradient host stable when loading children change under Fabric.
        <LinearGradient
          collapsable={false}
          colors={
            unavailable
              ? ([extended.disabledBg, extended.disabledBg] as const)
              : pressed
                ? ([extended.primaryPressed, extended.primaryPressed] as const)
                : gradients.primaryButton
          }
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.primary, compact ? styles.compact : null, !unavailable && !isDark ? shadows.primaryGlow : null]}
        >
          {loading ? (
            <ActivityIndicator color={unavailable ? extended.disabledText : palette.kioskHeaderText} size="small" />
          ) : icon ? (
            <Ionicons color={unavailable ? extended.disabledText : palette.kioskHeaderText} name={icon} size={compact ? 17 : 20} />
          ) : null}
          <GabiText style={{ color: unavailable ? extended.disabledText : palette.kioskHeaderText }} variant={compact ? "buttonSm" : "buttonLg"}>
            {label}
          </GabiText>
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function GabiSoftButton({ label, onPress, icon, disabled = false, loading = false, accessibilityHint, testID, compact = false }: GabiButtonProps) {
  const { palette, extended } = useGabiTheme();
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.soft,
        compact ? styles.compact : null,
        {
          backgroundColor: unavailable ? extended.disabledBg : pressed ? extended.violetChipBg : palette.softPrimary,
          borderColor: unavailable ? extended.disabledBg : palette.border,
        },
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={extended.disabledText} size="small" />
      ) : icon ? (
        <Ionicons color={unavailable ? extended.disabledText : extended.violetChipText} name={icon} size={compact ? 17 : 19} />
      ) : null}
      <GabiText style={{ color: unavailable ? extended.disabledText : extended.violetChipText }} variant="buttonSm">
        {label}
      </GabiText>
    </Pressable>
  );
}

export function GabiButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  primary: {
    alignItems: "center",
    borderRadius: gabiComponents.buttonPrimary.radius,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: gabiComponents.buttonPrimary.minHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  soft: {
    alignItems: "center",
    borderRadius: gabiComponents.buttonSoft.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: gabiComponents.buttonSoft.minHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  compact: {
    borderRadius: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
