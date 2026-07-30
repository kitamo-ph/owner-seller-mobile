import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { NetworkStatusBadge } from "@/components/common/NetworkStatusBadge";
import { GabiEmptyState, GabiNotice, GabiSkeleton, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import { listActiveOwnerAlerts } from "@/db/repositories";
import { isLowStock } from "@/domain/inventory";
import type { Product } from "@/domain/types";
import { loadKioskContext, type KioskContext } from "@/services/kioskSales";
import { notifyOwnerLowStock } from "@/services/stockOps";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";

export default function KioskStockScreen() {
  const [context, setContext] = useState<KioskContext | null>(null);
  const [alertedProductIds, setAlertedProductIds] = useState<Set<string>>(new Set());
  const [notifyingProductId, setNotifyingProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const notifyLock = useRef(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const nextContext = await loadKioskContext();
    setContext(nextContext);

    if (nextContext.activeBusiness) {
      const activeAlerts = await listActiveOwnerAlerts(nextContext.activeBusiness.id);
      setAlertedProductIds(new Set(activeAlerts.map((alert) => alert.productId).filter((id): id is string => Boolean(id))));
    } else {
      setAlertedProductIds(new Set());
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refresh().catch((error) => {
        logDevError("KioskStock.refresh", error);
        if (active) {
          setMessage(getFriendlyErrorMessage("Could not load stock."));
          setMessageIsError(true);
        }
      });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  async function notifyOwner(product: Product) {
    if (notifyLock.current) {
      return;
    }

    notifyLock.current = true;
    setNotifyingProductId(product.id);
    setMessage(null);
    try {
      const result = await notifyOwnerLowStock(product.id);
      setMessage(
        result.alreadyNotified
          ? `Owner is already notified about ${product.name}.`
          : `Nai-notify na ang owner tungkol sa ${product.name}.`,
      );
      setMessageIsError(false);
      await refresh();
    } catch (error) {
      logDevError("KioskStock.notifyOwner", error);
      setMessage(getUserSafeErrorMessage(error, "Could not notify the owner."));
      setMessageIsError(true);
    } finally {
      notifyLock.current = false;
      setNotifyingProductId(null);
    }
  }

  return (
    <ScreenScroll kioskNav>
      <AppTopBar
        eyebrow="KIOSK"
        subtitle="Mabilis na stock check para sa confirmed stall"
        title="Stock"
      />

      <NetworkStatusBadge pendingQueueCount={context?.pendingQueueCount ?? 0} compact />

      {messageIsError && message ? <GabiNotice message={message} title="Hindi ma-update ang local alert" tone="danger" /> : null}

      {!context ? (
        <GabiCard>
          <GabiText tone="muted" variant="caption">Binabasa ang local stock...</GabiText>
          <GabiSkeleton height={74} />
          <GabiSkeleton height={74} />
        </GabiCard>
      ) : (
        <GabiCard>
          <GabiSectionHeader
            action={<GabiChip label={`${context.products.length} paninda`} tone="primary" />}
            title={context.activeBranch?.branchName ?? "Stock ng stall"}
          />
          {context.setupMessage && context.setupMessage !== "Add products in Owner Inventory first." ? (
            <GabiNotice message={context.setupMessage} tone="warning" />
          ) : null}
          {context.products.length === 0 ? (
            <GabiEmptyState
              actionLabel="Buksan ang Owner Inventory"
              icon="cube-outline"
              message="Magdagdag muna ng paninda sa Owner Mode para makita ang stall stock dito."
              onAction={() => router.push("/owner/inventory")}
              title="Wala pang paninda"
            />
          ) : (
            <View style={styles.stockList}>
              {context.products.map((product) => (
                <StockRow
                  cookedToOrder={Boolean(context.cookUponOrderRecipeByProductId[product.id])}
                  key={product.id}
                  notifying={notifyingProductId === product.id}
                  notifyDisabled={notifyingProductId !== null}
                  onNotify={() => notifyOwner(product)}
                  ownerNotified={alertedProductIds.has(product.id)}
                  product={product}
                />
              ))}
            </View>
          )}
        </GabiCard>
      )}

      {!messageIsError && message ? <GabiSnackbar message={message} onDismiss={() => setMessage(null)} /> : null}
    </ScreenScroll>
  );
}

type StockRowProps = {
  product: Product;
  cookedToOrder: boolean;
  ownerNotified: boolean;
  notifying: boolean;
  notifyDisabled: boolean;
  onNotify: () => void;
};

function StockRow({ product, cookedToOrder, ownerNotified, notifying, notifyDisabled, onNotify }: StockRowProps) {
  const { palette, extended } = useGabiTheme();
  const outOfStock = product.stockQty <= 0 && !cookedToOrder;
  const lowStock = !outOfStock && !cookedToOrder && isLowStock(product.stockQty, product.lowStockThreshold);
  const needsAttention = outOfStock || lowStock;

  return (
    <View style={[styles.stockRow, { borderColor: palette.border }]}>
      <View style={styles.stockTopRow}>
        <View style={[styles.stockIcon, { backgroundColor: outOfStock ? palette.softDanger : lowStock ? palette.softWarning : palette.softPrimary }]}>
          <Ionicons color={outOfStock ? palette.danger : lowStock ? palette.warning : palette.primary} name="cube-outline" size={21} />
        </View>
        <View style={styles.stockText}>
          <GabiText adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={2} variant="cardTitle">{product.name}</GabiText>
          <GabiText tone="muted" variant="caption">
            {product.stockQty} {product.unitType} · Paubos sa {product.lowStockThreshold}
          </GabiText>
          <View style={styles.stockChips}>
            {cookedToOrder ? (
              <GabiChip icon="flame-outline" label="Luto kapag may order" tone="accent" />
            ) : (
              <GabiChip
                label={outOfStock ? "Ubos na" : lowStock ? `${product.stockQty} na lang` : "May stock"}
                tone={outOfStock ? "danger" : lowStock ? "warning" : "success"}
              />
            )}
            {ownerNotified ? <GabiChip icon="notifications-outline" label="Nasa Owner alerts" tone="primary" /> : null}
          </View>
        </View>
        <View style={styles.stockPrice}>
          <GabiText money tone="primary" variant="metricValue">{formatPeso(product.price)}</GabiText>
          <GabiText tone="faint" variant="caption">presyo</GabiText>
        </View>
      </View>

      {needsAttention && !ownerNotified ? (
        <Pressable
          accessibilityLabel={`Gumawa ng local Owner alert para sa ${product.name}`}
          accessibilityRole="button"
          disabled={notifyDisabled}
          onPress={onNotify}
          style={[
            styles.notifyButton,
            {
              backgroundColor: notifyDisabled ? extended.disabledBg : palette.softPrimary,
              borderColor: notifyDisabled ? extended.disabledBg : palette.border,
            },
          ]}
        >
          <Ionicons color={notifyDisabled ? extended.disabledText : palette.primary} name="notifications-outline" size={18} />
          <GabiText style={{ color: notifyDisabled ? extended.disabledText : palette.primary }} variant="buttonSm">
            {notifying ? "Ginagawa ang local alert..." : "I-alert ang Owner sa phone na ito"}
          </GabiText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stockList: {
    gap: 0,
  },
  stockRow: {
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  stockTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  stockIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  stockText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  stockChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  stockPrice: {
    alignItems: "flex-end",
    maxWidth: 92,
  },
  notifyButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
