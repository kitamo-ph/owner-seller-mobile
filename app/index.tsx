import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiPrimaryButton } from "@/components/gabi/GabiButton";
import { GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiText } from "@/components/gabi/GabiText";
import { ScreenScroll } from "@/components/ui/KitaMoUI";
import { loadGuidedSetupStatus } from "@/services/guidedOnboarding";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

/**
 * Startup is deliberately a routing gate, not an onboarding choice screen.
 * The first meaningful question for an incomplete installation lives at
 * /onboarding; configured legacy owners continue straight into Owner mode.
 */
export default function StartupGateScreen() {
  const router = useRouter();
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const openCorrectExperience = useCallback(async () => {
    setErrorMessage(null);
    try {
      const status = await loadGuidedSetupStatus();
      setOwnerContext(status.ownerStatus.activeBusiness, status.ownerStatus.activeBranch);

      if (status.destination === "owner-app") {
        router.replace("/owner");
        return;
      }

      router.replace("/onboarding" as Href);
    } catch (error) {
      logDevError("StartupGate.openCorrectExperience", error);
      setErrorMessage(getFriendlyErrorMessage("Hindi mabuksan ang local setup. Subukan ulit."));
    }
  }, [router, setOwnerContext]);

  useEffect(() => {
    void openCorrectExperience();
  }, [attempt, openCorrectExperience]);

  return (
    <ScreenScroll>
      <View style={styles.content}>
        <View style={styles.brandCopy}>
          <GabiText tone="primary" variant="eyebrow">
            KITAMO
          </GabiText>
          <GabiText variant="h1">Inihahanda ang KitaMo mo…</GabiText>
          <GabiText tone="muted" variant="body">
            Binubuksan ang iyong local na negosyo sa phone na ito.
          </GabiText>
        </View>

        {errorMessage ? (
          <>
            <GabiNotice message={errorMessage} title="Hindi muna mabuksan" tone="danger" />
            <GabiPrimaryButton icon="refresh" label="Subukan ulit" onPress={() => setAttempt((value) => value + 1)} />
          </>
        ) : (
          <View style={styles.skeletons}>
            <GabiSkeleton height={18} showImmediately width="72%" />
            <GabiSkeleton height={52} showImmediately />
            <GabiSkeleton height={52} showImmediately />
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    justifyContent: "center",
    minHeight: 560,
  },
  brandCopy: {
    gap: spacing.sm,
  },
  skeletons: {
    gap: spacing.md,
  },
});
