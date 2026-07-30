import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiNotice, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll, formatPeso } from "@/components/ui/KitaMoUI";
import { calculateCartSubtotal, calculateLineTotal } from "@/domain/pricing";
import type { PaymentMethod } from "@/domain/types";
import { completeKioskSale, type CompletedKioskSale } from "@/services/kioskSales";
import { copyReceiptText, shareReceiptText } from "@/services/shareReceipt";
import { useKioskStore, type KioskCartItem } from "@/state/kioskStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getUserSafeErrorMessage, logDevError } from "@/utils/errors";

const paymentMethods: PaymentMethod[] = ["cash", "GCash", "Maya", "bank transfer", "other"];
const discountShortcuts = [0, 5, 10] as const;

function paymentLabel(method: PaymentMethod) {
  if (method === "bank transfer") return "Bank";
  return method === "cash" || method === "other" ? method.charAt(0).toUpperCase() + method.slice(1) : method;
}

function paymentIcon(method: PaymentMethod): React.ComponentProps<typeof Ionicons>["name"] {
  if (method === "cash") return "cash-outline";
  if (method === "GCash") return "phone-portrait-outline";
  if (method === "Maya") return "wallet-outline";
  if (method === "bank transfer") return "business-outline";
  return "ellipsis-horizontal-circle-outline";
}

export default function KioskCheckoutScreen() {
  const cartItems = useKioskStore((state) => state.cartItems);
  const checkoutToken = useKioskStore((state) => state.checkoutToken);
  const clearCart = useKioskStore((state) => state.clearCart);
  const setLastReceipt = useKioskStore((state) => state.setLastReceipt);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [completedSale, setCompletedSale] = useState<CompletedKioskSale | null>(null);
  const [completedItems, setCompletedItems] = useState<KioskCartItem[]>([]);
  const { palette } = useGabiTheme();
  const router = useRouter();

  function setNotice(text: string) {
    setMessage(text);
    setMessageIsError(false);
  }

  function setError(text: string) {
    setMessage(text);
    setMessageIsError(true);
  }

  const subtotal = calculateCartSubtotal(cartItems);
  const discount = parseMoney(discountAmount);
  const discountInvalid = discount === null;
  const discountTooLarge = discount !== null && discount > subtotal;
  const total = Math.max(0, subtotal - (discount ?? 0));
  const referenceRequired = paymentMethod !== "cash";
  const hasCashTender = paymentMethod === "cash" && cashReceived.trim().length > 0;
  const parsedCashTender = parseMoney(cashReceived);
  const cashTenderInvalid = hasCashTender && (parsedCashTender === null || parsedCashTender < total);
  const change = hasCashTender && parsedCashTender !== null && parsedCashTender >= total ? parsedCashTender - total : null;
  const disabledReason = completedSale
    ? null
    : cartItems.length === 0
      ? "Walang laman ang cart."
      : discountInvalid
        ? "Ayusin ang tawad para maging valid na halaga."
        : discountTooLarge
          ? "Hindi puwedeng mas malaki sa subtotal ang tawad."
          : referenceRequired && !referenceNumber.trim()
            ? `Kailangan ang reference # para sa ${paymentLabel(paymentMethod)}.`
            : cashTenderInvalid
              ? parsedCashTender === null
                ? "Ayusin ang halagang inabot."
                : `Kulang ng ${formatPeso(total - parsedCashTender)} ang inabot.`
              : null;
  const tenderOptions = [...new Set([total, 100, 200, 500, 1000].filter((amount) => amount >= total))];

  async function confirmCheckout() {
    if (savingRef.current || saving || completedSale) return;

    if (cartItems.length === 0) {
      setError("Cart is empty.");
      return;
    }
    if (discount === null) {
      setError("Discount should be a number, like 10 or 12.50.");
      return;
    }
    if (discount > subtotal) {
      setError("Discount cannot be greater than subtotal.");
      return;
    }
    if (referenceRequired && !referenceNumber.trim()) {
      setError(`${paymentLabel(paymentMethod)} needs a reference number before completing checkout.`);
      return;
    }
    if (cashTenderInvalid) {
      setError(parsedCashTender === null ? "Cash received should be a valid amount." : "Cash received is less than the total.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice("Sine-save ang local sale...");
    try {
      const receiptItems = cartItems.map((item) => ({ ...item }));
      const sale = await completeKioskSale({
        cartItems,
        checkoutToken,
        paymentMethod,
        externalReferenceNumber: referenceRequired ? referenceNumber.trim() || null : null,
        discountAmount: discount,
      });
      setCompletedItems(receiptItems);
      setCompletedSale(sale);
      setLastReceipt(sale.saleId, sale.receiptText);
      clearCart();
      setNotice("Tapos ang benta. Naka-save sa phone na ito.");
    } catch (error) {
      logDevError("KioskCheckout.confirmCheckout", error);
      setError(getUserSafeErrorMessage(error, "Could not complete checkout."));
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  async function copyReceipt() {
    if (!completedSale) return;
    await copyReceiptText(completedSale.receiptText);
    setNotice("Nakopya ang resibo.");
  }

  async function shareReceipt() {
    if (!completedSale) return;
    const shared = await shareReceiptText(completedSale.receiptText);
    if (shared) setNotice("Bukas na ang share options.");
    else setError("Hindi available ang sharing sa device na ito.");
  }

  if (completedSale) {
    return (
      <ScreenScroll key="receipt" kioskNav>
        <AppTopBar eyebrow="RESIBO" subtitle="Naka-save na ang local sale" title="Tapos ang benta" />

        {messageIsError && message ? <GabiNotice message={message} title="Hindi ma-share" tone="danger" /> : null}

        <GabiCard raised style={styles.receiptCard}>
          <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
            <Ionicons color={palette.success} name="checkmark" size={32} />
          </View>
          <View style={styles.receiptHeading}>
            <GabiText tone="success" variant="eyebrow">BAYAD AT NAKA-SAVE</GabiText>
            <GabiText adjustsFontSizeToFit minimumFontScale={0.7} money numberOfLines={1} tone="primary" variant="heroPeso">
              {formatPeso(completedSale.total)}
            </GabiText>
            <GabiText tone="muted" variant="caption">{completedSale.transactionNo}</GabiText>
          </View>

          <View style={styles.receiptLines}>
            {completedItems.map((item) => {
              const pricing = calculateLineTotal(item);
              return (
                <View key={item.productId} style={[styles.receiptLine, { borderColor: palette.border }]}>
                  <View style={styles.receiptLineCopy}>
                    <GabiText variant="buttonSm">{item.name}</GabiText>
                    <GabiText tone="muted" variant="caption">{item.quantity} x {formatPeso(item.unitPrice)}</GabiText>
                    {pricing.bundleApplied && pricing.displayLabel ? <GabiChip label={pricing.displayLabel} tone="primary" /> : null}
                  </View>
                  <GabiText money variant="metricValue">{formatPeso(pricing.lineTotal)}</GabiText>
                </View>
              );
            })}
          </View>

          {completedSale.discount > 0 ? <ReceiptAmount label="Tawad" value={-completedSale.discount} /> : null}
          <ReceiptAmount label="Bayad" value={completedSale.total} />
          <GabiChip icon={paymentIcon(paymentMethod)} label={paymentLabel(paymentMethod)} tone="success" />

          <View style={styles.receiptActions}>
            <View style={styles.receiptActionCell}>
              <GabiSoftButton icon="copy-outline" label="Copy" onPress={copyReceipt} />
            </View>
            <View style={styles.receiptActionCell}>
              <GabiSoftButton icon="share-social-outline" label="Share" onPress={shareReceipt} />
            </View>
          </View>
        </GabiCard>

        <GabiNotice
          message="Nasa local SQLite na ang benta at resibo. Hindi kailangan ng internet; wala pang cloud sync sa pilot."
          title="Ligtas kahit offline"
          tone="success"
        />
        <GabiPrimaryButton icon="add" label="Bagong benta" onPress={() => router.replace("/kiosk/sell")} />
        <GabiSoftButton icon="receipt-outline" label="Tingnan ang Orders" onPress={() => router.replace("/kiosk/orders")} />
        {!messageIsError && message ? <GabiSnackbar message={message} onDismiss={() => setMessage(null)} /> : null}
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll key="checkout" kioskNav>
      <AppTopBar backHref="/kiosk/sell" eyebrow="BAYAD" subtitle="Review bago i-save ang local sale" title="Bayad" />

      {messageIsError && message ? <GabiNotice message={message} title="Hindi ma-save" tone="danger" /> : null}

      <GabiCard>
        <GabiSectionHeader action={<GabiText money tone="primary" variant="heroPeso">{formatPeso(total)}</GabiText>} title="Cart" />
        <View style={styles.cartSummary}>
          {cartItems.map((item) => {
            const pricing = calculateLineTotal(item);
            return (
              <View key={item.productId} style={[styles.cartRow, { borderColor: palette.border }]}>
                <View style={styles.cartCopy}>
                  <GabiText numberOfLines={1} variant="buttonSm">{item.name}</GabiText>
                  <GabiText tone="muted" variant="caption">{item.quantity} x {formatPeso(item.unitPrice)}</GabiText>
                  {pricing.bundleApplied && pricing.displayLabel ? <GabiChip label={pricing.displayLabel} tone="primary" /> : null}
                </View>
                <GabiText money variant="metricValue">{formatPeso(pricing.lineTotal)}</GabiText>
              </View>
            );
          })}
        </View>
        <View style={[styles.amountPanel, { backgroundColor: palette.softPrimary }]}>
          <ReceiptAmount label="Subtotal" value={subtotal} />
          <ReceiptAmount label="Tawad" value={-(discount ?? 0)} />
          <View style={[styles.amountDivider, { backgroundColor: palette.border }]} />
          <ReceiptAmount label="Total" strong value={total} />
        </View>
      </GabiCard>

      <GabiCard>
        <GabiSectionHeader title="Tawad" />
        <View style={styles.shortcutRow}>
          {discountShortcuts.map((amount) => (
            <ChoiceChip
              key={amount}
              label={amount === 0 ? "Wala" : formatPeso(amount)}
              onPress={() => setDiscountAmount(amount === 0 ? "" : String(amount))}
              selected={(discount ?? 0) === amount}
            />
          ))}
        </View>
        <GabiField
          errorMessage={discountInvalid ? "Gumamit ng numerong tulad ng 10 o 12.50." : discountTooLarge ? "Hindi puwedeng mas malaki sa subtotal." : undefined}
          keyboardType="decimal-pad"
          label="Ibang halaga"
          onChangeText={setDiscountAmount}
          placeholder="Optional"
          value={discountAmount}
        />
      </GabiCard>

      <GabiCard>
        <GabiSectionHeader title="Paraan ng bayad" />
        <View accessibilityRole="radiogroup" style={styles.paymentGrid}>
          {paymentMethods.map((method) => (
            <PaymentOption key={method} method={method} onPress={() => setPaymentMethod(method)} selected={method === paymentMethod} />
          ))}
        </View>

        <GabiField
          disabled={!referenceRequired}
          errorMessage={referenceRequired && !referenceNumber.trim() ? `Kailangan para sa ${paymentLabel(paymentMethod)}.` : undefined}
          helperText={referenceRequired ? "Ilagay bago i-save." : "Hindi kailangan para sa cash."}
          label="Reference #"
          onChangeText={setReferenceNumber}
          placeholder={referenceRequired ? "Required" : "Cash payment"}
          value={referenceNumber}
        />

        {paymentMethod === "cash" ? (
          <>
            <View style={styles.shortcutSection}>
              <GabiText variant="buttonSm">Halagang inabot</GabiText>
              <View style={styles.shortcutRow}>
                {tenderOptions.map((amount) => (
                  <ChoiceChip
                    key={amount}
                    label={amount === total ? "Eksakto" : formatPeso(amount)}
                    onPress={() => setCashReceived(String(amount))}
                    selected={parsedCashTender === amount && hasCashTender}
                  />
                ))}
              </View>
            </View>
            <GabiField
              errorMessage={
                hasCashTender && parsedCashTender === null
                  ? "Gumamit ng valid na halaga."
                  : hasCashTender && parsedCashTender !== null && parsedCashTender < total
                    ? `Kulang ng ${formatPeso(total - parsedCashTender)}.`
                    : undefined
              }
              helperText="Optional; pang-compute lang ng sukli at hindi sine-save."
              keyboardType="decimal-pad"
              label="Abot"
              onChangeText={setCashReceived}
              placeholder="Hal. 500"
              value={cashReceived}
            />
            {change !== null ? (
              <View style={[styles.changeCard, { backgroundColor: palette.softSuccess }]}>
                <View style={styles.changeCopy}>
                  <GabiText tone="success" variant="eyebrow">SUKLI</GabiText>
                  <GabiText tone="muted" variant="caption">{formatPeso(parsedCashTender ?? 0)} - {formatPeso(total)}</GabiText>
                </View>
                <GabiText money tone="success" variant="heroPeso">{formatPeso(change)}</GabiText>
              </View>
            ) : null}
          </>
        ) : null}
      </GabiCard>

      <GabiPrimaryButton
        disabled={saving || Boolean(disabledReason)}
        icon="checkmark-circle-outline"
        label={saving ? "Sine-save..." : "Kumpirmahin ang Benta"}
        loading={saving}
        onPress={confirmCheckout}
      />
      {disabledReason ? <GabiText tone="warning" variant="caption">{disabledReason}</GabiText> : null}
      <GabiText tone="faint" variant="caption">
        Isang local transaction lang ang mase-save kahit maulit ang tap.
      </GabiText>
      {!messageIsError && message ? <GabiSnackbar message={message} onDismiss={() => setMessage(null)} /> : null}
    </ScreenScroll>
  );
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (trimmed.includes(",")) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function ReceiptAmount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  const displayValue = normalizedValue < 0 ? `-${formatPeso(Math.abs(normalizedValue))}` : formatPeso(normalizedValue);

  return (
    <View style={styles.amountRow}>
      <GabiText tone={strong ? "default" : "muted"} variant={strong ? "buttonLg" : "body"}>{label}</GabiText>
      <GabiText money variant={strong ? "metricValue" : "body"}>{displayValue}</GabiText>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.choiceChip,
        {
          backgroundColor: selected ? palette.kioskHeader : palette.surface,
          borderColor: selected ? palette.kioskHeader : palette.border,
        },
      ]}
    >
      <GabiText style={selected ? { color: palette.kioskHeaderText } : undefined} variant="caption">{label}</GabiText>
    </Pressable>
  );
}

function PaymentOption({ method, selected, onPress }: { method: PaymentMethod; selected: boolean; onPress: () => void }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={paymentLabel(method)}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.paymentOption,
        {
          backgroundColor: selected ? palette.softPrimary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}
    >
      <Ionicons color={selected ? palette.primary : palette.mutedText} name={paymentIcon(method)} size={21} />
      <GabiText numberOfLines={1} tone={selected ? "primary" : "muted"} variant="caption">{paymentLabel(method)}</GabiText>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cartSummary: {
    gap: spacing.sm,
  },
  cartRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  cartCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  amountPanel: {
    borderRadius: 16,
    gap: spacing.xs,
    padding: spacing.md,
  },
  amountRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  amountDivider: {
    height: 1,
    marginVertical: spacing.xs,
  },
  shortcutSection: {
    gap: spacing.sm,
  },
  shortcutRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  choiceChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 66,
    paddingHorizontal: spacing.md,
  },
  paymentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  paymentOption: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    flexBasis: "30%",
    flexGrow: 1,
    gap: 5,
    minHeight: 86,
    minWidth: 88,
    padding: spacing.sm,
  },
  radio: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 16,
  },
  radioDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  changeCard: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  changeCopy: {
    flex: 1,
    gap: 2,
  },
  receiptCard: {
    alignItems: "stretch",
  },
  successIcon: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 34,
    height: 68,
    justifyContent: "center",
    width: 68,
  },
  receiptHeading: {
    alignItems: "center",
    gap: 3,
  },
  receiptLines: {
    gap: spacing.sm,
  },
  receiptLine: {
    alignItems: "flex-start",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  receiptLineCopy: {
    flex: 1,
    gap: 3,
  },
  receiptActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  receiptActionCell: {
    flex: 1,
  },
});
