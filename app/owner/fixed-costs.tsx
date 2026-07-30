import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { KitaTabs } from "@/components/owner/KitaTabs";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import { fixedCostCategories, fixedCostFrequencies } from "@/db/repositories";
import { isValidIsoDate } from "@/domain/fixedCostSchedule";
import type { FixedCostCategory, FixedCostFrequencyType } from "@/domain/types";
import {
  addFixedCost,
  archiveFixedCost,
  loadFixedCostsOverview,
  markFixedCostPaid,
  type FixedCostOverviewItem,
  type FixedCostsOverview,
} from "@/services/fixedCosts";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseRequiredNumber } from "@/utils/numberInput";

const categoryLabels: Record<FixedCostCategory, string> = {
  rent: "Rent",
  wages: "Sweldo",
  electricity: "Kuryente",
  water: "Tubig",
  transport: "Transport",
  lpg_gas: "LPG / Gas",
  market_fee: "Market fee",
  internet_load: "Internet / Load",
  other: "Iba pa",
};

const frequencyLabels: Record<FixedCostFrequencyType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  one_time: "One-time",
};

const statusOrder: Record<FixedCostOverviewItem["status"], number> = {
  overdue: 0,
  due_soon: 1,
  scheduled: 2,
  done: 3,
  paid_up: 4,
};

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-PH", { dateStyle: "medium" });
}

export default function OwnerFixedCostsScreen() {
  const router = useRouter();
  const { palette } = useGabiTheme();
  const [overview, setOverview] = useState<FixedCostsOverview | null>(null);
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<FixedCostCategory>("rent");
  const [branchId, setBranchId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<FixedCostFrequencyType>("monthly");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formIsError, setFormIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const actionLock = useRef(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const refresh = useCallback(async () => {
    const nextStatus = await loadOwnerSetupStatus();
    const nextOverview = await loadFixedCostsOverview();
    setStatus(nextStatus);
    setOverview(nextOverview);
    if (nextOverview.items.length === 0) setShowAddForm(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refresh()
        .then(() => { if (active) setLoadError(null); })
        .catch((error) => {
          logDevError("OwnerFixedCosts.refresh", error);
          if (active) setLoadError(getFriendlyErrorMessage("Could not load fixed costs."));
        });
      return () => { active = false; };
    }, [refresh]),
  );

  async function saveFixedCost() {
    if (saveLock.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormMessage("Ilagay ang pangalan ng gastos. Example: Stall rent.");
      setFormIsError(true);
      return;
    }
    const parsedAmount = parseRequiredNumber(amount, 0);
    if (parsedAmount === "invalid") {
      setFormMessage(numbersOnlyMessage);
      setFormIsError(true);
      return;
    }
    if (parsedAmount <= 0) {
      setFormMessage("Ilagay ang halaga. Example: 3000.");
      setFormIsError(true);
      return;
    }
    const trimmedDueDate = dueDate.trim();
    if (trimmedDueDate && !isValidIsoDate(trimmedDueDate)) {
      setFormMessage("Date should look like 2026-07-15. Leave it blank for today.");
      setFormIsError(true);
      return;
    }
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    saveLock.current = true;
    setSaving(true);
    setFormMessage(null);
    try {
      const cost = await addFixedCost({
        branchId,
        name: trimmedName,
        category,
        amount: parsedAmount,
        frequency,
        dueDate: trimmedDueDate || todayIso,
        notes: notes.trim() || null,
      });
      setName("");
      setAmount("");
      setDueDate("");
      setNotes("");
      setFormMessage(`Saved locally on this device. ${cost.name}: ${formatPeso(cost.amount)} ${frequencyLabels[cost.frequency].toLowerCase()}.`);
      setFormIsError(false);
      try {
        await refresh();
      } catch (refreshError) {
        logDevError("OwnerFixedCosts.refreshAfterSave", refreshError);
        setLoadError(getFriendlyErrorMessage("Could not reload fixed costs. Balikan ang screen na ito."));
      }
    } catch (error) {
      logDevError("OwnerFixedCosts.saveFixedCost", error);
      setFormMessage(getUserSafeErrorMessage(error, "Could not save the fixed cost."));
      setFormIsError(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function runAction(costId: string, action: "pay" | "archive") {
    if (actionLock.current) return;
    actionLock.current = true;
    setActingId(costId);
    try {
      if (action === "pay") {
        const result = await markFixedCostPaid(costId);
        setFormMessage(`Bayad na: ${result.costName} (${formatDate(result.dueDate)}).`);
      } else {
        await archiveFixedCost(costId);
        setFormMessage("Fixed cost archived. History stays saved.");
      }
      setFormIsError(false);
      await refresh();
    } catch (error) {
      logDevError("OwnerFixedCosts.runAction", error);
      setFormMessage(getUserSafeErrorMessage(error, "Could not update the fixed cost."));
      setFormIsError(true);
    } finally {
      actionLock.current = false;
      setActingId(null);
    }
  }

  function confirmAction(costId: string, costName: string, action: "pay" | "archive") {
    Alert.alert(
      action === "pay" ? "Mark this cost as paid?" : "Archive fixed cost?",
      action === "pay"
        ? `${costName} will be included as paid in the current profit period.`
        : `${costName} will stop appearing in active costs. Payment history stays saved.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: action === "pay" ? "Mark paid" : "Archive", style: action === "archive" ? "destructive" : "default", onPress: () => void runAction(costId, action) },
      ],
    );
  }

  const branches = status?.branches ?? [];
  const hasBusiness = Boolean(status?.activeBusiness);
  const items = useMemo(() => [...(overview?.items ?? [])].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]), [overview?.items]);

  return (
    <ScreenScroll bottomNav>
      <AppTopBar showBrand subtitle="Regular na gastos at due dates." title="Kita" />

      <KitaTabs />

      {loadError ? (
        <GabiCard>
          <GabiNotice message={loadError} title="Hindi mabuksan ang Bayarin" tone="danger" />
          <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
        </GabiCard>
      ) : null}

      {!overview ? <FixedCostSkeleton /> : null}

      {overview ? (
        <>
          <GabiCard>
            <GabiSectionHeader title="Ngayong buwan" action={<GabiChip label={`${items.length} active`} tone="neutral" />} />
            <GabiText money tone="primary" variant="heroPeso">{formatPeso(overview.thisMonthTotal)}</GabiText>
            <View style={styles.summaryRow}>
              <SummaryCell label="Overdue" tone={overview.overdueCount > 0 ? "danger" : "success"} value={String(overview.overdueCount)} />
              <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
              <SummaryCell label="Due soon" tone={overview.dueSoonCount > 0 ? "warning" : "success"} value={String(overview.dueSoonCount)} />
              <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
              <SummaryCell label="Paid" money tone="success" value={formatPeso(overview.paidThisMonthTotal)} />
            </View>
          </GabiCard>

          <GabiNotice
            message="Fixed Costs are deducted in the Kita Report for each occurrence within the selected period, whether paid or not."
            title="Profit formula"
            tone="owner"
          />

          <GabiPrimaryButton
            icon={showAddForm ? "close" : "add"}
            label={showAddForm ? "Isara ang form" : "Magdagdag ng bayarin"}
            onPress={() => setShowAddForm((visible) => !visible)}
          />
        </>
      ) : null}

      {showAddForm ? (
        <GabiCard>
          <GabiSectionHeader title="Bagong fixed cost" />
          {!hasBusiness && status ? <GabiNotice message="Create your business profile in Owner Settings first." tone="warning" /> : null}
          <GabiField disabled={saving} label="Pangalan" onChangeText={setName} placeholder="Example: Stall rent" value={name} />
          <ChoiceField
            disabled={saving}
            label="Category"
            onSelect={(value) => setCategory(value as FixedCostCategory)}
            options={fixedCostCategories.map((value) => ({ label: categoryLabels[value], value }))}
            selected={category}
          />
          <ChoiceField
            disabled={saving}
            label="Sakop"
            onSelect={(value) => setBranchId(value === "business" ? null : value)}
            options={[{ label: "Buong negosyo", value: "business" }, ...branches.map((branch) => ({ label: branch.branchName, value: branch.id }))]}
            selected={branchId ?? "business"}
          />
          <GabiField disabled={saving} keyboardType="decimal-pad" label="Halaga" onChangeText={setAmount} placeholder="Example: 3000" value={amount} />
          <ChoiceField
            disabled={saving}
            label="Dalas"
            onSelect={(value) => setFrequency(value as FixedCostFrequencyType)}
            options={fixedCostFrequencies.map((value) => ({ label: frequencyLabels[value], value }))}
            selected={frequency}
          />
          <GabiField disabled={saving} helperText="YYYY-MM-DD. Blank means today." label="Unang due date" onChangeText={setDueDate} placeholder="2026-07-15" value={dueDate} />
          <GabiField disabled={saving} label="Notes (optional)" onChangeText={setNotes} placeholder="Example: kay Aling Baby" value={notes} />
          {formMessage ? <GabiNotice message={formMessage} tone={formIsError ? "danger" : "success"} /> : null}
          <GabiPrimaryButton disabled={!hasBusiness} icon="save-outline" label="Save Fixed Cost" loading={saving} onPress={() => void saveFixedCost()} />
        </GabiCard>
      ) : formMessage ? <GabiNotice message={formMessage} tone={formIsError ? "danger" : "success"} /> : null}

      {overview ? (
        <>
          <GabiSectionHeader title="Mga bayarin" />
          {items.length === 0 ? (
            <GabiCard>
              <GabiEmptyState icon="receipt-outline" message="Example: Stall rent, ₱3,000 monthly." title="Wala pang fixed cost" />
            </GabiCard>
          ) : null}
          {items.map((item) => (
            <FixedCostCard
              acting={actingId !== null}
              item={item}
              key={item.cost.id}
              onArchive={() => confirmAction(item.cost.id, item.cost.name, "archive")}
              onPay={() => confirmAction(item.cost.id, item.cost.name, "pay")}
              saving={actingId === item.cost.id}
            />
          ))}
          <GabiSoftButton icon="bar-chart-outline" label="Buksan ang Kita Report" onPress={() => router.push("/owner/reports")} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

function ChoiceField({ label, options, selected, onSelect, disabled }: { label: string; options: { label: string; value: string }[]; selected: string; onSelect: (value: string) => void; disabled: boolean }) {
  const { palette, extended } = useGabiTheme();
  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      <View style={styles.choiceWrap}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={[
                styles.choice,
                {
                  backgroundColor: disabled ? extended.disabledBg : active ? palette.primary : palette.surface,
                  borderColor: disabled ? extended.disabledBg : active ? palette.primary : palette.border,
                },
              ]}
            >
              <GabiText style={{ color: disabled ? extended.disabledText : active ? palette.kioskHeaderText : palette.text }} variant="buttonSm">{option.label}</GabiText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SummaryCell({ label, value, tone, money = false }: { label: string; value: string; tone: "success" | "warning" | "danger"; money?: boolean }) {
  return (
    <View style={styles.summaryCell}>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money={money} tone={tone} variant="metricValue">{value}</GabiText>
    </View>
  );
}

function FixedCostCard({ item, acting, saving, onPay, onArchive }: { item: FixedCostOverviewItem; acting: boolean; saving: boolean; onPay: () => void; onArchive: () => void }) {
  const statusLabel = item.status === "overdue" ? "Overdue" : item.status === "due_soon" ? "Due soon" : item.status === "done" ? "Bayad na" : item.status === "paid_up" ? "Paid up" : "Scheduled";
  const statusTone = item.status === "overdue" ? "danger" as const : item.status === "due_soon" ? "warning" as const : item.status === "done" || item.status === "paid_up" ? "success" as const : "neutral" as const;
  const icon = item.cost.category === "rent" ? "home-outline" : item.cost.category === "wages" ? "people-outline" : item.cost.category === "electricity" ? "flash-outline" : item.cost.category === "water" ? "water-outline" : "receipt-outline";
  const { palette } = useGabiTheme();
  return (
    <GabiCard style={item.status === "overdue" ? { borderColor: palette.danger } : item.status === "due_soon" ? { borderColor: palette.warning } : undefined}>
      <View style={styles.costHeader}>
        <View style={[styles.costIcon, { backgroundColor: item.status === "overdue" ? palette.softDanger : item.status === "due_soon" ? palette.softWarning : palette.softPrimary }]}>
          <Ionicons color={item.status === "overdue" ? palette.danger : item.status === "due_soon" ? palette.warning : palette.primary} name={icon} size={22} />
        </View>
        <View style={styles.flexCopy}>
          <GabiText variant="cardTitle">{item.cost.name}</GabiText>
          <GabiText tone="muted" variant="caption">{categoryLabels[item.cost.category]} · {item.cost.branchName ?? "Buong negosyo"}</GabiText>
        </View>
        <GabiChip label={statusLabel} tone={statusTone} />
      </View>
      <View style={styles.costMeta}>
        <GabiText money tone={item.status === "overdue" ? "danger" : "primary"} variant="metricValue">{formatPeso(item.cost.amount)}</GabiText>
        <GabiText tone="muted" variant="caption">{frequencyLabels[item.cost.frequency]}</GabiText>
      </View>
      {item.nextDueDate ? <GabiText tone="muted" variant="body">Next due: {formatDate(item.nextDueDate)}</GabiText> : null}
      {item.paidCount > 0 ? <GabiText tone="faint" variant="caption">{item.paidCount} payment{item.paidCount === 1 ? "" : "s"} saved</GabiText> : null}
      <View style={styles.actionRow}>
        {item.nextDueDate ? <View style={styles.actionFlex}><GabiPrimaryButton compact disabled={acting && !saving} icon="checkmark" label="Bayad na" loading={saving} onPress={onPay} /></View> : null}
        <View style={styles.actionFlex}><GabiSoftButton compact disabled={acting} icon="archive-outline" label="Archive" onPress={onArchive} /></View>
      </View>
    </GabiCard>
  );
}

function FixedCostSkeleton() {
  return (
    <GabiCard>
      <GabiSkeleton height={22} width="48%" />
      <GabiSkeleton height={42} width="68%" />
      <GabiSkeleton height={60} />
    </GabiCard>
  );
}

const styles = StyleSheet.create({
  flexCopy: { flex: 1 },
  summaryRow: { alignItems: "stretch", flexDirection: "row", gap: spacing.sm },
  summaryCell: { flex: 1, gap: spacing.xs },
  summaryDivider: { width: 1 },
  field: { gap: spacing.xs },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  costHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  costIcon: { alignItems: "center", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  costMeta: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  actionFlex: { flex: 1 },
});
