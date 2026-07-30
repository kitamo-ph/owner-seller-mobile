import { useThemeStore } from "@/state/themeStore";

import { themePalettes } from "./colors";
import { extendedThemePalettes, gabiGradients } from "./tokens";

export function useGabiTheme() {
  const mode = useThemeStore((state) => state.themeMode);

  return {
    mode,
    isDark: mode === "dark",
    palette: themePalettes[mode],
    extended: extendedThemePalettes[mode],
    gradients: gabiGradients[mode],
  };
}
