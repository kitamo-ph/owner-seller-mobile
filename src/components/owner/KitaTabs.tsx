import { usePathname, useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

const tabs: { href: Href; label: string; route: string }[] = [
  { href: "/owner/reports", label: "Report", route: "/owner/reports" },
  { href: "/owner/records", label: "Logbook", route: "/owner/records" },
  { href: "/owner/fixed-costs", label: "Bayarin", route: "/owner/fixed-costs" },
];

export function KitaTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { palette, extended } = useGabiTheme();

  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: extended.neutralChipBg }]}>
      {tabs.map((tab) => {
        const active = pathname === tab.route;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab.route}
            onPress={() => {
              if (!active) {
                router.replace(tab.href);
              }
            }}
            style={({ pressed }) => [
              styles.tab,
              active ? { backgroundColor: palette.surface } : pressed ? { backgroundColor: palette.softPrimary } : null,
            ]}
          >
            <GabiText tone={active ? "primary" : "muted"} variant="buttonSm">
              {tab.label}
            </GabiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    borderRadius: gabiComponents.segmented.radius,
    flexDirection: "row",
    padding: gabiComponents.segmented.padding,
  },
  tab: {
    alignItems: "center",
    borderRadius: gabiComponents.segmented.radius - 3,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
});
