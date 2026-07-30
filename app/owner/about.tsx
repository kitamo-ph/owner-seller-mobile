import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

const deferredCapabilities = [
  "Seller accounts",
  "QR or join-code access",
  "Remote owner approvals",
  "Scheduled shifts",
  "Push notifications",
  "Cloud sync",
];

export default function AboutKitaMoScreen() {
  const { palette } = useGabiTheme();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const packageName = Constants.expoConfig?.android?.package ?? "ph.kitamo.app";

  return (
    <ScreenScroll bottomNav>
      <AppTopBar backHref="/owner/settings" eyebrow="APP INFORMATION" subtitle="Current Android pilot scope" title="About KitaMo" />

      <GabiCard raised>
        <View style={styles.identityRow}>
          <View style={[styles.identityIcon, { backgroundColor: palette.softPrimary }]}>
            <Ionicons color={palette.primary} name="storefront" size={27} />
          </View>
          <View style={styles.identityCopy}>
            <View style={styles.brandRow}>
              <GabiText tone="primary" variant="h1">Kita</GabiText>
              <GabiText tone="accent" variant="h1">Mo</GabiText>
            </View>
            <GabiText tone="muted" variant="body">Local-first selling and business records for Filipino small businesses.</GabiText>
          </View>
          <GabiChip label={`v${version}`} tone="accent" />
        </View>
      </GabiCard>

      <GabiCard>
        <GabiSectionHeader title="Android build" />
        <InfoRow label="App name" value="KitaMo" />
        <InfoRow label="Version" value={version} />
        <InfoRow label="Package" value={packageName} />
        <InfoRow label="Data" value="Local SQLite on this phone" />
        <InfoRow label="Kiosk" value="Stall-specific, shared device" />
        <InfoRow label="Theme" value="Araw and Gabi" />
      </GabiCard>

      <GabiNotice
        message="Owner Mode manages local businesses and stalls. Every Kiosk session requires an explicit active-stall selection and confirmation."
        title="Internal Testing model"
        tone="owner"
      />

      <GabiCard>
        <GabiSectionHeader action={<GabiChip label="Not enabled" tone="warning" />} title="Next cloud phase" />
        {deferredCapabilities.map((capability) => (
          <View key={capability} style={[styles.capabilityRow, { borderColor: palette.border }]}>
            <View style={[styles.capabilityIcon, { backgroundColor: palette.softWarning }]}>
              <Ionicons color={palette.warning} name="time-outline" size={17} />
            </View>
            <GabiText style={styles.capabilityCopy} tone="muted" variant="body">{capability}</GabiText>
          </View>
        ))}
      </GabiCard>

      <GabiCard>
        <GabiSectionHeader title="Privacy at tulong" />
        <GabiSoftButton icon="lock-closed-outline" label="Privacy Policy" onPress={() => router.push("/privacy")} />
        <GabiSoftButton icon="help-circle-outline" label="Pilot Guide" onPress={() => router.push("/owner/pilot-guide")} />
      </GabiCard>
    </ScreenScroll>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { palette } = useGabiTheme();
  return (
    <View style={[styles.infoRow, { borderColor: palette.border }]}>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText selectable style={styles.infoValue} variant="buttonSm">{value}</GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  identityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  identityIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  identityCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  brandRow: {
    flexDirection: "row",
  },
  infoRow: {
    alignItems: "flex-start",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  infoValue: {
    flex: 1,
    textAlign: "right",
  },
  capabilityRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingTop: spacing.sm,
  },
  capabilityIcon: {
    alignItems: "center",
    borderRadius: 10,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  capabilityCopy: {
    flex: 1,
  },
});
