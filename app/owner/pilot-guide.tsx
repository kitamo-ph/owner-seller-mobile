import { StyleSheet, Text, View } from "react-native";

import { AppTopBar, Card, Pill, ScreenScroll, SecondaryButton } from "@/components/ui/KitaMoUI";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes } from "@/theme/colors";
import { spacing } from "@/theme/spacing";
import { typography } from "@/theme/typography";

const walkthroughSteps = [
  "Sa Settings, buksan ang Business & Stalls para gumawa ng negosyo at stall, tapos piliin ang active context.",
  "Add grocery items sa Grocery Stock (example: Rice, 10kg, ₱650).",
  "Add your paninda sa Inventory.",
  "Create a recipe sa Recipe Cost — piliin ang mga grocery item na gamit mo.",
  "I-produce para sa stall mo sa Niluto.",
  "Sa Owner Home, buksan ang stall picker, piliin ang stall, at i-confirm ang Kiosk — subukan ang cash at GCash.",
  "Check Logbook para sa benta, resibo, at stock movements.",
  "Check Kita Report para sa benta, puhunan, bayarin, at tubo.",
  "Add a bayarin (example: Stall rent, ₱3,000 monthly).",
  "Open Kita Report para makita ang tubo per stall at buong negosyo.",
];

const trackedItems = [
  "Benta, resibo, at orders",
  "Paninda at stock",
  "Grocery items at presyo per brand/source",
  "Recipes at cost per piraso",
  "Niluto at ingredient usage",
  "Transfers sa pagitan ng stalls",
  "Nasayang / spoilage",
  "Fixed costs at bayarin",
  "Kita Report",
];

const notYetItems = [
  "Cloud backup o sync — nasa phone na ito lang ang data",
  "Login o accounts",
  "Remote seller approval o push notifications",
  "Scheduled employee shifts",
  "Full Lis AI (local helper lang muna)",
  "Camera / picture ng resibo",
  "Bluetooth printing",
  "BIR / official-receipt compliance",
];

export default function OwnerPilotGuideScreen() {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];

  return (
    <ScreenScroll bottomNav>
      <AppTopBar subtitle="Paano subukan ang KitaMo sa pilot na ito." title="Pilot Guide" />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Data privacy</Text>
          <Pill label="Local only" tone="success" />
        </View>
        <Text style={[styles.body, { color: palette.mutedText }]}>
          This pilot stores data on this device only. Walang cloud, walang ipinapadala kahit saan. Kapag na-uninstall ang app o
          na-clear ang local data, mawawala ang records — pilot data lang ito, hindi pa pang-permanente.
        </Text>
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Ano ang tina-track ng KitaMo</Text>
        {trackedItems.map((item) => (
          <Text key={item} style={[styles.body, { color: palette.mutedText }]}>
            • {item}
          </Text>
        ))}
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Suggested walkthrough</Text>
        {walkthroughSteps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <Text style={[styles.stepNumber, { color: palette.primary }]}>{index + 1}.</Text>
            <Text style={[styles.body, styles.stepText, { color: palette.text }]}>{step}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Wala pa sa pilot na ito</Text>
        {notYetItems.map((item) => (
          <Text key={item} style={[styles.body, { color: palette.mutedText }]}>
            • {item}
          </Text>
        ))}
      </Card>

      <Card>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Gusto mong mag-ulit ng test?</Text>
        <Text style={[styles.body, { color: palette.mutedText }]}>
          Sa Settings → Business & Stalls, gamitin ang Clear All Local Pilot Data. May confirmation bago mabura ang records,
          settings, at Owner lock. Hindi automatic na babalik ang Demo data.
        </Text>
        <SecondaryButton href="/owner/settings" label="Back to Settings" />
      </Card>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typography.body,
  },
  sectionTitle: {
    ...typography.heading,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  stepRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stepNumber: {
    ...typography.button,
    width: 22,
  },
  stepText: {
    flex: 1,
  },
});
