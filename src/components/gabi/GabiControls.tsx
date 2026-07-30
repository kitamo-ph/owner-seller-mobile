import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { getAppFontFamily, useAppFonts } from "@/theme/fonts";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GabiText } from "./GabiText";

export function GabiField({
  label,
  helperText,
  errorMessage,
  disabled = false,
  style,
  ...inputProps
}: TextInputProps & {
  label: string;
  helperText?: string;
  errorMessage?: string;
  disabled?: boolean;
}) {
  const { loaded } = useAppFonts();
  const { palette, extended } = useGabiTheme();
  const unavailable = disabled || inputProps.editable === false;

  return (
    <View style={styles.fieldWrap}>
      <GabiText variant="buttonSm">{label}</GabiText>
      <TextInput
        accessibilityLabel={label}
        editable={!unavailable}
        placeholderTextColor={unavailable ? extended.disabledText : extended.textFaint}
        {...inputProps}
        style={[
          styles.field,
          {
            backgroundColor: unavailable ? extended.disabledBg : extended.field,
            borderColor: errorMessage ? palette.danger : palette.border,
            color: unavailable ? extended.disabledText : palette.text,
            fontFamily: getAppFontFamily(loaded, "ui", "600"),
          },
          style,
        ]}
      />
      {errorMessage ? (
        <GabiText tone="danger" variant="caption">
          {errorMessage}
        </GabiText>
      ) : helperText ? (
        <GabiText tone="faint" variant="caption">
          {helperText}
        </GabiText>
      ) : null}
    </View>
  );
}

export function GabiRadioRow({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.radioRow,
        {
          backgroundColor: selected || pressed ? palette.softPrimary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? palette.primary : extended.radioOff }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
      <View style={styles.copy}>
        <GabiText variant="cardTitle">{title}</GabiText>
        {description ? (
          <GabiText tone="muted" variant="caption">
            {description}
          </GabiText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function GabiSegmentedControl<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: readonly { label: string; value: T }[];
  selected: T;
  onChange: (value: T) => void;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: extended.neutralChipBg }]}>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active ? { backgroundColor: palette.surface } : null]}
          >
            <GabiText tone={active ? "primary" : "muted"} variant="buttonSm">
              {option.label}
            </GabiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    gap: spacing.xs,
  },
  field: {
    borderRadius: gabiComponents.radioRow.radius,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  radioRow: {
    alignItems: "center",
    borderRadius: gabiComponents.radioRow.radius,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: gabiComponents.radioRow.minHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  radio: {
    alignItems: "center",
    borderRadius: gabiComponents.radioRow.radioSize / 2,
    borderWidth: 2,
    height: gabiComponents.radioRow.radioSize,
    justifyContent: "center",
    width: gabiComponents.radioRow.radioSize,
  },
  radioDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  segmented: {
    borderRadius: gabiComponents.segmented.radius,
    flexDirection: "row",
    padding: gabiComponents.segmented.padding,
  },
  segment: {
    alignItems: "center",
    borderRadius: gabiComponents.segmented.radius - 3,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
});
