import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import {
  GuidedSetupScreen,
  LocationSummary,
  StallDetailsForm,
  type StallBusinessOption,
  type StallDetailsErrors,
  type StallDetailsField,
  type StallDetailsFormValue,
} from "@/components/onboarding";
import { AppTopBar } from "@/components/ui/KitaMoUI";
import { inheritLocationRef, validateStallSetup } from "@/domain/onboarding";
import type { Branch, Business } from "@/domain/types";
import {
  createGuidedStall,
  loadGuidedSetupStatus,
  type GuidedSetupStatus,
} from "@/services/guidedOnboarding";
import {
  getApprovedLocationProvider,
  type LocationProviderAvailability,
} from "@/services/locationProvider";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function AddStallScreen() {
  const params = useLocalSearchParams<{ businessId?: string | string[]; makeActive?: string | string[] }>();
  const router = useRouter();
  const { palette } = useGabiTheme();
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<GuidedSetupStatus | null>(null);
  const [providerStatus, setProviderStatus] = useState<LocationProviderAvailability>("not_configured");
  const [preselectedBusinessId, setPreselectedBusinessId] = useState<string | null>(null);
  const [value, setValue] = useState<StallDetailsFormValue>({
    stallName: "Main Stall",
    businessId: null,
    locationRef: null,
    inheritsBusinessLocation: true,
    branchType: "stall",
    notes: "",
  });
  const [touched, setTouched] = useState<Set<StallDetailsField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createdBusiness, setCreatedBusiness] = useState<Business | null>(null);
  const [createdStall, setCreatedStall] = useState<Branch | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadGuidedSetupStatus(),
      getApprovedLocationProvider().getAvailability(),
    ])
      .then(([nextStatus, availability]) => {
        if (!active) return;
        const businesses = nextStatus.ownerStatus.businesses;
        const requestedId = firstParam(params.businessId);
        const requestedBusiness = businesses.find((business) => business.id === requestedId) ?? null;
        const selectedBusiness = requestedBusiness ?? nextStatus.ownerStatus.activeBusiness ?? businesses[0] ?? null;

        setStatus(nextStatus);
        setProviderStatus(availability);
        setPreselectedBusinessId(requestedBusiness?.id ?? null);
        setOwnerContext(nextStatus.ownerStatus.activeBusiness, nextStatus.ownerStatus.activeBranch);
        if (selectedBusiness) {
          setValue((current) => ({
            ...current,
            businessId: selectedBusiness.id,
            locationRef: inheritLocationRef(selectedBusiness.locationRef),
            inheritsBusinessLocation: true,
          }));
        }
      })
      .catch((error) => {
        logDevError("AddStall.load", error);
        if (active) setMessage(getFriendlyErrorMessage("Hindi ma-load ang Add Stall."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [params.businessId, setOwnerContext]);

  const businesses = useMemo(
    () => status?.ownerStatus.businesses ?? [],
    [status?.ownerStatus.businesses],
  );
  const selectedBusiness = businesses.find((business) => business.id === value.businessId) ?? null;
  const businessOptions = useMemo<StallBusinessOption[]>(
    () => businesses.map((business) => ({ id: business.id, name: business.businessName, locationRef: business.locationRef })),
    [businesses],
  );
  const validation = useMemo(
    () => validateStallSetup({
      stallName: value.stallName,
      businessId: value.businessId,
      locationRef: value.inheritsBusinessLocation ? selectedBusiness?.locationRef ?? null : value.locationRef,
    }),
    [selectedBusiness?.locationRef, value],
  );
  const visibleErrors = useMemo<StallDetailsErrors>(() => {
    if (submitted) return validation.errors;
    return Object.fromEntries(
      Object.entries(validation.errors).filter(([field]) => touched.has(field as StallDetailsField)),
    ) as StallDetailsErrors;
  }, [submitted, touched, validation.errors]);

  function close() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/owner/business-settings");
  }

  function touchField(field: StallDetailsField) {
    setTouched((current) => new Set(current).add(field));
  }

  async function saveStall() {
    if (saving || !selectedBusiness) return;
    setSubmitted(true);
    setMessage(null);
    if (!validation.valid) return;

    const requestedMakeActive = firstParam(params.makeActive) === "true";
    const fillsEmptyActiveContext =
      status?.ownerStatus.activeBusiness?.id === selectedBusiness.id && !status.ownerStatus.activeBranch;
    setSaving(true);
    try {
      const result = await createGuidedStall({
        businessId: selectedBusiness.id,
        stallName: value.stallName,
        locationRef: value.inheritsBusinessLocation
          ? selectedBusiness.locationRef
          : value.locationRef,
        inheritsBusinessLocation: value.inheritsBusinessLocation,
        branchType: value.branchType,
        notes: value.notes,
        makeActive: requestedMakeActive || fillsEmptyActiveContext,
      });
      setOwnerContext(result.status.ownerStatus.activeBusiness, result.status.ownerStatus.activeBranch);
      setStatus(result.status);
      setCreatedBusiness(result.business);
      setCreatedStall(result.stall);
    } catch (error) {
      logDevError("AddStall.save", error);
      setMessage(getFriendlyErrorMessage("Hindi ma-save ang stall. Walang partial na record na ginawa."));
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <AppTopBar
      backHref="/owner/business-settings"
      eyebrow="OWNER · ADD STALL"
      right={selectedBusiness ? <GabiChip label={selectedBusiness.businessName} tone="primary" /> : undefined}
      subtitle={selectedBusiness ? `Para sa ${selectedBusiness.businessName}` : "Pumili ng negosyo"}
      title="Bagong stall"
    />
  );

  if (loading) {
    return (
      <GuidedSetupScreen onBack={close} progress={header}>
        <GabiCard>
          <GabiSkeleton height={20} showImmediately width="48%" />
          <GabiSkeleton height={52} showImmediately />
          <GabiSkeleton height={68} showImmediately />
          <GabiSkeleton height={68} showImmediately />
        </GabiCard>
      </GuidedSetupScreen>
    );
  }

  if (!businesses.length) {
    return (
      <GuidedSetupScreen onBack={close} progress={header}>
        {message ? <GabiNotice message={message} title="Hindi ma-load" tone="danger" /> : null}
        <GabiCard>
          <GabiEmptyState
            actionLabel="Gumawa ng negosyo"
            icon="business-outline"
            message="Kailangan muna ng negosyo bago makagawa ng stall."
            onAction={() => router.replace("/owner/add-business")}
            title="Wala pang negosyo"
          />
        </GabiCard>
      </GuidedSetupScreen>
    );
  }

  if (createdBusiness && createdStall) {
    const successLocation = createdStall.locationRef ?? createdBusiness.locationRef;
    return (
      <GuidedSetupScreen
        footer={
          <View style={styles.footerActions}>
            <GabiPrimaryButton icon="checkmark" label="Tapos na" onPress={close} />
            <GabiSoftButton icon="home-outline" label="Buksan ang Owner Home" onPress={() => router.replace("/owner")} />
          </View>
        }
        onBack={close}
        progress={header}
        testID="add-stall-success"
      >
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
            <Ionicons color={palette.success} name="checkmark" size={40} />
          </View>
          <View style={styles.successCopy}>
            <GabiText style={styles.centeredText} variant="h1">Nagawa na ang {createdStall.branchName}!</GabiText>
            <GabiText style={styles.centeredText} tone="muted" variant="body">
              Naka-save ito sa {createdBusiness.businessName} sa phone na ito.
            </GabiText>
          </View>

          <GabiCard>
            <View style={styles.receiptRow}>
              <Ionicons color={palette.primary} name="storefront-outline" size={20} />
              <View style={styles.receiptCopy}>
                <GabiText variant="buttonSm">{createdBusiness.businessName}</GabiText>
                <GabiText tone="muted" variant="caption">Negosyo</GabiText>
              </View>
            </View>
            <View style={styles.receiptRow}>
              <Ionicons color={palette.primary} name="business-outline" size={20} />
              <View style={styles.receiptCopy}>
                <GabiText variant="buttonSm">{createdStall.branchName}</GabiText>
                <GabiText tone="muted" variant="caption">
                  {createdStall.branchType} · {createdStall.inheritsBusinessLocation ? "kapareho ng business location" : "sariling lokasyon"}
                </GabiText>
              </View>
            </View>
            <LocationSummary inherited={createdStall.inheritsBusinessLocation} value={successLocation} />
          </GabiCard>

          <GabiNotice
            message="Local stall lang ang ginawa. Walang remote seller join code, account, o cloud connection na inimbento."
            title="Same-device at offline"
            tone="owner"
          />
        </View>
      </GuidedSetupScreen>
    );
  }

  return (
    <GuidedSetupScreen
      footer={
        <GabiPrimaryButton
          icon="checkmark"
          label={saving ? "Sine-save ang stall…" : "I-save ang stall"}
          loading={saving}
          onPress={() => void saveStall()}
        />
      }
      footerHint={submitted && !validation.valid ? validation.summary ?? undefined : undefined}
      onBack={close}
      progress={header}
      testID="add-stall-screen"
    >
      {message ? <GabiNotice message={message} title="Hindi na-save" tone="danger" /> : null}
      {submitted && !validation.valid ? (
        <GabiNotice message="Kumpletuhin ang mga field na may pulang mensahe." title="May kulang pa" tone="danger" />
      ) : null}
      <StallDetailsForm
        businesses={businessOptions}
        disabled={saving}
        errors={visibleErrors}
        introMessage="Naka-prefill ang Main Stall at ang lokasyon ng napiling negosyo. Puwede mong palitan pareho."
        locationProviderStatus={providerStatus}
        onBlurField={touchField}
        onChange={setValue}
        preselectedBusinessId={preselectedBusinessId}
        value={value}
      />
    </GuidedSetupScreen>
  );
}

const styles = StyleSheet.create({
  footerActions: {
    gap: spacing.sm,
  },
  successContent: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
  successIcon: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 42,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  successCopy: {
    alignSelf: "center",
    gap: spacing.xs,
    maxWidth: 320,
  },
  centeredText: {
    textAlign: "center",
  },
  receiptRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  receiptCopy: {
    flex: 1,
    gap: 2,
  },
});
