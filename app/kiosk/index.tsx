import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import type { Branch } from "@/domain/types";
import { loadOwnerSetupStatus, switchActiveBranchContext, type OwnerSetupStatus } from "@/services/ownerSetup";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function KioskStallSelectionScreen() {
  const params = useLocalSearchParams<{ branchId?: string }>();
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingLock = useRef(false);
  const confirmKioskContext = useAppStore((state) => state.confirmKioskContext);
  const clearKioskSession = useAppStore((state) => state.clearKioskSession);
  const { palette, extended } = useGabiTheme();
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await loadOwnerSetupStatus();
      const activeBranches = nextStatus.branches.filter((branch) => branch.active);
      const requestedBranchId = Array.isArray(params.branchId) ? params.branchId[0] : params.branchId;
      const requestedBranch = activeBranches.find((branch) => branch.id === requestedBranchId);
      setStatus(nextStatus);
      setSelectedBranchId(requestedBranch?.id ?? null);
      setError(null);
    } catch (loadError) {
      logDevError("KioskStallSelection.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load your stalls."));
    } finally {
      setLoading(false);
    }
  }, [params.branchId]);

  useFocusEffect(
    useCallback(() => {
      clearKioskSession();
      void refresh();
    }, [clearKioskSession, refresh]),
  );

  const activeBranches = useMemo(() => status?.branches.filter((branch) => branch.active) ?? [], [status?.branches]);
  const selectedBranch = activeBranches.find((branch) => branch.id === selectedBranchId) ?? null;

  async function openKiosk() {
    if (openingLock.current || !selectedBranch) return;

    openingLock.current = true;
    setOpening(true);
    setError(null);
    try {
      const nextStatus = await switchActiveBranchContext(selectedBranch.id);
      if (!nextStatus.activeBusiness || !nextStatus.activeBranch) {
        throw new Error("Kiosk requires a valid business and active stall.");
      }
      confirmKioskContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      router.replace("/kiosk/sell");
    } catch (openError) {
      logDevError("KioskStallSelection.openKiosk", openError);
      setError(getFriendlyErrorMessage("Could not open Kiosk for this stall."));
    } finally {
      openingLock.current = false;
      setOpening(false);
    }
  }

  return (
    <ScreenScroll>
      <AppTopBar backHref="/owner" eyebrow="SHARED-DEVICE KIOSK" subtitle="Pumili at magkumpirma ng stall" title="Buksan ang BENTA" />

      <GabiNotice
        message="Ang napiling stall ang gagamitin para sa products at sales ng session na ito. Wala pang seller account o remote access."
        title="Stall-specific Kiosk"
        tone="shared"
      />

      {error ? <GabiNotice message={error} title="Hindi mabuksan ang Kiosk" tone="danger" /> : null}
      {loading ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="40%" />
          <GabiSkeleton height={76} showImmediately />
          <GabiSkeleton height={76} showImmediately />
        </GabiCard>
      ) : null}

      {!loading && !status?.activeBusiness ? (
        <GabiEmptyState
          actionLabel={status?.businesses.length ? "Pumili ng negosyo" : "I-set up ang negosyo"}
          icon="business-outline"
          message={status?.businesses.length ? "Pumili muna nang kusa ng saved business bago mag-Kiosk." : "Gumawa muna ng local business profile bago mag-Kiosk."}
          onAction={() => router.push(status?.businesses.length ? "/owner/context" : "/owner/business-settings")}
          title={status?.businesses.length ? "Walang napiling negosyo" : "Kailangan ng business setup"}
        />
      ) : null}

      {!loading && status?.activeBusiness && activeBranches.length === 0 ? (
        <GabiEmptyState
          actionLabel="Pamahalaan ang stalls"
          icon="storefront-outline"
          message="Magdagdag o mag-activate ng stall bago buksan ang Kiosk."
          onAction={() => router.push("/owner/business-settings")}
          title="Walang active stall"
        />
      ) : null}

      {!loading && activeBranches.length > 0 ? (
        <GabiCard>
          <GabiSectionHeader action={<GabiChip label={`${activeBranches.length} active`} tone="success" />} title="Piliin ang stall" />
          <GabiText tone="muted" variant="caption">{status?.activeBusiness?.businessName}</GabiText>
          <View accessibilityRole="radiogroup" style={styles.stallList}>
            {activeBranches.map((branch) => (
              <KioskStallOption
                branch={branch}
                key={branch.id}
                onSelect={() => setSelectedBranchId(branch.id)}
                productCount={countProductsForBranch(status, branch.id)}
                selected={selectedBranchId === branch.id}
              />
            ))}
          </View>
        </GabiCard>
      ) : null}

      <GabiCard raised style={styles.confirmCard}>
        <View style={styles.confirmHeader}>
          <View style={[styles.confirmIcon, { backgroundColor: selectedBranch ? palette.softSuccess : extended.disabledBg }]}>
            <Ionicons color={selectedBranch ? palette.success : extended.disabledText} name={selectedBranch ? "checkmark-circle" : "storefront-outline"} size={23} />
          </View>
          <View style={styles.confirmCopy}>
            <GabiText tone="muted" variant="caption">Kiosk session para sa</GabiText>
            <GabiText numberOfLines={2} style={!selectedBranch ? { color: extended.disabledText } : undefined} variant="cardTitle">
              {selectedBranch?.branchName ?? "Pumili muna ng stall"}
            </GabiText>
          </View>
        </View>
        <GabiPrimaryButton
          accessibilityHint="Kukumpirmahin ang stall para sa transient Kiosk session"
          disabled={!selectedBranch || opening}
          icon="storefront"
          label={opening ? "Binubuksan..." : "Kumpirmahin at Buksan"}
          loading={opening}
          onPress={openKiosk}
        />
        {!selectedBranch ? <GabiText tone="faint" variant="caption">Pumili muna ng active stall sa itaas.</GabiText> : null}
        <GabiText tone="faint" variant="caption">Kailangang pumili at magkumpirma ulit sa susunod na Kiosk session.</GabiText>
      </GabiCard>

      <GabiSoftButton icon="arrow-back" label="Bumalik sa Owner Home" onPress={() => router.replace("/owner")} />
    </ScreenScroll>
  );
}

function countProductsForBranch(status: OwnerSetupStatus | null, branchId: string) {
  return status?.products.filter((product) => product.active && (product.branchId === branchId || product.branchId === null)).length ?? 0;
}

function KioskStallOption({ branch, productCount, selected, onSelect }: { branch: Branch; productCount: number; selected: boolean; onSelect: () => void }) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={branch.branchName}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.stallOption,
        {
          backgroundColor: selected || pressed ? palette.softPrimary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}
    >
      <View style={[styles.stallIcon, { backgroundColor: selected ? palette.primary : palette.softPrimary }]}>
        <Ionicons color={selected ? palette.kioskHeaderText : palette.primary} name="storefront-outline" size={22} />
      </View>
      <View style={styles.stallCopy}>
        <GabiText numberOfLines={1} variant="cardTitle">{branch.branchName}</GabiText>
        <GabiText numberOfLines={2} tone="muted" variant="caption">
          {branch.location ?? branch.branchType} · {productCount} paninda
        </GabiText>
      </View>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : extended.radioOff }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stallList: {
    gap: spacing.sm,
  },
  stallOption: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 74,
    padding: spacing.sm,
  },
  stallIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  stallCopy: {
    flex: 1,
    gap: 2,
  },
  radio: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  confirmCard: {
    gap: spacing.md,
  },
  confirmHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  confirmIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  confirmCopy: {
    flex: 1,
    gap: 2,
  },
});
