import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiText } from "@/components/gabi/GabiText";
import { TURN6_BUSINESS_TYPES, type Turn6BusinessType } from "@/domain/onboarding";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GuidedField, GuidedFieldLabel } from "./GuidedField";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const businessTypeIcons: Record<Turn6BusinessType, IoniconName> = {
  "Food / Restaurant": "restaurant-outline",
  "Sari-sari Store": "storefront-outline",
  "Grocery / Mini Mart": "cart-outline",
  Hardware: "hammer-outline",
  Retail: "pricetag-outline",
  "Online Selling": "phone-portrait-outline",
  "Beauty / Salon": "cut-outline",
  Services: "hand-left-outline",
  "Repair Shop": "build-outline",
  "Pharmacy / Health": "medkit-outline",
  "Clothing / Fashion": "shirt-outline",
  Other: "ellipsis-horizontal-outline",
};

const defaultLikelyTypes: readonly Turn6BusinessType[] = [
  "Food / Restaurant",
  "Sari-sari Store",
  "Grocery / Mini Mart",
];

export type BusinessTypeSelectorProps = {
  value: Turn6BusinessType | null;
  customValue: string;
  onChange: (value: Turn6BusinessType) => void;
  onCustomChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  customError?: string;
  suggestedType?: Turn6BusinessType | null;
  likelyTypes?: readonly Turn6BusinessType[];
  disabled?: boolean;
};

export function BusinessTypeSelector({
  value,
  customValue,
  onChange,
  onCustomChange,
  onBlur,
  error,
  customError,
  suggestedType,
  likelyTypes = defaultLikelyTypes,
  disabled = false,
}: BusinessTypeSelectorProps) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingValue, setPendingValue] = useState<Turn6BusinessType | null>(value);
  const [pendingCustom, setPendingCustom] = useState(customValue);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();

  const quickChoices = useMemo(() => {
    const choices = [suggestedType, value, ...likelyTypes].filter(
      (candidate): candidate is Turn6BusinessType => Boolean(candidate),
    );
    return [...new Set(choices)].slice(0, 3);
  }, [likelyTypes, suggestedType, value]);

  const filteredTypes = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("en-PH");
    if (!normalizedSearch) return TURN6_BUSINESS_TYPES;
    return TURN6_BUSINESS_TYPES.filter((option) => option.toLocaleLowerCase("en-PH").includes(normalizedSearch));
  }, [search]);

  function openSheet(initialValue: Turn6BusinessType | null = value) {
    if (disabled) return;
    setPendingValue(initialValue);
    setPendingCustom(customValue);
    setPendingError(null);
    setSearch("");
    setVisible(true);
  }

  function closeSheet() {
    setVisible(false);
    setPendingError(null);
    onBlur?.();
  }

  function chooseQuickType(option: Turn6BusinessType) {
    if (option === "Other") {
      openSheet(option);
      return;
    }
    onChange(option);
    onBlur?.();
  }

  function confirmSelection() {
    if (!pendingValue) {
      setPendingError("Pumili ng uri ng negosyo.");
      return;
    }
    if (pendingValue === "Other" && !pendingCustom.trim()) {
      setPendingError("Sabihin kung anong uri ng negosyo ito.");
      return;
    }

    onChange(pendingValue);
    onCustomChange(pendingValue === "Other" ? pendingCustom : "");
    setVisible(false);
    setPendingError(null);
    onBlur?.();
  }

  return (
    <>
      <View style={styles.fieldWrap}>
        <GuidedFieldLabel label="Uri ng negosyo" required />
        <Pressable
          accessibilityLabel={`Uri ng negosyo, required, ${
            value
              ? `napili: ${value === "Other" && customValue.trim() ? customValue.trim() : value}`
              : "wala pang napili"
          }`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => openSheet()}
          style={({ pressed }) => [
            styles.selector,
            {
              backgroundColor: disabled ? extended.disabledBg : pressed ? palette.softPrimary : extended.field,
              borderColor: disabled ? extended.disabledBg : error ? palette.danger : value ? palette.primary : palette.border,
            },
          ]}
        >
          <Ionicons
            color={disabled ? extended.disabledText : value ? palette.primary : extended.textFaint}
            name={value ? businessTypeIcons[value] : "apps-outline"}
            size={20}
          />
          <GabiText
            numberOfLines={1}
            style={disabled ? { color: extended.disabledText } : undefined}
            tone={value ? "default" : "faint"}
            variant="body"
          >
            {value === "Other" && customValue.trim() ? customValue.trim() : value ?? "Pumili ng uri"}
          </GabiText>
          <View style={styles.selectorSpacer} />
          <Ionicons color={disabled ? extended.disabledText : palette.primary} name="chevron-down" size={19} />
        </Pressable>

        {suggestedType && suggestedType !== value ? (
          <View style={[styles.suggestion, { backgroundColor: palette.softPrimary }]}>
            <Ionicons color={palette.primary} name="sparkles" size={16} />
            <GabiText style={styles.suggestionCopy} tone="primary" variant="caption">
              Hula namin mula sa pangalan — puwede mong palitan.
            </GabiText>
          </View>
        ) : null}

        <View style={styles.quickChoices}>
          {quickChoices.map((option) => {
            const selected = value === option;
            const suggested = option === suggestedType && !selected;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled, selected }}
                disabled={disabled}
                key={option}
                onPress={() => chooseQuickType(option)}
                style={[
                  styles.quickChoice,
                  {
                    backgroundColor: disabled
                      ? extended.disabledBg
                      : selected
                        ? palette.primary
                        : suggested
                          ? palette.softPrimary
                          : palette.surface,
                    borderColor: disabled
                      ? extended.disabledBg
                      : selected || suggested
                        ? palette.primary
                        : palette.border,
                  },
                ]}
              >
                <Ionicons
                  color={disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.primary}
                  name={businessTypeIcons[option]}
                  size={16}
                />
                <GabiText
                  style={{ color: disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.text }}
                  variant="caption"
                >
                  {option}
                </GabiText>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => openSheet()}
            style={[styles.quickChoice, { backgroundColor: palette.surface, borderColor: disabled ? extended.disabledBg : palette.border }]}
          >
            <GabiText style={disabled ? { color: extended.disabledText } : undefined} tone="primary" variant="caption">
              Lahat ({TURN6_BUSINESS_TYPES.length})
            </GabiText>
          </Pressable>
        </View>

        {error ? <GabiText accessibilityLiveRegion="polite" tone="danger" variant="caption">{error}</GabiText> : null}
        {value === "Other" && customError ? (
          <GabiText accessibilityLiveRegion="polite" tone="danger" variant="caption">{customError}</GabiText>
        ) : null}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={closeSheet}
        statusBarTranslucent
        transparent
        visible={visible}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
          <Pressable accessibilityRole="button" onPress={closeSheet} style={[styles.scrim, { backgroundColor: extended.scrim }]} />
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
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitle}>
                <GabiText variant="h2">Anong uri ng negosyo?</GabiText>
                <GabiText tone="muted" variant="caption">Hanapin o pumili sa 12 kategorya.</GabiText>
              </View>
              <GabiSoftButton compact icon="close" label="Isara" onPress={closeSheet} />
            </View>

            <GuidedField
              label="Hanapin ang uri"
              onChangeText={setSearch}
              placeholder="Hal. Food, Retail, Salon"
              showOptionalBadge={false}
              value={search}
            />

            <ScrollView
              contentContainerStyle={styles.optionGrid}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.optionScroll}
            >
              {filteredTypes.length ? filteredTypes.map((option) => {
                const selected = pendingValue === option;
                return (
                  <Pressable
                    accessibilityLabel={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={option}
                    onPress={() => {
                      setPendingValue(option);
                      setPendingError(null);
                    }}
                    style={[
                      styles.option,
                      {
                        backgroundColor: selected ? palette.softPrimary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Ionicons color={selected ? palette.primary : extended.textFaint} name={businessTypeIcons[option]} size={20} />
                    <GabiText style={styles.optionCopy} tone={selected ? "primary" : "default"} variant="buttonSm">
                      {option}
                    </GabiText>
                    {selected ? <Ionicons color={palette.primary} name="checkmark-circle" size={18} /> : null}
                  </Pressable>
                );
              }) : (
                <View style={styles.noResults}>
                  <Ionicons color={extended.textFaint} name="search-outline" size={24} />
                  <GabiText tone="muted" variant="body">Walang tugmang kategorya.</GabiText>
                </View>
              )}
            </ScrollView>

            {pendingValue === "Other" ? (
              <GuidedField
                errorMessage={pendingError ?? customError}
                label="Anong uri?"
                onChangeText={(nextValue) => {
                  setPendingCustom(nextValue);
                  setPendingError(null);
                }}
                placeholder="Hal. Karinderya + laundry"
                required
                value={pendingCustom}
              />
            ) : pendingError ? (
              <GabiText accessibilityLiveRegion="polite" tone="danger" variant="caption">{pendingError}</GabiText>
            ) : null}

            <GabiPrimaryButton
              disabled={!pendingValue}
              icon="checkmark"
              label={pendingValue ? `Piliin ang ${pendingValue}` : "Pumili muna ng uri"}
              onPress={confirmSelection}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    gap: spacing.sm,
  },
  selector: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  selectorSpacer: {
    flex: 1,
  },
  suggestion: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  suggestionCopy: {
    flex: 1,
  },
  quickChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickChoice: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
    gap: spacing.md,
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    borderRadius: 3,
    height: 5,
    width: 42,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  sheetTitle: {
    flex: 1,
    gap: 2,
  },
  optionScroll: {
    flexGrow: 0,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  option: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexBasis: "47%",
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 52,
    padding: spacing.sm,
  },
  optionCopy: {
    flex: 1,
  },
  noResults: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 120,
  },
});
