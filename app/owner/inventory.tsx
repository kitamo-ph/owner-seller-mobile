import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { type ComponentProps, useCallback, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NetworkStatusBadge } from "@/components/common/NetworkStatusBadge";
import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import { createProduct, updateProduct } from "@/db/repositories";
import type { PanindaSection } from "@/domain/catalogItems";
import {
  buildPanindaActionDescriptors,
  buildPanindaActionSheetLayout,
} from "@/domain/panindaActionSheet";
import { bundleLabelFor, hasBundlePricing } from "@/domain/pricing";
import type { Product, ProductType, UnitType } from "@/domain/types";
import {
  loadPanindaCatalog,
  type PanindaCatalogEntry,
} from "@/services/catalogItems";
import {
  archiveInventoryCatalogItem,
  permanentlyDeleteInventoryCatalogItem,
} from "@/services/itemLifecycle";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { addDirectResalePurchase } from "@/services/productPurchases";
import { recordCookedBatch, recordSpoilage } from "@/services/stockOps";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";

const productTypes: ProductType[] = ["retail item", "cooked food", "ingredient-based item", "service/other"];
const unitTypes: UnitType[] = ["piece", "bottle", "pack", "sachet", "kilo", "serving", "case", "tray", "other"];

type ProductForm = {
  id: string | null;
  stockEditable: boolean;
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
  stockEditable: true,
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

type PurchaseForm = {
  quantity: string;
  totalCost: string;
  notes: string;
};

const emptyCookForm: CookForm = { productId: null, quantity: "", note: "" };
const emptySpoilageForm: SpoilageForm = { productId: null, quantity: "", reason: "" };
const emptyPurchaseForm: PurchaseForm = {
  quantity: "",
  totalCost: "",
  notes: "",
};

export default function OwnerInventoryScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [panindaEntries, setPanindaEntries] = useState<PanindaCatalogEntry[]>([]);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [showProductForm, setShowProductForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [cookForm, setCookForm] = useState<CookForm>(emptyCookForm);
  const [spoilageForm, setSpoilageForm] = useState<SpoilageForm>(emptySpoilageForm);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm);
  const [purchaseEntry, setPurchaseEntry] = useState<PanindaCatalogEntry | null>(null);
  const [cookMessage, setCookMessage] = useState<string | null>(null);
  const [cookIsError, setCookIsError] = useState(false);
  const [spoilageMessage, setSpoilageMessage] = useState<string | null>(null);
  const [spoilageIsError, setSpoilageIsError] = useState(false);
  const [cookSaving, setCookSaving] = useState(false);
  const [spoilageSaving, setSpoilageSaving] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [sectionFilter, setSectionFilter] =
    useState<Exclude<PanindaSection, "excluded">>("active");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [productRenderLimit, setProductRenderLimit] = useState(productRenderBatch);
  const [openProductActionsId, setOpenProductActionsId] = useState<string | null>(null);
  const [stockAction, setStockAction] = useState<"cook" | "spoilage" | "purchase" | null>(null);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const cookLock = useRef(false);
  const spoilageLock = useRef(false);
  const purchaseLock = useRef(false);
  const lifecycleLock = useRef(false);
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
    const nextEntries = nextStatus.activeBusiness
      ? await loadPanindaCatalog(nextStatus.activeBusiness.id)
      : [];
    setStatus(nextStatus);
    setPanindaEntries(nextEntries);
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
        productType: productForm.id ? productForm.productType : "retail item",
        lowStockThreshold,
        price,
        bundleQuantity,
        bundlePrice,
        bundleLabel: productForm.bundleLabel.trim() || null,
      };

      if (productForm.id) {
        const stockChanged =
          productForm.stockEditable &&
          productForm.stockQty.trim() !==
            (productForm.initialStockQty ?? "").trim();
        await updateProduct(productForm.id, {
          ...sharedFields,
          ...(productForm.stockEditable
            ? { unitType: productForm.unitType, cost }
            : {}),
          ...(stockChanged ? { stockQty } : {}),
        });
      } else {
        await createProduct({
          ...sharedFields,
          unitType: productForm.unitType,
          cost,
          stockQty,
          branchId: status.activeBranch?.id ?? null,
          active: true,
          businessId: status.activeBusiness.id,
          catalogMode: "direct_resale",
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

  function editProduct(product: Product, stockEditable = true) {
    setOpenProductActionsId(null);
    setShowProductForm(true);
    setProductForm({
      id: product.id,
      stockEditable,
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

  function addPurchasedStock(entry: PanindaCatalogEntry) {
    setOpenProductActionsId(null);
    if (entry.stockPolicy !== "product_lots") {
      editProduct(entry.product);
      return;
    }
    setPurchaseEntry(entry);
    setPurchaseForm(emptyPurchaseForm);
    setStockAction("purchase");
  }

  async function savePurchasedStock() {
    if (purchaseLock.current || !purchaseEntry) return;
    const quantity = parseRequiredNumber(purchaseForm.quantity, 0);
    const totalCost = parseOptionalStrictNumber(purchaseForm.totalCost);
    if (quantity === "invalid" || totalCost === "invalid") {
      setError(numbersOnlyMessage);
      return;
    }
    if (quantity <= 0) {
      setError("Purchased quantity must be greater than zero.");
      return;
    }
    if (totalCost !== null && totalCost < 0) {
      setError("Purchase cost cannot be negative.");
      return;
    }

    purchaseLock.current = true;
    setPurchaseSaving(true);
    setMessage(null);
    try {
      await addDirectResalePurchase({
        catalogItemId: purchaseEntry.catalogItemId,
        productId: purchaseEntry.product.id,
        quantity,
        totalCost,
        notes: purchaseForm.notes,
      });
      const purchasedName = purchaseEntry.product.name;
      setPurchaseEntry(null);
      setPurchaseForm(emptyPurchaseForm);
      setStockAction(null);
      await refresh();
      setNotice(
        `${quantity} ${purchaseEntry.product.unitType} added to ${purchasedName} as a purchase lot.`,
      );
    } catch (error) {
      logDevError("OwnerInventory.savePurchasedStock", error);
      setError(
        getUserSafeErrorMessage(error, "Could not record the purchased stock."),
      );
    } finally {
      purchaseLock.current = false;
      setPurchaseSaving(false);
    }
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

  function openRecipe(entry: PanindaCatalogEntry) {
    setOpenProductActionsId(null);
    if (entry.draftId) {
      router.push({
        pathname: "/owner/recipe-editor" as never,
        params: { draftId: entry.draftId },
      });
      return;
    }
    if (entry.activeRecipeId) {
      router.push({
        pathname: "/owner/recipe-detail",
        params: { recipeId: entry.activeRecipeId },
      });
      return;
    }
    router.push("/owner/recipes");
  }

  async function performArchive(entry: PanindaCatalogEntry) {
    if (lifecycleLock.current) return;
    lifecycleLock.current = true;
    setLifecycleSaving(true);
    setOpenProductActionsId(null);
    try {
      await archiveInventoryCatalogItem(entry.catalogItemId, true);
      await refresh();
      setSectionFilter("archived");
      setNotice(`${entry.product.name} archived. History remains available.`);
    } catch (error) {
      logDevError("OwnerInventory.archive", error);
      setError(getUserSafeErrorMessage(error, "Could not archive this item."));
    } finally {
      lifecycleLock.current = false;
      setLifecycleSaving(false);
    }
  }

  function confirmArchive(entry: PanindaCatalogEntry) {
    setOpenProductActionsId(null);
    Alert.alert(
      `Archive ${entry.product.name}?`,
      "It will leave normal Paninda and Kiosk selection. Sales, production, recipes, lots, movements, and reports remain preserved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive Item",
          style: "destructive",
          onPress: () => void performArchive(entry),
        },
      ],
    );
  }

  async function performPermanentDelete(entry: PanindaCatalogEntry) {
    if (lifecycleLock.current) return;
    lifecycleLock.current = true;
    setLifecycleSaving(true);
    setOpenProductActionsId(null);
    try {
      const result = await permanentlyDeleteInventoryCatalogItem(
        entry.catalogItemId,
        true,
      );
      if (result.outcome === "deleted") {
        await refresh();
        setNotice(`${entry.product.name} permanently deleted.`);
        return;
      }
      if (result.outcome === "archive_required") {
        Alert.alert(
          "This item has history",
          "Permanent delete is not safe because this item is referenced by stock, Recipe, production, sale, transfer, or other historical evidence. Archive keeps that history intact.",
          [
            { text: "Keep Item", style: "cancel" },
            {
              text: "Archive Instead",
              onPress: () => confirmArchive(entry),
            },
          ],
        );
        return;
      }
      Alert.alert(
        "Permanent delete unavailable",
        result.outcome === "owner_authorization_required"
          ? "Owner authorization is required."
          : "The complete reference check could not be proven, so deletion was denied safely. You can archive the item instead.",
        [
          { text: "Close", style: "cancel" },
          {
            text: "Archive Instead",
            onPress: () => confirmArchive(entry),
          },
        ],
      );
    } catch (error) {
      logDevError("OwnerInventory.permanentDelete", error);
      setError(
        getUserSafeErrorMessage(error, "Could not safely delete this item."),
      );
    } finally {
      lifecycleLock.current = false;
      setLifecycleSaving(false);
    }
  }

  function confirmPermanentDelete(entry: PanindaCatalogEntry) {
    setOpenProductActionsId(null);
    Alert.alert(
      `Permanently delete ${entry.product.name}?`,
      "The app will recheck every historical reference inside the delete transaction. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Permanently",
          style: "destructive",
          onPress: () => void performPermanentDelete(entry),
        },
      ],
    );
  }

  const canEditProducts = Boolean(status?.activeBusiness);
  const activeEntries = panindaEntries.filter((entry) => entry.section === "active");
  const activeProducts = activeEntries.map((entry) => entry.product);
  const compatibilityCookProducts = activeEntries
    .filter((entry) => entry.actions.manualCompatibilityStockIn)
    .map((entry) => entry.product);
  const spoilageProducts = activeEntries
    .filter((entry) => entry.actions.recordSpoilage)
    .map((entry) => entry.product);
  const lowStockCount = activeProducts.filter(
    (product) => product.stockQty <= product.lowStockThreshold,
  ).length;
  const stockValue = activeProducts.reduce(
    (total, product) => total + product.stockQty * product.cost,
    0,
  );
  const productFormVisible =
    Boolean(status) && (showProductForm || Boolean(productForm.id));
  const visibleEntries = panindaEntries.filter((entry) => {
    if (entry.section !== sectionFilter) return false;
    const product = entry.product;
    const matchesSearch = `${product.name} ${product.category}`.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase());
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "out" ? product.stockQty <= 0 : product.stockQty > 0 && product.stockQty <= product.lowStockThreshold);
    return matchesSearch && matchesStock;
  });
  const renderedEntries = visibleEntries.slice(0, productRenderLimit);
  const remainingProductCount = Math.max(0, visibleEntries.length - renderedEntries.length);
  const actionEntry =
    panindaEntries.find(
      (entry) => entry.catalogItemId === openProductActionsId,
    ) ?? null;

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
              <SummaryMetric icon="cube-outline" label="Active" value={String(activeEntries.length)} />
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

            {panindaEntries.length > 0 ? (
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
                  {(["active", "needs_setup", "archived"] as const).map(
                    (option) => (
                      <FilterChip
                        active={sectionFilter === option}
                        key={option}
                        label={
                          option === "active"
                            ? "Active"
                            : option === "needs_setup"
                              ? "Needs Setup"
                              : "Archived"
                        }
                        onPress={() => {
                          setSectionFilter(option);
                          setProductRenderLimit(productRenderBatch);
                        }}
                      />
                    ),
                  )}
                </ScrollView>
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

            {panindaEntries.length === 0 ? (
              <GabiEmptyState
                actionLabel="Magdagdag ng paninda"
                icon="cube-outline"
                message="Ilagay ang unang produktong ibebenta sa napiling business o stall."
                onAction={openProductForm}
                title="Wala pang paninda"
              />
            ) : visibleEntries.length === 0 ? (
              <GabiEmptyState
                actionLabel="I-reset ang filter"
                icon="search-outline"
                message="Walang tumutugma sa search at stock filter."
                onAction={() => {
                  setProductSearch("");
                  setStockFilter("all");
                  setSectionFilter("active");
                  setProductRenderLimit(productRenderBatch);
                }}
                title="Walang nahanap"
              />
            ) : (
              <View style={styles.productList}>
                {renderedEntries.map((entry) => (
                  <InventoryProductRow
                    actionsOpen={openProductActionsId === entry.catalogItemId}
                    disabled={saving || lifecycleSaving}
                    entry={entry}
                    key={entry.catalogItemId}
                    onToggleActions={() =>
                      setOpenProductActionsId((current) =>
                        current === entry.catalogItemId
                          ? null
                          : entry.catalogItemId,
                      )
                    }
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

          {stockAction === "purchase" && purchaseEntry ? (
            <GabiCard raised>
              <GabiSectionHeader
                action={<GabiChip label="Exact purchase lot" tone="success" />}
                title={`Add purchased stock · ${purchaseEntry.product.name}`}
              />
              <GabiNotice
                message={`The stock unit is fixed at ${purchaseEntry.product.unitType}. Saving creates purchase, lot, movement, and scalar compatibility evidence atomically.`}
                tone="owner"
              />
              <View style={styles.twoColumn}>
                <FormField
                  editable={!purchaseSaving}
                  keyboardType="decimal-pad"
                  label={`Quantity (${purchaseEntry.product.unitType})`}
                  onChangeText={(quantity) =>
                    setPurchaseForm((form) => ({ ...form, quantity }))
                  }
                  placeholder="0"
                  value={purchaseForm.quantity}
                />
                <FormField
                  editable={!purchaseSaving}
                  keyboardType="decimal-pad"
                  label="Total purchase cost"
                  onChangeText={(totalCost) =>
                    setPurchaseForm((form) => ({ ...form, totalCost }))
                  }
                  placeholder="Optional · No Price"
                  value={purchaseForm.totalCost}
                />
              </View>
              <GabiField
                disabled={purchaseSaving}
                label="Purchase note"
                onChangeText={(notes) =>
                  setPurchaseForm((form) => ({ ...form, notes }))
                }
                placeholder="Optional reference or supplier note"
                value={purchaseForm.notes}
              />
              <View style={styles.formActions}>
                <View style={styles.primaryAction}>
                  <GabiPrimaryButton
                    disabled={purchaseSaving}
                    icon="bag-add-outline"
                    label={purchaseSaving ? "Saving purchase..." : "Save purchase lot"}
                    loading={purchaseSaving}
                    onPress={() => void savePurchasedStock()}
                  />
                </View>
                <GabiSoftButton
                  disabled={purchaseSaving}
                  icon="close"
                  label="Close"
                  onPress={() => {
                    setPurchaseEntry(null);
                    setPurchaseForm(emptyPurchaseForm);
                    setStockAction(null);
                  }}
                />
              </View>
            </GabiCard>
          ) : null}

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
                products={compatibilityCookProducts}
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
              <GabiSectionHeader action={<GabiChip label="Stock out" tone="danger" />} title="Record spoilage" />
              <GabiNotice message="Ibabawas ito sa stock at isasama sa spoilage loss. Hindi puwedeng lumampas sa kasalukuyang stock." tone="warning" />
              <ProductChips
                disabled={spoilageSaving}
                onSelect={(productId) => setSpoilageForm((form) => ({ ...form, productId }))}
                products={spoilageProducts}
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
                    icon="remove-circle-outline"
                    label={spoilageSaving ? "Sine-save..." : "Record spoilage"}
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
                action={panindaEntries.length > 0 ? <GabiSoftButton compact disabled={saving} icon="close" label="Isara" onPress={closeProductForm} /> : undefined}
                title={productForm.id ? "I-edit ang paninda" : "Bagong direct-resale item"}
              />
              {!productForm.id ? (
                <>
                  <GabiNotice
                    message="Bagong Paninda is for items bought and resold as-is, such as bottled water, biscuits, or canned goods."
                    tone="owner"
                  />
                  <GabiSoftButton
                    icon="restaurant-outline"
                    label="Cooking or preparing this item? Create it in Recipe Book"
                    onPress={() => {
                      closeProductForm();
                      router.push("/owner/recipes");
                    }}
                  />
                </>
              ) : null}
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
              {productForm.id ? (
                <OptionGroup
                  disabled={!canEditProducts}
                  label="Legacy product type"
                  onSelect={(productType) => setProductForm((form) => ({ ...form, productType }))}
                  options={productTypes}
                  selected={productForm.productType}
                />
              ) : null}
              <OptionGroup
                disabled={!canEditProducts || !productForm.stockEditable}
                label="Unit"
                onSelect={(unitType) => setProductForm((form) => ({ ...form, unitType }))}
                options={unitTypes}
                selected={productForm.unitType}
              />
              <View style={styles.twoColumn}>
                <FormField editable={canEditProducts && productForm.stockEditable} keyboardType="decimal-pad" label="Stock qty" onChangeText={(stockQty) => setProductForm((form) => ({ ...form, stockQty }))} placeholder="0" value={productForm.stockQty} />
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Paubos kapag" onChangeText={(lowStockThreshold) => setProductForm((form) => ({ ...form, lowStockThreshold }))} placeholder="0" value={productForm.lowStockThreshold} />
              </View>
              {productForm.id && !productForm.stockEditable ? (
                <GabiNotice
                  message="Stock is lot-tracked. Edit selling details here; use the lot-aware purchase, Recipe, or Production flow to change stock."
                  tone="owner"
                />
              ) : null}
              <View style={styles.twoColumn}>
                <FormField editable={canEditProducts} keyboardType="decimal-pad" label="Presyo" onChangeText={(price) => setProductForm((form) => ({ ...form, price }))} placeholder="0" value={productForm.price} />
                <FormField editable={canEditProducts && productForm.stockEditable} keyboardType="decimal-pad" label="Unit cost" onChangeText={(cost) => setProductForm((form) => ({ ...form, cost }))} placeholder="0" value={productForm.cost} />
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

      {actionEntry ? (
        <ProductActionSheet
          onClose={() => setOpenProductActionsId(null)}
          onAddPurchasedStock={() => addPurchasedStock(actionEntry)}
          onArchive={() => confirmArchive(actionEntry)}
          onCook={() => openManualCook(actionEntry.product)}
          onDelete={() => confirmPermanentDelete(actionEntry)}
          onEdit={() =>
            editProduct(
              actionEntry.product,
              actionEntry.stockPolicy !== "product_lots",
            )
          }
          onOpenRecipe={() => openRecipe(actionEntry)}
          onProduce={() => {
            setOpenProductActionsId(null);
            router.push({
              pathname: "/owner/production",
              params: actionEntry.activeRecipeId
                ? { recipeId: actionEntry.activeRecipeId }
                : {},
            });
          }}
          onSpoilage={() => openSpoilage(actionEntry.product)}
          onTransfer={() => {
            setOpenProductActionsId(null);
            router.push("/owner/transfers");
          }}
          busy={lifecycleSaving}
          entry={actionEntry}
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

function panindaClassificationLabel(entry: PanindaCatalogEntry) {
  if (entry.classification === "finished_product") return "Recipe-backed item";
  if (entry.classification === "direct_resale_product") return "Direct resale";
  if (entry.classification === "bundle_combo") return "Bundle";
  if (entry.compatibilityMode === "legacy_unclassified") {
    return "Legacy selling item";
  }
  return "Selling item";
}

type InventoryProductRowProps = {
  entry: PanindaCatalogEntry;
  actionsOpen: boolean;
  disabled: boolean;
  onToggleActions: () => void;
};

function InventoryProductRow({
  entry,
  actionsOpen,
  disabled,
  onToggleActions,
}: InventoryProductRowProps) {
  const product = entry.product;
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
          <GabiText tone="muted" variant="caption">
            {product.category} · {panindaClassificationLabel(entry)}
          </GabiText>
          <View style={styles.productChips}>
            <GabiChip label={stateLabel} tone={stateTone} />
            {entry.section === "needs_setup" ? (
              <GabiChip label="Needs setup" tone="warning" />
            ) : null}
            {entry.section === "archived" ? (
              <GabiChip label="Archived" tone="neutral" />
            ) : null}
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
  entry,
  busy,
  onClose,
  onOpenRecipe,
  onProduce,
  onAddPurchasedStock,
  onCook,
  onSpoilage,
  onTransfer,
  onEdit,
  onArchive,
  onDelete,
}: {
  entry: PanindaCatalogEntry;
  busy: boolean;
  onClose: () => void;
  onOpenRecipe: () => void;
  onProduce: () => void;
  onAddPurchasedStock: () => void;
  onCook: () => void;
  onSpoilage: () => void;
  onTransfer: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const product = entry.product;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { palette, extended } = useGabiTheme();
  const layout = buildPanindaActionSheetLayout({
    windowHeight: height,
    topInset: insets.top,
    bottomInset: insets.bottom,
    spacingLg: spacing.lg,
    spacingMd: spacing.md,
  });
  const actionHandlers = {
    openRecipe: onOpenRecipe,
    produceFromRecipe: onProduce,
    addPurchasedStock: onAddPurchasedStock,
    editSellingItem: onEdit,
    manualCompatibilityStockIn: onCook,
    recordSpoilage: onSpoilage,
    transferStock: onTransfer,
    archive: onArchive,
    requestPermanentDelete: onDelete,
  } as const;
  const actionIcons = {
    openRecipe: "book-outline",
    produceFromRecipe: "restaurant-outline",
    addPurchasedStock: "basket-outline",
    editSellingItem: "create-outline",
    manualCompatibilityStockIn: "add-circle-outline",
    recordSpoilage: "remove-circle-outline",
    transferStock: "swap-horizontal-outline",
    archive: "archive-outline",
    requestPermanentDelete: "trash-outline",
  } as const;
  const actions = buildPanindaActionDescriptors({
    actions: entry.actions,
    productType: product.productType,
  });
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.modalRoot}>
        <Pressable accessibilityLabel="Isara ang product actions" onPress={onClose} style={[styles.modalScrim, { backgroundColor: extended.scrim }]} />
        <View
          style={[
            styles.actionSheet,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              maxHeight: layout.maxHeight,
              paddingBottom: layout.paddingBottom,
            },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitle}>
              <GabiText numberOfLines={2} variant="h2">{product.name}</GabiText>
              <GabiText tone="muted" variant="caption">{product.stockQty} {product.unitType} sa stock · {formatPeso(product.price)}</GabiText>
            </View>
            <GabiSoftButton compact icon="close" label="Isara" onPress={onClose} />
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            style={styles.sheetScroll}
          >
            <View style={styles.sheetSummary}>
              <GabiChip
                label={panindaClassificationLabel(entry)}
                tone="primary"
              />
              {entry.section === "needs_setup" ? (
                <GabiChip label="Needs setup" tone="warning" />
              ) : null}
              {entry.section === "archived" ? (
                <GabiChip label="Archived" tone="neutral" />
              ) : null}
            </View>
            {entry.stockPolicy === "product_lots" ? (
              <GabiNotice
                message="This item uses native lot evidence. Stock changes stay in a lot-aware purchase, Recipe, or Production flow so no partial scalar-only mutation is created."
                tone="owner"
              />
            ) : null}
            <View style={[styles.sheetActions, { backgroundColor: palette.softPrimary }]}>
              {actions.map((action) => (
                <MenuAction
                  danger={action.danger}
                  disabled={busy}
                  icon={actionIcons[action.key]}
                  key={action.key}
                  label={action.label}
                  onPress={actionHandlers[action.key]}
                />
              ))}
              {actions.length === 0 ? (
                <GabiText tone="muted" variant="caption">
                  This archived item is read-only. Its historical records remain preserved.
                </GabiText>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MenuAction({ icon, label, onPress, danger = false, disabled = false }: { icon: IconName; label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.menuAction, disabled ? styles.disabledAction : null]}
    >
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
  sheetScroll: {
    flexShrink: 1,
  },
  sheetScrollContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  sheetSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  menuAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  disabledAction: {
    opacity: 0.48,
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
