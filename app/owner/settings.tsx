import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { getOwnerAccessStatus, type OwnerAccessStatus } from "@/services/ownerAccess";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes, type ResolvedThemeMode } from "@/theme/colors";
import { spacing } from "@/theme/spacing";
import { extendedThemePalettes } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

type SettingsRowProps = {
  title: string;
  description: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "primary" | "accent" | "warning" | "danger";
};

export default function OwnerSettingsIndexScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingTheme, setChangingTheme] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const themePreference = useThemeStore((state) => state.themePreference);
  const resolvedTheme = useThemeStore((state) => state.themeMode);
  const kioskSessionTheme = useThemeStore((state) => state.kioskSessionThemeMode);
  const pendingTheme = useThemeStore((state) => state.pendingThemePreference);
  const setThemeMode = useThemeStore((state) => state.setThemeMode);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextOwnerAccess] = await Promise.all([loadOwnerSetupStatus(), getOwnerAccessStatus()]);
      setStatus(nextStatus);
      setOwnerAccess(nextOwnerAccess);
      setError(null);
    } catch (loadError) {
      logDevError("OwnerSettingsIndex.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function chooseTheme(nextTheme: ResolvedThemeMode) {
    if (changingTheme) return;
    setChangingTheme(true);
    try {
      await setThemeMode(nextTheme);
      setError(null);
    } catch (themeError) {
      logDevError("OwnerSettingsIndex.chooseTheme", themeError);
      setError(getFriendlyErrorMessage("Could not save the theme preference."));
    } finally {
      setChangingTheme(false);
    }
  }

  const selectedTheme = themePreference === "system" ? resolvedTheme : themePreference;
  const previewPalette = themePalettes[selectedTheme];
  const previewExtended = extendedThemePalettes[selectedTheme];

  return (
    <ScreenScroll bottomNav>
      <AppTopBar backHref="/owner" eyebrow="OWNER" subtitle="Negosyo, access, privacy, at app" title="Settings" />

      {error ? <GabiNotice message={error} title="May hindi na-save" tone="danger" /> : null}
      {loading && !status ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="35%" />
          <GabiSkeleton height={62} showImmediately />
          <GabiSkeleton height={62} showImmediately />
        </GabiCard>
      ) : null}

      <GabiCard>
        <View style={styles.themeHeader}>
          <View style={[styles.largeIcon, { backgroundColor: selectedTheme === "dark" ? previewExtended.field : previewPalette.softAccent }]}>
            <Ionicons color={selectedTheme === "dark" ? previewPalette.primary : previewPalette.warning} name={selectedTheme === "dark" ? "moon" : "sunny"} size={23} />
          </View>
          <View style={styles.themeCopy}>
            <GabiText variant="cardTitle">Itsura ng app</GabiText>
            <GabiText tone="muted" variant="caption">Manual Araw o Gabi. Auto mode ay para sa susunod na phase.</GabiText>
          </View>
          {status ? <GabiChip label={status.mode === "demo" ? "Demo" : "Local"} tone={status.mode === "demo" ? "accent" : "success"} /> : null}
        </View>
        <View accessibilityRole="radiogroup" style={styles.themeChoices}>
          <ThemeChoice
            disabled={changingTheme}
            icon="sunny-outline"
            label="Araw"
            onPress={() => chooseTheme("light")}
            selected={selectedTheme === "light"}
          />
          <ThemeChoice
            disabled={changingTheme}
            icon="moon-outline"
            label="Gabi"
            onPress={() => chooseTheme("dark")}
            selected={selectedTheme === "dark"}
          />
        </View>
        {themePreference === "system" ? (
          <GabiText tone="faint" variant="caption">Kasalukuyang system preference. Pumili ng Araw o Gabi para gawing manual.</GabiText>
        ) : null}
        {kioskSessionTheme && pendingTheme ? (
          <GabiNotice
            message={`Mananatiling ${kioskSessionTheme === "dark" ? "Gabi" : "Araw"} ang kasalukuyang Kiosk session. Mag-a-apply ang bagong theme kapag isinara ito.`}
            title="Theme change pending"
            tone="warning"
          />
        ) : null}
      </GabiCard>

      <SettingsGroup title="Negosyo at Access">
        <SettingsRow
          description="Persistent local Owner business at active stall"
          href="/owner/context"
          icon="swap-horizontal-outline"
          title="Palitan ang Business o Stall"
          tone="accent"
        />
        <SettingsRow
          description="Business profile, stores, stalls, at Kiosk availability"
          href="/owner/business-settings"
          icon="storefront-outline"
          title="Business at Stalls"
        />
        <SettingsRow
          description={ownerAccess?.hasPin ? "Owner PIN is on; manage PIN and biometrics" : "Protektahan ang Owner Mode sa shared device"}
          href="/owner/business-settings"
          icon="shield-checkmark-outline"
          title="Owner Access at Security"
          tone={ownerAccess?.hasPin ? "primary" : "warning"}
        />
      </SettingsGroup>

      <SettingsGroup title="Abiso at Data">
        <SettingsRow
          description="Active at resolved alerts sa phone na ito"
          href="/owner/notifications"
          icon="notifications-outline"
          title="Local Notifications"
          tone="warning"
        />
        <SettingsRow
          description="Paano iniimbak at ginagamit ang local business records"
          href="/privacy"
          icon="lock-closed-outline"
          title="Privacy Policy"
        />
      </SettingsGroup>

      <SettingsGroup title="App at Tulong">
        <SettingsRow
          description="I-save sa phone ang problema at sanitized app info"
          href={"/owner/report-problem" as Href}
          icon="chatbox-ellipses-outline"
          title="Report Problem"
          tone="warning"
        />
        <SettingsRow
          description="Buksan, kopyahin, o i-share ang local reports"
          href={"/owner/problem-reports" as Href}
          icon="documents-outline"
          title="My Problem Reports"
        />
        <SettingsRow
          description="Version, package, pilot scope, at app information"
          href="/owner/about"
          icon="information-circle-outline"
          title="About KitaMo"
          tone="accent"
        />
        <SettingsRow
          description="Guided walkthrough para sa local seller pilot"
          href="/owner/pilot-guide"
          icon="help-circle-outline"
          title="Pilot Guide"
        />
      </SettingsGroup>
    </ScreenScroll>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GabiCard style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <GabiSectionHeader title={title} />
      </View>
      <View>{children}</View>
    </GabiCard>
  );
}

function SettingsRow({ title, description, href, icon, tone = "primary" }: SettingsRowProps) {
  const router = useRouter();
  const { palette, extended } = useGabiTheme();
  const iconBackground =
    tone === "accent" ? palette.softAccent : tone === "warning" ? palette.softWarning : tone === "danger" ? palette.softDanger : palette.softPrimary;
  const iconColor = tone === "accent" ? palette.accent : tone === "warning" ? palette.warning : tone === "danger" ? palette.danger : palette.primary;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.settingsRow, { backgroundColor: pressed ? palette.background : palette.surface, borderColor: extended.hairline }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBackground }]}>
        <Ionicons color={iconColor} name={icon} size={21} />
      </View>
      <View style={styles.rowCopy}>
        <GabiText variant="buttonSm">{title}</GabiText>
        <GabiText numberOfLines={2} tone="muted" variant="caption">{description}</GabiText>
      </View>
      <Ionicons color={extended.textFaint} name="chevron-forward" size={19} />
    </Pressable>
  );
}

function ThemeChoice({ label, icon, selected, disabled, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; disabled: boolean; onPress: () => void }) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.themeChoice,
        {
          backgroundColor: disabled ? extended.disabledBg : selected ? palette.softPrimary : palette.surface,
          borderColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.border,
        },
      ]}
    >
      <Ionicons color={disabled ? extended.disabledText : selected ? palette.primary : palette.mutedText} name={icon} size={20} />
      <GabiText style={disabled ? { color: extended.disabledText } : undefined} tone={selected ? "primary" : "muted"} variant="buttonSm">{label}</GabiText>
      <View style={[styles.radio, { borderColor: disabled ? extended.disabledText : selected ? palette.primary : extended.radioOff }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  themeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  largeIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  themeCopy: {
    flex: 1,
    gap: 2,
  },
  themeChoices: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  themeChoice: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  radio: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: "center",
    marginLeft: "auto",
    width: 20,
  },
  radioDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  groupCard: {
    gap: spacing.sm,
    paddingBottom: 0,
    paddingHorizontal: 0,
    paddingTop: spacing.md,
  },
  groupHeader: {
    paddingHorizontal: spacing.md,
  },
  settingsRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
});
