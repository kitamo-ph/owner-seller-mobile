import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import type { GuidedSetupRole } from "@/domain/onboarding";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type RoleChoiceCardProps = {
  role: GuidedSetupRole;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
};

const roleCopy: Record<GuidedSetupRole, { title: string; description: string; icon: keyof typeof Ionicons.glyphMap }> = {
  owner: {
    title: "Owner — ako ang may negosyo",
    description: "I-set up ang negosyo, stall, paninda, at reports.",
    icon: "storefront-outline",
  },
  seller: {
    title: "Seller / Empleyado",
    description: "Ikonekta ang stall kapag may code na mula sa owner.",
    icon: "people-outline",
  },
};

export function RoleChoiceCard({ role, selected, onPress, disabled = false }: RoleChoiceCardProps) {
  const { palette, extended, isDark } = useGabiTheme();
  const copy = roleCopy[role];

  return (
    <Pressable
      accessibilityLabel={copy.title}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: disabled
            ? extended.disabledBg
            : selected || pressed
              ? palette.softPrimary
              : palette.surface,
          borderColor: disabled
            ? extended.disabledBg
            : selected
              ? palette.primary
              : palette.border,
        },
        selected && !disabled && !isDark ? shadows.raised : null,
      ]}
    >
      <View
        style={[
          styles.iconTile,
          { backgroundColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.softPrimary },
        ]}
      >
        <Ionicons
          color={disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.primary}
          name={copy.icon}
          size={25}
        />
      </View>

      <View style={styles.copy}>
        <GabiText style={disabled ? { color: extended.disabledText } : undefined} variant="cardTitle">
          {copy.title}
        </GabiText>
        <GabiText style={disabled ? { color: extended.disabledText } : undefined} tone="muted" variant="caption">
          {copy.description}
        </GabiText>
      </View>

      <View
        style={[
          styles.radio,
          { borderColor: disabled ? extended.disabledText : selected ? palette.primary : extended.radioOff },
        ]}
      >
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 84,
    padding: spacing.md,
  },
  iconTile: {
    alignItems: "center",
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  radio: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
});
