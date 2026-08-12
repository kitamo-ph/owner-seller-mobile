import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  GabiPrimaryButton,
  GabiSoftButton,
} from "@/components/gabi/GabiButton";
import {
  GabiEmptyState,
  GabiNotice,
  GabiSnackbar,
} from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import {
  RecipeLibraryCard,
  type RecipeLibraryCardView,
} from "@/components/owner/RecipeLibraryCard";
import {
  RecipeLibraryFilters,
  type RecipeLibraryCostFilter,
  type RecipeLibraryGroup,
} from "@/components/owner/RecipeLibraryFilters";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { loadOwnerSetupStatus } from "@/services/ownerSetup";
import {
  archiveRecipeFirstItem,
  deleteRecipeFirstItem,
  duplicateRecipeFirstItem,
  loadRecipeLibrary,
  startRecipeFirstEdit,
  type RecipeFirstLibraryEntry,
} from "@/services/recipeFirst";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import {
  getFriendlyErrorMessage,
  getUserSafeErrorMessage,
  logDevError,
} from "@/utils/errors";

type ActionState =
  | { kind: "create" }
  | { kind: "item"; entry: RecipeFirstLibraryEntry }
  | null;

type LibrarySection = {
  key: RecipeLibraryGroup;
  title: string;
  items: RecipeFirstLibraryEntry[];
};

function classificationLabel(entry: RecipeFirstLibraryEntry) {
  if (entry.classification === "prepared_base") return "Prepared base";
  if (entry.classification === "finished_product") return "Selling item";
  if (entry.classification === "purchased_ingredient") return "Ingredient";
  if (entry.classification === "direct_resale_product") return "Resale product";
  if (entry.classification === "bundle_combo") return "Bundle";
  if (entry.classification === "supply_packaging") return "Supply or packaging";
  if (entry.ingredientId) return "Ingredient";
  if (entry.productId && !entry.activeVersionId) return "Resale product";
  if (entry.productId) return "Selling item";
  return "Needs classification";
}

function lifecycleLabel(entry: RecipeFirstLibraryEntry) {
  if (entry.lifecycle === "archived") return "Archived";
  if (entry.draftId) {
    return entry.draftLifecycle === "ready" ? "Draft ready to review" : "Draft";
  }
  if (entry.activeVersionId) return "Recipe recorded";
  if (entry.lifecycle === "active") return "Active";
  if (entry.lifecycle === "ready") return "Ready";
  return "Incomplete";
}

function costStatus(
  entry: RecipeFirstLibraryEntry,
): RecipeLibraryCardView["costStatus"] {
  if (entry.activeVersionCostStatus) return entry.activeVersionCostStatus;
  if (entry.activeCostSource === "owner_estimate") return "estimated";
  if (entry.activeCostSource === "recipe_version") return "actual";
  if (entry.latestIngredientUnitCost !== null) return "actual";
  if (entry.purchaseCostState === "known") return "actual";
  if (
    entry.purchaseCostState === "unknown" ||
    entry.sellingPriceState === "unknown"
  ) {
    return "no_price";
  }
  if (
    entry.purchaseCostState === "legacy_zero_unresolved" ||
    entry.reviewRequired
  ) {
    return "incomplete";
  }
  return entry.displayCostPerUnit === null ? "no_price" : "actual";
}

function unitCost(entry: RecipeFirstLibraryEntry) {
  if (entry.activeVersionCostPerOutputUnit !== null) {
    return entry.activeVersionCostPerOutputUnit;
  }
  if (
    entry.activeCostTotal !== null &&
    entry.activeCostReferenceQuantity !== null &&
    entry.activeCostReferenceQuantity > 0
  ) {
    return entry.activeCostTotal / entry.activeCostReferenceQuantity;
  }
  return entry.displayCostPerUnit;
}

function cardView(entry: RecipeFirstLibraryEntry): RecipeLibraryCardView {
  const producible =
    entry.classification === "prepared_base" ||
    entry.classification === "finished_product";
  const status = costStatus(entry);
  const productionReady =
    producible &&
    Boolean(entry.activeVersionId) &&
    entry.readinessState === "ready" &&
    entry.lifecycle !== "archived";
  const kioskReady =
    entry.kioskEnabled &&
    entry.sellable &&
    entry.productActive === true &&
    entry.lifecycle !== "archived";
  return {
    id: entry.catalogItemId,
    name: entry.name,
    classificationLabel: classificationLabel(entry),
    statusLabel: lifecycleLabel(entry),
    sellingPrice: entry.sellingPrice,
    costStatus: status,
    unitCost:
      status === "actual" || status === "estimated"
        ? unitCost(entry)
        : null,
    unitLabel: entry.activeCostReferenceUnit ?? "unit",
    productionReady,
    kioskReady,
    isDraft: Boolean(entry.draftId),
    isArchived: entry.lifecycle === "archived",
    usesEstimatedInput:
      entry.activeCostSource === "owner_estimate" ||
      entry.activeVersionCostStatus === "estimated",
    missingInformation:
      status === "incomplete" ||
      entry.reviewRequired ||
      entry.readinessState === "incomplete" ||
      entry.readinessState === "legacy_review",
    primaryActionLabel: entry.lifecycle === "archived"
      ? "View Archived Item"
      : entry.draftId
      ? "Continue Draft"
      : entry.sourceType !== "native" && entry.activeRecipeId
        ? "View Recipe"
      : entry.activeVersionId
        ? "Edit Recipe"
        : entry.ingredientId
          ? "Open Grocery"
          : entry.productId
            ? "Open Paninda"
            : "View Details",
  };
}

function matchesGroup(
  entry: RecipeFirstLibraryEntry,
  group: RecipeLibraryGroup,
) {
  if (group === "all") return entry.lifecycle !== "archived";
  if (group === "archived") return entry.lifecycle === "archived";
  if (group === "drafts") return Boolean(entry.draftId);
  if (entry.lifecycle === "archived") return false;
  if (group === "recipes") return Boolean(entry.activeVersionId);
  if (group === "prepared") return entry.classification === "prepared_base";
  if (group === "ingredients") {
    return (
      Boolean(entry.ingredientId) ||
      entry.classification === "purchased_ingredient" ||
      entry.classification === "supply_packaging"
    );
  }
  if (group === "selling") {
    return (
      entry.classification === "finished_product" ||
      entry.classification === "bundle_combo"
    );
  }
  return (
    entry.classification === "direct_resale_product" ||
    (Boolean(entry.productId) && !entry.activeVersionId)
  );
}

function sectionKey(entry: RecipeFirstLibraryEntry): RecipeLibraryGroup {
  if (entry.draftId) return "drafts";
  if (entry.classification === "prepared_base") return "prepared";
  if (
    entry.ingredientId ||
    entry.classification === "purchased_ingredient" ||
    entry.classification === "supply_packaging"
  ) {
    return "ingredients";
  }
  if (
    entry.classification === "finished_product" ||
    entry.classification === "bundle_combo"
  ) {
    return "selling";
  }
  if (entry.activeVersionId) return "recipes";
  if (
    entry.classification === "direct_resale_product" ||
    (entry.productId && !entry.activeVersionId)
  ) {
    return "resale";
  }
  return "all";
}

const sectionTitles: Record<RecipeLibraryGroup, string> = {
  all: "Iba pang item",
  recipes: "May kailangang suriin",
  prepared: "Tinimplang Recipe",
  ingredients: "Mga sangkap",
  selling: "Handang ibenta",
  resale: "Biniling paninda",
  drafts: "Mga draft",
  archived: "Naka-archive",
};

export default function OwnerRecipesScreen() {
  const params = useLocalSearchParams<{
    publishedItemId?: string | string[];
    group?: string | string[];
    query?: string | string[];
  }>();
  const publishedItemId = Array.isArray(params.publishedItemId)
    ? params.publishedItemId[0]
    : params.publishedItemId;
  const requestedGroup = Array.isArray(params.group)
    ? params.group[0]
    : params.group;
  const requestedQuery = Array.isArray(params.query) ? params.query[0] : params.query;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette, extended } = useGabiTheme();
  const [entries, setEntries] = useState<RecipeFirstLibraryEntry[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<RecipeLibraryGroup>("all");
  const [costFilter, setCostFilter] =
    useState<RecipeLibraryCostFilter>("all");
  const [actions, setActions] = useState<ActionState>(null);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const handledPublishedItem = useRef<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const status = await loadOwnerSetupStatus();
    setBusinessId(status.activeBusiness?.id ?? null);
    setBranchId(status.activeBranch?.id ?? null);
    setEntries(
      status.activeBusiness
        ? await loadRecipeLibrary(status.activeBusiness.id)
        : [],
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void refresh()
        .then(() => {
          if (active) {
            setLoadError(null);
            if (
              publishedItemId &&
              handledPublishedItem.current !== publishedItemId
            ) {
              handledPublishedItem.current = publishedItemId;
              setSearch("");
              setCostFilter("all");
              setGroup(
                requestedGroup === "prepared" || requestedGroup === "selling"
                  ? requestedGroup
                  : "all",
              );
              setSnackbar("Recipe ready — review production setup next");
            } else if (requestedQuery) {
              setSearch(requestedQuery);
            }
          }
        })
        .catch((error) => {
          logDevError("OwnerRecipes.recipeFirstLibrary", error);
          if (active) {
            setLoadError(
              getFriendlyErrorMessage("Could not load the Recipe Book."),
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [publishedItemId, refresh, requestedGroup, requestedQuery]),
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (!matchesGroup(entry, group)) return false;
      const view = cardView(entry);
      if (costFilter !== "all" && view.costStatus !== costFilter) {
        return false;
      }
      return query
        ? [
            entry.name,
            classificationLabel(entry),
            lifecycleLabel(entry),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)
        : true;
    });
  }, [costFilter, entries, group, search]);

  const sections = useMemo<LibrarySection[]>(() => {
    if (group !== "all") {
      return filtered.length
        ? [{ key: group, title: sectionTitles[group], items: filtered }]
        : [];
    }
    const order: RecipeLibraryGroup[] = [
      "selling",
      "prepared",
      "drafts",
      "ingredients",
      "resale",
      "recipes",
      "all",
    ];
    return order
      .map((key) => ({
        key,
        title: sectionTitles[key],
        items: filtered.filter((entry) => sectionKey(entry) === key),
      }))
      .filter((section) => section.items.length > 0);
  }, [filtered, group]);
  const attentionEntries = useMemo(
    () => entries.filter((entry) => {
      const view = cardView(entry);
      return entry.lifecycle !== "archived" && (view.isDraft || view.missingInformation || view.costStatus === "no_price");
    }).slice(0, 4),
    [entries],
  );

  const runAction = useCallback(async (operation: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      logDevError("OwnerRecipes.action", error);
      Alert.alert(
        "Could not complete action",
        getUserSafeErrorMessage(error, "Please try this Recipe action again."),
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }, []);

  const openEntry = useCallback(
    async (entry: RecipeFirstLibraryEntry) => {
      setActions(null);
      if (entry.lifecycle === "archived") {
        Alert.alert(
          entry.name,
          "This item is archived and read-only. Its Recipe, production, sale, and cost history remain preserved.",
        );
        return;
      }
      if (entry.sourceType !== "native" && entry.activeRecipeId) {
        router.push({
          pathname: "/owner/recipe-detail",
          params: { recipeId: entry.activeRecipeId },
        });
        return;
      }
      if (entry.draftId) {
        router.push({
          pathname: "/owner/recipe-editor" as never,
          params: { draftId: entry.draftId },
        });
        return;
      }
      if (!entry.activeVersionId && entry.ingredientId) {
        router.push("/owner/grocery");
        return;
      }
      if (!entry.activeVersionId && entry.productId) {
        router.push("/owner/inventory");
        return;
      }
      if (!businessId || !entry.activeVersionId) {
        Alert.alert(
          entry.name,
          "This recorded item does not have an editable Recipe draft yet.",
        );
        return;
      }
      await runAction(async () => {
        const draft = await startRecipeFirstEdit({
          businessId,
          sourceVersionId: entry.activeVersionId as string,
        });
        router.push({
          pathname: "/owner/recipe-editor" as never,
          params: { draftId: draft.draft.id, step: "1" },
        });
      });
    },
    [businessId, router, runAction],
  );

  const duplicateEntry = useCallback(
    async (entry: RecipeFirstLibraryEntry) => {
      if (!businessId || !entry.activeVersionId) {
        Alert.alert(
          "Cannot duplicate yet",
          "Complete and publish this Recipe before duplicating it.",
        );
        return;
      }
      await runAction(async () => {
        const copy = await duplicateRecipeFirstItem({
          businessId,
          branchId,
          sourceVersionId: entry.activeVersionId as string,
          name: `${entry.name} copy`,
        });
        setActions(null);
        router.push({
          pathname: "/owner/recipe-editor" as never,
          params: { draftId: copy.draft.id, step: "1" },
        });
      });
    },
    [branchId, businessId, router, runAction],
  );

  const confirmArchive = useCallback(
    (entry: RecipeFirstLibraryEntry) => {
      if (!businessId) return;
      setActions(null);
      Alert.alert(
        `Archive ${entry.name}?`,
        "It will leave the primary library and Kiosk while historical records remain unchanged.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Archive Item",
            style: "destructive",
            onPress: () =>
              void runAction(async () => {
                await archiveRecipeFirstItem({
                  businessId,
                  catalogItemId: entry.catalogItemId,
                  ownerAuthorized: true,
                });
                await refresh();
                setSnackbar(`${entry.name} archived`);
              }),
          },
        ],
      );
    },
    [businessId, refresh, runAction],
  );

  const confirmDelete = useCallback(
    (entry: RecipeFirstLibraryEntry) => {
      if (!businessId) return;
      setActions(null);
      Alert.alert(
        `Permanently delete ${entry.name}?`,
        "Delete is allowed only for an unused native draft. Purchases, references, production, sales, and other history block deletion.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete Unused Draft",
            style: "destructive",
            onPress: () =>
              void runAction(async () => {
                await deleteRecipeFirstItem({
                  businessId,
                  catalogItemId: entry.catalogItemId,
                  ownerAuthorized: true,
                });
                await refresh();
                setSnackbar(`${entry.name} deleted`);
              }),
          },
        ],
      );
    },
    [businessId, refresh, runAction],
  );

  const createFab = (
    <View style={styles.fabWrap}>
      <Pressable
        accessibilityHint="Choose between creating a Recipe and producing an existing Recipe"
        accessibilityLabel="Open Recipe actions"
        accessibilityRole="button"
        onPress={() => setActions({ kind: "create" })}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: pressed ? extended.primaryPressed : palette.primary,
          },
        ]}
      >
        <Ionicons color={palette.kioskHeaderText} name="add" size={29} />
      </Pressable>
    </View>
  );

  return (
    <>
      <ScreenScroll bottomNav floatingFooter={createFab}>
        <View />
        <AppTopBar
          eyebrow="Tindahan"
          subtitle="Gumawa, kumpletuhin, at ihanda para sa Production"
          title="Recipe"
        />
        <TindahanTabs active="recipes" />

        {attentionEntries.length > 0 ? (
          <GabiCard>
            <GabiSectionHeader title="Unahin ito" />
            <View style={styles.attentionList}>
              {attentionEntries.map((entry) => {
                const view = cardView(entry);
                return (
                  <Pressable
                    accessibilityLabel={`${entry.name}. ${view.primaryActionLabel}`}
                    accessibilityRole="button"
                    key={entry.catalogItemId}
                    onPress={() => void openEntry(entry)}
                    style={styles.attentionRow}
                  >
                    <View style={[styles.attentionIcon, { backgroundColor: palette.softWarning }]}>
                      <Ionicons color={palette.warning} name={view.isDraft ? "document-text-outline" : "alert-circle-outline"} size={19} />
                    </View>
                    <View style={styles.attentionCopy}>
                      <GabiText numberOfLines={1} variant="buttonSm">{entry.name}</GabiText>
                      <GabiText numberOfLines={2} tone="warning" variant="caption">
                        {view.isDraft ? "Draft pa — ituloy ang Recipe." : view.costStatus === "no_price" ? "May sangkap na walang presyo." : "May kailangang kumpletuhin bago mag-production."}
                      </GabiText>
                    </View>
                    <GabiText tone="primary" variant="buttonSm">{view.isDraft ? "Ituloy" : "Ayusin"}</GabiText>
                    <Ionicons color={palette.primary} name="chevron-forward" size={16} />
                  </Pressable>
                );
              })}
            </View>
          </GabiCard>
        ) : null}

        <View
          style={[
            styles.search,
            { backgroundColor: extended.field, borderColor: palette.border },
          ]}
        >
          <Ionicons color={palette.mutedText} name="search" size={20} />
          <TextInput
            accessibilityLabel="Hanapin sa Recipe"
            onChangeText={setSearch}
            placeholder="Hanapin ang Recipe o sangkap"
            placeholderTextColor={extended.textFaint}
            style={[styles.searchInput, { color: palette.text }]}
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="Clear Recipe Book search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setSearch("")}
            >
              <Ionicons
                color={palette.mutedText}
                name="close-circle"
                size={20}
              />
            </Pressable>
          ) : null}
        </View>

        <RecipeLibraryFilters
          costFilter={costFilter}
          group={group}
          onChangeCostFilter={setCostFilter}
          onChangeGroup={setGroup}
        />

        {loadError ? (
          <GabiNotice message={loadError} tone="danger" />
        ) : null}
        {!businessId ? (
          <GabiCard>
            <GabiEmptyState
              icon="storefront-outline"
                  message="Pumili muna ng negosyo sa Owner context."
                  title="Walang napiling negosyo"
            />
          </GabiCard>
        ) : null}
        {loading ? (
          <GabiCard>
            <GabiText tone="muted" variant="body">
              Binabasa ang Recipe…
            </GabiText>
          </GabiCard>
        ) : null}
        {!loading && businessId && filtered.length === 0 ? (
          <GabiCard>
            <GabiEmptyState
              icon={search ? "search-outline" : "restaurant-outline"}
              message={
                search || group !== "all" || costFilter !== "all"
                  ? "Try another search or filter."
                  : "Use the + button to create a cooked or prepared product directly from this Recipe Book."
              }
              title={
                search || group !== "all" || costFilter !== "all"
                  ? "Walang nahanap"
                  : "Wala pang Recipe"
              }
            />
          </GabiCard>
        ) : null}

        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <GabiText variant="h2">{section.title}</GabiText>
              <GabiText tone="muted" variant="caption">
                {section.items.length}
              </GabiText>
            </View>
            {section.items.map((entry) => {
              const view = cardView(entry);
              return (
                <RecipeLibraryCard
                  highlighted={entry.catalogItemId === publishedItemId}
                  item={view}
                  key={entry.catalogItemId}
                  onMoreActions={() =>
                    setActions({ kind: "item", entry })
                  }
                  onOpen={() => void openEntry(entry)}
                  onProduce={
                    view.productionReady && entry.activeRecipeId
                      ? () =>
                          router.push({
                            pathname: "/owner/production",
                            params: { recipeId: entry.activeRecipeId },
                          })
                      : undefined
                  }
                />
              );
            })}
          </View>
        ))}
      </ScreenScroll>

      <Modal
        animationType="slide"
        onRequestClose={() => setActions(null)}
        transparent
        visible={actions !== null}
      >
        <Pressable
          accessibilityLabel="Close Recipe actions"
          accessibilityRole="button"
          onPress={() => setActions(null)}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: palette.background,
                paddingBottom: insets.bottom + spacing.md,
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <GabiText tone="primary" variant="eyebrow">
                  Recipe Book
                </GabiText>
                <GabiText variant="h2">
                  {actions?.kind === "create"
                    ? "What would you like to do?"
                    : actions?.kind === "item"
                      ? actions.entry.name
                      : ""}
                </GabiText>
              </View>
              <GabiIconButton
                accessibilityLabel="Close Recipe actions"
                icon="close"
                onPress={() => setActions(null)}
              />
            </View>

            {actions?.kind === "create" ? (
              <View style={styles.sheetActions}>
                <GabiPrimaryButton
                  icon="create-outline"
                  label="Gumawa ng bagong Recipe"
                  onPress={() => {
                    setActions(null);
                    router.push("/owner/recipe-editor" as never);
                  }}
                />
                <GabiSoftButton
                  icon="restaurant-outline"
                  label="Mag-production mula sa Recipe"
                  onPress={() => {
                    setActions(null);
                    router.push("/owner/production");
                  }}
                />
                <GabiText tone="muted" variant="caption">
                  Recipe-backed items are produced in Niluto. Manual “dagdag
                  luto” without ingredient deduction is only for legacy
                  compatibility items in Paninda.
                </GabiText>
              </View>
            ) : null}

            {actions?.kind === "item" ? (
              <ScrollView
                contentContainerStyle={styles.sheetActions}
                showsVerticalScrollIndicator={false}
              >
                <GabiPrimaryButton
                  icon={
                    actions.entry.sourceType !== "native" &&
                    actions.entry.activeRecipeId
                      ? "document-text-outline"
                      : actions.entry.draftId ||
                          actions.entry.activeVersionId
                      ? "create-outline"
                      : actions.entry.ingredientId
                        ? "basket-outline"
                        : "cube-outline"
                  }
                  label={cardView(actions.entry).primaryActionLabel}
                  loading={busy}
                  onPress={() => void openEntry(actions.entry)}
                />
                {actions.entry.draftId || actions.entry.activeVersionId ? (
                  <GabiSoftButton
                    disabled={!actions.entry.activeVersionId}
                    icon="copy-outline"
                    label="Duplicate Recipe"
                    loading={busy}
                    onPress={() => void duplicateEntry(actions.entry)}
                  />
                ) : null}
                {actions.entry.classification === "prepared_base" &&
                actions.entry.activeCostSource === "owner_estimate" &&
                actions.entry.draftId ? (
                  <GabiSoftButton
                    icon="flask-outline"
                    label="Create or Complete Batch Recipe"
                    onPress={() => void openEntry(actions.entry)}
                  />
                ) : null}
                {actions.entry.sourceType === "native" &&
                (actions.entry.draftId || actions.entry.activeVersionId) &&
                actions.entry.lifecycle !== "archived" ? (
                  <GabiSoftButton
                    icon="archive-outline"
                    label="Archive Item"
                    onPress={() => confirmArchive(actions.entry)}
                  />
                ) : null}
                {actions.entry.sourceType === "native" &&
                actions.entry.lifecycle === "draft" ? (
                  <>
                    <GabiSoftButton
                      icon="trash-outline"
                      label="Delete Unused Draft"
                      onPress={() => confirmDelete(actions.entry)}
                    />
                    <GabiText tone="faint" variant="caption">
                      Permanent delete is blocked when purchases, Recipe
                      references, production, sales, bundles, adjustments, or
                      other history exist.
                    </GabiText>
                  </>
                ) : null}
                {!actions.entry.draftId &&
                !actions.entry.activeVersionId ? (
                  <GabiNotice
                    message={
                      actions.entry.ingredientId
                        ? "Manage this recorded ingredient and its purchase lots in Grocery."
                        : "Manage this direct-resale or legacy selling item in Paninda."
                    }
                    tone="owner"
                  />
                ) : null}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {snackbar ? (
        <View
          style={[
            styles.snackbar,
            { bottom: insets.bottom + spacing.lg },
          ]}
        >
          <GabiSnackbar
            message={snackbar}
            onDismiss={() => setSnackbar(null)}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  attentionList: {
    gap: spacing.xs,
  },
  attentionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 60,
    paddingVertical: spacing.sm,
  },
  attentionIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  attentionCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  search: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 52,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  fabWrap: {
    alignItems: "flex-end",
  },
  fab: {
    alignItems: "center",
    borderRadius: 29,
    elevation: 5,
    height: 58,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    width: 58,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.45)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: spacing.md,
    maxHeight: "84%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#9CA3AF",
    borderRadius: 3,
    height: 5,
    width: 42,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sheetActions: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  snackbar: {
    left: spacing.lg,
    position: "absolute",
    right: spacing.lg,
    zIndex: 8,
  },
});
