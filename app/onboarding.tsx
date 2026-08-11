import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiHeroCard } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import {
  BusinessDetailsForm,
  GuidedField,
  GuidedProgressHeader,
  GuidedSetupScreen,
  RoleChoiceCard,
  StallDetailsForm,
  type BusinessDetailsErrors,
  type BusinessDetailsField,
  type BusinessDetailsFormValue,
  type StallDetailsErrors,
  type StallDetailsField,
  type StallDetailsFormValue,
} from "@/components/onboarding";
import {
  inheritLocationRef,
  suggestBusinessType,
  validateBusinessSetup,
  validateStallSetup,
  type GuidedSetupDestination,
  type GuidedSetupRole,
} from "@/domain/onboarding";
import type { Branch, Business } from "@/domain/types";
import {
  attemptSellerCodeJoin,
  completeExistingOwnerFirstStall,
  completeOwnerGuidedSetup,
  completeSellerLimitedSetup,
  loadGuidedSetupStatus,
  saveGuidedPerson,
  saveGuidedRole,
} from "@/services/guidedOnboarding";
import { completeDemoFirstRun, loadOwnerSetupStatus } from "@/services/ownerSetup";
import { useAppStore } from "@/state/appStore";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

type FlowStep = GuidedSetupDestination | "owner-success";

const emptyBusiness: BusinessDetailsFormValue = {
  businessName: "",
  businessType: null,
  businessTypeCustom: "",
  locationRef: null,
  notes: "",
};

const emptyStall: StallDetailsFormValue = {
  stallName: "Main Stall",
  businessId: "new-owner-business",
  locationRef: null,
  inheritsBusinessLocation: true,
  branchType: "stall",
  notes: "",
};

export default function GuidedOnboardingScreen() {
  const router = useRouter();
  const { palette } = useGabiTheme();
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<FlowStep>("name");
  const [personName, setPersonName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [role, setRole] = useState<GuidedSetupRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessDetailsFormValue>(emptyBusiness);
  const [businessTouched, setBusinessTouched] = useState<Set<BusinessDetailsField>>(new Set());
  const [businessSubmitted, setBusinessSubmitted] = useState(false);
  const [stall, setStall] = useState<StallDetailsFormValue>(emptyStall);
  const [stallTouched, setStallTouched] = useState<Set<StallDetailsField>>(new Set());
  const [stallSubmitted, setStallSubmitted] = useState(false);
  const [existingBusiness, setExistingBusiness] = useState<Business | null>(null);
  const [createdBusiness, setCreatedBusiness] = useState<Business | null>(null);
  const [createdStall, setCreatedStall] = useState<Branch | null>(null);
  const [sellerCode, setSellerCode] = useState("");
  const [sellerMessage, setSellerMessage] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setPageMessage(null);
    try {
      const status = await loadGuidedSetupStatus();
      setOwnerContext(status.ownerStatus.activeBusiness, status.ownerStatus.activeBranch);
      setPersonName(status.personName);
      setRole(status.role);
      setExistingBusiness(status.destination === "owner-stall" ? status.existingBusiness : null);

      if (status.destination === "owner-app") {
        router.replace("/owner");
        return;
      }

      if (status.destination === "owner-stall" && status.existingBusiness) {
        setStall({
          ...emptyStall,
          businessId: status.existingBusiness.id,
          locationRef: inheritLocationRef(status.existingBusiness.locationRef),
        });
      }
      setStep(status.destination);
    } catch (error) {
      logDevError("GuidedOnboarding.hydrate", error);
      setPageMessage(getFriendlyErrorMessage("Hindi mabuksan ang guided setup."));
    } finally {
      setLoading(false);
    }
  }, [router, setOwnerContext]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const businessValidation = useMemo(
    () => validateBusinessSetup(business),
    [business],
  );
  const businessErrors = useMemo<BusinessDetailsErrors>(() => {
    if (businessSubmitted) return businessValidation.errors;
    return Object.fromEntries(
      Object.entries(businessValidation.errors).filter(([field]) => businessTouched.has(field as BusinessDetailsField)),
    ) as BusinessDetailsErrors;
  }, [businessSubmitted, businessTouched, businessValidation.errors]);

  const stallValidation = useMemo(
    () => validateStallSetup({
      stallName: stall.stallName,
      businessId: stall.businessId,
      locationRef: stall.inheritsBusinessLocation
        ? existingBusiness?.locationRef ?? business.locationRef
        : stall.locationRef,
    }),
    [business.locationRef, existingBusiness?.locationRef, stall],
  );
  const stallErrors = useMemo<StallDetailsErrors>(() => {
    if (stallSubmitted) return stallValidation.errors;
    return Object.fromEntries(
      Object.entries(stallValidation.errors).filter(([field]) => stallTouched.has(field as StallDetailsField)),
    ) as StallDetailsErrors;
  }, [stallSubmitted, stallTouched, stallValidation.errors]);

  function touchBusinessField(field: BusinessDetailsField) {
    setBusinessTouched((current) => new Set(current).add(field));
    if (field === "businessName" && !business.businessType) {
      const suggested = suggestBusinessType(business.businessName);
      if (suggested) {
        setBusiness((current) => ({ ...current, businessType: suggested }));
      }
    }
  }

  function touchStallField(field: StallDetailsField) {
    setStallTouched((current) => new Set(current).add(field));
  }

  async function continueFromName() {
    const normalizedName = personName.trim();
    setNameTouched(true);
    if (!normalizedName) {
      setNameError("Ilagay ang pangalan mo.");
      return;
    }

    setBusy(true);
    setPageMessage(null);
    try {
      const savedName = await saveGuidedPerson(normalizedName);
      setPersonName(savedName);
      setNameError(null);
      setStep("role");
    } catch (error) {
      logDevError("GuidedOnboarding.saveName", error);
      setPageMessage(getFriendlyErrorMessage("Hindi ma-save ang pangalan mo."));
    } finally {
      setBusy(false);
    }
  }

  async function continueFromRole() {
    if (!role) {
      setRoleError("Pumili kung Owner o Seller / Empleyado ka.");
      return;
    }

    setBusy(true);
    setPageMessage(null);
    try {
      await saveGuidedRole(role);
      setRoleError(null);
      setStep(role === "owner" ? "owner-business" : "seller-connect");
    } catch (error) {
      logDevError("GuidedOnboarding.saveRole", error);
      setPageMessage(getFriendlyErrorMessage("Hindi ma-save ang role mo."));
    } finally {
      setBusy(false);
    }
  }

  function continueFromBusiness() {
    setBusinessSubmitted(true);
    if (!businessValidation.valid) return;
    const inheritedLocation = business.locationRef ? inheritLocationRef(business.locationRef) : null;
    setStall((current) => ({ ...current, businessId: "new-owner-business", locationRef: inheritedLocation }));
    setStep("owner-stall");
  }

  async function finishOwnerSetup() {
    setStallSubmitted(true);
    if (!stallValidation.valid) return;

    setBusy(true);
    setPageMessage(null);
    try {
      const result = existingBusiness
        ? await completeExistingOwnerFirstStall({
            existingBusinessId: existingBusiness.id,
            personName,
            stall: {
              stallName: stall.stallName,
              locationRef: stall.locationRef,
              inheritsBusinessLocation: stall.inheritsBusinessLocation,
              branchType: stall.branchType,
              notes: stall.notes,
            },
          })
        : await completeOwnerGuidedSetup({
            personName,
            business: {
              businessName: business.businessName,
              businessType: business.businessType,
              businessTypeCustom: business.businessTypeCustom,
              locationRef: business.locationRef,
              notes: business.notes,
            },
            stall: {
              stallName: stall.stallName,
              locationRef: stall.locationRef,
              inheritsBusinessLocation: stall.inheritsBusinessLocation,
              branchType: stall.branchType,
              notes: stall.notes,
            },
          });
      setCreatedBusiness(result.business);
      setCreatedStall(result.stall);
      setOwnerContext(result.status.ownerStatus.activeBusiness, result.status.ownerStatus.activeBranch);
      setStep("owner-success");
    } catch (error) {
      logDevError("GuidedOnboarding.finishOwner", error);
      setPageMessage(getFriendlyErrorMessage("Hindi matapos ang setup. Walang partial na negosyo o stall na na-save."));
    } finally {
      setBusy(false);
    }
  }

  async function openDemo() {
    setBusy(true);
    setPageMessage(null);
    try {
      await completeDemoFirstRun();
      const status = await loadOwnerSetupStatus();
      setOwnerContext(status.activeBusiness, status.activeBranch);
      router.replace("/owner");
    } catch (error) {
      logDevError("GuidedOnboarding.openDemo", error);
      setPageMessage(getFriendlyErrorMessage("Hindi magawa ang halimbawa."));
    } finally {
      setBusy(false);
    }
  }

  async function pasteSellerCode() {
    setSellerMessage(null);
    try {
      const pasted = (await Clipboard.getStringAsync()).trim().toUpperCase();
      if (!pasted) {
        setSellerMessage("Walang text sa clipboard. Puwede mo pa ring i-type ang code.");
        return;
      }
      setSellerCode(normalizeSellerCode(pasted));
    } catch (error) {
      logDevError("GuidedOnboarding.pasteSellerCode", error);
      setSellerMessage("Hindi mabasa ang clipboard. I-type na lang ang code.");
    }
  }

  async function submitSellerCode() {
    setBusy(true);
    try {
      const result = await attemptSellerCodeJoin(sellerCode);
      setSellerMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function skipSellerCode() {
    setBusy(true);
    setSellerMessage(null);
    try {
      await completeSellerLimitedSetup({ personName });
      setStep("seller-limited");
    } catch (error) {
      logDevError("GuidedOnboarding.skipSellerCode", error);
      setSellerMessage(getFriendlyErrorMessage("Hindi ma-save ang limited Seller state."));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setPageMessage(null);
    if (step === "role") setStep("name");
    else if (step === "owner-business") setStep("role");
    else if (step === "owner-stall") {
      if (existingBusiness) router.replace("/owner/business-settings" as Href);
      else setStep("owner-business");
    } else if (step === "seller-connect") setStep("role");
    else if (step === "seller-limited") setStep("seller-connect");
  }

  if (loading) {
    return (
      <GuidedSetupScreen>
        <View style={styles.centeredState}>
          <View style={[styles.brandMark, { backgroundColor: palette.accent }]}>
            <GabiText style={{ color: palette.text }} variant="h1">K</GabiText>
          </View>
          <GabiText variant="h1">Binubuksan ang setup mo…</GabiText>
          <GabiText tone="muted" variant="body">Local data lang ang hinihintay.</GabiText>
        </View>
      </GuidedSetupScreen>
    );
  }

  if (pageMessage && step === "name") {
    return (
      <GuidedSetupScreen footer={<GabiPrimaryButton icon="refresh" label="Subukan ulit" onPress={() => void hydrate()} />}>
        <View style={styles.centeredState}>
          <GabiNotice message={pageMessage} title="Hindi mabuksan ang setup" tone="danger" />
        </View>
      </GuidedSetupScreen>
    );
  }

  if (step === "name") {
    return (
      <GuidedSetupScreen
        footer={
          <View style={styles.footerActions}>
            <GabiPrimaryButton icon="arrow-forward" label={busy ? "Sine-save…" : "Magpatuloy"} loading={busy} onPress={() => void continueFromName()} />
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void openDemo()} style={styles.quietAction}>
              <GabiText tone="muted" variant="buttonSm">Tingnan muna ang halimbawa (demo)</GabiText>
            </Pressable>
          </View>
        }
        testID="onboarding-name-screen"
      >
        <GabiHeroCard style={styles.welcomeHero}>
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { backgroundColor: palette.accent }]}>
              <GabiText style={{ color: palette.text }} variant="h1">K</GabiText>
            </View>
            <View>
              <GabiText tone="inverse" variant="h2">KitaMo</GabiText>
              <GabiText tone="inverse" variant="caption">Tindahan sa bulsa</GabiText>
            </View>
          </View>
          <GabiText style={styles.heroTitle} tone="inverse" variant="h1">Kumusta!{"\n"}Ano ang pangalan mo?</GabiText>
          <GabiText style={styles.heroSubtitle} tone="inverse" variant="body">
            Para ma-personalize namin ang KitaMo. Isang tanong muna — mabilis lang ito.
          </GabiText>
        </GabiHeroCard>

        {pageMessage ? <GabiNotice message={pageMessage} tone="danger" /> : null}
        <GuidedField
          autoCapitalize="words"
          autoFocus
          errorMessage={nameTouched ? nameError ?? undefined : undefined}
          helperText="Puwedeng palayaw — ito ang gagamitin naming pantawag sa iyo."
          label="Pangalan mo"
          maxLength={60}
          onBlur={() => {
            setNameTouched(true);
            setNameError(personName.trim() ? null : "Ilagay ang pangalan mo.");
          }}
          onChangeText={(value) => {
            setPersonName(value);
            if (nameTouched && value.trim()) setNameError(null);
          }}
          onSubmitEditing={() => void continueFromName()}
          placeholder="Palayaw o pangalan"
          required
          returnKeyType="next"
          showValidState
          value={personName}
        />
      </GuidedSetupScreen>
    );
  }

  if (step === "role") {
    return (
      <GuidedSetupScreen
        footer={
          <GabiPrimaryButton
            disabled={!role}
            icon="arrow-forward"
            label={role ? `Magpatuloy bilang ${role === "owner" ? "Owner" : "Seller"}` : "Pumili muna ng role"}
            loading={busy}
            onPress={() => void continueFromRole()}
          />
        }
        footerHint={!role ? "Piliin ang card na pinakamalapit sa gagawin mo." : undefined}
        onBack={goBack}
        progress={<GuidedProgressHeader label="IKAW · NEGOSYO · STALL" onBack={goBack} step={1} total={3} />}
        testID="onboarding-role-screen"
      >
        <View style={styles.introCopy}>
          <GabiText variant="h1">Hi, {personName}! Ano ang role mo?</GabiText>
          <GabiText tone="muted" variant="body">Magkaiba ang setup ng Owner at Seller / Empleyado.</GabiText>
        </View>
        {pageMessage ? <GabiNotice message={pageMessage} tone="danger" /> : null}
        <View accessibilityRole="radiogroup" style={styles.roleList}>
          <RoleChoiceCard onPress={() => { setRole("owner"); setRoleError(null); }} role="owner" selected={role === "owner"} />
          <RoleChoiceCard onPress={() => { setRole("seller"); setRoleError(null); }} role="seller" selected={role === "seller"} />
        </View>
        {roleError ? <GabiText tone="danger" variant="caption">{roleError}</GabiText> : null}
        <GabiNotice message="Ang Seller ay hindi nakakakita ng tubo, puhunan, o supplier prices." title="Sadyang limitado" tone="owner" />
      </GuidedSetupScreen>
    );
  }

  if (step === "owner-business") {
    return (
      <GuidedSetupScreen
        footer={<GabiPrimaryButton icon="arrow-forward" label="Susunod: unang stall" onPress={continueFromBusiness} />}
        footerHint={!businessValidation.valid && businessSubmitted ? businessValidation.summary ?? undefined : undefined}
        onBack={goBack}
        progress={<GuidedProgressHeader label="ANG NEGOSYO MO" onBack={goBack} personName={personName} step={2} total={3} />}
        testID="onboarding-business-screen"
      >
        {pageMessage ? <GabiNotice message={pageMessage} tone="danger" /> : null}
        {businessSubmitted && !businessValidation.valid ? (
          <GabiNotice message="Kumpletuhin ang mga field na may pulang mensahe." title="May kulang pa" tone="danger" />
        ) : null}
        <View style={styles.greetingLine}>
          <GabiText tone="primary" variant="buttonSm">Hi, {personName}!</GabiText>
        </View>
        <BusinessDetailsForm
          errors={businessErrors}
          locationProviderStatus="not_configured"
          onBlurField={touchBusinessField}
          onChange={setBusiness}
          suggestedType={suggestBusinessType(business.businessName)}
          value={business}
        />
      </GuidedSetupScreen>
    );
  }

  if (step === "owner-stall") {
    const stallBusiness = existingBusiness
      ? [{ id: existingBusiness.id, name: existingBusiness.businessName, locationRef: existingBusiness.locationRef }]
      : [{ id: "new-owner-business", name: business.businessName, locationRef: business.locationRef }];
    return (
      <GuidedSetupScreen
        footer={<GabiPrimaryButton icon="checkmark" label={busy ? "Ginagawa ang setup…" : "Tapusin ang setup"} loading={busy} onPress={() => void finishOwnerSetup()} />}
        footerHint={!stallValidation.valid && stallSubmitted ? stallValidation.summary ?? undefined : undefined}
        onBack={goBack}
        progress={
          <GuidedProgressHeader
            finalStep
            label={`UNANG STALL NG ${existingBusiness?.businessName ?? business.businessName}`}
            onBack={goBack}
            step={3}
            total={3}
          />
        }
        testID="onboarding-stall-screen"
      >
        {pageMessage ? <GabiNotice message={pageMessage} tone="danger" /> : null}
        {stallSubmitted && !stallValidation.valid ? (
          <GabiNotice message="Kumpletuhin ang mga field na may pulang mensahe." title="May kulang pa" tone="danger" />
        ) : null}
        <StallDetailsForm
          businesses={stallBusiness}
          errors={stallErrors}
          locationProviderStatus="not_configured"
          onBlurField={touchStallField}
          onChange={setStall}
          preselectedBusinessId={stall.businessId}
          value={stall}
        />
      </GuidedSetupScreen>
    );
  }

  if (step === "seller-connect") {
    return (
      <GuidedSetupScreen
        footer={
          <View style={styles.footerActions}>
            <GabiPrimaryButton
              disabled={!sellerCode.trim()}
              icon="link-outline"
              label={sellerCode.trim() ? "Suriin ang code" : "Sumali · kulang pa ang code"}
              loading={busy}
              onPress={() => void submitSellerCode()}
            />
            <GabiSoftButton label="Wala pa akong code" onPress={() => void skipSellerCode()} />
          </View>
        }
        footerHint={!sellerCode.trim() ? "I-type o i-paste ang code; walang remote join na papanggapin." : undefined}
        onBack={goBack}
        progress={<GuidedProgressHeader label="SELLER / EMPLEYADO" onBack={goBack} step={1} total={1} />}
        testID="onboarding-seller-code-screen"
      >
        <View style={styles.introCopy}>
          <GabiText variant="h1">Hi, {personName}! Ikonekta natin ang stall mo.</GabiText>
          <GabiText tone="muted" variant="body">Hingin ang Owner / Stall code mula sa may-ari.</GabiText>
        </View>
        {sellerMessage ? <GabiNotice message={sellerMessage} title="Local-only muna" tone="warning" /> : null}
        <GuidedField
          autoCapitalize="characters"
          autoCorrect={false}
          helperText="Hindi case-sensitive. Manual typing ay laging available."
          label="Owner / Stall code"
          maxLength={16}
          onChangeText={(value) => { setSellerCode(normalizeSellerCode(value)); setSellerMessage(null); }}
          placeholder="Hal. RVS-4821"
          required
          style={styles.codeInput}
          value={sellerCode}
        />
        <View style={styles.inlineButtons}>
          <GabiSoftButton compact icon="clipboard-outline" label="I-paste" onPress={() => void pasteSellerCode()} />
        </View>
        <GabiNotice message="Wala pang cross-device Seller account o cloud join sa build na ito. Ang code ay hindi ipapadalang kunwari ay gumagana." title="Tapat na boundary" tone="owner" />
      </GuidedSetupScreen>
    );
  }

  if (step === "seller-limited") {
    return (
      <GuidedSetupScreen testID="onboarding-seller-limited-screen">
        <View style={[styles.kioskStrip, { backgroundColor: palette.kioskHeader }]}>
          <Ionicons color={palette.accent} name="briefcase" size={19} />
          <GabiText style={styles.kioskStripCopy} tone="inverse" variant="buttonSm">Kiosk · hindi pa konektado</GabiText>
          <GabiText tone="inverse" variant="caption">{personName}</GabiText>
        </View>
        <View style={styles.introCopy}>
          <GabiText variant="h1">Ayos lang, {personName} — puwede kang maghintay.</GabiText>
          <GabiText tone="muted" variant="body">Hindi ka pa konektado sa stall, kaya walang totoong benta o stock na mare-record.</GabiText>
        </View>
        <GabiCard>
          <StepRow number="1" text="Hingin ang stall access sa owner." />
          <StepRow number="2" text="Sa phone ng owner, buksan ang Kiosk at piliin ang stall." />
          <StepRow number="3" text="Cross-device code joining ay idaragdag lang kapag may approved backend." />
        </GabiCard>
        <GabiPrimaryButton icon="key-outline" label="May code na ako" onPress={() => setStep("seller-connect")} />
        <GabiSoftButton icon="swap-horizontal" label="Palitan ang role" onPress={() => setStep("role")} />
        <GabiNotice message="Walang error sa account mo. Sadyang unconnected ang state hanggang may tunay na supported join flow." title="Limitadong Seller state" tone="owner" />
      </GuidedSetupScreen>
    );
  }

  const summaryBusiness = createdBusiness ?? existingBusiness;
  return (
    <GuidedSetupScreen testID="onboarding-owner-success-screen">
      <View style={styles.successContent}>
        <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
          <Ionicons color={palette.success} name="checkmark" size={42} />
        </View>
        <View style={styles.successCopy}>
          <GabiText variant="h1">Ayos na, {personName}!</GabiText>
          <GabiText tone="muted" variant="body">
            Handa na ang {summaryBusiness?.businessName} at ang {createdStall?.branchName}.
          </GabiText>
        </View>
        {summaryBusiness && createdStall ? (
          <GabiCard>
            <SummaryRow icon="storefront-outline" title={summaryBusiness.businessName} subtitle={`${summaryBusiness.businessType} · ${summaryBusiness.locationRef.formattedAddress}`} />
            <SummaryRow icon="business-outline" title={createdStall.branchName} subtitle={createdStall.inheritsBusinessLocation ? "Kapareho ng lokasyon ng negosyo" : createdStall.locationRef?.formattedAddress ?? ""} />
          </GabiCard>
        ) : null}
        <View style={styles.footerActions}>
          <GabiPrimaryButton icon="add-circle-outline" label="Magdagdag ng paninda" onPress={() => router.replace("/owner/inventory")} />
          <GabiSoftButton icon="home-outline" label="Pumunta sa Owner Home" onPress={() => router.replace("/owner")} />
          <Pressable accessibilityRole="button" onPress={() => router.replace("/owner/business-settings" as Href)} style={styles.quietAction}>
            <GabiText tone="primary" variant="buttonSm">I-edit ang business o stall</GabiText>
          </Pressable>
        </View>
      </View>
    </GuidedSetupScreen>
  );
}

function normalizeSellerCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16);
}

function StepRow({ number, text }: { number: string; text: string }) {
  const { palette } = useGabiTheme();
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepNumber, { backgroundColor: palette.primary }]}>
        <GabiText style={{ color: palette.kioskHeaderText }} variant="caption">{number}</GabiText>
      </View>
      <GabiText style={styles.stepCopy} variant="body">{text}</GabiText>
    </View>
  );
}

function SummaryRow({ icon, title, subtitle }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; subtitle: string }) {
  const { palette } = useGabiTheme();
  return (
    <View style={[styles.summaryRow, { borderColor: palette.border }]}>
      <Ionicons color={palette.primary} name={icon} size={21} />
      <View style={styles.summaryCopy}>
        <GabiText variant="buttonSm">{title}</GabiText>
        <GabiText tone="muted" variant="caption">{subtitle}</GabiText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    minHeight: 520,
  },
  brandMark: {
    alignItems: "center",
    borderRadius: 15,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  welcomeHero: {
    borderRadius: 0,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  heroTitle: {
    fontSize: 27,
    lineHeight: 34,
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.82)",
  },
  footerActions: {
    gap: spacing.sm,
  },
  quietAction: {
    alignItems: "center",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  introCopy: {
    gap: spacing.xs,
  },
  roleList: {
    gap: spacing.md,
  },
  greetingLine: {
    marginBottom: -spacing.md,
  },
  codeInput: {
    fontFamily: "monospace",
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: 4,
  },
  inlineButtons: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  kioskStrip: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  kioskStripCopy: {
    flex: 1,
  },
  stepRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  stepNumber: {
    alignItems: "center",
    borderRadius: 5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  stepCopy: {
    flex: 1,
  },
  successContent: {
    alignItems: "stretch",
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    minHeight: 620,
    paddingVertical: spacing.xl,
  },
  successIcon: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: radius.pill,
    height: 88,
    justifyContent: "center",
    width: 88,
  },
  successCopy: {
    alignItems: "center",
    gap: spacing.xs,
  },
  summaryRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
});
