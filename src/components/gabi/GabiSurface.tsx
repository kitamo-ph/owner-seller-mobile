import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radius } from "@/theme/radius";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { gabiComponents } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GabiText } from "./GabiText";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type Tone = "primary" | "accent" | "success" | "warning" | "danger" | "neutral";

function toneColors(tone: Tone, palette: ReturnType<typeof useGabiTheme>["palette"], extended: ReturnType<typeof useGabiTheme>["extended"]) {
  if (tone === "accent") return { background: palette.softAccent, foreground: extended.accentTextOn };
  if (tone === "success") return { background: palette.softSuccess, foreground: palette.success };
  if (tone === "warning") return { background: palette.softWarning, foreground: palette.warning };
  if (tone === "danger") return { background: palette.softDanger, foreground: palette.danger };
  if (tone === "neutral") return { background: extended.neutralChipBg, foreground: palette.mutedText };
  return { background: extended.violetChipBg, foreground: extended.violetChipText };
}

export function GabiCard({ children, style, raised = false }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; raised?: boolean }>) {
  const { palette, extended, isDark } = useGabiTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: raised ? extended.raised : palette.surface,
          borderColor: isDark ? palette.border : extended.hairline,
        },
        isDark ? shadows.darkCard : raised ? shadows.raised : shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function GabiHeroCard({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { gradients, isDark } = useGabiTheme();
  return (
    <LinearGradient
      colors={gradients.heroCard}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.hero, !isDark ? shadows.hero : null, style]}
    >
      {children}
    </LinearGradient>
  );
}

export function GabiChip({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IoniconName }) {
  const { palette, extended } = useGabiTheme();
  const colors = toneColors(tone, palette, extended);
  return (
    <View style={[styles.chip, { backgroundColor: colors.background }]}>
      {icon ? <Ionicons color={colors.foreground} name={icon} size={13} /> : null}
      <GabiText style={{ color: colors.foreground }} variant="caption">
        {label}
      </GabiText>
    </View>
  );
}

export function GabiIconButton({
  icon,
  accessibilityLabel,
  onPress,
  badgeCount = 0,
}: {
  icon: IoniconName;
  accessibilityLabel: string;
  onPress: () => void;
  badgeCount?: number;
}) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? palette.softPrimary : palette.surface, borderColor: palette.border },
      ]}
    >
      <Ionicons color={palette.primary} name={icon} size={21} />
      {badgeCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: palette.danger }]}>
      <GabiText style={[styles.badgeText, { color: palette.kioskHeaderText }]} variant="caption">
            {badgeCount > 9 ? "9+" : badgeCount}
          </GabiText>
        </View>
      ) : null}
    </Pressable>
  );
}

export function GabiContextIndicator({
  businessName,
  stallName,
  onPress,
}: {
  businessName: string;
  stallName?: string | null;
  onPress: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityHint="Choose a different business or stall"
      accessibilityLabel={`${businessName}, ${stallName ?? "All stalls"}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.context,
        { backgroundColor: pressed ? palette.softPrimary : palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.contextIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name="storefront-outline" size={18} />
      </View>
      <View style={styles.contextCopy}>
        <GabiText numberOfLines={1} variant="buttonSm">
          {businessName}
        </GabiText>
        <GabiText numberOfLines={1} style={{ color: extended.textFaint }} variant="caption">
          {stallName ?? "All stalls"}
        </GabiText>
      </View>
      <GabiText tone="primary" variant="caption">
        Palitan
      </GabiText>
    </Pressable>
  );
}

export function GabiSectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <GabiText variant="h2">{title}</GabiText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  hero: {
    borderRadius: radius.xl,
    gap: spacing.md,
    overflow: "hidden",
    padding: spacing.lg,
  },
  chip: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: gabiComponents.chip.horizontalPadding,
    paddingVertical: gabiComponents.chip.verticalPadding,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: gabiComponents.topBarIconButton.radius,
    borderWidth: 1,
    height: gabiComponents.topBarIconButton.size,
    justifyContent: "center",
    width: gabiComponents.topBarIconButton.size,
  },
  badge: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: gabiComponents.topBarIconButton.badgeSize,
    justifyContent: "center",
    minWidth: gabiComponents.topBarIconButton.badgeSize,
    paddingHorizontal: 3,
    position: "absolute",
    right: -4,
    top: -5,
  },
  badgeText: {
    fontSize: 8,
    lineHeight: 10,
  },
  context: {
    alignItems: "center",
    borderRadius: gabiComponents.contextIndicator.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: gabiComponents.contextIndicator.height,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  contextIcon: {
    alignItems: "center",
    borderRadius: gabiComponents.contextIndicator.iconRadius,
    height: gabiComponents.contextIndicator.iconSize,
    justifyContent: "center",
    width: gabiComponents.contextIndicator.iconSize,
  },
  contextCopy: {
    flex: 1,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
});
