import type { PropsWithChildren } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";

import { getAppFontFamily, useAppFonts } from "@/theme/fonts";
import { moneyTypography, typography } from "@/theme/typography";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type GabiTextVariant =
  | "displayPeso"
  | "heroPeso"
  | "h1"
  | "h2"
  | "cardTitle"
  | "metricValue"
  | "body"
  | "caption"
  | "eyebrow"
  | "buttonLg"
  | "buttonSm";

type GabiTextProps = PropsWithChildren<
  TextProps & {
    variant?: GabiTextVariant;
    tone?: "default" | "muted" | "faint" | "primary" | "accent" | "success" | "warning" | "danger" | "inverse";
    money?: boolean;
  }
>;

function variantFamily(variant: GabiTextVariant) {
  return variant === "displayPeso" || variant === "heroPeso" || variant === "metricValue" ? "display" : "ui";
}

function variantWeight(variant: GabiTextVariant): "400" | "600" | "700" | "800" {
  return typography[variant].fontWeight as "400" | "600" | "700" | "800";
}

export function GabiText({ children, variant = "body", tone = "default", money = false, style, ...props }: GabiTextProps) {
  const { loaded } = useAppFonts();
  const { palette, extended } = useGabiTheme();
  const color =
    tone === "muted"
      ? palette.mutedText
      : tone === "faint"
        ? extended.textFaint
        : tone === "primary"
          ? palette.primary
          : tone === "accent"
            ? palette.accent
            : tone === "success"
              ? palette.success
              : tone === "warning"
                ? palette.warning
                : tone === "danger"
                  ? palette.danger
                  : tone === "inverse"
                    ? palette.kioskHeaderText
                    : palette.text;
  const weight = variantWeight(variant);
  const fontStyle: TextStyle = {
    fontFamily: getAppFontFamily(loaded, variantFamily(variant), weight),
  };

  return (
    <Text {...props} style={[typography[variant], fontStyle, { color }, money ? moneyTypography : null, style]}>
      {children}
    </Text>
  );
}
