import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import {
  BusinessDetailsForm,
  GuidedSetupScreen,
  LocationSummary,
  type BusinessDetailsErrors,
  type BusinessDetailsField,
  type BusinessDetailsFormValue,
} from "@/components/onboarding";
import {
  inheritLocationRef,
  suggestBusinessType,
  validateBusinessSetup,
} from "@/domain/onboarding";
import type { Business } from "@/domain/types";
import {
  createGuidedBusiness,
  loadGuidedSetupStatus,
} from "@/services/guidedOnboarding";
import {
  getApprovedLocationProvider,
  type LocationProviderAvailability,
} from "@/services/locationProvider";
import { useAppStore } from "@/state/appStore";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { AppTopBar } from "@/components/ui/KitaMoUI";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

const emptyBusiness: BusinessDetailsFormValue = {
  businessName: "",
  businessType: null,
  businessTypeCustom: "",
  locationRef: null,
  notes: "",
};

export default function AddBusinessScreen() {
  const router = useRouter();
  const { palette } = useGabiTheme();
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personName, setPersonName] = useState("");
  const [businessCount, setBusinessCount] = useState(0);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [providerStatus, setProviderStatus] = useState<LocationProviderAvailability>("not_configured");
  const [value, setValue] = useState<BusinessDetailsFormValue>(emptyBusiness);
  const [touched, setTouched] = useState<Set<BusinessDetailsField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createdBusiness, setCreatedBusiness] = useState<Business | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      loadGuidedSetupStatus(),
      getApprovedLocationProvider().getAvailability(),
    ])
      .then(([status, availability]) => {
        if (!active) return;
        setPersonName(status.personName);
        setBusinessCount(status.ownerStatus.businesses.length);
        setSavedBusinesses(status.ownerStatus.businesses);
        setProviderStatus(availability);
        setOwnerContext(status.ownerStatus.activeBusiness, status.ownerStatus.activeBranch);
      })
      .catch((error) => {
        logDevError("AddBusiness.load", error);
        if (active) setMessage(getFriendlyErrorMessage("Hindi ma-load ang Add Business."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [setOwnerContext]);

  const validation = useMemo(() => validateBusinessSetup(value), [value]);
  const visibleErrors = useMemo<BusinessDetailsErrors>(() => {
    if (submitted) return validation.errors;
    return Object.fromEntries(
      Object.entries(validation.errors).filter(([field]) => touched.has(field as BusinessDetailsField)),
    ) as BusinessDetailsErrors;
  }, [submitted, touched, validation.errors]);

  function close() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/owner/business-settings");
  }

  function touchField(field: BusinessDetailsField) {
    setTouched((current) => new Set(current).add(field));
  }

  function reuseAddress(business: Business) {
    setValue((current) => ({
      ...current,
      locationRef: inheritLocationRef(business.locationRef),
    }));
    setTouched((current) => new Set(current).add("location"));
    setMessage(null);
  }

  async function saveBusiness() {
    if (saving) return;
    setSubmitted(true);
    setMessage(null);
    if (!validation.valid) return;

    setSaving(true);
    try {
      const result = await createGuidedBusiness({
        personName,
        businessName: value.businessName,
        businessType: value.businessType,
        businessTypeCustom: value.businessTypeCustom,
        locationRef: value.locationRef,
        notes: value.notes,
      });
      setOwnerContext(result.status.ownerStatus.activeBusiness, result.status.ownerStatus.activeBranch);
      setCreatedBusiness(result.business);
    } catch (error) {
      logDevError("AddBusiness.save", error);
      setMessage(getFriendlyErrorMessage("Hindi ma-save ang negosyo. Walang partial na record na ginawa."));
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <AppTopBar
      backHref="/owner/business-settings"
      eyebrow="OWNER · ADD BUSINESS"
      right={<GabiChip label={`${Math.max(1, businessCount + (createdBusiness ? 1 : 0))} negosyo`} tone="neutral" />}
      subtitle={personName ? `Bagong negosyo ni ${personName}` : "Local business setup"}
      title="Bagong negosyo"
    />
  );

  if (loading) {
    return (
      <GuidedSetupScreen onBack={close} progress={header}>
        <GabiCard>
          <GabiSkeleton height={20} showImmediately width="54%" />
          <GabiSkeleton height={52} showImmediately />
          <GabiSkeleton height={52} showImmediately />
          <GabiSkeleton height={110} showImmediately />
        </GabiCard>
      </GuidedSetupScreen>
    );
  }

  if (createdBusiness) {
    return (
      <GuidedSetupScreen
        footer={
          <View style={styles.footerActions}>
            <GabiPrimaryButton
              icon="add-circle-outline"
              label="Magdagdag ng Stall"
              onPress={() =>
                router.replace({
                  pathname: "/owner/add-stall",
                  params: { businessId: createdBusiness.id, makeActive: "true" },
                })
              }
            />
            <GabiSoftButton icon="time-outline" label="Mamaya na lang" onPress={close} />
          </View>
        }
        onBack={close}
        progress={header}
        testID="add-business-success"
      >
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
            <Ionicons color={palette.success} name="storefront" size={38} />
          </View>
          <View style={styles.successCopy}>
            <GabiText style={styles.centeredText} variant="h1">Nagawa na ang {createdBusiness.businessName}!</GabiText>
            <GabiText style={styles.centeredText} tone="muted" variant="body">
              Wala pa itong stall, kaya hindi pa ito puwedeng magbenta. Gusto mong gawin na natin ngayon?
            </GabiText>
          </View>

          <GabiCard style={styles.receiptCard}>
            <ReceiptRow icon="storefront-outline" label="Negosyo" value={createdBusiness.businessName} />
            <ReceiptRow
              icon="pricetag-outline"
              label="Uri"
              value={createdBusiness.businessType === "Other"
                ? createdBusiness.businessTypeCustom ?? "Other"
                : createdBusiness.businessType}
            />
            <LocationSummary value={createdBusiness.locationRef} />
          </GabiCard>

          <GabiCard>
            <View style={styles.suggestionRow}>
              <View style={[styles.smallIcon, { backgroundColor: palette.softPrimary }]}>
                <Ionicons color={palette.primary} name="business-outline" size={19} />
              </View>
              <View style={styles.suggestionCopy}>
                <GabiText variant="buttonSm">Suggested: “Main Stall”</GabiText>
                <GabiText numberOfLines={2} tone="muted" variant="caption">
                  Mana ang address: {createdBusiness.locationRef.formattedAddress}
                </GabiText>
              </View>
            </View>
          </GabiCard>
        </View>
      </GuidedSetupScreen>
    );
  }

  return (
    <GuidedSetupScreen
      footer={
        <GabiPrimaryButton
          icon="checkmark"
          label={saving ? "Sine-save ang negosyo…" : "I-save ang negosyo"}
          loading={saving}
          onPress={() => void saveBusiness()}
        />
      }
      footerHint={submitted && !validation.valid ? validation.summary ?? undefined : undefined}
      onBack={close}
      progress={header}
      testID="add-business-screen"
    >
      {message ? <GabiNotice message={message} title="Hindi na-save" tone="danger" /> : null}
      {submitted && !validation.valid ? (
        <GabiNotice message="Kumpletuhin ang mga field na may pulang mensahe." title="May kulang pa" tone="danger" />
      ) : null}

      <BusinessDetailsForm
        disabled={saving}
        errors={visibleErrors}
        introMessage="Alam na namin kung sino ka. Pangalan, uri, at lokasyon na lang ang kailangan."
        locationAccessory={savedBusinesses.length ? (
          <View style={styles.reuseBlock}>
            <View style={styles.reuseHeader}>
              <Ionicons color={palette.primary} name="copy-outline" size={16} />
              <GabiText tone="primary" variant="caption">Gamitin ang saved address (opsyonal)</GabiText>
            </View>
            <View style={styles.addressChoices}>
              {savedBusinesses.slice(0, 3).map((business) => {
                const selected = value.locationRef?.formattedAddress === business.locationRef.formattedAddress;
                return (
                  <Pressable
                    accessibilityLabel={`Gamitin ang address ng ${business.businessName}: ${business.locationRef.formattedAddress}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={business.id}
                    onPress={() => reuseAddress(business)}
                    style={[
                      styles.addressChoice,
                      {
                        backgroundColor: selected ? palette.softPrimary : palette.surface,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <GabiText numberOfLines={1} tone={selected ? "primary" : "default"} variant="caption">
                      {business.businessName}
                    </GabiText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        locationProviderStatus={providerStatus}
        onBlurField={touchField}
        onChange={setValue}
        suggestedType={suggestBusinessType(value.businessName)}
        value={value}
      />
    </GuidedSetupScreen>
  );
}

function ReceiptRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const { palette } = useGabiTheme();
  return (
    <View style={styles.receiptRow}>
      <Ionicons color={palette.primary} name={icon} size={19} />
      <View style={styles.receiptCopy}>
        <GabiText tone="faint" variant="caption">{label}</GabiText>
        <GabiText numberOfLines={2} variant="buttonSm">{value}</GabiText>
      </View>
    </View>
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
    borderRadius: 36,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  successCopy: {
    alignSelf: "center",
    gap: spacing.xs,
    maxWidth: 320,
  },
  centeredText: {
    textAlign: "center",
  },
  receiptCard: {
    gap: spacing.sm,
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
  suggestionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  suggestionCopy: {
    flex: 1,
    gap: 2,
  },
  smallIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  reuseHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  reuseBlock: {
    gap: spacing.xs,
    marginTop: -spacing.sm,
  },
  addressChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  addressChoice: {
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: "100%",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
