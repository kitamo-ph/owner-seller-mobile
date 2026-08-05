import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiText } from "@/components/gabi/GabiText";
import {
  detailedRecipeUnitLabel,
  partitionRecipeUnitOptions,
  shortRecipeUnitLabel,
} from "@/domain/recipeUnitPicker";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

type RecipeUnitSelectorProps<T extends string> = {
  label: string;
  options: readonly T[];
  selected: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  help?: string;
};

function unitKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[ -]+/g, "_");
}

export function RecipeUnitSelector<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  help,
}: RecipeUnitSelectorProps<T>) {
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const partition = useMemo(
    () => partitionRecipeUnitOptions(options),
    [options],
  );
  const selectedIsMore = partition.moreFlat.some(
    (unit) => unitKey(unit) === unitKey(selected),
  );

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      {help ? (
        <GabiText tone="muted" variant="caption">
          {help}
        </GabiText>
      ) : null}
      <View style={styles.chipRow}>
        {partition.common.map((unit) => {
          const isSelected = unitKey(unit) === unitKey(selected);
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              key={unit}
              onPress={() => onChange(unit as T)}
              style={[
                styles.chip,
                {
                  backgroundColor: disabled
                    ? extended.disabledBg
                    : isSelected
                      ? palette.softPrimary
                      : palette.surface,
                  borderColor: disabled
                    ? extended.disabledBg
                    : isSelected
                      ? palette.primary
                      : palette.border,
                },
              ]}
            >
              <GabiText
                style={{
                  color: disabled
                    ? extended.disabledText
                    : isSelected
                      ? palette.primary
                      : palette.text,
                }}
                variant="buttonSm"
              >
                {shortRecipeUnitLabel(unit)}
              </GabiText>
            </Pressable>
          );
        })}
        {partition.moreFlat.length > 0 ? (
          <Pressable
            accessibilityLabel="Iba pa na unit"
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => setMoreOpen(true)}
            style={[
              styles.chip,
              styles.moreChip,
              {
                backgroundColor: disabled
                  ? extended.disabledBg
                  : selectedIsMore
                    ? palette.softPrimary
                    : palette.surface,
                borderColor: disabled
                  ? extended.disabledBg
                  : selectedIsMore
                    ? palette.primary
                    : palette.border,
              },
            ]}
          >
            <GabiText
              style={{
                color: disabled
                  ? extended.disabledText
                  : selectedIsMore
                    ? palette.primary
                    : palette.text,
              }}
              variant="buttonSm"
            >
              {selectedIsMore
                ? shortRecipeUnitLabel(selected)
                : "Iba pa"}
            </GabiText>
            <Ionicons
              color={
                disabled
                  ? extended.disabledText
                  : selectedIsMore
                    ? palette.primary
                    : palette.mutedText
              }
              name="chevron-down"
              size={16}
            />
          </Pressable>
        ) : null}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setMoreOpen(false)}
        transparent
        visible={moreOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Isara ang iba pang units"
            onPress={() => setMoreOpen(false)}
            style={[styles.scrim, { backgroundColor: extended.scrim }]}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            <View
              style={[styles.handle, { backgroundColor: palette.border }]}
            />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitle}>
                <GabiText tone="primary" variant="eyebrow">
                  Unit
                </GabiText>
                <GabiText variant="h2">Iba pa</GabiText>
              </View>
              <GabiSoftButton
                compact
                icon="close"
                label="Isara"
                onPress={() => setMoreOpen(false)}
              />
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
            >
              {partition.more.map((group) => (
                <View key={group.key} style={styles.group}>
                  <GabiText tone="muted" variant="caption">
                    {group.header}
                  </GabiText>
                  {group.units.map((unit) => {
                    const isSelected = unitKey(unit) === unitKey(selected);
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isSelected }}
                        key={unit}
                        onPress={() => {
                          onChange(unit as T);
                          setMoreOpen(false);
                        }}
                        style={[
                          styles.moreRow,
                          {
                            backgroundColor: isSelected
                              ? palette.softPrimary
                              : palette.background,
                            borderColor: isSelected
                              ? palette.primary
                              : palette.border,
                          },
                        ]}
                      >
                        <View style={styles.moreRowCopy}>
                          <GabiText variant="buttonSm">
                            {shortRecipeUnitLabel(unit)}
                          </GabiText>
                          <GabiText tone="muted" variant="caption">
                            {detailedRecipeUnitLabel(unit)}
                          </GabiText>
                        </View>
                        <Ionicons
                          color={
                            isSelected ? palette.primary : extended.radioOff
                          }
                          name={
                            isSelected
                              ? "radio-button-on"
                              : "radio-button-off-outline"
                          }
                          size={22}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: gabiComponents.hitTarget,
    paddingHorizontal: spacing.md,
  },
  moreChip: {
    flexDirection: "row",
    gap: 4,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    maxHeight: "72%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.sm,
    width: 44,
  },
  sheetHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    flex: 1,
    gap: 2,
  },
  sheetBody: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  group: {
    gap: spacing.xs,
  },
  moreRow: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: gabiComponents.hitTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  moreRowCopy: {
    flex: 1,
    gap: 2,
  },
});
