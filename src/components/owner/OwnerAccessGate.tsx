import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconBadge, KitaMoBrand, PrimaryButton, SecondaryButton } from "@/components/ui/KitaMoUI";
import { formatOwnerPinLockoutMessage, ownerPinLockoutRemainingMs } from "@/domain/ownerPinSecurity";
import {
  authenticateOwnerWithBiometrics,
  getOwnerAccessStatus,
  getOwnerPinAttemptState,
  verifyOwnerPinWithThrottle,
} from "@/services/ownerAccess";
import { useOwnerAccessStore } from "@/state/ownerAccessStore";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { typography } from "@/theme/typography";
import { logDevError } from "@/utils/errors";

export function OwnerAccessGate({ children }: PropsWithChildren) {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const attemptLock = useRef(false);
  const hydrated = useOwnerAccessStore((state) => state.hydrated);
  const isProtectionEnabled = useOwnerAccessStore((state) => state.isProtectionEnabled);
  const isUnlocked = useOwnerAccessStore((state) => state.isUnlocked);
  const hydrate = useOwnerAccessStore((state) => state.hydrate);
  const lock = useOwnerAccessStore((state) => state.lock);
  const unlock = useOwnerAccessStore((state) => state.unlock);
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const router = useRouter();

  useEffect(() => {
    let active = true;
    Promise.all([getOwnerAccessStatus(), getOwnerPinAttemptState()])
      .then(([status, attemptState]) => {
        if (active) {
          setBiometricEnabled(status.biometricEnabled);
          setLockoutUntil(attemptState.lockoutUntil);
          setClockNow(Date.now());
          hydrate(status.hasPin);
        }
      })
      .catch((error) => {
        logDevError("OwnerAccessGate.load", error);
        if (active) {
          hydrate(false);
        }
      });

    return () => {
      active = false;
    };
  }, [hydrate]);

  const lockoutRemainingMs = ownerPinLockoutRemainingMs({ failedAttempts: 0, lockoutUntil }, clockNow);

  useEffect(() => {
    if (lockoutRemainingMs <= 0) {
      if (message?.startsWith("Too many attempts.")) {
        setMessage(null);
      }
      return;
    }

    setMessage(formatOwnerPinLockoutMessage(lockoutRemainingMs));
    const timer = setTimeout(() => setClockNow(Date.now()), Math.min(1000, lockoutRemainingMs));
    return () => clearTimeout(timer);
  }, [lockoutRemainingMs, message]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        lock();
      }
    });
    return () => subscription.remove();
  }, [lock]);

  useEffect(() => {
    if (!isProtectionEnabled || isUnlocked) {
      return;
    }

    getOwnerAccessStatus()
      .then((status) => setBiometricEnabled(status.biometricEnabled))
      .catch((error) => logDevError("OwnerAccessGate.refreshBiometrics", error));
  }, [isProtectionEnabled, isUnlocked]);

  async function submitPin() {
    if (attemptLock.current || checking) {
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setMessage("Enter your 4 to 6 digit Owner PIN.");
      return;
    }

    attemptLock.current = true;
    setChecking(true);
    setMessage(null);
    try {
      const result = await verifyOwnerPinWithThrottle(pin);
      if (result.status === "success") {
        setPin("");
        setLockoutUntil(0);
        unlock();
        return;
      }

      setPin("");
      if (result.status === "locked") {
        setLockoutUntil(result.state.lockoutUntil);
        setClockNow(Date.now());
        setMessage(formatOwnerPinLockoutMessage(result.remainingMs));
      } else {
        const attempts = result.attemptsBeforeLockout;
        setMessage(`Wrong PIN. ${attempts} attempt${attempts === 1 ? "" : "s"} before a 30-second lock.`);
      }
    } catch (error) {
      logDevError("OwnerAccessGate.submitPin", error);
      setMessage("Could not verify the PIN. Please try again.");
    } finally {
      attemptLock.current = false;
      setChecking(false);
    }
  }

  async function useBiometrics() {
    if (attemptLock.current || checking) {
      return;
    }
    attemptLock.current = true;
    setChecking(true);
    setMessage(null);
    try {
      if (await authenticateOwnerWithBiometrics()) {
        unlock();
      } else {
        setMessage("Device unlock was not confirmed. Use your Owner PIN.");
      }
    } catch (error) {
      logDevError("OwnerAccessGate.useBiometrics", error);
      setMessage("Biometric unlock is unavailable. Use your Owner PIN.");
    } finally {
      attemptLock.current = false;
      setChecking(false);
    }
  }

  if (!hydrated) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} size="large" />
        <Text style={[styles.helper, { color: palette.mutedText }]}>Checking Owner access...</Text>
      </SafeAreaView>
    );
  }

  if (!isProtectionEnabled || isUnlocked) {
    return children;
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.lockContent}>
        <KitaMoBrand centered />
        <View style={[styles.lockCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <IconBadge icon="lock-closed" size="lg" tone="primary" />
          <Text style={[styles.title, { color: palette.text }]}>Owner Mode is locked</Text>
          <Text style={[styles.helper, { color: palette.mutedText }]}>Enter the local PIN to view reports, costs, and business settings.</Text>
          <TextInput
            autoFocus
            editable={lockoutRemainingMs <= 0 && !checking}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => setPin(value.replace(/\D/g, ""))}
            onSubmitEditing={submitPin}
            placeholder="Owner PIN"
            placeholderTextColor={palette.mutedText}
            secureTextEntry
            style={[styles.pinInput, { backgroundColor: palette.background, borderColor: message ? palette.danger : palette.border, color: palette.text }]}
            value={pin}
          />
          {message ? <Text style={[styles.message, { color: palette.danger }]}>{message}</Text> : null}
          <PrimaryButton
            disabled={checking || lockoutRemainingMs > 0}
            label={checking ? "Checking..." : lockoutRemainingMs > 0 ? "Temporarily locked" : "Unlock Owner Mode"}
            onPress={submitPin}
          />
          {biometricEnabled ? (
            <SecondaryButton disabled={checking} label="Use fingerprint or face unlock" onPress={useBiometrics} />
          ) : null}
        </View>
        <Pressable onPress={() => router.replace("/kiosk")} style={styles.kioskLink}>
          <Text style={[styles.kioskLinkText, { color: palette.primary }]}>Return to Kiosk</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    alignItems: "center",
    gap: spacing.md,
    justifyContent: "center",
  },
  lockContent: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    padding: spacing.lg,
  },
  lockCard: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
    textAlign: "center",
  },
  helper: {
    ...typography.body,
    textAlign: "center",
  },
  pinInput: {
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    textAlign: "center",
    width: "100%",
  },
  message: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  kioskLink: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  kioskLinkText: {
    ...typography.button,
  },
});
