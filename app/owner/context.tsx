import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import type { Branch } from "@/domain/types";
import {
  loadOwnerSetupStatus,
  switchActiveBranchContext,
  switchActiveBusinessContext,
  type OwnerSetupStatus,
} from "@/services/ownerSetup";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function OwnerContextScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const switchLock = useRef(false);
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const { palette, extended } = useGabiTheme();
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await loadOwnerSetupStatus();
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setError(null);
    } catch (loadError) {
      logDevError("OwnerContext.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load business context."));
    } finally {
      setLoading(false);
    }
  }, [setOwnerContext]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function chooseBusiness(businessId: string) {
    if (switchLock.current || status?.activeBusiness?.id === businessId) return;

    switchLock.current = true;
    setSwitchingId(businessId);
    try {
      const nextStatus = await switchActiveBusinessContext(businessId);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setError(null);
    } catch (switchError) {
      logDevError("OwnerContext.chooseBusiness", switchError);
      setError(getFriendlyErrorMessage("Could not switch businesses."));
    } finally {
      switchLock.current = false;
      setSwitchingId(null);
    }
  }

  async function chooseBranch(branch: Branch) {
    if (switchLock.current || status?.activeBranch?.id === branch.id || !branch.active) return;

    switchLock.current = true;
    setSwitchingId(branch.id);
    try {
      const nextStatus = await switchActiveBranchContext(branch.id);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setError(null);
    } catch (switchError) {
      logDevError("OwnerContext.chooseBranch", switchError);
      setError(getFriendlyErrorMessage("Could not switch stalls."));
    } finally {
      switchLock.current = false;
      setSwitchingId(null);
    }
  }

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        backHref="/owner"
        eyebrow="OWNER CONTEXT"
        subtitle="Piliin ang persistent workspace sa phone na ito"
        title="Negosyo at Stall"
      />

      <GabiNotice
        message="Owner context lang ang binabago nito. Bawat Kiosk session ay kailangan pa ring pumili at magkumpirma ng stall."
        title="Local at same-device"
        tone="owner"
      />

      {error ? <GabiNotice message={error} title="Hindi napalitan ang context" tone="danger" /> : null}
      {loading && !status ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="38%" />
          <GabiSkeleton height={70} showImmediately />
          <GabiSkeleton height={70} showImmediately />
        </GabiCard>
      ) : null}

      {status ? (
        <GabiCard>
          <GabiSectionHeader action={<GabiChip label={`${status.businesses.length} saved`} />} title="Mga negosyo" />
          {status.businesses.length === 0 ? (
            <GabiEmptyState
              actionLabel="Gumawa ng negosyo"
              icon="business-outline"
              message="Gumawa muna ng local business profile bago pumili ng Owner context."
              onAction={() => router.push("/owner/business-settings")}
              title="Wala pang negosyo"
            />
          ) : (
            <View accessibilityRole="radiogroup" style={styles.list}>
              {status.businesses.map((business) => {
                const selected = status.activeBusiness?.id === business.id;
                const switching = switchingId === business.id;
                return (
                  <Pressable
                    accessibilityLabel={business.businessName}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: switchingId !== null }}
                    disabled={switchingId !== null}
                    key={business.id}
                    onPress={() => chooseBusiness(business.id)}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: selected ? palette.softPrimary : pressed ? palette.background : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <SelectionMark selected={selected} />
                    <View style={styles.optionCopy}>
                      <GabiText numberOfLines={1} variant="cardTitle">{business.businessName}</GabiText>
                      <GabiText numberOfLines={2} tone="muted" variant="caption">
                        {business.businessType} · {business.barangay}
                      </GabiText>
                    </View>
                    <GabiChip label={switching ? "Pinapalitan" : selected ? "Aktibo" : "Piliin"} tone={selected ? "success" : "neutral"} />
                  </Pressable>
                );
              })}
            </View>
          )}
          {status.businesses.length > 0 ? (
            <GabiSoftButton icon="settings-outline" label="Pamahalaan ang negosyo" onPress={() => router.push("/owner/business-settings")} />
          ) : null}
        </GabiCard>
      ) : null}

      {status?.activeBusiness ? (
        <GabiCard>
          <GabiSectionHeader
            action={<GabiChip label={`${status.branches.filter((branch) => branch.active).length} active`} tone="success" />}
            title="Mga stall"
          />
          <GabiText tone="muted" variant="caption">Sa {status.activeBusiness.businessName}</GabiText>
          {status.branches.length === 0 ? (
            <GabiEmptyState
              actionLabel="Magdagdag ng stall"
              icon="storefront-outline"
              message="Magdagdag muna ng stall bago pumili ng operational context."
              onAction={() => router.push("/owner/business-settings")}
              title="Wala pang stall"
            />
          ) : (
            <View accessibilityRole="radiogroup" style={styles.list}>
              {status.branches.map((branch) => {
                const selected = status.activeBranch?.id === branch.id;
                const productCount = status.products.filter((product) => product.branchId === branch.id).length;
                const switching = switchingId === branch.id;
                return (
                  <View
                    key={branch.id}
                    style={[
                      styles.stallOption,
                      {
                        backgroundColor: branch.active ? palette.surface : extended.disabledBg,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityLabel={branch.branchName}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: !branch.active || switchingId !== null }}
                      disabled={!branch.active || switchingId !== null}
                      onPress={() => chooseBranch(branch)}
                      style={styles.stallSelect}
                    >
                      <SelectionMark disabled={!branch.active} selected={selected} />
                      <View style={styles.optionCopy}>
                        <GabiText numberOfLines={1} style={!branch.active ? { color: extended.disabledText } : undefined} variant="cardTitle">
                          {branch.branchName}
                        </GabiText>
                        <GabiText numberOfLines={2} style={!branch.active ? { color: extended.disabledText } : undefined} tone="muted" variant="caption">
                          {branch.location ?? branch.branchType} · {productCount} paninda
                        </GabiText>
                      </View>
                      <GabiChip
                        label={switching ? "Pinapalitan" : selected ? "Aktibo" : branch.active ? "Piliin" : "Naka-off"}
                        tone={selected ? "success" : branch.active ? "neutral" : "warning"}
                      />
                    </Pressable>
                    <View style={[styles.stallFooter, { borderColor: palette.border }]}>
                      <GabiText tone={branch.active ? "muted" : "faint"} variant="caption">
                        {branch.active ? "Kiosk requires confirmation" : "I-activate muna sa Business & Stalls"}
                      </GabiText>
                      <Pressable
                        accessibilityLabel={`Buksan ang Kiosk picker para sa ${branch.branchName}`}
                        accessibilityRole="button"
                        disabled={!branch.active}
                        onPress={() => router.push({ pathname: "/kiosk", params: { branchId: branch.id } })}
                        style={styles.kioskAction}
                      >
                        <Ionicons color={branch.active ? palette.primary : extended.disabledText} name="storefront-outline" size={17} />
                        <GabiText style={!branch.active ? { color: extended.disabledText } : undefined} tone="primary" variant="buttonSm">
                          {branch.active ? "Buksan Kiosk" : "Hindi available"}
                        </GabiText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          <GabiSoftButton icon="storefront-outline" label="Pamahalaan ang stalls" onPress={() => router.push("/owner/business-settings")} />
        </GabiCard>
      ) : status && status.businesses.length > 0 ? (
        <GabiEmptyState
          icon="business-outline"
          message="Pumili nang kusa ng saved business. Hindi awtomatikong pipili ang KitaMo."
          title="Walang napiling negosyo"
        />
      ) : null}
    </ScreenScroll>
  );
}

function SelectionMark({ selected, disabled = false }: { selected: boolean; disabled?: boolean }) {
  const { palette, extended } = useGabiTheme();
  return (
    <View style={[styles.radio, { borderColor: disabled ? extended.disabledText : selected ? palette.primary : extended.radioOff }]}>
      {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  option: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    padding: spacing.sm,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
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
  stallOption: {
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  stallSelect: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    padding: spacing.sm,
  },
  stallFooter: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  kioskAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
  },
});
