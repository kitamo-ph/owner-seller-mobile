import {
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans/800ExtraBold";
import { useFonts } from "expo-font";
import { createContext, type PropsWithChildren, useContext, useMemo } from "react";

export const appFontFamilies = {
  ui400: "PlusJakartaSans_400Regular",
  ui600: "PlusJakartaSans_600SemiBold",
  ui700: "PlusJakartaSans_700Bold",
  ui800: "PlusJakartaSans_800ExtraBold",
  display700: "BricolageGrotesque_700Bold",
  display800: "BricolageGrotesque_800ExtraBold",
} as const;

const appFontAssets = {
  [appFontFamilies.ui400]: PlusJakartaSans_400Regular,
  [appFontFamilies.ui600]: PlusJakartaSans_600SemiBold,
  [appFontFamilies.ui700]: PlusJakartaSans_700Bold,
  [appFontFamilies.ui800]: PlusJakartaSans_800ExtraBold,
  [appFontFamilies.display700]: BricolageGrotesque_700Bold,
  [appFontFamilies.display800]: BricolageGrotesque_800ExtraBold,
};

type AppFontContextValue = {
  loaded: boolean;
  error: Error | null;
};

const AppFontContext = createContext<AppFontContextValue>({ loaded: false, error: null });

export function AppFontProvider({ children }: PropsWithChildren) {
  const [loaded, error] = useFonts(appFontAssets);
  const value = useMemo(() => ({ loaded: loaded && !error, error }), [error, loaded]);

  // Children render immediately. A missing font stays on the native system face.
  return <AppFontContext.Provider value={value}>{children}</AppFontContext.Provider>;
}

export function useAppFonts() {
  return useContext(AppFontContext);
}

export function getAppFontFamily(
  loaded: boolean,
  family: "ui" | "display",
  weight: "400" | "600" | "700" | "800",
) {
  if (!loaded) {
    return undefined;
  }

  if (family === "display") {
    return weight === "700" ? appFontFamilies.display700 : appFontFamilies.display800;
  }

  if (weight === "400") {
    return appFontFamilies.ui400;
  }
  if (weight === "600") {
    return appFontFamilies.ui600;
  }
  if (weight === "700") {
    return appFontFamilies.ui700;
  }
  return appFontFamilies.ui800;
}
