import { useEffect, type ReactNode } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiText } from "@/components/gabi/GabiText";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type GuidedSetupScreenProps = {
  children: ReactNode;
  progress?: ReactNode;
  footer?: ReactNode;
  footerHint?: string;
  onBack?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Keyboard-safe full-screen shell shared by first-use setup and the owner Add
 * Business / Add Stall routes. The footer remains reachable while the body can
 * scroll on short Android screens.
 */
export function GuidedSetupScreen({
  children,
  progress,
  footer,
  footerHint,
  onBack,
  contentContainerStyle,
  testID,
}: GuidedSetupScreenProps) {
  const insets = useSafeAreaInsets();
  const { palette, extended } = useGabiTheme();

  useEffect(() => {
    if (!onBack) return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]} testID={testID}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={styles.keyboardRoot}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: insets.top + spacing.sm,
              paddingBottom: footer ? spacing.lg : insets.bottom + spacing.lg,
            },
            contentContainerStyle,
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {progress}
          <View style={styles.body}>{children}</View>
        </ScrollView>

        {footer ? (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: palette.surface,
                borderColor: extended.hairline,
                paddingBottom: Math.max(insets.bottom, spacing.sm),
              },
            ]}
          >
            {footer}
            {footerHint ? (
              <GabiText accessibilityLiveRegion="polite" style={styles.footerHint} tone="faint" variant="caption">
                {footerHint}
              </GabiText>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  keyboardRoot: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  body: {
    flexGrow: 1,
    gap: spacing.lg,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  footerHint: {
    textAlign: "center",
  },
});
