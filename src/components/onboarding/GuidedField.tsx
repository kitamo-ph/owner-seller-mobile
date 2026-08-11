import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { getAppFontFamily, useAppFonts } from "@/theme/fonts";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type GuidedFieldLabelProps = {
  label: string;
  required?: boolean;
  showOptionalBadge?: boolean;
};

export function GuidedFieldLabel({ label, required = false, showOptionalBadge = !required }: GuidedFieldLabelProps) {
  const { palette, extended } = useGabiTheme();
  return (
    <View style={styles.labelRow}>
      <GabiText variant="buttonSm">{label}</GabiText>
      {required ? (
        <GabiText accessibilityLabel="required" style={{ color: palette.danger }} variant="buttonSm">*</GabiText>
      ) : showOptionalBadge ? (
        <View style={[styles.optionalBadge, { backgroundColor: extended.neutralChipBg }]}>
          <GabiText tone="faint" variant="caption">opsyonal</GabiText>
        </View>
      ) : null}
    </View>
  );
}

export type GuidedFieldProps = Omit<TextInputProps, "editable"> & {
  label: string;
  required?: boolean;
  showOptionalBadge?: boolean;
  helperText?: string;
  errorMessage?: string;
  disabled?: boolean;
  showValidState?: boolean;
};

export function GuidedField({
  label,
  required = false,
  showOptionalBadge,
  helperText,
  errorMessage,
  disabled = false,
  showValidState = false,
  onBlur,
  onFocus,
  value,
  style,
  multiline,
  ...inputProps
}: GuidedFieldProps) {
  const [focused, setFocused] = useState(false);
  const { loaded } = useAppFonts();
  const { palette, extended } = useGabiTheme();
  const valid = showValidState && !errorMessage && typeof value === "string" && value.trim().length > 0;

  return (
    <View style={styles.fieldWrap}>
      <GuidedFieldLabel label={label} required={required} showOptionalBadge={showOptionalBadge} />
      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={`${label}, ${required ? "required" : "optional"}`}
          accessibilityHint={errorMessage}
          accessibilityState={{ disabled }}
          editable={!disabled}
          multiline={multiline}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={disabled ? extended.disabledText : extended.textFaint}
          value={value}
          {...inputProps}
          style={[
            styles.input,
            multiline ? styles.multiline : null,
            {
              backgroundColor: disabled ? extended.disabledBg : extended.field,
              borderColor: errorMessage ? palette.danger : focused || valid ? palette.primary : palette.border,
              color: disabled ? extended.disabledText : palette.text,
              fontFamily: getAppFontFamily(loaded, "ui", "600"),
              paddingRight: valid ? 42 : spacing.md,
            },
            style,
          ]}
        />
        {valid ? (
          <View pointerEvents="none" style={styles.validIcon}>
            <Ionicons color={palette.success} name="checkmark-circle" size={19} />
          </View>
        ) : null}
      </View>
      {errorMessage ? (
        <View accessibilityLiveRegion="polite" style={styles.feedbackRow}>
          <Ionicons color={palette.danger} name="information-circle" size={15} />
          <GabiText style={styles.feedbackCopy} tone="danger" variant="caption">{errorMessage}</GabiText>
        </View>
      ) : helperText ? (
        <GabiText tone="faint" variant="caption">{helperText}</GabiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  optionalBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inputWrap: {
    justifyContent: "center",
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  validIcon: {
    position: "absolute",
    right: spacing.md,
  },
  feedbackRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
  },
  feedbackCopy: {
    flex: 1,
  },
});
