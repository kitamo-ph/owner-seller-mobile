import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll, formatPeso } from "@/components/ui/KitaMoUI";
import type { PaymentMethod } from "@/domain/types";
import { listRecentKioskOrders, type KioskOrderSummary } from "@/services/kioskSales";
import { copyReceiptText, shareReceiptText } from "@/services/shareReceipt";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function paymentLabel(method: PaymentMethod) {
  return method === "bank transfer"
    ? "Bank transfer"
    : method === "cash" || method === "other"
      ? method.charAt(0).toUpperCase() + method.slice(1)
      : method;
}

export default function KioskOrdersScreen() {
  const [orders, setOrders] = useState<KioskOrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<KioskOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const { palette } = useGabiTheme();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextOrders = await listRecentKioskOrders();
      setOrders(nextOrders);
      setMessage(null);
      setMessageIsError(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refresh().catch((error) => {
        logDevError("KioskOrders.refresh", error);
        if (active) {
          setMessage(getFriendlyErrorMessage("Could not load orders."));
          setMessageIsError(true);
        }
      });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  async function copyReceipt() {
    if (!selectedOrder?.receiptText) return;
    await copyReceiptText(selectedOrder.receiptText);
    setMessage("Nakopya ang resibo.");
    setMessageIsError(false);
  }

  async function shareReceipt() {
    if (!selectedOrder?.receiptText) return;
    const shared = await shareReceiptText(selectedOrder.receiptText);
    setMessage(shared ? "Bukas na ang share options." : "Hindi available ang sharing sa device na ito.");
    setMessageIsError(!shared);
  }

  return (
    <ScreenScroll kioskNav>
      <AppTopBar eyebrow="KIOSK" subtitle="Mga lokal na benta at resibo sa stall na ito" title="Orders" />

      {messageIsError && message ? <GabiNotice message={message} title="Hindi ma-load o ma-share" tone="danger" /> : null}

      {loading ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="35%" />
          <GabiSkeleton height={82} showImmediately />
          <GabiSkeleton height={82} showImmediately />
        </GabiCard>
      ) : null}

      {!loading && orders.length === 0 ? (
        <GabiCard>
          <GabiEmptyState
            icon="receipt-outline"
            message="Lalabas dito ang mga benta matapos ang unang checkout sa stall na ito."
            title="Wala pang local sale"
          />
        </GabiCard>
      ) : null}

      {!loading && orders.length > 0 ? (
        <GabiCard>
          <GabiSectionHeader action={<GabiChip label={`${orders.length} recent`} tone="neutral" />} title="Mga order" />
          <View style={styles.orderList}>
            {orders.map((order) => {
              const selected = selectedOrder?.id === order.id;
              return (
                <Pressable
                  accessibilityLabel={`${order.transactionNo}, ${formatPeso(order.amount)}`}
                  accessibilityRole="button"
                  key={order.id}
                  onPress={() => setSelectedOrder(order)}
                  style={[
                    styles.orderCard,
                    {
                      backgroundColor: selected ? palette.softPrimary : palette.surface,
                      borderColor: selected ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <View style={[styles.orderIcon, { backgroundColor: palette.softSuccess }]}>
                    <Ionicons color={palette.success} name="receipt-outline" size={20} />
                  </View>
                  <View style={styles.orderCopy}>
                    <GabiText numberOfLines={1} variant="buttonSm">{order.transactionNo}</GabiText>
                    <GabiText tone="muted" variant="caption">{formatDateTime(order.happenedAt)} · {order.itemCount} item(s)</GabiText>
                    <View style={styles.orderMeta}>
                      <GabiChip label={paymentLabel(order.paymentMethod)} tone="success" />
                      {order.externalReferenceNumber ? <GabiChip label={`Ref ${order.externalReferenceNumber}`} tone="neutral" /> : null}
                    </View>
                  </View>
                  <View style={styles.orderAmount}>
                    <GabiText money numberOfLines={1} tone="success" variant="metricValue">{formatPeso(order.amount)}</GabiText>
                    <Ionicons color={palette.primary} name="chevron-forward" size={18} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </GabiCard>
      ) : null}

      {selectedOrder ? (
        <GabiCard raised>
          <GabiSectionHeader action={<GabiChip label={paymentLabel(selectedOrder.paymentMethod)} tone="success" />} title="Resibo" />
          <View style={[styles.receiptTotal, { backgroundColor: palette.softPrimary }]}>
            <View style={styles.receiptTotalCopy}>
              <GabiText tone="muted" variant="caption">{selectedOrder.transactionNo}</GabiText>
              <GabiText tone="muted" variant="caption">{formatDateTime(selectedOrder.happenedAt)}</GabiText>
            </View>
            <GabiText money tone="primary" variant="heroPeso">{formatPeso(selectedOrder.amount)}</GabiText>
          </View>
          {selectedOrder.receiptText ? (
            <>
              <View style={[styles.receiptTextCard, { backgroundColor: palette.background, borderColor: palette.border }]}>
                <GabiText style={styles.receiptText}>{selectedOrder.receiptText}</GabiText>
              </View>
              <View style={styles.receiptActions}>
                <View style={styles.receiptActionCell}>
                  <GabiSoftButton icon="copy-outline" label="Copy" onPress={copyReceipt} />
                </View>
                <View style={styles.receiptActionCell}>
                  <GabiSoftButton icon="share-social-outline" label="Share" onPress={shareReceipt} />
                </View>
              </View>
            </>
          ) : (
            <GabiNotice message="Walang receipt text na naka-save para sa order na ito." tone="warning" />
          )}
        </GabiCard>
      ) : null}

      {!messageIsError && message ? <GabiSnackbar message={message} onDismiss={() => setMessage(null)} /> : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  orderList: {
    gap: spacing.sm,
  },
  orderCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 92,
    padding: spacing.sm,
  },
  orderIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  orderCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  orderMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  orderAmount: {
    alignItems: "flex-end",
    gap: 4,
  },
  receiptTotal: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  receiptTotalCopy: {
    flex: 1,
    gap: 3,
  },
  receiptTextCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  receiptText: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
  },
  receiptActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  receiptActionCell: {
    flex: 1,
  },
});
