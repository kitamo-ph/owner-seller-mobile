import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { PilotStatusCard } from "@/components/owner/PilotStatusCard";
import { AppTopBar, Card, IconBadge, Pill, ScreenScroll, SecondaryButton } from "@/components/ui/KitaMoUI";
import {
  createBranch,
  createBusiness,
  updateBranch,
  updateBusiness,
} from "@/db/repositories";
import type { Branch, Business, BusinessType } from "@/domain/types";
import {
  createSingleFlightProtectedAction,
  formatOwnerPinLockoutMessage,
} from "@/domain/ownerPinSecurity";
import {
  clearActiveBranchContext,
  loadOwnerSetupStatus,
  switchActiveBranchContext,
  switchActiveBusinessContext,
  type OwnerSetupStatus,
} from "@/services/ownerSetup";
import {
  clearOwnerAccess,
  getOwnerAccessStatus,
  isValidOwnerPin,
  saveOwnerPin,
  setOwnerBiometricEnabled,
  type OwnerAccessStatus,
  verifyOwnerPin,
  verifyOwnerPinWithThrottle,
} from "@/services/ownerAccess";
import { clearLocalPilotData } from "@/services/pilotData";
import { useAppStore } from "@/state/appStore";
import { useOwnerAccessStore } from "@/state/ownerAccessStore";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes } from "@/theme/colors";
import { spacing } from "@/theme/spacing";
import { extendedThemePalettes } from "@/theme/tokens";
import { typography } from "@/theme/typography";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

const businessTypes: BusinessType[] = [
  "sari-sari store",
  "karinderia",
  "street food",
  "kiosk",
  "school canteen",
  "small booth",
  "other",
];

const branchTypes = ["stall", "branch", "booth", "home kitchen", "pop-up"] as const;

type BranchTypeOption = (typeof branchTypes)[number];

type BusinessForm = {
  businessName: string;
  businessType: BusinessType;
  ownerName: string;
  contactNumber: string;
  barangay: string;
  notes: string;
};

type BranchForm = {
  id: string | null;
  branchName: string;
  location: string;
  branchType: BranchTypeOption;
  active: boolean;
  notes: string;
};

const emptyBusinessForm: BusinessForm = {
  businessName: "",
  businessType: "sari-sari store",
  ownerName: "",
  contactNumber: "",
  barangay: "",
  notes: "",
};

const emptyBranchForm: BranchForm = {
  id: null,
  branchName: "",
  location: "",
  branchType: "stall",
  active: true,
  notes: "",
};

function toBusinessForm(business: Business): BusinessForm {
  return {
    businessName: business.businessName,
    businessType: business.businessType,
    ownerName: business.ownerName,
    contactNumber: business.contactNumber ?? "",
    barangay: business.barangay,
    notes: business.notes ?? "",
  };
}

export default function OwnerSettingsScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [editingBusinessId, setEditingBusinessId] = useState<string | null>(null);
  const [businessForm, setBusinessForm] = useState<BusinessForm>(emptyBusinessForm);
  const [branchForm, setBranchForm] = useState<BranchForm>(emptyBranchForm);
  const [saving, setSaving] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccessStatus | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [clearDataPinVisible, setClearDataPinVisible] = useState(false);
  const [clearDataPin, setClearDataPin] = useState("");
  const [clearDataPinMessage, setClearDataPinMessage] = useState<string | null>(null);
  const [clearDataRunning, setClearDataRunning] = useState(false);
  const clearDataTapLock = useRef(false);
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const resetAppContext = useAppStore((state) => state.resetAppContext);
  const enableOwnerProtection = useOwnerAccessStore((state) => state.enableProtection);
  const disableOwnerProtection = useOwnerAccessStore((state) => state.disableProtection);
  const lockOwnerAccess = useOwnerAccessStore((state) => state.lock);
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode];
  const router = useRouter();

  const protectedClearPilotData = useMemo(
    () =>
      createSingleFlightProtectedAction({
        verify: async (pin: string) => {
          const result = await verifyOwnerPinWithThrottle(pin);
          if (result.status === "success") {
            return true;
          }
          setClearDataPinMessage(
            result.status === "locked"
              ? formatOwnerPinLockoutMessage(result.remainingMs)
              : `Wrong PIN. ${result.attemptsBeforeLockout} attempt${result.attemptsBeforeLockout === 1 ? "" : "s"} before a 30-second lock.`,
          );
          return false;
        },
        execute: clearLocalPilotData,
      }),
    [],
  );

  function setNotice(text: string) {
    setMessage(text);
    setMessageIsError(false);
  }

  function setError(text: string) {
    setMessage(text);
    setMessageIsError(true);
  }

  const refresh = useCallback(
    async (options?: { keepBusinessForm?: boolean }) => {
      const nextStatus = await loadOwnerSetupStatus();
      const nextOwnerAccess = await getOwnerAccessStatus();
      setStatus(nextStatus);
      setOwnerAccess(nextOwnerAccess);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);

      if (nextStatus.activeBusiness && !options?.keepBusinessForm) {
        setEditingBusinessId(nextStatus.activeBusiness.id);
        setBranchForm(emptyBranchForm);
        setBusinessForm({
          businessName: nextStatus.activeBusiness.businessName,
          businessType: nextStatus.activeBusiness.businessType,
          ownerName: nextStatus.activeBusiness.ownerName,
          contactNumber: nextStatus.activeBusiness.contactNumber ?? "",
          barangay: nextStatus.activeBusiness.barangay,
          notes: nextStatus.activeBusiness.notes ?? "",
        });
      } else if (!nextStatus.activeBusiness && !options?.keepBusinessForm) {
        setEditingBusinessId(null);
        setBranchForm(emptyBranchForm);
        setBusinessForm(emptyBusinessForm);
      }
    },
    [setOwnerContext],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      refresh().catch((error) => {
        logDevError("OwnerSettings.refresh", error);
        if (active) {
          setMessage(getFriendlyErrorMessage("Could not load settings."));
          setMessageIsError(true);
        }
      });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  async function saveBusinessProfile() {
    const businessName = businessForm.businessName.trim();
    const ownerName = businessForm.ownerName.trim();
    const barangay = businessForm.barangay.trim();

    if (!businessName || !ownerName || !barangay) {
      setError("Business name, owner/contact name, and address/location are required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        businessName,
        businessType: businessForm.businessType,
        ownerName,
        barangay,
        contactNumber: businessForm.contactNumber.trim() || null,
        notes: businessForm.notes.trim() || null,
        preferredLanguage: "Taglish" as const,
      };

      const savedBusiness = editingBusinessId
        ? await updateBusiness(editingBusinessId, payload)
        : await createBusiness(payload);

      const nextStatus = editingBusinessId
        ? await loadOwnerSetupStatus()
        : await switchActiveBusinessContext(savedBusiness.id);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setEditingBusinessId(savedBusiness.id);
      setBusinessForm({
        businessName: savedBusiness.businessName,
        businessType: savedBusiness.businessType,
        ownerName: savedBusiness.ownerName,
        contactNumber: savedBusiness.contactNumber ?? "",
        barangay: savedBusiness.barangay,
        notes: savedBusiness.notes ?? "",
      });
      setNotice(editingBusinessId ? "Business profile updated." : "Business created and selected. Choose a stall when ready.");
    } catch (error) {
      logDevError("OwnerSettings.saveBusinessProfile", error);
      setError(getFriendlyErrorMessage("Could not save business profile."));
    } finally {
      setSaving(false);
    }
  }

  function saveBranch() {
    if (!status?.activeBusiness) {
      setError("Create your business profile before adding a stall or store.");
      return;
    }

    const branchName = branchForm.branchName.trim();
    if (!branchName) {
      setError("Stall or branch name is required.");
      return;
    }

    if (branchForm.id === status.activeBranch?.id && !branchForm.active) {
      Alert.alert(
        "Deactivate selected stall?",
        "Owner context will have no active stall until you deliberately choose another one. Kiosk will remain unavailable.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Deactivate", style: "destructive", onPress: () => void persistBranch() },
        ],
      );
      return;
    }

    void persistBranch();
  }

  async function persistBranch() {
    if (!status?.activeBusiness) {
      return;
    }

    const branchName = branchForm.branchName.trim();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        branchName,
        location: branchForm.location.trim() || null,
        branchType: branchForm.branchType,
        active: branchForm.active,
        notes: branchForm.notes.trim() || null,
      };
      const savedBranch = branchForm.id
        ? await updateBranch(branchForm.id, payload)
        : await createBranch({
            ...payload,
            businessId: status.activeBusiness.id,
          });

      let nextStatus = await loadOwnerSetupStatus();
      let noticeText = branchForm.id ? "Store or stall updated." : "Store or stall added. Select it explicitly to use it as Owner context.";

      if (!savedBranch.active && status.activeBranch?.id === savedBranch.id) {
        nextStatus = await clearActiveBranchContext(status.activeBusiness.id);
        noticeText = "Store or stall deactivated. No active stall is selected.";
      }

      setBranchForm(emptyBranchForm);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setNotice(noticeText);
    } catch (error) {
      logDevError("OwnerSettings.saveBranch", error);
      setError(getFriendlyErrorMessage("Could not save store or stall."));
    } finally {
      setSaving(false);
    }
  }

  async function chooseActiveBranch(branchId: string) {
    setSaving(true);
    setMessage(null);
    try {
      const nextStatus = await switchActiveBranchContext(branchId);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setNotice("Active stall updated.");
    } catch (error) {
      logDevError("OwnerSettings.chooseActiveBranch", error);
      setError(getFriendlyErrorMessage("Could not select active stall."));
    } finally {
      setSaving(false);
    }
  }

  async function chooseActiveBusiness(business: Business) {
    if (saving || status?.activeBusiness?.id === business.id) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const nextStatus = await switchActiveBusinessContext(business.id);
      setStatus(nextStatus);
      setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
      setEditingBusinessId(business.id);
      setBusinessForm(toBusinessForm(business));
      setBranchForm(emptyBranchForm);
      setNotice(nextStatus.activeBranch ? `Switched to ${business.businessName}.` : `Switched to ${business.businessName}. Choose an active stall deliberately.`);
    } catch (error) {
      logDevError("OwnerSettings.chooseActiveBusiness", error);
      setError(getFriendlyErrorMessage("Could not select business."));
    } finally {
      setSaving(false);
    }
  }

  function startNewBusiness() {
    setEditingBusinessId(null);
    setBusinessForm(emptyBusinessForm);
    setBranchForm(emptyBranchForm);
    setMessage(null);
  }

  function editBusiness(business: Business) {
    setEditingBusinessId(business.id);
    setBusinessForm(toBusinessForm(business));
    setMessage(null);
  }

  function editBranch(branch: Branch) {
    setBranchForm({
      id: branch.id,
      branchName: branch.branchName,
      location: branch.location ?? "",
      branchType: branch.branchType === "kiosk" ? "stall" : branch.branchType,
      active: branch.active,
      notes: branch.notes ?? "",
    });
  }

  async function savePin() {
    if (!isValidOwnerPin(newPin)) {
      setError("Use a 4 to 6 digit Owner PIN.");
      return;
    }

    if (newPin !== confirmPin) {
      setError("The new PIN and confirmation do not match.");
      return;
    }

    setSecuritySaving(true);
    setMessage(null);
    try {
      if (ownerAccess?.hasPin && !(await verifyOwnerPin(currentPin))) {
        setError("Current Owner PIN is incorrect.");
        return;
      }

      await saveOwnerPin(newPin);
      enableOwnerProtection();
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setOwnerAccess(await getOwnerAccessStatus());
      setNotice(ownerAccess?.hasPin ? "Owner PIN updated." : "Owner Mode protection is now on.");
    } catch (error) {
      logDevError("OwnerSettings.savePin", error);
      setError(getFriendlyErrorMessage("Could not save the Owner PIN."));
    } finally {
      setSecuritySaving(false);
    }
  }

  async function toggleBiometrics(enabled: boolean) {
    setSecuritySaving(true);
    setMessage(null);
    try {
      await setOwnerBiometricEnabled(enabled);
      setOwnerAccess(await getOwnerAccessStatus());
      setNotice(enabled ? "Biometric Owner unlock enabled." : "Biometric Owner unlock disabled.");
    } catch (error) {
      logDevError("OwnerSettings.toggleBiometrics", error);
      setError(error instanceof Error ? error.message : "Could not update biometric unlock.");
    } finally {
      setSecuritySaving(false);
    }
  }

  function confirmRemoveOwnerLock() {
    if (!ownerAccess?.hasPin) {
      return;
    }

    Alert.alert("Remove Owner lock?", "Owner-only reports and settings will be accessible without a PIN on this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove lock",
        style: "destructive",
        onPress: () => {
          void removeOwnerLock();
        },
      },
    ]);
  }

  async function removeOwnerLock() {
    setSecuritySaving(true);
    setMessage(null);
    try {
      if (!(await verifyOwnerPin(currentPin))) {
        setError("Enter the current Owner PIN before removing the lock.");
        return;
      }
      await clearOwnerAccess();
      disableOwnerProtection();
      setOwnerAccess(await getOwnerAccessStatus());
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setNotice("Owner Mode protection removed.");
    } catch (error) {
      logDevError("OwnerSettings.removeOwnerLock", error);
      setError(getFriendlyErrorMessage("Could not remove the Owner lock."));
    } finally {
      setSecuritySaving(false);
    }
  }

  function confirmClearPilotData() {
    if (saving || clearDataRunning) {
      return;
    }

    if (!ownerAccess?.hasPin) {
      Alert.alert(
        "Owner PIN required",
        "Set an Owner PIN first. KitaMo requires the current PIN again before a complete local-data wipe.",
      );
      return;
    }

    Alert.alert(
      "Clear all local KitaMo data?",
      "This permanently removes businesses, products, sales, receipts, costs, settings, and the Owner lock from this phone. Demo data will not return automatically.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear local data",
          style: "destructive",
          onPress: () => {
            setClearDataPin("");
            setClearDataPinMessage(null);
            setClearDataPinVisible(true);
          },
        },
      ],
    );
  }

  function cancelClearPilotData() {
    if (clearDataRunning) return;
    setClearDataPin("");
    setClearDataPinMessage(null);
    setClearDataPinVisible(false);
  }

  async function verifyAndClearPilotData() {
    if (clearDataTapLock.current || clearDataRunning) return;
    if (!isValidOwnerPin(clearDataPin)) {
      setClearDataPinMessage("Enter your current 4 to 6 digit Owner PIN.");
      return;
    }

    clearDataTapLock.current = true;
    setClearDataRunning(true);
    setClearDataPinMessage(null);
    try {
      const result = await protectedClearPilotData(clearDataPin);
      if (result.status !== "completed") {
        return;
      }

      setClearDataPin("");
      setClearDataPinVisible(false);
      disableOwnerProtection();
      resetAppContext();
      router.replace("/");
    } catch (error) {
      logDevError("OwnerSettings.clearPilotData", error);
      setClearDataPinMessage(getFriendlyErrorMessage("Could not clear local data."));
    } finally {
      clearDataTapLock.current = false;
      setClearDataRunning(false);
    }
  }

  return (
    <>
      <ScreenScroll bottomNav>
      <AppTopBar subtitle="Business, stalls, Owner access, and local data" title="Business & Stalls" />

      {message ? <Text style={[styles.message, { color: messageIsError ? palette.danger : palette.text }]}>{message}</Text> : null}

      <Card>
        <View style={styles.summaryCard}>
          <IconBadge label="S" tone="primary" size="lg" />
          <View style={styles.summaryText}>
            <Text style={[styles.summaryTitle, { color: palette.text }]}>
              {status?.activeBusiness?.businessName ?? "No business profile yet"}
            </Text>
            <Text style={[styles.body, { color: palette.mutedText }]}>
              {status?.activeBusiness
                ? `${status.activeBusiness.businessType} · ${status.activeBranch?.branchName ?? "No active stall"}`
                : status?.businesses.length
                  ? "Choose a saved business to manage its stalls."
                  : "Create your local business profile to start selling."}
            </Text>
            <Text style={[styles.body, { color: palette.mutedText }]}>
              {status?.activeBusiness?.barangay ?? "Location will appear here."}
            </Text>
          </View>
          <Pill label="Owner mode" tone="accent" />
        </View>
        <SecondaryButton href="/owner/context" label="Switch Business or Stall" />
      </Card>

      <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.cloudHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Saved Businesses</Text>
          <SmallButton disabled={saving} label="Add business" onPress={startNewBusiness} />
        </View>
        {status?.businesses.length ? (
          <View style={styles.businessList}>
            {status.businesses.map((business) => {
              const selected = status.activeBusiness?.id === business.id;
              const editing = editingBusinessId === business.id;
              return (
                <View key={business.id} style={[styles.listItem, { borderColor: selected ? palette.primary : palette.border }]}>
                  <View style={styles.listItemHeader}>
                    <View style={styles.listItemText}>
                      <Text style={[styles.listItemTitle, { color: palette.text }]}>{business.businessName}</Text>
                      <Text style={[styles.body, { color: palette.mutedText }]}>{business.businessType} | {business.barangay}</Text>
                    </View>
                    <Pill label={selected ? "Selected" : editing ? "Editing" : "Saved"} tone={selected ? "success" : editing ? "accent" : "neutral"} />
                  </View>
                  <View style={styles.inlineActions}>
                    <SmallButton disabled={saving || editing} label="Edit" onPress={() => editBusiness(business)} />
                    <SmallButton disabled={saving || selected} label="Use business" onPress={() => void chooseActiveBusiness(business)} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.empty, { color: palette.mutedText }]}>No saved businesses yet.</Text>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>{editingBusinessId ? "Edit Business Profile" : "Add Business"}</Text>
        {!status?.activeBusiness && status?.businesses.length === 0 ? (
          <Text style={[styles.empty, { color: palette.mutedText }]}>
            Create your business profile to start tracking sales and inventory.
          </Text>
        ) : null}

        <FormField
          label="Business name"
          onChangeText={(businessName) => setBusinessForm((form) => ({ ...form, businessName }))}
          placeholder="Example: Aling Nena's Store"
          value={businessForm.businessName}
        />
        <OptionGroup
          label="Business type"
          onSelect={(businessType) => setBusinessForm((form) => ({ ...form, businessType }))}
          options={businessTypes}
          selected={businessForm.businessType}
        />
        <FormField
          label="Owner/contact name"
          onChangeText={(ownerName) => setBusinessForm((form) => ({ ...form, ownerName }))}
          placeholder="Owner or staff contact"
          value={businessForm.ownerName}
        />
        <FormField
          keyboardType="phone-pad"
          label="Phone/contact number"
          onChangeText={(contactNumber) => setBusinessForm((form) => ({ ...form, contactNumber }))}
          placeholder="Optional"
          value={businessForm.contactNumber}
        />
        <FormField
          label="Address/location"
          onChangeText={(barangay) => setBusinessForm((form) => ({ ...form, barangay }))}
          placeholder="Barangay, market, mall, or route"
          value={businessForm.barangay}
        />
        <FormField
          label="Notes/description"
          multiline
          onChangeText={(notes) => setBusinessForm((form) => ({ ...form, notes }))}
          placeholder="Optional local notes"
          value={businessForm.notes}
        />

        <View style={styles.inlineActions}>
          <ActionButton disabled={saving} label={editingBusinessId ? "Save Business Profile" : "Create Business"} onPress={saveBusinessProfile} />
          {!editingBusinessId && status?.activeBusiness ? (
            <SmallButton disabled={saving} label="Cancel" onPress={() => editBusiness(status.activeBusiness as Business)} />
          ) : null}
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Stores / Stalls</Text>
        {!status?.activeBusiness ? (
          <Text style={[styles.empty, { color: palette.mutedText }]}>
            {status?.businesses.length ? "Choose a saved business before adding or editing stalls." : "Create a business profile before adding stores or stalls."}
          </Text>
        ) : status.branches.length === 0 ? (
          <Text style={[styles.empty, { color: palette.mutedText }]}>Add your first stall or store.</Text>
        ) : null}

        {status?.branches.map((branch) => {
          const selected = status.activeBranch?.id === branch.id;
          const productCount = status.products.filter((product) => product.branchId === branch.id).length;
          return (
            <View key={branch.id} style={[styles.listItem, { borderColor: selected ? palette.primary : palette.border }]}>
              <View style={styles.listItemHeader}>
                <View style={styles.listItemText}>
                  <Text style={[styles.listItemTitle, { color: palette.text }]}>{branch.branchName}</Text>
                  <Text style={[styles.body, { color: palette.mutedText }]}>
                    {branch.branchType} | {branch.location ?? "No location"} | {branch.active ? "active" : "inactive"}
                  </Text>
                  <Text style={[styles.body, { color: palette.mutedText }]}>{productCount} assigned product{productCount === 1 ? "" : "s"}</Text>
                </View>
                <Text style={[styles.badge, { backgroundColor: selected ? palette.primary : palette.background, color: selected ? palette.kioskHeaderText : palette.mutedText }]}>
                  {selected ? "Active" : "Saved"}
                </Text>
              </View>
              {branch.notes ? <Text style={[styles.body, { color: palette.mutedText }]}>{branch.notes}</Text> : null}
              <View style={styles.inlineActions}>
                <SmallButton disabled={saving} label="Edit" onPress={() => editBranch(branch)} />
                <SmallButton disabled={saving || selected || !branch.active} label="Use as active" onPress={() => chooseActiveBranch(branch.id)} />
                <SmallButton
                  disabled={saving || !branch.active}
                  label="Open Kiosk"
                  onPress={() => router.push({ pathname: "/kiosk", params: { branchId: branch.id } })}
                />
              </View>
            </View>
          );
        })}

        <Text style={[styles.subheading, { color: palette.text }]}>{branchForm.id ? "Edit stall/store" : "Add stall/store"}</Text>
        <FormField
          editable={Boolean(status?.activeBusiness)}
          label="Stall/branch name"
          onChangeText={(branchName) => setBranchForm((form) => ({ ...form, branchName }))}
          placeholder="Example: Main stall"
          value={branchForm.branchName}
        />
        <FormField
          editable={Boolean(status?.activeBusiness)}
          label="Location"
          onChangeText={(location) => setBranchForm((form) => ({ ...form, location }))}
          placeholder="Optional"
          value={branchForm.location}
        />
        <OptionGroup
          disabled={!status?.activeBusiness}
          label="Type"
          onSelect={(branchType) => setBranchForm((form) => ({ ...form, branchType }))}
          options={branchTypes}
          selected={branchForm.branchType}
        />
        <OptionGroup
          disabled={!status?.activeBusiness}
          label="Status"
          onSelect={(activeLabel) => setBranchForm((form) => ({ ...form, active: activeLabel === "active" }))}
          options={["active", "inactive"] as const}
          selected={branchForm.active ? "active" : "inactive"}
        />
        <FormField
          editable={Boolean(status?.activeBusiness)}
          label="Notes"
          multiline
          onChangeText={(notes) => setBranchForm((form) => ({ ...form, notes }))}
          placeholder="Optional"
          value={branchForm.notes}
        />
        <View style={styles.inlineActions}>
          <ActionButton disabled={saving || !status?.activeBusiness} label={branchForm.id ? "Save Store/Stall" : "Add Store/Stall"} onPress={saveBranch} />
          {branchForm.id ? <SmallButton disabled={saving} label="Cancel edit" onPress={() => setBranchForm(emptyBranchForm)} /> : null}
        </View>
      </View>

      {status ? <PilotStatusCard status={status} /> : null}

      <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.cloudHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Owner Access</Text>
          <Pill label={ownerAccess?.hasPin ? "Protected" : "Not locked"} tone={ownerAccess?.hasPin ? "success" : "warning"} />
        </View>
        <Text style={[styles.body, { color: palette.mutedText }]}>Protect reports, costs, and settings when this phone is shared with Kiosk staff.</Text>
        {ownerAccess?.hasPin ? (
          <FormField
            keyboardType="numeric"
            label="Current PIN"
            onChangeText={(value) => setCurrentPin(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Required to change or remove lock"
            secureTextEntry
            value={currentPin}
          />
        ) : null}
        <View style={styles.securityPinRow}>
          <FormField
            keyboardType="numeric"
            label={ownerAccess?.hasPin ? "New PIN" : "Create PIN"}
            onChangeText={(value) => setNewPin(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="4 to 6 digits"
            secureTextEntry
            value={newPin}
          />
          <FormField
            keyboardType="numeric"
            label="Confirm PIN"
            onChangeText={(value) => setConfirmPin(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Repeat PIN"
            secureTextEntry
            value={confirmPin}
          />
        </View>
        <ActionButton
          disabled={securitySaving}
          label={securitySaving ? "Saving..." : ownerAccess?.hasPin ? "Change Owner PIN" : "Turn On Owner Lock"}
          onPress={savePin}
        />
        {ownerAccess?.hasPin ? (
          <>
            <View style={[styles.securityToggleRow, { borderColor: palette.border }]}>
              <View style={styles.securityToggleCopy}>
                <Text style={[styles.listItemTitle, { color: palette.text }]}>Fingerprint or face unlock</Text>
                <Text style={[styles.body, { color: palette.mutedText }]}>
                  {ownerAccess.biometricAvailable ? "Use this phone's enrolled device unlock." : "Set up biometrics in Android settings first."}
                </Text>
              </View>
              <Switch
                disabled={securitySaving || !ownerAccess.biometricAvailable}
                onValueChange={toggleBiometrics}
                thumbColor={palette.surface}
                trackColor={{ false: palette.border, true: palette.primary }}
                value={ownerAccess.biometricEnabled}
              />
            </View>
            <View style={styles.inlineActions}>
              <SmallButton disabled={securitySaving} label="Lock Owner Mode now" onPress={lockOwnerAccess} />
              <Pressable disabled={securitySaving} onPress={confirmRemoveOwnerLock} style={styles.dangerTextButton}>
                <Text style={[styles.smallButtonText, { color: palette.danger }]}>Remove lock</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>

      <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.text }]}>Data & Privacy</Text>
        <Text style={[styles.body, { color: palette.mutedText }]}>Business data stays in KitaMo on this phone. Cloud sync is not active, and Android backup is disabled.</Text>
        <SecondaryButton href="/privacy" label="Privacy Policy" />
        <SecondaryButton href="/owner/pilot-guide" label="Open Pilot Guide" />
        <Pressable disabled={saving || clearDataRunning} onPress={confirmClearPilotData} style={[styles.clearDataButton, { borderColor: palette.danger }]}>
          <Text style={[styles.smallButtonText, { color: palette.danger }]}>Clear All Local Pilot Data</Text>
        </Pressable>
      </View>
      </ScreenScroll>

      <Modal
        animationType="fade"
        onRequestClose={cancelClearPilotData}
        transparent
        visible={clearDataPinVisible}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: extended.scrim }]}>
          <View style={[styles.clearDataModal, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <IconBadge icon="shield-checkmark" size="lg" tone="danger" />
            <View style={styles.clearDataModalCopy}>
              <Text style={[styles.sectionTitle, { color: palette.text }]}>Verify before deleting</Text>
              <Text style={[styles.body, { color: palette.mutedText }]}>Enter the current Owner PIN. Cancel or a wrong PIN will leave all local data unchanged.</Text>
            </View>
            <TextInput
              accessibilityLabel="Current Owner PIN for local data deletion"
              autoFocus
              editable={!clearDataRunning}
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value) => setClearDataPin(value.replace(/\D/g, ""))}
              onSubmitEditing={verifyAndClearPilotData}
              placeholder="Current Owner PIN"
              placeholderTextColor={palette.mutedText}
              secureTextEntry
              style={[
                styles.clearDataPinInput,
                {
                  backgroundColor: palette.background,
                  borderColor: clearDataPinMessage ? palette.danger : palette.border,
                  color: palette.text,
                },
              ]}
              value={clearDataPin}
            />
            {clearDataPinMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.danger }]}>{clearDataPinMessage}</Text> : null}
            <View style={styles.clearDataModalActions}>
              <SmallButton disabled={clearDataRunning} label="Cancel" onPress={cancelClearPilotData} />
              <Pressable
                accessibilityRole="button"
                disabled={clearDataRunning}
                onPress={verifyAndClearPilotData}
                style={[
                  styles.deleteConfirmButton,
                  { backgroundColor: clearDataRunning ? extended.disabledBg : palette.danger },
                ]}
              >
                <Text style={[styles.actionButtonText, { color: clearDataRunning ? extended.disabledText : palette.kioskHeaderText }]}>
                  {clearDataRunning ? "Verifying..." : "Verify & Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "phone-pad" | "numeric" | "decimal-pad";
  editable?: boolean;
  secureTextEntry?: boolean;
};

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = "default",
  editable = true,
  secureTextEntry = false,
}: FormFieldProps) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode];

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedText}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          multiline ? styles.multilineInput : null,
          {
            backgroundColor: editable ? palette.background : extended.disabledBg,
            borderColor: editable ? palette.border : extended.disabledBg,
            color: editable ? palette.text : extended.disabledText,
          },
        ]}
        value={value}
      />
    </View>
  );
}

type OptionGroupProps<T extends string> = {
  label: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
};

function OptionGroup<T extends string>({ label, options, selected, onSelect, disabled = false }: OptionGroupProps<T>) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode];

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((option) => {
          const isSelected = option === selected;
          return (
            <Pressable
              disabled={disabled}
              key={option}
              onPress={() => onSelect(option)}
              style={[
                styles.option,
                {
                  backgroundColor: disabled ? extended.disabledBg : isSelected ? palette.primary : palette.background,
                  borderColor: disabled ? extended.disabledBg : isSelected ? palette.primary : palette.border,
                },
              ]}
            >
              <Text style={[styles.optionText, { color: disabled ? extended.disabledText : isSelected ? palette.kioskHeaderText : palette.text }]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function ActionButton({ label, onPress, disabled = false }: ButtonProps) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode];

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: disabled ? extended.disabledBg : palette.primary }]}
    >
      <Text style={[styles.actionButtonText, { color: disabled ? extended.disabledText : palette.kioskHeaderText }]}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress, disabled = false }: ButtonProps) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode];

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.smallButton, { backgroundColor: disabled ? extended.disabledBg : palette.surface, borderColor: disabled ? extended.disabledBg : palette.border }]}
    >
      <Text style={[styles.smallButtonText, { color: disabled ? extended.disabledText : palette.primary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  summaryCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  cloudHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  securityPinRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  securityToggleRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  securityToggleCopy: {
    flex: 1,
    gap: 2,
  },
  dangerTextButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  clearDataButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  modalBackdrop: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  clearDataModal: {
    alignItems: "stretch",
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 440,
    padding: spacing.lg,
    width: "100%",
  },
  clearDataModalCopy: {
    gap: spacing.xs,
  },
  clearDataPinInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    textAlign: "center",
  },
  clearDataModalActions: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  deleteConfirmButton: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 152,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryText: {
    flex: 1,
    gap: spacing.xs,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
  },
  header: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
  },
  title: {
    ...typography.title,
  },
  body: {
    ...typography.body,
  },
  message: {
    ...typography.body,
  },
  section: {
    borderRadius: 8,
    borderWidth: 1,
    elevation: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
  },
  businessList: {
    gap: spacing.sm,
  },
  empty: {
    ...typography.body,
  },
  subheading: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.button,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  option: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  optionText: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 44,
    minWidth: 152,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionButtonText: {
    ...typography.button,
  },
  listItem: {
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  listItemHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  listItemText: {
    flex: 1,
    gap: spacing.xs,
  },
  listItemTitle: {
    ...typography.button,
  },
  badge: {
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inlineActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  smallButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
});
