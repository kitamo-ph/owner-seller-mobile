import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { GabiCard, GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { formatPeso } from "@/components/ui/KitaMoUI";
import type { RecipeFirstMode } from "@/services/recipeFirst";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const RECIPE_CHOICE_LABELS: Readonly<Record<string, string>> = {
  g: "Gram (g)",
  kg: "Kilogram (kg)",
  ml: "Milliliter (mL)",
  l: "Liter (L)",
  pcs: "Piece",
  pack: "Pack",
  portion: "Portion",
  serving: "Serving",
  metric_cup: "Metric cup — 250 mL",
  us_cup: "US cup — approximately 236.588 mL",
  custom_cup: "Custom business cup",
  tbsp: "Tablespoon — 15 mL",
  tsp: "Teaspoon — 5 mL",
  us_gallon: "US gallon — approximately 3,785.412 mL",
  imperial_gallon: "Imperial gallon — 4,546.09 mL",
  oz: "Ounce (timbang)",
  lb: "Pound (timbang)",
  floz_us: "US fluid ounce",
  floz_imp: "Imperial fluid ounce",
};

export function RecipeFirstStepHeader({
  step,
  title,
  message,
}: {
  step: 1 | 2 | 3;
  title: string;
  message: string;
}) {
  const { palette, extended } = useGabiTheme();

  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepTitleRow}>
        <View style={styles.stepTitleCopy}>
          <GabiText tone="primary" variant="eyebrow">
            Hakbang {step} sa 3
          </GabiText>
          <GabiText variant="h1">{title}</GabiText>
        </View>
        <GabiChip label={`${step} / 3`} tone="primary" />
      </View>
      <View style={styles.progress}>
        {[1, 2, 3].map((position) => (
          <View
            key={position}
            style={[
              styles.progressSegment,
              {
                backgroundColor:
                  position <= step ? palette.primary : extended.disabledBg,
              },
            ]}
          />
        ))}
      </View>
      <GabiText tone="muted" variant="body">
        {message}
      </GabiText>
    </View>
  );
}

const modeOptions: {
  mode: RecipeFirstMode;
  title: string;
  detail: string;
  icon: IoniconName;
}[] = [
  {
    mode: "finished_per_unit",
    title: "Pagkaing ibinebenta kada piraso o serving",
    detail:
      "Para sa sushi, burger, inumin, rice meal, at iba pang paisa-isang benta.",
    icon: "fast-food-outline",
  },
  {
    mode: "prepared_batch",
    title: "Tinimplang sangkap o base",
    detail:
      "Para sa kanin, sauce, sabaw, filling, dough, at ibang batch preparation.",
    icon: "flask-outline",
  },
  {
    mode: "unsure",
    title: "Hindi pa ako sigurado",
    detail: "I-save muna bilang draft at piliin ang final na uri mamaya.",
    icon: "help-circle-outline",
  },
];

export function RecipeFirstModePicker({
  selected,
  disabled = false,
  onChange,
}: {
  selected: RecipeFirstMode | null;
  disabled?: boolean;
  onChange: (mode: RecipeFirstMode) => void;
}) {
  const { palette, extended } = useGabiTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      style={styles.modeList}
    >
      {modeOptions.map((option) => {
        const isSelected = selected === option.mode;
        return (
          <Pressable
            accessibilityLabel={option.title}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected, disabled }}
            disabled={disabled}
            key={option.mode}
            onPress={() => onChange(option.mode)}
            style={({ pressed }) => [
              styles.modeOption,
              {
                backgroundColor: isSelected
                  ? palette.softPrimary
                  : pressed
                    ? extended.neutralChipBg
                    : palette.surface,
                borderColor: isSelected ? palette.primary : palette.border,
              },
            ]}
          >
            <View
              style={[
                styles.modeIcon,
                {
                  backgroundColor: isSelected
                    ? palette.primary
                    : palette.softPrimary,
                },
              ]}
            >
              <Ionicons
                color={isSelected ? palette.kioskHeaderText : palette.primary}
                name={option.icon}
                size={22}
              />
            </View>
            <View style={styles.modeCopy}>
              <GabiText variant="buttonSm">{option.title}</GabiText>
              <GabiText tone="muted" variant="caption">
                {option.detail}
              </GabiText>
            </View>
            <Ionicons
              color={isSelected ? palette.primary : extended.radioOff}
              name={
                isSelected ? "radio-button-on" : "radio-button-off-outline"
              }
              size={22}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function RecipeFirstField({
  label,
  help,
  trailing,
  ...inputProps
}: TextInputProps & {
  label: string;
  help?: string;
  trailing?: ReactNode;
}) {
  const { palette, extended } = useGabiTheme();

  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <GabiText variant="buttonSm">{label}</GabiText>
        {trailing}
      </View>
      <TextInput
        {...inputProps}
        placeholderTextColor={extended.textFaint}
        style={[
          styles.input,
          {
            backgroundColor: extended.field,
            borderColor: palette.border,
            color: palette.text,
          },
          inputProps.multiline ? styles.multiline : null,
          inputProps.style,
        ]}
      />
      {help ? (
        <GabiText tone="faint" variant="caption">
          {help}
        </GabiText>
      ) : null}
    </View>
  );
}

export function RecipeFirstChoiceRow<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly T[];
  selected: T;
  onChange: (value: T) => void;
}) {
  const { palette } = useGabiTheme();

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const isSelected = option === selected;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={option}
              onPress={() => onChange(option)}
              style={[
                styles.choice,
                {
                  backgroundColor: isSelected
                    ? palette.softPrimary
                    : palette.surface,
                  borderColor: isSelected
                    ? palette.primary
                    : palette.border,
                },
              ]}
            >
              <GabiText
                tone={isSelected ? "primary" : "muted"}
                variant="buttonSm"
              >
                {RECIPE_CHOICE_LABELS[option] ?? option.replaceAll("_", " ")}
              </GabiText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type RecipeFirstCostSummaryValue = {
  status: "actual" | "estimated" | "no_price" | "incomplete";
  totalCost: number | null;
  unitCost: number | null;
  unitLabel: string;
  estimatedInputCount: number;
  missingCostCount: number;
  sellingPrice: number | null;
  grossProfit: number | null;
  definitionReady: boolean;
  productionReady: boolean;
  kioskReady: boolean;
};

export function RecipeFirstCostSummary({
  value,
}: {
  value: RecipeFirstCostSummaryValue;
}) {
  const statusLabel =
    value.status === "actual"
      ? "Actual cost"
      : value.status === "estimated"
        ? "Estimated cost"
        : value.status === "no_price"
          ? "No price yet"
          : "Cost incomplete";

  return (
    <GabiCard>
      <View style={styles.summaryHeader}>
        <View style={styles.modeCopy}>
          <GabiText variant="h2">Cost summary</GabiText>
          <GabiText tone="muted" variant="caption">
            Missing prices are never counted as free.
          </GabiText>
        </View>
        <GabiChip
          label={statusLabel}
          tone={
            value.status === "actual"
              ? "success"
              : value.status === "estimated"
                ? "warning"
                : "danger"
          }
        />
      </View>

      <View style={styles.summaryGrid}>
        <SummaryMetric
          label="TOTAL INPUT COST"
          value={
            value.totalCost === null
              ? "Not available"
              : formatPeso(value.totalCost)
          }
        />
        <SummaryMetric
          label="COST PER UNIT"
          value={
            value.unitCost === null
              ? "Not available"
              : `${formatPeso(value.unitCost)}/${value.unitLabel}`
          }
        />
        <SummaryMetric
          label="SELLING PRICE"
          value={
            value.sellingPrice === null
              ? "No price yet"
              : formatPeso(value.sellingPrice)
          }
        />
        <SummaryMetric
          label="EST. GROSS PROFIT"
          value={
            value.grossProfit === null
              ? "Not available"
              : formatPeso(value.grossProfit)
          }
        />
      </View>

      <View style={styles.summaryFacts}>
        <GabiText
          tone={value.estimatedInputCount > 0 ? "warning" : "muted"}
          variant="caption"
        >
          Estimated inputs: {value.estimatedInputCount}
        </GabiText>
        <GabiText
          tone={value.missingCostCount > 0 ? "danger" : "muted"}
          variant="caption"
        >
          Missing costs: {value.missingCostCount}
        </GabiText>
        <GabiText
          tone={value.definitionReady ? "success" : "warning"}
          variant="caption"
        >
          {value.definitionReady
            ? "Recipe definition ready to publish"
            : "Recipe definition incomplete"}
        </GabiText>
        <GabiText
          tone={value.productionReady ? "success" : "warning"}
          variant="caption"
        >
          {value.productionReady
            ? "Ready for production"
            : "Not ready for production"}
        </GabiText>
        <GabiText
          tone={value.kioskReady ? "success" : "muted"}
          variant="caption"
        >
          {value.kioskReady ? "Ready for Kiosk" : "Not ready for Kiosk"}
        </GabiText>
      </View>
    </GabiCard>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <GabiText tone="faint" variant="eyebrow">
        {label}
      </GabiText>
      <GabiText money variant="cardTitle">
        {value}
      </GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  stepHeader: {
    gap: spacing.sm,
  },
  stepTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  stepTitleCopy: {
    flex: 1,
    gap: 2,
  },
  progress: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  progressSegment: {
    borderRadius: 4,
    flex: 1,
    height: 5,
  },
  modeList: {
    gap: spacing.sm,
  },
  modeOption: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  modeIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  modeCopy: {
    flex: 1,
    gap: 2,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  choice: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metric: {
    flexGrow: 1,
    gap: 2,
    minWidth: 130,
  },
  summaryFacts: {
    gap: spacing.xs,
  },
});
