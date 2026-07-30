import { type PropsWithChildren, useEffect } from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { loadThemePreference } from "@/services/themePreferences";
import { useAppStore } from "@/state/appStore";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes, type ResolvedThemeMode } from "@/theme/colors";
import { AppFontProvider } from "@/theme/fonts";

/** Provides app-wide safe areas, persisted theme resolution, and nonblocking fonts. */
export function AppShell({ children }: PropsWithChildren) {
  const systemColorScheme = useColorScheme();
  const kioskSessionBranchId = useAppStore((state) => state.kioskSessionBranchId);
  const themeMode = useThemeStore((state) => state.themeMode);
  const hydrateThemePreference = useThemeStore((state) => state.hydrateThemePreference);
  const markThemePreferenceLoadFailed = useThemeStore((state) => state.markThemePreferenceLoadFailed);
  const setSystemThemeMode = useThemeStore((state) => state.setSystemThemeMode);
  const lockKioskTheme = useThemeStore((state) => state.lockKioskTheme);
  const unlockKioskTheme = useThemeStore((state) => state.unlockKioskTheme);
  const palette = themePalettes[themeMode];

  useEffect(() => {
    setSystemThemeMode((systemColorScheme === "dark" ? "dark" : "light") as ResolvedThemeMode);
  }, [setSystemThemeMode, systemColorScheme]);

  useEffect(() => {
    let active = true;

    void loadThemePreference()
      .then((preference) => {
        if (active) {
          hydrateThemePreference(preference);
        }
      })
      .catch(() => {
        if (active) {
          markThemePreferenceLoadFailed();
        }
      });

    return () => {
      active = false;
    };
  }, [hydrateThemePreference, markThemePreferenceLoadFailed]);

  useEffect(() => {
    if (kioskSessionBranchId) {
      lockKioskTheme();
    } else {
      unlockKioskTheme();
    }
  }, [kioskSessionBranchId, lockKioskTheme, unlockKioskTheme]);

  return (
    <AppFontProvider>
      <SafeAreaProvider>
        <View style={[styles.container, { backgroundColor: palette.background }]}>{children}</View>
      </SafeAreaProvider>
    </AppFontProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
