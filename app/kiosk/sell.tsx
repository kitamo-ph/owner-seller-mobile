import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { NetworkStatusBadge } from "@/components/common/NetworkStatusBadge";
import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll, formatPeso } from "@/components/ui/KitaMoUI";
import { isLowStock } from "@/domain/inventory";
import { bundleLabelFor, calculateCartSubtotal, calculateLineTotal, hasBundlePricing } from "@/domain/pricing";
import type { Product } from "@/domain/types";
import { loadKioskPreferences, recordRecentProduct, saveFavoriteProductIds } from "@/services/kioskPreferences";
import { loadKioskContext, type KioskContext } from "@/services/kioskSales";
import { useKioskStore } from "@/state/kioskStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function KioskSellScreen() {
  const [context, setContext] = useState<KioskContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const cartItems = useKioskStore((state) => state.cartItems);
  const addProductToCart = useKioskStore((state) => state.addProductToCart);
  const incrementCartItem = useKioskStore((state) => state.incrementCartItem);
  const decrementCartItem = useKioskStore((state) => state.decrementCartItem);
  const removeCartItem = useKioskStore((state) => state.removeCartItem);
  const clearCart = useKioskStore((state) => state.clearCart);
  const { palette, extended, isDark } = useGabiTheme();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const nextContext = await loadKioskContext();
    const preferences = await loadKioskPreferences();
    setContext(nextContext);
    setFavoriteProductIds(preferences.favoriteProductIds);
    setRecentProductIds(preferences.recentProductIds);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refresh().catch((error) => {
        logDevError("KioskSell.refresh", error);
        if (active) {
          setMessage(getFriendlyErrorMessage("Could not load products."));
          setMessageIsError(true);
        }
      });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  function addToCart(product: Product) {
    const cookedToOrder = Boolean(context?.cookUponOrderRecipeByProductId[product.id]);
    const result = addProductToCart(product, cookedToOrder);
    if (!result.ok) {
      setMessage(result.reason ?? "Could not add product.");
      setMessageIsError(true);
      return;
    }

    setMessage(null);
    void Haptics.selectionAsync();
    const nextRecentIds = [product.id, ...recentProductIds.filter((id) => id !== product.id)].slice(0, 8);
    setRecentProductIds(nextRecentIds);
    recordRecentProduct(product.id, recentProductIds).catch((error) => {
      logDevError("KioskSell.recordRecentProduct", error);
    });
  }

  function increase(productId: string) {
    const result = incrementCartItem(productId);
    if (!result.ok) {
      setMessage(result.reason ?? "Could not increase quantity.");
      setMessageIsError(true);
    } else {
      setMessage(null);
      void Haptics.selectionAsync();
    }
  }

  function decrease(productId: string) {
    decrementCartItem(productId);
    setMessage(null);
    void Haptics.selectionAsync();
  }

  function toggleFavorite(productId: string) {
    const wasFavorite = favoriteProductIds.includes(productId);
    const nextIds = wasFavorite
      ? favoriteProductIds.filter((id) => id !== productId)
      : [productId, ...favoriteProductIds];
    setFavoriteProductIds(nextIds);
    void Haptics.selectionAsync();
    saveFavoriteProductIds(nextIds).catch((error) => {
      logDevError("KioskSell.toggleFavorite", error);
      setFavoriteProductIds(favoriteProductIds);
      setMessage("Could not save favorites. Please try again.");
      setMessageIsError(true);
    });
  }

  function confirmClearCart() {
    Alert.alert("Alisin ang cart?", "Mawawala ang lahat ng item sa kasalukuyang benta.", [
      { text: "Hindi", style: "cancel" },
      { text: "Alisin", style: "destructive", onPress: clearCart },
    ]);
  }

  const total = calculateCartSubtotal(cartItems);
  const cartQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const categories = useMemo(
    () => [...new Set((context?.products ?? []).map((product) => product.category.trim()).filter(Boolean))].sort(),
    [context?.products],
  );
  const visibleProducts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    let products = [...(context?.products ?? [])];

    if (selectedFilter === "favorites") {
      products = products.filter((product) => favoriteProductIds.includes(product.id));
    } else if (selectedFilter === "recent") {
      products = products
        .filter((product) => recentProductIds.includes(product.id))
        .sort((left, right) => recentProductIds.indexOf(left.id) - recentProductIds.indexOf(right.id));
    } else if (selectedFilter !== "all") {
      products = products.filter((product) => product.category === selectedFilter);
    }

    if (normalizedQuery) {
      products = products.filter((product) =>
        `${product.name} ${product.category}`.toLocaleLowerCase().includes(normalizedQuery),
      );
    }

    return products;
  }, [context?.products, favoriteProductIds, recentProductIds, searchQuery, selectedFilter]);

  const cartBar = cartItems.length > 0 ? (
    <View style={[styles.cartBar, { backgroundColor: palette.kioskHeader, borderColor: isDark ? palette.border : palette.kioskHeader }]}>
      <View style={styles.cartBarCopy}>
        <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">
          {cartQuantity} item{cartQuantity === 1 ? "" : "s"} sa cart
        </GabiText>
        <GabiText money numberOfLines={1} tone="inverse" variant="heroPeso">{formatPeso(total)}</GabiText>
      </View>
      <Pressable
        accessibilityLabel="Bayad"
        accessibilityRole="button"
        onPress={() => router.push("/kiosk/checkout")}
        style={({ pressed }) => [
          styles.payButton,
          { backgroundColor: pressed ? palette.warning : palette.accent },
        ]}
      >
        <GabiText style={{ color: extended.accentTextOn }} variant="buttonLg">Bayad</GabiText>
        <Ionicons color={extended.accentTextOn} name="arrow-forward" size={18} />
      </Pressable>
    </View>
  ) : null;

  return (
    <ScreenScroll floatingFooter={cartBar} kioskNav>
      <AppTopBar
        eyebrow="BENTA"
        right={<GabiIconButton accessibilityLabel="Kiosk help at problem reports" icon="help-circle-outline" onPress={() => router.push("/kiosk/help" as Href)} />}
        subtitle="Tap paninda para idagdag sa cart"
        title={context?.activeBranch?.branchName ?? "Benta"}
      />

      {message ? (
        <GabiNotice
          message={message}
          title={messageIsError ? "Hindi naidagdag" : "Naka-save"}
          tone={messageIsError ? "danger" : "success"}
        />
      ) : null}

      {!context ? (
        <GabiCard>
          <GabiSkeleton height={46} showImmediately />
          <View style={styles.productGrid}>
            <GabiSkeleton height={184} showImmediately width="48%" />
            <GabiSkeleton height={184} showImmediately width="48%" />
          </View>
        </GabiCard>
      ) : null}

      {context?.setupMessage ? (
        <GabiNotice message={context.setupMessage} title="Kailangan ng setup" tone="warning" />
      ) : null}

      <View style={styles.statusRow}>
        <NetworkStatusBadge compact pendingQueueCount={context?.pendingQueueCount ?? 0} />
        {context ? <GabiChip label={`${context.products.length} paninda`} tone="neutral" /> : null}
      </View>

      {context ? (
        <GabiCard style={styles.productsCard}>
          <GabiSectionHeader
            action={<GabiText tone="faint" variant="caption">{visibleProducts.length} shown</GabiText>}
            title="Paninda"
          />

          <View style={[styles.searchBox, { backgroundColor: extended.field, borderColor: palette.border }]}>
            <Ionicons color={extended.textFaint} name="search-outline" size={20} />
            <TextInput
              accessibilityLabel="Search paninda"
              onChangeText={setSearchQuery}
              placeholder="Search paninda"
              placeholderTextColor={extended.textFaint}
              style={[styles.searchInput, { color: palette.text }]}
              value={searchQuery}
            />
            {searchQuery ? (
              <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSearchQuery("")}>
                <Ionicons color={extended.textFaint} name="close-circle" size={20} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView horizontal contentContainerStyle={styles.filterRow} showsHorizontalScrollIndicator={false}>
            <FilterChip active={selectedFilter === "all"} label="Lahat" onPress={() => setSelectedFilter("all")} />
            <FilterChip active={selectedFilter === "favorites"} icon="star" label="Paborito" onPress={() => setSelectedFilter("favorites")} />
            <FilterChip active={selectedFilter === "recent"} icon="time" label="Kamakailan" onPress={() => setSelectedFilter("recent")} />
            {categories.map((category) => (
              <FilterChip active={selectedFilter === category} key={category} label={category} onPress={() => setSelectedFilter(category)} />
            ))}
          </ScrollView>

          {context.products.length === 0 ? (
            <GabiEmptyState
              actionLabel="Buksan ang Inventory"
              icon="cube-outline"
              message="Magdagdag muna ng paninda sa Owner Inventory."
              onAction={() => router.push("/owner/inventory")}
              title="Wala pang paninda"
            />
          ) : null}

          {context.products.length > 0 && visibleProducts.length === 0 ? (
            <GabiEmptyState
              icon={selectedFilter === "favorites" ? "star-outline" : selectedFilter === "recent" ? "time-outline" : "search-outline"}
              message={
                selectedFilter === "favorites"
                  ? "Tap ang star sa tile para manatili rito."
                  : selectedFilter === "recent"
                    ? "Lalabas dito ang huling mga piniling paninda."
                    : "Subukan ang ibang category o search term."
              }
              title={selectedFilter === "favorites" ? "Wala pang paborito" : selectedFilter === "recent" ? "Wala pang recent" : "Walang tugma"}
            />
          ) : null}

          <View style={styles.productGrid}>
            {visibleProducts.map((product) => (
              <ProductTile
                cartQuantity={cartItems.find((item) => item.productId === product.id)?.quantity ?? 0}
                cookedToOrder={Boolean(context.cookUponOrderRecipeByProductId[product.id])}
                favorite={favoriteProductIds.includes(product.id)}
                key={product.id}
                onAdd={() => addToCart(product)}
                onDecrement={() => decrease(product.id)}
                onIncrement={() => increase(product.id)}
                onToggleFavorite={() => toggleFavorite(product.id)}
                product={product}
              />
            ))}
          </View>
        </GabiCard>
      ) : null}

      {cartItems.length > 0 ? (
        <GabiCard>
          <GabiSectionHeader
            action={<GabiSoftButton compact icon="trash-outline" label="Alisin lahat" onPress={confirmClearCart} />}
            title="Cart"
          />
          <View style={styles.cartList}>
            {cartItems.map((item) => {
              const pricing = calculateLineTotal(item);
              return (
                <View key={item.productId} style={[styles.cartRow, { borderColor: palette.border }]}>
                  <View style={styles.cartRowCopy}>
                    <GabiText numberOfLines={1} variant="buttonSm">{item.name}</GabiText>
                    <View style={styles.cartMetaRow}>
                      <GabiText tone="muted" variant="caption">
                        {formatPeso(item.unitPrice)} x {item.quantity}
                      </GabiText>
                      {pricing.bundleApplied && pricing.displayLabel ? <GabiChip label={pricing.displayLabel} tone="primary" /> : null}
                    </View>
                  </View>
                  <GabiText money numberOfLines={1} variant="metricValue">{formatPeso(pricing.lineTotal)}</GabiText>
                  <View style={[styles.cartStepper, { backgroundColor: palette.softPrimary }]}>
                    <Pressable accessibilityLabel={`Bawasan ang ${item.name}`} onPress={() => decrease(item.productId)} style={styles.stepperButton}>
                      <Ionicons color={palette.primary} name="remove" size={18} />
                    </Pressable>
                    <GabiText tone="primary" variant="buttonSm">{item.quantity}</GabiText>
                    <Pressable accessibilityLabel={`Dagdagan ang ${item.name}`} onPress={() => increase(item.productId)} style={styles.stepperButton}>
                      <Ionicons color={palette.primary} name="add" size={18} />
                    </Pressable>
                  </View>
                  <Pressable accessibilityLabel={`Alisin ang ${item.name}`} hitSlop={6} onPress={() => removeCartItem(item.productId)} style={styles.removeButton}>
                    <Ionicons color={palette.danger} name="close" size={19} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </GabiCard>
      ) : null}
    </ScreenScroll>
  );
}

type ProductTileProps = {
  product: Product;
  cookedToOrder: boolean;
  cartQuantity: number;
  favorite: boolean;
  onAdd: () => void;
  onDecrement: () => void;
  onIncrement: () => void;
  onToggleFavorite: () => void;
};

function ProductTile({
  product,
  cookedToOrder,
  cartQuantity,
  favorite,
  onAdd,
  onDecrement,
  onIncrement,
  onToggleFavorite,
}: ProductTileProps) {
  const { palette, extended, isDark } = useGabiTheme();
  const lowStock = isLowStock(product.stockQty, product.lowStockThreshold);
  const outOfStock = product.stockQty <= 0 && !cookedToOrder;
  const bundleLabel = hasBundlePricing(product)
    ? bundleLabelFor(product.bundleQuantity, product.bundlePrice, product.bundleLabel)
    : null;
  const backgroundColor = outOfStock
    ? extended.disabledBg
    : cartQuantity > 0
      ? palette.softPrimary
      : isDark
        ? extended.raised
        : palette.surface;

  return (
    <View
      style={[
        styles.productTile,
        {
          backgroundColor,
          borderColor: cartQuantity > 0 ? palette.primary : palette.border,
        },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={styles.tileTitleWrap}>
          <GabiText
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            numberOfLines={2}
            style={outOfStock ? { color: extended.disabledText } : undefined}
            variant="cardTitle"
          >
            {product.name}
          </GabiText>
          <GabiText numberOfLines={1} style={outOfStock ? { color: extended.disabledText } : undefined} tone="faint" variant="caption">
            {product.category}
          </GabiText>
        </View>
        <Pressable accessibilityLabel={favorite ? `Alisin sa paborito ang ${product.name}` : `Paborito ang ${product.name}`} onPress={onToggleFavorite} style={styles.favoriteButton}>
          <Ionicons color={favorite ? palette.accent : outOfStock ? extended.disabledText : palette.mutedText} name={favorite ? "star" : "star-outline"} size={20} />
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" disabled={outOfStock} onPress={onAdd} style={styles.tileBody}>
        <View style={styles.tileChips}>
          {cookedToOrder ? <GabiChip icon="flame-outline" label="Made to order" tone="accent" /> : null}
          {outOfStock ? <GabiChip label="Ubos na" tone="danger" /> : null}
          {!outOfStock && !cookedToOrder && lowStock ? <GabiChip label={`${product.stockQty} na lang`} tone="warning" /> : null}
          {bundleLabel ? <GabiChip icon="pricetag-outline" label={bundleLabel} tone="primary" /> : null}
        </View>
        <GabiText
          money
          numberOfLines={1}
          style={outOfStock ? { color: extended.disabledText } : isDark ? { color: extended.primaryStrongText } : undefined}
          tone="primary"
          variant="displayPeso"
        >
          {formatPeso(product.price)}
        </GabiText>
        <GabiText numberOfLines={1} style={outOfStock ? { color: extended.disabledText } : undefined} tone="muted" variant="caption">
          {cookedToOrder ? "Luto kapag may order" : `${product.stockQty} ${product.unitType}`}
        </GabiText>
      </Pressable>

      <View style={styles.tileFooter}>
        {cartQuantity > 0 ? (
          <View style={[styles.tileStepper, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Pressable accessibilityLabel={`Bawasan ang ${product.name}`} onPress={onDecrement} style={styles.stepperButton}>
              <Ionicons color={palette.primary} name="remove" size={18} />
            </Pressable>
            <GabiText tone="primary" variant="buttonSm">{cartQuantity}</GabiText>
            <Pressable accessibilityLabel={`Dagdagan ang ${product.name}`} disabled={outOfStock} onPress={onIncrement} style={styles.stepperButton}>
              <Ionicons color={palette.primary} name="add" size={18} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityLabel={`Idagdag ang ${product.name}`}
            accessibilityRole="button"
            disabled={outOfStock}
            onPress={onAdd}
            style={[
              styles.addButton,
              { backgroundColor: outOfStock ? extended.disabledBg : palette.primary },
            ]}
          >
            <Ionicons color={outOfStock ? extended.disabledText : palette.kioskHeaderText} name="add" size={22} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function FilterChip({ active, label, onPress, icon }: { active: boolean; label: string; onPress: () => void; icon?: "star" | "time" }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? palette.kioskHeader : palette.surface,
          borderColor: active ? palette.kioskHeader : palette.border,
        },
      ]}
    >
      {icon ? <Ionicons color={active ? palette.accent : palette.primary} name={icon} size={14} /> : null}
      <GabiText style={active ? { color: palette.kioskHeaderText } : undefined} variant="caption">{label}</GabiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  productsCard: {
    paddingHorizontal: 14,
  },
  searchBox: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    minHeight: 46,
    paddingVertical: spacing.sm,
  },
  filterRow: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  filterChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 38,
    paddingHorizontal: 13,
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  productTile: {
    borderRadius: 20,
    borderWidth: 1.5,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 190,
    minWidth: 0,
    padding: 12,
  },
  tileTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
  },
  tileTitleWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  tileBody: {
    flex: 1,
    gap: 5,
  },
  tileChips: {
    alignItems: "flex-start",
    gap: 4,
  },
  tileFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    minHeight: 44,
  },
  favoriteButton: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  addButton: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 48,
  },
  tileStepper: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 44,
  },
  stepperButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 38,
  },
  cartBar: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 66,
    padding: 8,
    paddingLeft: spacing.md,
  },
  cartBarCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  payButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  cartList: {
    gap: spacing.sm,
  },
  cartRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  cartRowCopy: {
    flex: 1,
    gap: 3,
    minWidth: 112,
  },
  cartMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  cartStepper: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    minHeight: 44,
  },
  removeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 32,
  },
});
