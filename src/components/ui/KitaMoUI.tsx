import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, usePathname, useRouter } from "expo-router";
import { Children, type ComponentProps, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OwnerContextBar } from "@/components/owner/OwnerContextBar";
import { GabiText } from "@/components/gabi/GabiText";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes, type ThemePalette } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { extendedThemePalettes, gabiGradients } from "@/theme/tokens";
import { typography } from "@/theme/typography";

type Tone = "primary" | "accent" | "success" | "warning" | "danger" | "neutral";
export type IoniconName = ComponentProps<typeof Ionicons>["name"];

const toneStyles = {
  primary: (palette: ThemePalette) => ({ backgroundColor: palette.softPrimary, color: palette.primary, borderColor: palette.border }),
  accent: (palette: ThemePalette) => ({ backgroundColor: palette.softAccent, color: palette.accent, borderColor: palette.border }),
  success: (palette: ThemePalette) => ({ backgroundColor: palette.softSuccess, color: palette.success, borderColor: palette.border }),
  warning: (palette: ThemePalette) => ({ backgroundColor: palette.softWarning, color: palette.warning, borderColor: palette.border }),
  danger: (palette: ThemePalette) => ({ backgroundColor: palette.softDanger, color: palette.danger, borderColor: palette.border }),
  neutral: (palette: ThemePalette) => ({ backgroundColor: palette.surface, color: palette.mutedText, borderColor: palette.border }),
};

function usePalette() {
  const themeMode = useThemeStore((state) => state.themeMode);
  return themePalettes[themeMode === "dark" ? "dark" : "light"];
}

export function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  })}`;
}

export function formatQuantity(value: number) {
  return value.toLocaleString("en-PH", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

// Visual height of the bottom navigation before the safe-area inset is added.
const BOTTOM_NAV_BASE_HEIGHT = 76;

export function ScreenScroll({
  children,
  bottomNav = false,
  kioskNav = false,
  floatingFooter,
}: PropsWithChildren<{ bottomNav?: boolean; kioskNav?: boolean; floatingFooter?: ReactNode }>) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
  const hasNav = bottomNav || kioskNav;
  const floatingFooterHeight = floatingFooter ? 72 : 0;
  const bottomPadding = hasNav
    ? BOTTOM_NAV_BASE_HEIGHT + floatingFooterHeight + bottomInset + spacing.lg
    : floatingFooterHeight + bottomInset + spacing.lg;
  const content = Children.toArray(children);
  const contextHeader = hasNav ? content[0] : null;
  const screenContent = hasNav ? content.slice(1) : content;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.sm, paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        {contextHeader}
        {bottomNav ? <OwnerContextBar mode="owner" /> : null}
        {kioskNav ? <OwnerContextBar mode="kiosk" /> : null}
        {screenContent}
      </ScrollView>
      <View
        pointerEvents="none"
        style={[styles.statusBarMask, { backgroundColor: palette.background, height: insets.top }]}
      />
      {floatingFooter ? (
        <View
          style={[
            styles.floatingFooter,
            { bottom: hasNav ? BOTTOM_NAV_BASE_HEIGHT + bottomInset + spacing.xs : bottomInset + spacing.xs },
          ]}
        >
          {floatingFooter}
        </View>
      ) : null}
      {bottomNav ? <OwnerBottomNav /> : null}
      {kioskNav ? <KioskBottomNav /> : null}
    </View>
  );
}

export function KitaMoBrand({ centered = false }: { centered?: boolean }) {
  const palette = usePalette();

  return (
    <Text style={[styles.brand, { textAlign: centered ? "center" : "left" }]}>
      <Text style={{ color: palette.primary }}>Kita</Text>
      <Text style={{ color: palette.accent }}>Mo</Text>
    </Text>
  );
}

type AppTopBarProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: ReactNode;
  centeredBrand?: boolean;
  backHref?: Href;
  showBrand?: boolean;
};

export function AppTopBar({ title, subtitle, eyebrow, right, centeredBrand = false, backHref, showBrand = false }: AppTopBarProps) {
  const palette = usePalette();
  const router = useRouter();

  return (
    <View style={styles.topBar}>
      {backHref ? (
        <Pressable
          accessibilityLabel="Bumalik"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.replace(backHref)}
          style={({ pressed }) => [
            styles.topBackButton,
            { backgroundColor: pressed ? palette.softPrimary : palette.surface, borderColor: palette.border },
          ]}
        >
          <Ionicons color={palette.primary} name="arrow-back" size={21} />
        </Pressable>
      ) : null}
      <View style={styles.topText}>
        {showBrand ? <KitaMoBrand centered={centeredBrand} /> : null}
        {eyebrow ? <GabiText tone="primary" variant="eyebrow">{eyebrow}</GabiText> : null}
        <GabiText maxFontSizeMultiplier={1.3} numberOfLines={2} variant="h1">
          {title}
        </GabiText>
        {subtitle ? <GabiText tone="muted" variant="caption">{subtitle}</GabiText> : null}
      </View>
      {right ? <View style={styles.topRight}>{right}</View> : null}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const palette = usePalette();
  return <View style={[styles.card, { backgroundColor: palette.surface }, shadows.card, style]}>{children}</View>;
}

export function HeroCard({ children }: PropsWithChildren) {
  const palette = usePalette();
  return <View style={[styles.heroCard, { backgroundColor: palette.primary }, shadows.hero]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {action}
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const palette = usePalette();
  const toneStyle = toneStyles[tone](palette);
  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.backgroundColor, borderColor: toneStyle.borderColor }]}>
      <Text style={[styles.pillText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

// Accepts a modern Ionicon (`icon`) or a legacy letter/emoji (`label`).
// Ionicon wins when both are given, so screens can migrate gradually.
export function IconBadge({
  label,
  icon,
  tone = "primary",
  size = "md",
}: {
  label?: string;
  icon?: IoniconName;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const palette = usePalette();
  const toneStyle = toneStyles[tone](palette);
  const dimension = size === "lg" ? 46 : size === "sm" ? 30 : 38;
  const iconSize = size === "lg" ? 24 : size === "sm" ? 16 : 20;
  return (
    <View
      style={[
        styles.iconBadge,
        {
          backgroundColor: toneStyle.backgroundColor,
          height: dimension,
          width: dimension,
        },
      ]}
    >
      {icon ? (
        <Ionicons color={toneStyle.color} name={icon} size={iconSize} />
      ) : (
        <Text style={[styles.iconBadgeText, { color: toneStyle.color, fontSize: size === "lg" ? 20 : 15 }]}>{label ?? ""}</Text>
      )}
    </View>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
  icon?: string;
  iconName?: IoniconName;
};

export function MetricCard({ label, value, detail, tone = "primary", icon = "₱", iconName }: MetricCardProps) {
  const palette = usePalette();
  return (
    <Card style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <IconBadge icon={iconName} label={iconName ? undefined : icon} size="sm" tone={tone} />
        <Text numberOfLines={1} style={[styles.metricLabel, { color: palette.mutedText }]}>
          {label}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.metricValue, { color: tone === "danger" ? palette.danger : tone === "accent" ? palette.accent : palette.text }]}
      >
        {value}
      </Text>
      {detail ? (
        <Text numberOfLines={1} style={[styles.metricDetail, { color: palette.mutedText }]}>
          {detail}
        </Text>
      ) : null}
    </Card>
  );
}

type ButtonProps = {
  label: string;
  onPress?: () => void;
  href?: Href;
  disabled?: boolean;
};

// Route via router.push rather than <Link asChild>. On the New Architecture,
// wrapping a Pressable in <Link asChild> drops the Pressable's background/border
// style, making filled buttons render as bare text — so navigation buttons use
// an explicit onPress instead.
export function PrimaryButton({ label, onPress, href, disabled = false }: ButtonProps) {
  const palette = usePalette();
  const themeMode = useThemeStore((state) => state.themeMode);
  const extended = extendedThemePalettes[themeMode];
  const router = useRouter();
  const handlePress = href ? () => router.push(href) : onPress;
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={[styles.primaryButton, { backgroundColor: disabled ? extended.disabledBg : palette.primary }]}
    >
      <Text style={[styles.primaryButtonText, { color: disabled ? extended.disabledText : palette.kioskHeaderText }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, href, disabled = false }: ButtonProps) {
  const palette = usePalette();
  const themeMode = useThemeStore((state) => state.themeMode);
  const extended = extendedThemePalettes[themeMode];
  const router = useRouter();
  const handlePress = href ? () => router.push(href) : onPress;
  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={[styles.secondaryButton, { backgroundColor: disabled ? extended.disabledBg : palette.surface, borderColor: disabled ? extended.disabledBg : palette.border }]}
    >
      <Text style={[styles.secondaryButtonText, { color: disabled ? extended.disabledText : palette.primary }]}>{label}</Text>
    </Pressable>
  );
}

export function FormInput({ label, style, ...inputProps }: TextInputProps & { label: string }) {
  const palette = usePalette();
  const themeMode = useThemeStore((state) => state.themeMode);
  const extended = extendedThemePalettes[themeMode];
  const editable = inputProps.editable !== false;

  return (
    <View style={styles.formField}>
      <Text style={[styles.formLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.mutedText}
        {...inputProps}
        style={[
          styles.input,
          {
            backgroundColor: editable ? palette.surface : extended.disabledBg,
            borderColor: editable ? palette.border : extended.disabledBg,
            color: editable ? palette.text : extended.disabledText,
          },
          style,
        ]}
      />
    </View>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  amount?: string;
  badge?: string;
  badgeTone?: Tone;
  icon?: string;
  iconTone?: Tone;
  onPress?: () => void;
};

export function ListRow({ title, subtitle, amount, badge, badgeTone = "neutral", icon = "I", iconTone = "primary", onPress }: ListRowProps) {
  const palette = usePalette();
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper onPress={onPress} style={[styles.listRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <IconBadge label={icon} tone={iconTone} />
      <View style={styles.listText}>
        <Text style={[styles.listTitle, { color: palette.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.listSubtitle, { color: palette.mutedText }]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.listTrailing}>
        {amount ? <Text style={[styles.listAmount, { color: palette.text }]}>{amount}</Text> : null}
        {badge ? <Pill label={badge} tone={badgeTone} /> : null}
      </View>
    </Wrapper>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.softPrimary }]}>
      <IconBadge icon="sparkles-outline" tone="primary" size="lg" />
      <View style={styles.emptyText}>
        <Text style={[styles.emptyTitle, { color: palette.text }]}>{title}</Text>
        {description ? <Text style={[styles.emptyDescription, { color: palette.mutedText }]}>{description}</Text> : null}
      </View>
    </View>
  );
}

export function LoadingState({ label = "Loading local data..." }: { label?: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.loadingState, { backgroundColor: palette.softPrimary }]}>
      <ActivityIndicator color={palette.primary} />
      <Text style={[styles.loadingLabel, { color: palette.mutedText }]}>{label}</Text>
    </View>
  );
}

export function InlineNotice({
  message,
  title,
  tone = "neutral",
}: {
  message: string;
  title?: string;
  tone?: Tone;
}) {
  const palette = usePalette();
  const toneStyle = toneStyles[tone](palette);
  const icon: IoniconName = tone === "danger" ? "alert-circle" : tone === "warning" ? "warning" : tone === "success" ? "checkmark-circle" : "information-circle";

  return (
    <View style={[styles.inlineNotice, { backgroundColor: toneStyle.backgroundColor, borderColor: toneStyle.borderColor }]}>
      <Ionicons color={toneStyle.color} name={icon} size={20} />
      <View style={styles.inlineNoticeCopy}>
        {title ? <Text style={[styles.inlineNoticeTitle, { color: toneStyle.color }]}>{title}</Text> : null}
        <Text style={[styles.inlineNoticeMessage, { color: palette.text }]}>{message}</Text>
      </View>
    </View>
  );
}

function OwnerBottomNav() {
  const pathname = usePathname();
  const palette = usePalette();
  const themeMode = useThemeStore((state) => state.themeMode);
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];
  const gradients = gabiGradients[themeMode === "dark" ? "dark" : "light"];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabs: { href: Href; label: string; icon: IoniconName; activeIcon: IoniconName; active: boolean }[] = [
    { href: "/owner", label: "Home", icon: "home-outline", activeIcon: "home", active: pathname === "/owner" },
    {
      href: "/owner/inventory",
      label: "Tindahan",
      icon: "cube-outline",
      activeIcon: "cube",
      active: ["/owner/inventory", "/owner/grocery", "/owner/recipes", "/owner/production", "/owner/transfers"].some((path) => pathname.includes(path)),
    },
    {
      href: "/owner/reports",
      label: "Kita",
      icon: "receipt-outline",
      activeIcon: "receipt",
      active: ["/owner/reports", "/owner/records", "/owner/fixed-costs"].some((path) => pathname.includes(path)),
    },
    {
      href: "/owner/settings",
      label: "Ako",
      icon: "person-outline",
      activeIcon: "person",
      active: ["/owner/settings", "/owner/about", "/owner/business-settings", "/owner/context", "/owner/notifications", "/owner/pilot-guide", "/owner/report-problem", "/owner/problem-reports"].some((path) => pathname.includes(path)),
    },
  ];

  return (
    <View
      style={[
        styles.ownerBottomNav,
        {
          backgroundColor: themeMode === "dark" ? extended.raised : palette.surface,
          borderColor: palette.border,
          bottom: Math.max(insets.bottom, 8),
        },
        themeMode === "dark" ? null : shadows.raised,
      ]}
    >
      <View style={styles.ownerBottomNavTabs}>
        {tabs.slice(0, 2).map((tab) => <OwnerNavItem key={tab.label} {...tab} />)}
        <Pressable
          accessibilityHint="Pumili at kumpirmahin muna ang stall"
          accessibilityLabel="BENTA"
          accessibilityRole="button"
          onPress={() => router.push("/kiosk")}
          style={styles.bentaNavItem}
        >
          <LinearGradient colors={gradients.primaryButton} style={[styles.bentaOrb, { borderColor: palette.background }]}>
            <Ionicons color={palette.kioskHeaderText} name="storefront" size={23} />
          </LinearGradient>
          <GabiText tone="primary" variant="caption">BENTA</GabiText>
        </Pressable>
        {tabs.slice(2).map((tab) => <OwnerNavItem key={tab.label} {...tab} />)}
      </View>
    </View>
  );
}

function OwnerNavItem({ href, label, icon, activeIcon, active }: { href: Href; label: string; icon: IoniconName; activeIcon: IoniconName; active: boolean }) {
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={() => router.push(href)} style={styles.bottomNavItem}>
      <View style={[styles.bottomNavIconWrap, active ? { backgroundColor: palette.softPrimary } : null]}>
        <Ionicons color={active ? palette.primary : palette.mutedText} name={active ? activeIcon : icon} size={20} />
      </View>
      <GabiText tone={active ? "primary" : "muted"} variant="caption">{label}</GabiText>
    </Pressable>
  );
}

function KioskBottomNav() {
  const pathname = usePathname();
  const palette = usePalette();
  const themeMode = useThemeStore((state) => state.themeMode);
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];
  const gradients = gabiGradients[themeMode === "dark" ? "dark" : "light"];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const leftTabs: { href: Href; label: string; icon: IoniconName; activeIcon: IoniconName; active: boolean }[] = [
    { href: "/kiosk/orders", label: "Orders", icon: "receipt-outline", activeIcon: "receipt", active: pathname.includes("/kiosk/orders") },
    { href: "/kiosk/stock", label: "Stock", icon: "cube-outline", activeIcon: "cube", active: pathname.includes("/kiosk/stock") },
  ];
  const rightTabs: { href: Href; label: string; icon: IoniconName; activeIcon: IoniconName; active: boolean }[] = [
    { href: "/kiosk/shift", label: "Shift", icon: "time-outline", activeIcon: "time", active: pathname.includes("/kiosk/shift") },
    { href: "/kiosk", label: "Isara", icon: "lock-closed-outline", activeIcon: "lock-closed", active: false },
  ];
  const bentaActive = pathname.includes("/kiosk/sell") || pathname.includes("/kiosk/checkout");

  return (
    <View
      style={[
        styles.kioskBottomNav,
        {
          backgroundColor: themeMode === "dark" ? extended.raised : palette.surface,
          borderColor: palette.border,
          bottom: Math.max(insets.bottom, 8),
        },
        themeMode === "dark" ? null : shadows.raised,
      ]}
    >
      <View style={styles.ownerBottomNavTabs}>
        {leftTabs.map((tab) => <KioskNavItem key={tab.label} {...tab} />)}
        <Pressable
          accessibilityLabel="BENTA"
          accessibilityRole="button"
          onPress={() => router.replace("/kiosk/sell")}
          style={styles.bentaNavItem}
        >
          <LinearGradient
            colors={gradients.primaryButton}
            style={[
              styles.bentaOrb,
              { borderColor: palette.background },
              bentaActive ? { shadowColor: palette.primary, shadowOpacity: 0.34, shadowRadius: 10 } : null,
            ]}
          >
            <Ionicons color={palette.kioskHeaderText} name="storefront" size={23} />
          </LinearGradient>
          <GabiText tone="primary" variant="caption">BENTA</GabiText>
        </Pressable>
        {rightTabs.map((tab) => <KioskNavItem key={tab.label} {...tab} />)}
      </View>
    </View>
  );
}

function KioskNavItem({ href, label, icon, activeIcon, active }: { href: Href; label: string; icon: IoniconName; activeIcon: IoniconName; active: boolean }) {
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={() => router.replace(href)} style={styles.bottomNavItem}>
      <View style={[styles.bottomNavIconWrap, active ? { backgroundColor: palette.softPrimary } : null]}>
        <Ionicons color={active ? palette.primary : palette.mutedText} name={active ? activeIcon : icon} size={20} />
      </View>
      <GabiText tone={active ? "primary" : "muted"} variant="caption">{label}</GabiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  statusBarMask: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
  },
  floatingFooter: {
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
    zIndex: 4,
  },
  scrollContent: {
    flexGrow: 1,
    gap: 12,
    paddingHorizontal: spacing.md,
  },
  brand: {
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 48,
    paddingBottom: spacing.xs,
  },
  topText: {
    flex: 1,
    gap: 3,
  },
  topRight: {
    alignItems: "flex-end",
  },
  topBackButton: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  eyebrow: {
    ...typography.label,
  },
  pageTitle: {
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 30,
  },
  pageTitleCompact: {
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 27,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  card: {
    borderRadius: radius.lg,
    gap: spacing.sm,
    padding: spacing.md,
  },
  heroCard: {
    borderRadius: radius.xl,
    gap: spacing.sm,
    overflow: "hidden",
    padding: spacing.md,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 15,
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
  },
  iconBadgeText: {
    fontWeight: "900",
    lineHeight: 24,
  },
  metricCard: {
    flexBasis: "47%",
    flexGrow: 1,
    gap: 6,
    padding: spacing.sm + 2,
  },
  metricHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
  },
  metricDetail: {
    fontSize: 11,
    lineHeight: 15,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    ...typography.button,
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.button,
  },
  formField: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 132,
  },
  formLabel: {
    ...typography.button,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  listRow: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm + 2,
  },
  listText: {
    flex: 1,
    gap: spacing.xs,
  },
  listTitle: {
    ...typography.button,
  },
  listSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  listTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  listAmount: {
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 23,
  },
  emptyState: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  emptyText: {
    flex: 1,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.button,
  },
  emptyDescription: {
    ...typography.body,
  },
  loadingState: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    padding: spacing.md,
  },
  loadingLabel: {
    ...typography.body,
    flex: 1,
  },
  inlineNotice: {
    alignItems: "flex-start",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm + 2,
  },
  inlineNoticeCopy: {
    flex: 1,
    gap: 2,
  },
  inlineNoticeTitle: {
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
  },
  inlineNoticeMessage: {
    fontSize: 13,
    lineHeight: 18,
  },
  bottomNav: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    elevation: 8,
    left: 0,
    position: "absolute",
    right: 0,
  },
  kioskBottomNav: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    left: 10,
    minHeight: 66,
    paddingHorizontal: 6,
    position: "absolute",
    right: 10,
  },
  ownerBottomNav: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    left: 10,
    minHeight: 66,
    paddingHorizontal: 6,
    position: "absolute",
    right: 10,
  },
  ownerBottomNavTabs: {
    alignItems: "flex-end",
    flexDirection: "row",
    minHeight: 64,
  },
  bottomNavTabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
    paddingTop: 6,
  },
  bottomNavItem: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 58,
  },
  bottomNavIconWrap: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 30,
    justifyContent: "center",
    width: 46,
  },
  bottomNavText: {
    fontSize: 10.5,
    lineHeight: 14,
  },
  bentaNavItem: {
    alignItems: "center",
    flex: 1.12,
    gap: 2,
    justifyContent: "flex-end",
    minHeight: 72,
    paddingBottom: 6,
  },
  bentaOrb: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 3,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
});
