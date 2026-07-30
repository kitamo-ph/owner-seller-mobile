import type { ResolvedThemeMode } from "./colors";

export const GABI_TOKEN_VERSION = "3.1.0" as const;
export const SHARED_RECEIPT_THEME = "light" as const;

export type ExtendedThemePalette = {
  textFaint: string;
  primaryStrongText: string;
  textOnPrimaryMuted: string;
  primaryPressed: string;
  accentTextOn: string;
  successDeep: string;
  warningDeep: string;
  dangerDeep: string;
  violetChipBg: string;
  violetChipText: string;
  neutralChipBg: string;
  disabledBg: string;
  disabledText: string;
  field: string;
  raised: string;
  hairline: string;
  radioOff: string;
  skeletonA: string;
  skeletonB: string;
  scrim: string;
};

export const extendedThemePalettes: Record<ResolvedThemeMode, ExtendedThemePalette> = {
  light: {
    textFaint: "#8A86A0",
    primaryStrongText: "#4F2EC9",
    textOnPrimaryMuted: "#B9B3D6",
    primaryPressed: "#3E23A6",
    accentTextOn: "#3A2800",
    successDeep: "#0B6B47",
    warningDeep: "#8F5700",
    dangerDeep: "#B02A20",
    violetChipBg: "#EDE8FB",
    violetChipText: "#3A2494",
    neutralChipBg: "#F1F0F6",
    disabledBg: "#ECEAF5",
    disabledText: "#A8A4BF",
    field: "#FFFFFF",
    raised: "#FFFFFF",
    hairline: "#E6E3F1",
    radioOff: "#C9C5DC",
    skeletonA: "#ECEAF5",
    skeletonB: "#F6F5FB",
    scrim: "rgba(22,17,44,0.5)",
  },
  dark: {
    textFaint: "#7B7599",
    primaryStrongText: "#B3A0F8",
    textOnPrimaryMuted: "#A9A3C6",
    primaryPressed: "#4E31C4",
    accentTextOn: "#F5B342",
    successDeep: "#43C98A",
    warningDeep: "#F0A23C",
    dangerDeep: "#F87A6C",
    violetChipBg: "#322659",
    violetChipText: "#C9BCF9",
    neutralChipBg: "#2A2542",
    disabledBg: "#272243",
    disabledText: "#6B6590",
    field: "#2A2348",
    raised: "#1A1530",
    hairline: "#2C2648",
    radioOff: "#4A4468",
    skeletonA: "#2A2348",
    skeletonB: "#1F1935",
    scrim: "rgba(5,3,12,0.7)",
  },
};

export const gabiGradients: Record<ResolvedThemeMode, { primaryButton: readonly [string, string]; heroCard: readonly [string, string, string] }> = {
  light: {
    primaryButton: ["#5C3BE3", "#4326B8"],
    heroCard: ["#5C3BE3", "#4F2EC9", "#3A21A4"],
  },
  dark: {
    primaryButton: ["#6A4BE0", "#4E31C4"],
    heroCard: ["#4A2FBE", "#3E27A8", "#2D1B82"],
  },
};

export const gabiMotion = {
  fastMs: 120,
  standardMs: 200,
  emphaticMs: 320,
  shimmerMs: 1300,
  skeletonDelayMs: 300,
  snackbarMs: 2000,
} as const;

export const gabiComponents = {
  hitTarget: 44,
  topBarIconButton: { size: 40, radius: 13, badgeSize: 17 },
  contextIndicator: { height: 46, radius: 16, iconSize: 34, iconRadius: 11 },
  kioskContextHeader: { eyebrowSize: 8.5, stallSize: 13 },
  stallCard: { radius: 20, padding: 14 },
  radioRow: { minHeight: 58, radius: 16, radioSize: 22 },
  notice: { radius: 14 },
  buttonPrimary: { minHeight: 54, radius: 18 },
  buttonSoft: { minHeight: 48, radius: 16 },
  segmented: { radius: 14, padding: 3 },
  chip: { horizontalPadding: 10, verticalPadding: 5 },
  skeleton: { radius: 8 },
  snackbar: { radius: 14 },
  emptyState: { iconSize: 52, iconRadius: 17 },
} as const;
