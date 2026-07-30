import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { recordProblemReportAction } from "@/services/problemReports";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export default function KioskHelpScreen() {
  const activeBranchName = useAppStore((state) => state.activeBranchName);
  const router = useRouter();

  function openReportForm() {
    recordProblemReportAction("kiosk_help_report_problem");
    router.push("/kiosk/report-problem" as Href);
  }

  return (
    <ScreenScroll kioskNav>
      <AppTopBar backHref="/kiosk/sell" eyebrow="KIOSK" subtitle={activeBranchName ?? "Current stall"} title="Help & Reports" />

      <GabiNotice
        message="Ang cart at confirmed Kiosk stall ay mananatili habang binubuksan o isinasara ang help at report screens."
        title="Hindi mawawala ang kasalukuyang benta"
        tone="success"
      />

      <GabiCard>
        <GabiSectionHeader action={<GabiChip label="Local only" tone="success" />} title="May napansing problema?" />
        <MenuRow
          description="I-save ang maikling detalye at sanitized app info sa phone"
          icon="chatbox-ellipses-outline"
          onPress={openReportForm}
          title="Report Problem"
        />
        <MenuRow
          description="Buksan, kopyahin, o i-share ang reports ng kasalukuyang stall"
          icon="documents-outline"
          onPress={() => router.push("/kiosk/problem-reports" as Href)}
          title="My Problem Reports"
        />
      </GabiCard>

      <GabiNotice
        message="Walang automatic crash reporting, cloud upload, seller account, o remote support sa build na ito."
        title="Internal Testing scope"
        tone="owner"
      />
    </ScreenScroll>
  );
}

function MenuRow({ title, description, icon, onPress }: { title: string; description: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? palette.softPrimary : palette.surface, borderColor: extended.hairline },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name={icon} size={21} />
      </View>
      <View style={styles.copy}>
        <GabiText variant="buttonSm">{title}</GabiText>
        <GabiText numberOfLines={2} tone="muted" variant="caption">{description}</GabiText>
      </View>
      <Ionicons color={extended.textFaint} name="chevron-forward" size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.sm,
  },
  icon: {
    alignItems: "center",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
