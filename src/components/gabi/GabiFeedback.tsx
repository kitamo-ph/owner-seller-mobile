import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";

import { spacing } from "@/theme/spacing";
import { gabiComponents, gabiMotion } from "@/theme/tokens";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GabiPrimaryButton } from "./GabiButton";
import { GabiText } from "./GabiText";

type NoticeTone = "owner" | "shared" | "success" | "warning" | "danger";

export function GabiNotice({ title, message, tone = "owner" }: { title?: string; message: string; tone?: NoticeTone }) {
  const { palette, extended } = useGabiTheme();
  const background =
    tone === "shared" || tone === "warning"
      ? palette.softWarning
      : tone === "success"
        ? palette.softSuccess
        : tone === "danger"
          ? palette.softDanger
          : extended.violetChipBg;
  const foreground =
    tone === "shared" || tone === "warning"
      ? extended.warningDeep
      : tone === "success"
        ? extended.successDeep
        : tone === "danger"
          ? extended.dangerDeep
          : extended.violetChipText;
  const icon = tone === "danger" ? "alert-circle" : tone === "warning" || tone === "shared" ? "warning" : tone === "success" ? "checkmark-circle" : "information-circle";

  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <Ionicons color={foreground} name={icon} size={20} />
      <View style={styles.noticeCopy}>
        {title ? (
          <GabiText style={{ color: foreground }} variant="buttonSm">
            {title}
          </GabiText>
        ) : null}
        <GabiText style={{ color: foreground }} variant="caption">
          {message}
        </GabiText>
      </View>
    </View>
  );
}

export function GabiEmptyState({
  icon = "storefront-outline",
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { palette } = useGabiTheme();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name={icon} size={25} />
      </View>
      <View style={styles.emptyCopy}>
        <GabiText variant="cardTitle">{title}</GabiText>
        <GabiText tone="muted" variant="body">
          {message}
        </GabiText>
      </View>
      {actionLabel && onAction ? <GabiPrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function GabiSkeleton({ height = 18, width = "100%", showImmediately = false }: { height?: number; width?: number | `${number}%`; showImmediately?: boolean }) {
  const { extended } = useGabiTheme();
  const [visible, setVisible] = useState(showImmediately);
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (showImmediately) return;
    const timer = setTimeout(() => setVisible(true), gabiMotion.skeletonDelayMs);
    return () => clearTimeout(timer);
  }, [showImmediately]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible || reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { duration: gabiMotion.shimmerMs / 2, toValue: 1, useNativeDriver: true }),
        Animated.timing(opacity, { duration: gabiMotion.shimmerMs / 2, toValue: 0.45, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion, visible]);

  if (!visible) return null;

  return <Animated.View style={{ backgroundColor: extended.skeletonA, borderRadius: gabiComponents.skeleton.radius, height, opacity, width }} />;
}

export function GabiSnackbar({
  message,
  visible = true,
  onDismiss,
}: {
  message: string;
  visible?: boolean;
  onDismiss?: () => void;
}) {
  const { palette } = useGabiTheme();

  useEffect(() => {
    if (!visible || !onDismiss) return;
    const timer = setTimeout(onDismiss, gabiMotion.snackbarMs);
    return () => clearTimeout(timer);
  }, [onDismiss, visible]);

  if (!visible) return null;

  return (
    <View accessibilityLiveRegion="polite" style={[styles.snackbar, { backgroundColor: palette.kioskHeader }]}>
      <GabiText tone="inverse" variant="body">
        {message}
      </GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignItems: "flex-start",
    borderRadius: gabiComponents.notice.radius,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeCopy: {
    flex: 1,
    gap: 2,
  },
  emptyState: {
    alignItems: "stretch",
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  emptyIcon: {
    alignItems: "center",
    borderRadius: gabiComponents.emptyState.iconRadius,
    height: gabiComponents.emptyState.iconSize,
    justifyContent: "center",
    width: gabiComponents.emptyState.iconSize,
  },
  emptyCopy: {
    gap: spacing.xs,
  },
  snackbar: {
    borderRadius: gabiComponents.snackbar.radius,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
