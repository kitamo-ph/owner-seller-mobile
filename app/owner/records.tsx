import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { KitaTabs } from "@/components/owner/KitaTabs";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import {
  getLogbookDateGroup,
  listLogbookEvents,
  logbookDateGroupLabels,
  type LogbookDateGroup,
  type LogbookEvent,
  type LogbookEventFilter,
  type LogbookEventType,
} from "@/services/localAnalytics";
import { loadOwnerSetupStatus } from "@/services/ownerSetup";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

const filters: { id: LogbookEventFilter; label: string }[] = [
  { id: "all", label: "Lahat" },
  { id: "benta", label: "Benta" },
  { id: "grocery", label: "Grocery" },
  { id: "niluto", label: "Niluto" },
  { id: "bayarin", label: "Bayarin" },
  { id: "nasayang", label: "Nasayang" },
  { id: "lipat", label: "Lipat" },
];

const dateGroupOrder: LogbookDateGroup[] = ["today", "yesterday", "earlier"];

const eventMeta: Record<LogbookEventType, { icon: React.ComponentProps<typeof Ionicons>["name"]; tone: "primary" | "success" | "danger" | "neutral" | "warning" | "accent" }> = {
  benta: { icon: "cart-outline", tone: "success" },
  grocery: { icon: "basket-outline", tone: "accent" },
  niluto: { icon: "flame-outline", tone: "primary" },
  bayarin: { icon: "receipt-outline", tone: "warning" },
  nasayang: { icon: "trash-bin-outline", tone: "danger" },
  lipat: { icon: "swap-horizontal-outline", tone: "neutral" },
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function signedAmount(event: LogbookEvent) {
  if (event.amount === null) return null;
  if (event.eventType === "benta") return `+${formatPeso(event.amount)}`;
  if (event.eventType === "grocery" || event.eventType === "bayarin") return `−${formatPeso(event.amount)}`;
  return formatPeso(event.amount);
}

export default function OwnerRecordsScreen() {
  const router = useRouter();
  const { palette } = useGabiTheme();
  const [events, setEvents] = useState<LogbookEvent[]>([]);
  const [hasBusiness, setHasBusiness] = useState(true);
  const [activeFilter, setActiveFilter] = useState<LogbookEventFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [summary, setSummary] = useState({ bentaTotal: 0, bentaCount: 0, eventCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await loadOwnerSetupStatus();
      const businessId = status.activeBusiness?.id ?? null;
      const nextEvents = await listLogbookEvents(businessId);
      const bentaEvents = nextEvents.filter((event) => event.eventType === "benta");
      setHasBusiness(Boolean(businessId));
      setEvents(nextEvents);
      setSummary({
        bentaTotal: bentaEvents.reduce((total, event) => total + (event.amount ?? 0), 0),
        bentaCount: bentaEvents.length,
        eventCount: nextEvents.length,
      });
      setError(null);
    } catch (loadError) {
      logDevError("OwnerRecords.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load local records."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const filteredEvents = useMemo(
    () => activeFilter === "all" ? events : events.filter((event) => event.eventType === activeFilter),
    [activeFilter, events],
  );

  const groupedEvents = useMemo(() => {
    const groups = new Map<LogbookDateGroup, LogbookEvent[]>(dateGroupOrder.map((group) => [group, []]));
    for (const event of filteredEvents) groups.get(getLogbookDateGroup(event.happenedAt))?.push(event);
    return dateGroupOrder.map((group) => ({ group, events: groups.get(group) ?? [] })).filter((entry) => entry.events.length > 0);
  }, [filteredEvents]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  return (
    <ScreenScroll bottomNav>
      <AppTopBar showBrand subtitle="Isang timeline ng galaw ng negosyo." title="Kita" />

      <KitaTabs />

      {error ? (
        <GabiCard>
          <GabiNotice message={error} title="Hindi mabuksan ang Logbook" tone="danger" />
          <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
        </GabiCard>
      ) : null}

      {loading ? <LogbookSkeleton /> : null}

      {!loading && !hasBusiness ? (
        <GabiCard>
          <GabiEmptyState
            actionLabel="Buksan ang Settings"
            icon="business-outline"
            message="Pumili o gumawa muna ng business para makita ang lokal na timeline."
            onAction={() => router.push("/owner/settings")}
            title="Wala pang business"
          />
        </GabiCard>
      ) : null}

      {!loading && hasBusiness ? (
        <>
          <GabiCard>
            <GabiSectionHeader title="Buod" action={<GabiChip label={`${summary.eventCount} entries`} tone="neutral" />} />
            <View style={styles.summaryRow}>
              <SummaryMetric label="Benta" value={String(summary.bentaCount)} />
              <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
              <SummaryMetric label="Halaga" money value={formatPeso(summary.bentaTotal)} />
            </View>
          </GabiCard>

          <View style={styles.filterRow}>
            {filters.map((filter) => {
              const active = activeFilter === filter.id;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={filter.id}
                  onPress={() => {
                    setActiveFilter(filter.id);
                    setSelectedEventId(null);
                  }}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? palette.primary : palette.surface,
                      borderColor: active ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <GabiText style={{ color: active ? palette.kioskHeaderText : palette.text }} variant="buttonSm">{filter.label}</GabiText>
                </Pressable>
              );
            })}
          </View>

          {filteredEvents.length === 0 ? (
            <GabiCard>
              <GabiEmptyState
                icon="document-text-outline"
                message="Magbenta, bumili ng grocery, magluto, o mag-record ng bayarin para magkaroon ng entry."
                title="Wala pang entry sa filter na ito"
              />
            </GabiCard>
          ) : null}

          {groupedEvents.map(({ group, events: groupEvents }) => (
            <View key={group} style={styles.dateGroup}>
              <View style={styles.dateHeader}>
                <GabiText variant="h2">{logbookDateGroupLabels[group]}</GabiText>
                <GabiText tone="faint" variant="caption">{groupEvents.length} entries</GabiText>
              </View>
              <GabiCard style={styles.timelineCard}>
                {groupEvents.map((event, index) => (
                  <LogbookRow
                    event={event}
                    key={event.id}
                    last={index === groupEvents.length - 1}
                    onPress={() => setSelectedEventId((current) => current === event.id ? null : event.id)}
                    selected={selectedEventId === event.id}
                  />
                ))}
              </GabiCard>
            </View>
          ))}

          {selectedEvent ? (
            <GabiCard>
              <View style={styles.detailHeader}>
                <View style={styles.flexCopy}>
                  <GabiText variant="h2">{selectedEvent.receiptText ? "Receipt" : `${selectedEvent.label} detail`}</GabiText>
                  <GabiText tone="muted" variant="caption">{formatDateTime(selectedEvent.happenedAt)}</GabiText>
                </View>
                <GabiChip label={selectedEvent.label} tone={eventMeta[selectedEvent.eventType].tone} />
              </View>
              {selectedEvent.receiptText ? (
                <View style={[styles.receipt, { backgroundColor: palette.background, borderColor: palette.border }]}>
                  <GabiText style={styles.receiptText}>{selectedEvent.receiptText}</GabiText>
                </View>
              ) : (
                <>
                  <GabiText variant="cardTitle">{selectedEvent.title}</GabiText>
                  <GabiText tone="muted" variant="body">{selectedEvent.subtitle}</GabiText>
                  {signedAmount(selectedEvent) ? <GabiText money tone={selectedEvent.eventType === "benta" ? "success" : "default"} variant="metricValue">{signedAmount(selectedEvent)}</GabiText> : null}
                </>
              )}
            </GabiCard>
          ) : null}
        </>
      ) : null}
    </ScreenScroll>
  );
}

function SummaryMetric({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <View style={styles.summaryMetric}>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money={money} tone="success" variant="metricValue">{value}</GabiText>
    </View>
  );
}

function LogbookRow({ event, selected, last, onPress }: { event: LogbookEvent; selected: boolean; last: boolean; onPress: () => void }) {
  const { palette } = useGabiTheme();
  const meta = eventMeta[event.eventType];
  const amount = signedAmount(event);
  const amountTone = event.eventType === "benta" ? "success" : event.eventType === "grocery" || event.eventType === "bayarin" ? "danger" : "default";
  const iconColor = meta.tone === "success" ? palette.success : meta.tone === "accent" ? palette.accent : meta.tone === "warning" ? palette.warning : meta.tone === "danger" ? palette.danger : palette.primary;
  const iconBg = meta.tone === "success" ? palette.softSuccess : meta.tone === "accent" ? palette.softAccent : meta.tone === "warning" ? palette.softWarning : meta.tone === "danger" ? palette.softDanger : palette.softPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.eventRow,
        !last ? { borderBottomColor: palette.border, borderBottomWidth: 1 } : null,
        selected || pressed ? { backgroundColor: palette.softPrimary } : null,
      ]}
    >
      <View style={[styles.eventIcon, { backgroundColor: iconBg }]}>
        <Ionicons color={iconColor} name={meta.icon} size={20} />
      </View>
      <View style={styles.flexCopy}>
        <GabiText numberOfLines={1} variant="cardTitle">{event.title}</GabiText>
        <GabiText numberOfLines={2} tone="muted" variant="caption">{event.label} · {event.subtitle}</GabiText>
        <GabiText tone="faint" variant="caption">{formatTime(event.happenedAt)}</GabiText>
      </View>
      <View style={styles.eventEnd}>
        {amount ? <GabiText money tone={amountTone} variant="buttonSm">{amount}</GabiText> : null}
        <Ionicons color={palette.mutedText} name={selected ? "chevron-up" : "chevron-forward"} size={18} />
      </View>
    </Pressable>
  );
}

function LogbookSkeleton() {
  return (
    <GabiCard>
      <GabiSkeleton height={26} width="42%" />
      {[0, 1, 2].map((item) => <GabiSkeleton height={64} key={item} />)}
    </GabiCard>
  );
}

const styles = StyleSheet.create({
  flexCopy: { flex: 1 },
  summaryRow: { alignItems: "stretch", flexDirection: "row", gap: spacing.md },
  summaryMetric: { flex: 1, gap: spacing.xs },
  summaryDivider: { width: 1 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filterChip: { borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  dateGroup: { gap: spacing.sm },
  dateHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  timelineCard: { gap: 0, padding: 0, overflow: "hidden" },
  eventRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 78, padding: spacing.md },
  eventIcon: { alignItems: "center", borderRadius: 14, height: 42, justifyContent: "center", width: 42 },
  eventEnd: { alignItems: "flex-end", gap: spacing.xs },
  detailHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  receipt: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  receiptText: { fontFamily: "monospace", fontSize: 13, lineHeight: 19 },
});
