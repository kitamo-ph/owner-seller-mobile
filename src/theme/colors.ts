export type ThemeMode = "light" | "dark" | "system";
export type ResolvedThemeMode = Exclude<ThemeMode, "system">;

export type ThemePalette = {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  softPrimary: string;
  softAccent: string;
  softDanger: string;
  softSuccess: string;
  softWarning: string;
  success: string;
  warning: string;
  danger: string;
  kioskHeader: string;
  kioskHeaderText: string;
};

export const brandColors = {
  gabi: "#4F2EC9",
  gabiBright: "#5C3BE3",
  gabiDeep: "#4326B8",
  liwanag: "#FFAF1F",
  ink: "#1C1830",
  mist: "#F6F5FB",
  white: "#FFFFFF",
} as const;

// These keys intentionally stay aligned 1:1 with the pre-Gabi ThemePalette API.
export const themePalettes: Record<ResolvedThemeMode, ThemePalette> = {
  light: {
    primary: "#4F2EC9",
    accent: "#FFAF1F",
    background: "#F6F5FB",
    surface: "#FFFFFF",
    border: "#E6E3F1",
    text: "#1C1830",
    mutedText: "#6E6A85",
    softPrimary: "#F1EEFC",
    softAccent: "#FFF2D6",
    softDanger: "#FDEAE8",
    softSuccess: "#E2F6EC",
    softWarning: "#FFF3DE",
    success: "#0F9D63",
    warning: "#E08700",
    danger: "#E23D32",
    kioskHeader: "#1C1830",
    kioskHeaderText: "#FFFFFF",
  },
  dark: {
    primary: "#A48BF2",
    accent: "#F5B342",
    background: "#141020",
    surface: "#1F1935",
    border: "#37305A",
    text: "#F2EFFA",
    mutedText: "#A9A3C6",
    softPrimary: "#2A2348",
    softAccent: "#3A2D12",
    softDanger: "#3D1F1E",
    softSuccess: "#16352A",
    softWarning: "#3A2B12",
    success: "#43C98A",
    warning: "#F0A23C",
    danger: "#F87A6C",
    kioskHeader: "#0D0A18",
    kioskHeaderText: "#F2EFFA",
  },
};

export function resolveThemeMode(themeMode: ThemeMode, systemMode: ResolvedThemeMode): ResolvedThemeMode {
  return themeMode === "system" ? systemMode : themeMode;
}
