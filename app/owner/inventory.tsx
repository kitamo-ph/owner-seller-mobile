import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { type ComponentProps, useCallback, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { NetworkStatusBadge } from "@/components/common/NetworkStatusBadge";
import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import { createProduct, updateProduct } from "@/db/repositories";
import { bundleLabelFor, hasBundlePricing } from "@/domain/pricing";
import type { Product, ProductType, UnitType } from "@/domain/types";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { recordCookedBatch, recordSpoilage } from "@/services/stockOps";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";

const productTypes: ProductType[] = ["retail item", "cooked food", "ingredient-based item", "service/other"];
const unitTypes: UnitType[] = ["piece", "bottle", "pack", "sachet", "kilo", "serving", "case", "tray", "other"];

type ProductForm = {
  id: string | null;
  name: string;
  category: string;
  productType: ProductType;
  unitType: UnitType;
  stockQty: string;
  initialStockQty: string | null;
  lowStockThreshold: string;
  price: string;
  cost: string;
  bundleQuantity: string;
  bundlePrice: string;
  bundleLabel: string;
};

const emptyProductForm: ProductForm = {
  id: null,
  name: "",
  category: "",
  productType: "retail item",
  unitType: "piece",
  stockQty: "",
  initialStockQty: null,
  lowStockThreshold: "",
  price: "",
  cost: "",
  bundleQuantity: "",
  bundlePrice: "",
  bundleLabel: "",
};

const numbersOnlyMessage = "Numbers only, like 1500 or 12.5. Walang comma.";
const productRenderBatch = 30;

type CookForm = {
  productId: string | null;
  quantity: string;
  note: string;
};

type SpoilageForm = {
  productId: string | null;
  quantity: string;
  reason: string;
};

const emptyCookForm: CookForm = { productId: null, quantity: "", note: "" };
const emptySpoilageForm: SpoilageForm = { productId: null, quantity: "", reason: "" };

export default function OwnerInventoryScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [showProductForm, setShowProductForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [cookForm, setCookForm] = useState<CookForm>(emptyCookForm);
  const [spoilageForm, setSpoilageForm] = useState<SpoilageForm>(emptySpoilageForm);
  const [cookMessage, setCookMessage] = useState<string | null>(null);
  const [cookIsError, setCookIsError] = useState(false);
  const [spoilageMessage, setSpoilageMessage] = useState<string | null>(null);
  const [spoilageIsError, setSpoilageIsError] = useState(false);
  const [cookSaving, setCookSaving] = useState(false);
  const [spoilageSaving, setSpoilageSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [productRenderLimit, setProductRenderLimit] = useState(productRenderBatch);
  const [openProductActionsId, setOpenProductActionsId] = useState<string | null>(null);
  const [stockAction, setStockAction] = useState<"cook" | "spoilage" | null>(null);
  const cookLock = useRef(false);
  const spoilageLock = useRef(false);
  const router = useRouter();

  function setNotice(text: string) {
    setMessage(text);
    setMessageIsError(false);
  }

  function setError(text: string) {
    setMessage(text);
    setMessageIsError(true);
  }

  const refresh = useCallback(async () => {
    const nextStatus = await loadOwnerSetupStatus();
    setStatus(nextStatus);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      refresh().catch((error) => {
        logDevError("OwnerInventory.refresh", error);
        if (active) {
          setMessage(getFriendlyErrorMessage("Could not load inventory."));
          setMessageIsError(true);
        }
      });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  async function saveProduct() {
    if (!status?.activeBusiness) {
      setError("Create your business profile before adding products.");
      return;
    }

    const name = productForm.name.trim();
    if (!name) {
      setError("Product name is required.");
      return;
    }

    const stockQty = parseRequiredNumber(productForm.stockQty, 0);
    const lowStockThreshold = parseRequiredNumber(productForm.lowStockThreshold, 0);
    const price = parseRequiredNumber(productForm.price, 0);
    const cost = parseRequiredNumber(productForm.cost, 0);
    const bundleQuantity = parseOptionalStrictNumber(productForm.bundleQuantity);
    const bundlePrice = parseOptionalStrictNumber(productForm.bundlePrice);

    if (
      stockQty === "invalid" ||
      lowStockThreshold === "invalid" ||
      price === "invalid" ||
      cost === "invalid" ||
      bundleQuantity === "invalid" ||
      bundlePrice === "invalid"
    ) {
      setError(numbersOnlyMessage);
      return;
    }

    if ([stockQty, lowStockThreshold, price, cost].some((value) => value < 0)) {
      setError("Stock, threshold, selling price, and unit cost cannot be negative.");
      return;
    }

    if (bundleQuantity !== null && bundleQuantity <= 0) {
      setError("Bundle quantity must be greater than zero.");
      return;
    }

    if (bundlePrice !== null && bundlePrice < 0) {
      setError("Bundle price cannot be negative.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const sharedFields = {
        name,
        category: productForm.category.trim() || "General",
        productType: productForm.productType,
        unitType: productForm.unitType,
        lowStockThreshold,
        price,
        cost,
        bundleQuantity,
        bundlePrice,
        bundleLabel: productForm.bundleLabel.trim() || null,
      };

      if (productForm.id) {
        const stockChanged = productForm.stockQty.trim() !== (productForm.initialStockQty ?? "").trim();
        await updateProduct(productForm.id, {
          ...sharedFields,
          ...(stockChanged ? { stockQty } : {}),
        });
      } else {
        await createProduct({
          ...sharedFields,
          stockQty,
          branchId: status.activeBranch?.id ?? null,
          active: true,
          businessId: status.activeBusiness.id,
        });
      }

      setProductForm(emptyProductForm);
      setShowProductForm(false);
      await refresh();
      setNotice(productForm.id ? "Product updated." : "Product added.");
    } catch (error) {
      logDevError("OwnerInventory.saveProduct", error);
      setError(getFriendlyErrorMessage("Could not save product."));
    } finally {
      setSaving(false);
    }
  }

  async function saveCookedBatch() {
    if (cookLock.current) {
      return;
    }

    if (!cookForm.productId) {
      setCookMessage("Piliin muna kung anong paninda ang niluto.");
      setCookIsError(true);
      return;
    }

    const quantity = parseRequiredNumber(cookForm.quantity, 0);
    if (quantity === "invalid") {
      setCookMessage(numbersOnlyMessage);
      setCookIsError(true);
      return;
    }

    if (quantity <= 0) {
      setCookMessage("Ilagay kung ilang piraso ang naluto.");
      setCookIsError(true);
      return;
    }

    cookLock.current = true;
    setCookSaving(true);
    setCookMessage(null);
    try {
      const result = await recordCookedBatch({
        productId: cookForm.productId,
        quantity,
        note: cookForm.note,
      });
      setCookForm(emptyCookForm);
      await refresh();
      setCookMessage(`Stock updated. Nadagdag ang ${quantity} sa ${result.productName} (${result.newStockQty} na ngayon).`);
      setCookIsError(false);
    } catch (error) {
      logDevError("OwnerInventory.saveCookedBatch", error);
      setCookMessage(getUserSafeErrorMessage(error, "Could not save the cooked batch."));
      setCookIsError(true);
    } finally {
      cookLock.current = false;
      setCookSaving(false);
    }
  }

  async function saveSpoilage() {
    if (spoilageLock.current) {
      return;
    }

    if (!spoilageForm.productId) {
      setSpoilageMessage("Piliin muna kung anong paninda ang nasayang.");
      setSpoilageIsError(true);
      return;
    }

    const quantity = parseRequiredNumber(spoilageForm.quantity, 0);
    if (quantity === "invalid") {
      setSpoilageMessage(numbersOnlyMessage);
      setSpoilageIsError(true);
      return;
    }

    if (quantity <= 0) {
      setSpoilageMessage("Ilagay kung ilang piraso ang nabawas.");
      setSpoilageIsError(true);
      return;
    }

    spoilageLock.current = true;
    setSpoilageSaving(true);
    setSpoilageMessage(null);
    try {
      const result = await recordSpoilage({
        productId: spoilageForm.productId,
        quantity,
        reason: spoilageForm.reason,
      });
      setSpoilageForm(emptySpoilageForm);
      await refresh();
      setSpoilageMessage(`Stock updated. Nabawas ang ${quantity} sa ${result.productName} (${result.newStockQty} na lang).`);
      setSpoilageIsError(false);
    } catch (error) {
      logDevError("OwnerInventory.saveSpoilage", error);
      setSpoilageMessage(getUserSafeErrorMessage(error, "Could not save the spoilage record."));
      setSpoilageIsError(true);
    } finally {
      spoilageLock.current = false;
      setSpoilageSaving(false);
    }
  }

  function editProduct(product: Product) {
    setOpenProductActionsId(null);
    setShowProductForm(true);
    setProductForm({
      id: product.id,
      name: product.name,
      category: product.category,
      productType: product.productType,
      unitType: product.unitType,
      stockQty: String(product.stockQty),
      initialStockQty: String(product.stockQty),
      lowStockThreshold: String(product.lowStockThreshold),
      price: String(product.price),
      cost: String(product.cost),
      bundleQuantity: product.bundleQuantity === null ? "" : String(product.bundleQuantity),
      bundlePrice: product.bundlePrice === null ? "" : String(product.bundlePrice),
      bundleLabel: product.bundleLabel ?? "",
    });
  }

  function openManualCook(product: Product) {
    setOpenProductActionsId(null);
    setCookForm({ ...emptyCookForm, productId: product.id });
    setCookMessage(null);
    setCookIsError(false);
    setStockAction("cook");
  }

  function openSpoilage(product: Product) {
    setOpenProductActionsId(null);
    setSpoilageForm({ ...emptySpoilageForm, productId: product.id });
    setSpoilageMessage(null);
    setSpoilageIsError(false);
    setStockAction("spoilage");
  }

  const canEditProducts = Boolean(status?.activeBusiness);
  const products = status?.products ?? [];
  const lowStockCount = products.filter((product) => product.stockQty <= product.lowStockThreshold).length;
  const stockValue = products.reduce((total, product) => total + product.stockQty * product.cost, 0);
  const productFormVisible = Boolean(status) && (products.length === 0 || showProductForm || Boolean(productForm.id));
  const visibleProducts = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.category}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase());
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "out" ? product.stockQty <= 0 : product.stockQty > 0 && product.stockQty <= product.lowStockThreshold);
    return matchesSearch && matchesStock;
  });
  const renderedProducts = visibleProducts.slice(0, productRenderLimit);
  const remainingProductCount = Math.max(0, visibleProducts.length - renderedProducts.length);
  const actionProduct = products.find((product) => product.id === openProductActionsId) ?? null;

  const openProductForm = () => {
    setProductForm(emptyProductForm);
    setShowProductForm(true);
  };
  const closeProductForm = () => {
    setProductForm(emptyProductForm);
    setShowProductForm(false);
  };

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        eyebrow="Tindahan"
        right={<GabiIconButton accessibilityLabel="Magdagdag ng paninda" icon="add" onPress={openProductForm} />}
        subtitle="Paninda, grocery, recipe, at stock actions"
        title="Paninda"
      />

      <TindahanTabs active="paninda" />

      {messageIsError && message ? <GabiNotice message={message} title="Hindi ma-save" tone="danger" /> : null}

      {!status ? (
        <GabiCard>
          <GabiText tone="muted" variant="caption">Binabasa ang local na paninda...</GabiText>
          <GabiSkeleton height={66} />
          <GabiSkeleton height={66} />
        </GabiCard>
      ) : !status.activeBusiness ? (
        <GabiCard>
          <GabiEmptyState
            actionLabel="Pumili ng negosyo"
            icon="business-outline"
            message="Kailangan ng deliberate business context bago magdagdag o magbago ng paninda."
            onAction={() => router.push("/owner/context")}
            title="Walang napiling negosyo"
          />
        </GabiCard>
      ) : (
        <>
          <View style={styles.networkRow}>
            <NetworkStatusBadge compact pendingQueueCount={status.pendingQueueCount} />
            <GabiChip label={status.activeBranch?.branchName ?? "All stalls"} tone="primary" />
          </View>

          <GabiCard>
            <View style={styles.summaryGrid}>
              <SummaryMetric icon="cube-outline" label="Paninda" value={String(products.length)} />
              <SummaryMetric
                icon="warning-outline"
                label="Paubos / ubos"
                tone={lowStockCount > 0 ? "warning" : "success"}
                value={String(lowStockCount)}
              />
              <SummaryMetric icon="wallet-outline" label="Stock value" tone="success" value={formatPeso(stockValue)} />
            </View>
          </GabiCard>

          <GabiCard>
            <GabiSectionHeader
              action={<GabiPrimaryButton compact disabled={saving || !canEditProducts} icon="add" label="Paninda" onPress={openProductForm} />}
              title="Listahan"
            />

            {products.length > 0 ? (
              <>
                <GabiField
                  label="Hanapin"
                  onChangeText={(value) => {
                    setProductSearch(value);
                    setProductRenderLimit(productRenderBatch);
                  }}
                  placeholder="Pangalan o category"
                  value={productSearch}
                />
                <ScrollView
                  contentContainerStyle={styles.filterRow}
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                >
                  {(["all", "low", "out"] as const).map((option) => (
                    <FilterChip
                      active={stockFilter === option}
                      key={option}
                      label={option === "all" ? "Lahat" : option === "low" ? "Paubos" : "Ubos na"}
                      onPress={() => {
                        setStockFilter(option);
                        setProductRenderLimit(productRenderBatch);
                      }}
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}

            {products.length === 0 ? (
              <GabiEmptyState
                actionLabel="Magdagdag ng paninda"
                icon="cube-outline"
                message="Ilagay ang unang produktong ibebenta sa napiling business o stall."
                onAction={openProductForm}
                title="Wala pang paninda"
              />
            ) : visibleProducts.length === 0 ? (
              <GabiEmptyState
                actionLabel="I-reset ang filter"
                icon="search-outline"
                message="Walang tumutugma sa search at stock filter."
                onAction={() => {
                  setProductSearch("");
                  setStockFilter("all");
                  setProductRenderLimit(productRenderBatch);
                }}
                title="Walang nahanap"
              />
            ) : (
              <View style={styles.productList}>
                {renderedProducts.map((product) => (
                  <InventoryProductRow
                    actionsOpen={openProductActionsId === product.id}
                    disabled={saving}
                    key={product.id}
                    onToggleActions={() => setOpenProductActionsId((current) => current === product.id ? null : product.id)}
                    product={product}
                  />
                ))}
                {remainingProductCount > 0 ? (
                  <GabiSoftButton
                    icon="chevron-down"
                    label={`Ipakita pa (${remainingProductCount})`}
                    onPress={() => setProductRenderLimit((current) => current + productRenderBatch)}
                  />
                ) : null}
              </View>
            )}
          </GabiCard>

          <View style={styles.flowGrid}>
            <FlowLink icon="flame-outline" label="Niluto / Production" onPress={() => router.push("/owner/production")} />
            <FlowLink icon="swap-horizontal-outline" label="Ilipat ang stock" onPress={() => router.push("/owner/transfers")} />
          </View>

          {stockAction === "cook" ? (
            <GabiCard raised>
              <GabiSectionHeader
                action={<GabiChip label="Manual stock in" tone="success" />}
                title="Dagdag luto (walang recipe)"
              />
              <GabiNotice
                message="Diretsong dagdag ito sa finished stock. Para sa exact ingredient deduction at recipe cost, gamitin ang Niluto."
                tone="warning"
              />
              <ProductChips
                disabled={cookSaving}
                onSelect={(productId) => setCookForm((form) => ({ ...form, productId }))}
                products={products}
                selectedId={cookForm.productId}
              />
              <View style={styles.twoColumn}>
                <FormField
                  editable={!cookSaving}
                  keyboardType="decimal-pad"
                  label="Ilang nadagdag?"
                  onChangeText={(quantity) => setCookForm((form) => ({ ...form, quantity }))}
                  placeholder="0"
                  value={cookForm.quantity}
                />
                <FormField
                  editable={!cookSaving}
                  label="Note"
                  onChangeText={(note) => setCookForm((form) => ({ ...form, note }))}
                  placeholder="Optional"
                  value={cookForm.note}
                />
              </View>
              {cookMessage ? <GabiNotice message={cookMessage} tone={cookIsError ? "danger" : "success"} /> : null}
              <View style={styles.formActions}>
                <View style={styles.primaryAction}>
                  <GabiPrimaryButton
                    disabled={cookSaving}
                    icon="checkmark-circle-outline"
                    label={cookSaving ? "Sine-save..." : "I-save ang dagdag stock"}
                    loading={cookSaving}
                    onPress={saveCookedBatch}
                  />
                </View>
                <GabiSoftButton icon="close" label="Isara" onPress={() => setStockAction(null)} />
              </View>
              <GabiSoftButton icon="flame-outline" label="May recipe? Buksan ang Niluto" onPress={() => router.push("/owner/production")} />
            </GabiCard>
          ) : null}

          {stockAction === "spoilage" ? (
            <GabiCard raised>
              <GabiSectionHeader action={<GabiChip label="Stock out" tone="danger" />} title="Nasayang" />
              <GabiNotice message="Ibabawas ito sa stock at isasama sa spoilage loss. Hindi puwedeng lumampas sa kasalukuyang stock." tone="warning" />
              <ProductChips
                disabled={spoilageSaving}
                onSelect={(productId) => setSpoilageForm((form) => ({ ...form, productId }))}
                products={products}
                selectedId={spoilageForm.productId}
              />
              <View style={styles.twoColumn}>
                <FormField
                  editable={!spoilageSaving}
                  keyboardType="decimal-pad"
                  label="Ilang nasayang?"
                  onChangeText={(quantity) => setSpoilageForm((form) => ({ ...form, quantity }))}
                  placeholder="0"
                  value={spoilageForm.quantity}
                />
                <FormField
                  editable={!spoilageSaving}
                  label="Dahilan"
                  onChangeText={(reason) => setSpoilageForm((form) => ({ ...form, reason }))}
                  placeholder="Hal. nabasag, na-expire"
                  value={spoilageForm.reason}
                />
              </View>
              {spoilageMessage ? <GabiNotice message={spoilageMessage} tone={spoilageIsError ? "danger" : "success"} /> : null}
              <View style={styles.formActions}>
                <View style={styles.primaryAction}>
                  <GabiPrimaryButton
                    disabled={spoilageSaving}
                    icon="trash-outline"
                    label={spoilageSaving ? "Sine-save..." : "I-save ang nasayang"}
                    loading={spoilageSaving}
                    onPress={saveSpoilage}
                  />
                </View>
                <GabiSoftButton icon="close" label="Isara" onPress={() => setStockAction(null)} />
              </View>
            </GabiCard>
          ) : null}

          {productFormVisible ? (
            <GabiCard raised>
              <GabiSectionHeader
                action={products.length > 0 ? <GabiSoftButton compact disabled={saving} icon="close" label="Isara" onPress={closeProductForm} /> : undefined}
                title={productForm.id ? "I-edit ang paninda" : "Bagong paninda"}
              />
              <GabiField
                disabled={!canEditProducts}
                label="Pangalan"
                onChangeText={(name) => setProductForm((form) => ({ ...form, name }))}
                placeholder="Hal. Bottled water"
                value={productForm.name}
              />
              <GabiField
                disabled={!canEditProducts}
                label="Category"
                onChangeText={(category) => setProductForm((form) => ({ ...form, category }))}
                placeholder="Drinks, meals, snacks"
                value={productForm.category}
              />
              <OptionGroup
                disabled={!canEditProducts}
                label="Uri ng paninda"
                onSelect={(productType) => setProductForm((form) => ({ ...form, productType }))}
                options={productTypes}
                selected={productForm.productType}
              />
              <OptionGroup
                disabled={!canEditProducts}
                label="Unit"
                onSelect={(unitType) => setProductForm((form) => ({ ...form, unitType }))}
                options={unitTypes}
                selected={productForm.unitType}
              />
              <View style={styles.twoColumn}>
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Stock qty" onChangeText={(stockQty) => setProductForm((form) => ({ ...form, stockQty }))} placeholder="0" value={productForm.stockQty} />
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Paubos kapag" onChangeText={(lowStockThreshold) => setProductForm((form) => ({ ...form, lowStockThreshold }))} placeholder="0" value={productForm.lowStockThreshold} />
              </View>
              <View style={styles.twoColumn}>
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Presyo" onChangeText={(price) => setProductForm((form) => ({ ...form, price }))} placeholder="0" value={productForm.price} />
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Unit cost" onChangeText={(cost) => setProductForm((form) => ({ ...form, cost }))} placeholder="0" value={productForm.cost} />
              </View>
              <GabiNotice message="Optional ang bundle. Parehong quantity at presyo ang kailangan para ma-apply ito sa BENTA." />
              <View style={styles.twoColumn}>
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Bundle quantity" onChangeText={(bundleQuantity) => setProductForm((form) => ({ ...form, bundleQuantity }))} placeholder="Optional" value={productForm.bundleQuantity} />
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Bundle price" onChangeText={(bundlePrice) => setProductForm((form) => ({ ...form, bundlePrice }))} placeholder="Optional" value={productForm.bundlePrice} />
              </View>
              <GabiField
                disabled={!canEditProducts}
                label="Bundle label"
                onChangeText={(bundleLabel) => setProductForm((form) => ({ ...form, bundleLabel }))}
                placeholder="Hal. 8 for PHP 150"
                value={productForm.bundleLabel}
              />
              <View style={styles.formActions}>
                <View style={styles.primaryAction}>
                  <GabiPrimaryButton
                    disabled={saving || !canEditProducts}
                    icon="save-outline"
                    label={saving ? "Sine-save..." : productForm.id ? "I-save ang paninda" : "Idagdag ang paninda"}
                    loading={saving}
                    onPress={saveProduct}
                  />
                </View>
                {productForm.id ? <GabiSoftButton disabled={saving} icon="close" label="Cancel" onPress={closeProductForm} /> : null}
              </View>
            </GabiCard>
          ) : null}
        </>
      )}

      {actionProduct ? (
        <ProductActionSheet
          onClose={() => setOpenProductActionsId(null)}
          onCook={() => openManualCook(actionProduct)}
          onEdit={() => editProduct(actionProduct)}
          onSpoilage={() => openSpoilage(actionProduct)}
          onTransfer={() => {
            setOpenProductActionsId(null);
            router.push("/owner/transfers");
          }}
          product={actionProduct}
        />
      ) : null}

      {!messageIsError && message ? <GabiSnackbar message={message} onDismiss={() => setMessage(null)} /> : null}
    </ScreenScroll>
  );
}

function parseRequiredNumber(value: string, fallback: number): number | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.includes(",")) {
    return "invalid";
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function parseOptionalStrictNumber(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(",")) {
    return "invalid";
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  editable?: boolean;
};

function FormField({ label, value, onChangeText, placeholder, keyboardType = "default", editable = true }: FormFieldProps) {
  return <GabiField disabled={!editable} keyboardType={keyboardType} label={label} onChangeText={onChangeText} placeholder={placeholder} value={value} />;
}

type ProductChipsProps = {
  products: Product[];
  selectedId: string | null;
  onSelect: (productId: string) => void;
  disabled?: boolean;
};

function ProductChips({ products, selectedId, onSelect, disabled = false }: ProductChipsProps) {
  const { palette, extended } = useGabiTheme();

  return (
    <ScrollView
      contentContainerStyle={styles.chipRow}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
    >
      {products.map((product) => {
        const selected = product.id === selectedId;
        return (
          <Pressable
            disabled={disabled}
            key={product.id}
            onPress={() => onSelect(product.id)}
            style={[
              styles.productChip,
              {
                backgroundColor: disabled ? extended.disabledBg : selected ? palette.kioskHeader : palette.surface,
                borderColor: disabled ? extended.disabledBg : selected ? palette.kioskHeader : palette.border,
              },
            ]}
          >
            <GabiText style={{ color: disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.text }} variant="buttonSm">
              {product.name}
            </GabiText>
          </Pressable>
        );
      })}
    </ScrollView>
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
  const { palette, extended } = useGabiTheme();

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      <View style={styles.optionWrap}>
        {options.map((option) => {
          const selectedOption = option === selected;
          return (
            <Pressable
              disabled={disabled}
              key={option}
              onPress={() => onSelect(option)}
              style={[
                styles.option,
                {
                  backgroundColor: disabled ? extended.disabledBg : selectedOption ? palette.kioskHeader : palette.surface,
                  borderColor: disabled ? extended.disabledBg : selectedOption ? palette.kioskHeader : palette.border,
                },
              ]}
            >
              <GabiText style={{ color: disabled ? extended.disabledText : selectedOption ? palette.kioskHeaderText : palette.text }} variant="caption">
                {option}
              </GabiText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type IconName = ComponentProps<typeof Ionicons>["name"];
type MetricTone = "primary" | "success" | "warning";

function SummaryMetric({ icon, label, value, tone = "primary" }: { icon: IconName; label: string; value: string; tone?: MetricTone }) {
  const { palette } = useGabiTheme();
  const backgroundColor = tone === "success" ? palette.softSuccess : tone === "warning" ? palette.softWarning : palette.softPrimary;
  const foreground = tone === "success" ? palette.success : tone === "warning" ? palette.warning : palette.primary;

  return (
    <View style={styles.summaryMetric}>
      <View style={[styles.summaryIcon, { backgroundColor }]}>
        <Ionicons color={foreground} name={icon} size={19} />
      </View>
      <GabiText numberOfLines={1} tone="muted" variant="caption">{label}</GabiText>
      <GabiText adjustsFontSizeToFit minimumFontScale={0.72} money={value.startsWith("₱")} numberOfLines={1} variant="metricValue">
        {value}
      </GabiText>
    </View>
  );
}

function FlowLink({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.flowLink,
        { backgroundColor: pressed ? palette.softPrimary : palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.flowIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name={icon} size={19} />
      </View>
      <GabiText numberOfLines={2} variant="buttonSm">{label}</GabiText>
      <Ionicons color={palette.mutedText} name="chevron-forward" size={16} />
    </Pressable>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="tab"
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
      <GabiText style={active ? { color: palette.kioskHeaderText } : undefined} variant="caption">{label}</GabiText>
    </Pressable>
  );
}

type InventoryProductRowProps = {
  product: Product;
  actionsOpen: boolean;
  disabled: boolean;
  onToggleActions: () => void;
};

function InventoryProductRow({
  product,
  actionsOpen,
  disabled,
  onToggleActions,
}: InventoryProductRowProps) {
  const { palette, extended } = useGabiTheme();
  const outOfStock = product.stockQty <= 0;
  const lowStock = !outOfStock && product.stockQty <= product.lowStockThreshold;
  const stateTone = outOfStock ? "danger" : lowStock ? "warning" : "success";
  const stateLabel = outOfStock ? "Ubos na" : lowStock ? `${product.stockQty} na lang` : "May stock";
  const bundleLabel = hasBundlePricing(product)
    ? bundleLabelFor(product.bundleQuantity, product.bundlePrice, product.bundleLabel)
    : null;
  const icon = product.productType === "cooked food"
    ? "fast-food-outline"
    : product.productType === "ingredient-based item"
      ? "restaurant-outline"
      : product.productType === "service/other"
        ? "briefcase-outline"
        : "cube-outline";

  return (
    <View style={[styles.productRow, { borderColor: palette.border }]}>
      <View style={styles.productMain}>
        <View style={[styles.productIcon, { backgroundColor: outOfStock ? palette.softDanger : lowStock ? palette.softWarning : palette.softPrimary }]}>
          <Ionicons color={outOfStock ? palette.danger : lowStock ? palette.warning : palette.primary} name={icon} size={21} />
        </View>
        <View style={styles.productCopy}>
          <GabiText adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={2} variant="cardTitle">{product.name}</GabiText>
          <GabiText tone="muted" variant="caption">{product.category} · {product.productType}</GabiText>
          <View style={styles.productChips}>
            <GabiChip label={stateLabel} tone={stateTone} />
            {bundleLabel ? <GabiChip icon="pricetag-outline" label={bundleLabel} tone="primary" /> : null}
            {!product.active ? <GabiChip label="Naka-off" tone="neutral" /> : null}
          </View>
          <GabiText tone="muted" variant="caption">
            Stock {product.stockQty} {product.unitType} · Paubos sa {product.lowStockThreshold}
          </GabiText>
        </View>
        <View style={styles.productTrailing}>
          <GabiText money tone="primary" variant="metricValue">{formatPeso(product.price)}</GabiText>
          <GabiText tone="faint" variant="caption">Cost {formatPeso(product.cost)}</GabiText>
          <Pressable
            accessibilityLabel={`Mga action para sa ${product.name}`}
            accessibilityRole="button"
            disabled={disabled}
            onPress={onToggleActions}
            style={[
              styles.moreButton,
              { backgroundColor: disabled ? extended.disabledBg : palette.softPrimary },
            ]}
          >
            <Ionicons color={disabled ? extended.disabledText : palette.primary} name={actionsOpen ? "close" : "ellipsis-horizontal"} size={19} />
          </Pressable>
        </View>
      </View>

    </View>
  );
}

function ProductActionSheet({
  product,
  onClose,
  onCook,
  onSpoilage,
  onTransfer,
  onEdit,
}: {
  product: Product;
  onClose: () => void;
  onCook: () => void;
  onSpoilage: () => void;
  onTransfer: () => void;
  onEdit: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Isara ang product actions" onPress={onClose} style={[styles.modalScrim, { backgroundColor: extended.scrim }]} />
        <View style={[styles.actionSheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitle}>
              <GabiText variant="h2">{product.name}</GabiText>
              <GabiText tone="muted" variant="caption">{product.stockQty} {product.unitType} sa stock · {formatPeso(product.price)}</GabiText>
            </View>
            <GabiSoftButton compact icon="close" label="Isara" onPress={onClose} />
          </View>
          <View style={[styles.sheetActions, { backgroundColor: palette.softPrimary }]}>
            <MenuAction icon="flame-outline" label="Dagdag luto (walang recipe)" onPress={onCook} />
            <MenuAction danger icon="trash-outline" label="Nasayang" onPress={onSpoilage} />
            <MenuAction icon="swap-horizontal-outline" label="Ilipat sa ibang stall" onPress={onTransfer} />
            <MenuAction icon="create-outline" label="I-edit ang paninda" onPress={onEdit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MenuAction({ icon, label, onPress, danger = false }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.menuAction}>
      <Ionicons color={danger ? palette.danger : palette.primary} name={icon} size={18} />
      <GabiText style={danger ? { color: palette.danger } : undefined} variant="buttonSm">{label}</GabiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  networkRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  summaryGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryMetric: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  summaryIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  flowGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  flowLink: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 60,
    padding: spacing.sm,
  },
  flowIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  filterRow: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  productList: {
    gap: 0,
  },
  productRow: {
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  productMain: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  productIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  productCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  productChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  productTrailing: {
    alignItems: "flex-end",
    gap: 4,
    maxWidth: 108,
  },
  moreButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  actionSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: 999,
    height: 4,
    width: 44,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  sheetTitle: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  sheetActions: {
    borderRadius: 16,
    padding: spacing.xs,
  },
  menuAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 2,
  },
  productChip: {
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  field: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 132,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  option: {
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  twoColumn: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  formActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  primaryAction: {
    flex: 1,
    minWidth: 210,
  },
});
