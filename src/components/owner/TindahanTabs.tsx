import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type TindahanTab = "paninda" | "grocery" | "recipes" | "production";

const options = [
  { label: "Paninda", value: "paninda", icon: "file-tray-full-outline" },
  { label: "Grocery", value: "grocery", icon: "basket-outline" },
  { label: "Recipe", value: "recipes", icon: "book-outline" },
  { label: "Production", value: "production", icon: "restaurant-outline" },
] as const;

export function TindahanTabs({ active }: { active: TindahanTab }) {
  const router = useRouter();

  function openTab(tab: TindahanTab) {
    if (tab === active) return;
    if (tab === "grocery") router.replace("/owner/grocery");
    else if (tab === "recipes") router.replace("/owner/recipes");
    else if (tab === "production") router.replace("/owner/production");
    else router.replace("/owner/inventory");
  }

  const { palette, extended } = useGabiTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: extended.neutralChipBg }]}
    >
      {options.map((option) => {
        const selected = option.value === active;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => openTab(option.value)}
            style={[
              styles.tab,
              selected
                ? { backgroundColor: palette.surface, borderColor: palette.border }
                : { borderColor: "transparent" },
            ]}
          >
            <Ionicons
              color={selected ? palette.primary : palette.mutedText}
              name={option.icon}
              size={18}
            />
            <GabiText tone={selected ? "primary" : "muted"} variant="caption">
              {option.label}
            </GabiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: radius.md,
    flexDirection: "row",
    padding: 3,
  },
  tab: {
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 56,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
});
