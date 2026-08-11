import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type GuidedProgressHeaderProps = {
  step: number;
  total: number;
  label: string;
  personName?: string | null;
  onBack?: () => void;
  backAccessibilityLabel?: string;
  finalStep?: boolean;
};

export function GuidedProgressHeader({
  step,
  total,
  label,
  personName,
  onBack,
  backAccessibilityLabel = "Bumalik",
  finalStep = false,
}: GuidedProgressHeaderProps) {
  const { palette } = useGabiTheme();
  const safeTotal = Math.max(1, total);
  const safeStep = Math.min(Math.max(1, step), safeTotal);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            accessibilityLabel={backAccessibilityLabel}
            accessibilityRole="button"
            hitSlop={4}
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: pressed ? palette.softPrimary : palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <Ionicons color={palette.primary} name="arrow-back" size={21} />
          </Pressable>
        ) : null}

        <View style={styles.titleCopy}>
          <GabiText variant="h1">Hakbang {safeStep} ng {safeTotal}</GabiText>
          <GabiText numberOfLines={1} tone="faint" variant="eyebrow">{label}</GabiText>
        </View>

        {finalStep ? (
          <GabiChip label="huling hakbang" tone="primary" />
        ) : personName?.trim() ? (
          <GabiChip label={personName.trim()} tone="neutral" />
        ) : null}
      </View>

      <View
        accessibilityLabel={`Hakbang ${safeStep} ng ${safeTotal}: ${label}`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: safeTotal, now: safeStep, text: label }}
        style={styles.segments}
      >
        {Array.from({ length: safeTotal }, (_, index) => (
          <View
            key={index}
            style={[
              styles.segment,
              { backgroundColor: index < safeStep ? palette.primary : palette.border },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
  },
  backButton: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  titleCopy: {
    flex: 1,
    gap: 2,
  },
  segments: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    borderRadius: 3,
    flex: 1,
    height: 5,
  },
});
