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

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiText } from "@/components/gabi/GabiText";
import {
  classifyRecipeUnitCompatibility,
  detailedRecipeUnitLabel,
  ghostedUnitGuidance,
  partitionRecipeUnitOptions,
  shortRecipeUnitLabel,
  type GhostedUnitGuidance,
} from "@/domain/recipeUnitPicker";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type RecipeUnitGhostSelection<T extends string> = {
  unit: T;
  oppositeUnit: string;
  guidance: GhostedUnitGuidance;
};

type RecipeUnitSelectorProps<T extends string> = {
  label: string;
  options: readonly T[];
  selected: T;
  onChange: (value: T) => void;
  /** When set, units without a standard factor against this side are ghosted. */
  oppositeUnit?: string | null;
  /** Called when a ghosted unit is confirmed through the explanation sheet. */
  onGhostedSelect?: (selection: RecipeUnitGhostSelection<T>) => void;
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
  oppositeUnit = null,
  onGhostedSelect,
  disabled = false,
  help,
}: RecipeUnitSelectorProps<T>) {
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const [ghostPending, setGhostPending] = useState<{
    unit: T;
    guidance: GhostedUnitGuidance;
  } | null>(null);
  const partition = useMemo(
    () => partitionRecipeUnitOptions(options),
    [options],
  );
  const selectedIsMore = partition.moreFlat.some(
    (unit) => unitKey(unit) === unitKey(selected),
  );

  function chooseUnit(unit: T) {
    if (disabled) return;
    const compatibility = classifyRecipeUnitCompatibility(unit, oppositeUnit);
    if (compatibility === "ghosted" && oppositeUnit?.trim()) {
      const guidance = ghostedUnitGuidance(oppositeUnit, unit);
      setGhostPending({ unit, guidance });
      return;
    }
    onChange(unit);
  }

  function confirmGhosted() {
    if (!ghostPending || !oppositeUnit?.trim()) return;
    const { unit, guidance } = ghostPending;
    onChange(unit);
    onGhostedSelect?.({ unit, oppositeUnit, guidance });
    setGhostPending(null);
    setMoreOpen(false);
  }

  function renderChip(unit: string) {
    const typed = unit as T;
    const isSelected = unitKey(unit) === unitKey(selected);
    const compatibility = classifyRecipeUnitCompatibility(unit, oppositeUnit);
    const ghosted = compatibility === "ghosted";
    const guidance =
      ghosted && oppositeUnit?.trim()
        ? ghostedUnitGuidance(oppositeUnit, unit)
        : null;

    return (
      <Pressable
        accessibilityHint={guidance?.message}
        accessibilityLabel={shortRecipeUnitLabel(unit)}
        accessibilityRole="button"
        accessibilityState={{
          checked: isSelected,
          disabled: false,
        }}
        key={unit}
        onPress={() => chooseUnit(typed)}
        style={[
          styles.chip,
          {
            backgroundColor: disabled
              ? extended.disabledBg
              : ghosted
                ? extended.disabledBg
                : isSelected
                  ? palette.softPrimary
                  : palette.surface,
            borderColor: disabled
              ? extended.disabledBg
              : ghosted
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
              : ghosted
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
  }

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      {help ? (
        <GabiText tone="muted" variant="caption">
          {help}
        </GabiText>
      ) : null}
      <View style={styles.chipRow}>
        {partition.common.map((unit) => renderChip(unit))}
        {partition.moreFlat.length > 0 ? (
          <Pressable
            accessibilityLabel="Iba pa na unit"
            accessibilityRole="button"
            accessibilityState={{ disabled: false }}
            onPress={() => {
              if (!disabled) setMoreOpen(true);
            }}
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
                    const typed = unit as T;
                    const isSelected = unitKey(unit) === unitKey(selected);
                    const ghosted =
                      classifyRecipeUnitCompatibility(unit, oppositeUnit) ===
                      "ghosted";
                    const guidance =
                      ghosted && oppositeUnit?.trim()
                        ? ghostedUnitGuidance(oppositeUnit, unit)
                        : null;
                    return (
                      <Pressable
                        accessibilityHint={guidance?.message}
                        accessibilityLabel={detailedRecipeUnitLabel(unit)}
                        accessibilityRole="button"
                        accessibilityState={{
                          checked: isSelected,
                          disabled: false,
                        }}
                        key={unit}
                        onPress={() => chooseUnit(typed)}
                        style={[
                          styles.moreRow,
                          {
                            backgroundColor: ghosted
                              ? extended.disabledBg
                              : isSelected
                                ? palette.softPrimary
                                : palette.background,
                            borderColor: ghosted
                              ? extended.disabledBg
                              : isSelected
                                ? palette.primary
                                : palette.border,
                          },
                        ]}
                      >
                        <View style={styles.moreRowCopy}>
                          <GabiText
                            style={
                              ghosted
                                ? { color: extended.disabledText }
                                : undefined
                            }
                            variant="buttonSm"
                          >
                            {shortRecipeUnitLabel(unit)}
                          </GabiText>
                          <GabiText
                            style={
                              ghosted
                                ? { color: extended.disabledText }
                                : undefined
                            }
                            tone={ghosted ? undefined : "muted"}
                            variant="caption"
                          >
                            {detailedRecipeUnitLabel(unit)}
                          </GabiText>
                        </View>
                        <Ionicons
                          color={
                            ghosted
                              ? extended.disabledText
                              : isSelected
                                ? palette.primary
                                : extended.radioOff
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

      <Modal
        animationType="fade"
        onRequestClose={() => setGhostPending(null)}
        transparent
        visible={ghostPending !== null}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Isara ang conversion guidance"
            onPress={() => setGhostPending(null)}
            style={[styles.scrim, { backgroundColor: extended.scrim }]}
          />
          <View
            style={[
              styles.ghostSheet,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            <GabiText variant="h2">Walang awtomatikong conversion</GabiText>
            {ghostPending ? (
              <GabiNotice message={ghostPending.guidance.message} tone="warning" />
            ) : null}
            <GabiPrimaryButton
              icon="arrow-forward"
              label={
                ghostPending?.guidance.primaryActionLabel ??
                "Ituloy"
              }
              onPress={confirmGhosted}
            />
            <GabiSoftButton
              icon="close"
              label="Mag-iba ng unit"
              onPress={() => setGhostPending(null)}
            />
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
  ghostSheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
