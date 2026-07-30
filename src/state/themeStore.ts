import { create } from "zustand";

import { saveThemePreference } from "@/services/themePreferences";
import { resolveThemeMode, type ResolvedThemeMode, type ThemeMode } from "@/theme/colors";

type ThemeState = {
  themePreference: ThemeMode;
  themeMode: ResolvedThemeMode;
  systemThemeMode: ResolvedThemeMode;
  kioskSessionThemeMode: ResolvedThemeMode | null;
  pendingThemePreference: ThemeMode | null;
  preferenceLoaded: boolean;
  preferenceLoadFailed: boolean;
  hydrateThemePreference: (themePreference: ThemeMode) => void;
  markThemePreferenceLoadFailed: () => void;
  setSystemThemeMode: (themeMode: ResolvedThemeMode) => void;
  setThemeMode: (themePreference: ThemeMode) => Promise<void>;
  lockKioskTheme: () => void;
  unlockKioskTheme: () => void;
};

function effectiveTheme(
  themePreference: ThemeMode,
  systemThemeMode: ResolvedThemeMode,
  kioskSessionThemeMode: ResolvedThemeMode | null,
) {
  return kioskSessionThemeMode ?? resolveThemeMode(themePreference, systemThemeMode);
}

export const useThemeStore = create<ThemeState>((set) => ({
  themePreference: "system",
  themeMode: "light",
  systemThemeMode: "light",
  kioskSessionThemeMode: null,
  pendingThemePreference: null,
  preferenceLoaded: false,
  preferenceLoadFailed: false,
  hydrateThemePreference: (themePreference) =>
    set((state) => ({
      themePreference,
      themeMode: effectiveTheme(themePreference, state.systemThemeMode, state.kioskSessionThemeMode),
      preferenceLoaded: true,
      preferenceLoadFailed: false,
    })),
  markThemePreferenceLoadFailed: () => set({ preferenceLoaded: true, preferenceLoadFailed: true }),
  setSystemThemeMode: (systemThemeMode) =>
    set((state) => ({
      systemThemeMode,
      themeMode: effectiveTheme(state.themePreference, systemThemeMode, state.kioskSessionThemeMode),
    })),
  setThemeMode: async (themePreference) => {
    await saveThemePreference(themePreference);
    set((state) => ({
      themePreference,
      themeMode: effectiveTheme(themePreference, state.systemThemeMode, state.kioskSessionThemeMode),
      pendingThemePreference: state.kioskSessionThemeMode ? themePreference : null,
    }));
  },
  lockKioskTheme: () =>
    set((state) =>
      state.kioskSessionThemeMode
        ? state
        : {
            kioskSessionThemeMode: state.themeMode,
            themeMode: state.themeMode,
          },
    ),
  unlockKioskTheme: () =>
    set((state) => ({
      kioskSessionThemeMode: null,
      pendingThemePreference: null,
      themeMode: resolveThemeMode(state.themePreference, state.systemThemeMode),
    })),
}));
