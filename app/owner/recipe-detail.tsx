import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { RecipeMakeableCard } from "@/components/owner/RecipeMakeableCard";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { loadRecipesOverview, type RecipeOverviewItem } from "@/services/recipes";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function OwnerRecipeDetailScreen() {
  const { recipeId } = useLocalSearchParams<{ recipeId?: string }>();
  const router = useRouter();
  const { palette, extended } = useGabiTheme();
  const [item, setItem] = useState<RecipeOverviewItem | null>(null);
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextOverview, nextStatus] = await Promise.all([loadRecipesOverview(), loadOwnerSetupStatus()]);
    setItem(nextOverview.items.find((candidate) => candidate.recipe.id === recipeId) ?? null);
    setStatus(nextStatus);
  }, [recipeId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoaded(false);
      void refresh()
        .then(() => {
          if (active) setLoadError(null);
        })
        .catch((error) => {
          logDevError("OwnerRecipeDetail.refresh", error);
          if (active) setLoadError(getFriendlyErrorMessage("Hindi ma-load ang recipe detail."));
        })
        .finally(() => {
          if (active) setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  const product = useMemo(
    () => status?.products.find((candidate) => candidate.id === item?.recipe.outputProductId) ?? null,
    [item?.recipe.outputProductId, status?.products],
  );
  const advisoryPrice = item?.recipe.suggestedSellingPrice ?? product?.price ?? null;
  const unitProfit = item && advisoryPrice !== null ? advisoryPrice - item.costPerOutputUnit : null;
  const marginPercent = unitProfit !== null && advisoryPrice && advisoryPrice > 0 ? (unitProfit / advisoryPrice) * 100 : null;
  const canProduce =
    item?.recipe.productionMode === "prepared_before_selling" &&
    item.lines.length > 0 &&
    (!item.makeable.stockLimited || (item.makeable.batches ?? 0) > 0);

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        backHref="/owner/recipes"
        eyebrow={status?.activeBusiness?.businessName ? `Recipe · ${status.activeBusiness.businessName}` : "Recipe detail"}
        subtitle="Saan nanggaling ang bawat piso"
        title={item?.recipe.name ?? "Recipe detail"}
      />

      {loadError ? (
        <GabiNotice message={loadError} title="Hindi ma-load ang local recipe" tone="danger" />
      ) : null}

      {!loaded ? (
        <GabiCard>
          <GabiSkeleton height={72} showImmediately />
          <GabiSkeleton height={140} showImmediately />
          <GabiSkeleton height={64} showImmediately />
        </GabiCard>
      ) : null}

      {loaded && !item ? (
        <GabiCard>
          <GabiEmptyState
            actionLabel="Bumalik sa Recipes"
            icon="restaurant-outline"
            message="Maaaring na-archive o wala na sa kasalukuyang negosyo ang recipe na ito."
            onAction={() => router.replace("/owner/recipes")}
            title="Hindi makita ang recipe"
          />
        </GabiCard>
      ) : null}

      {item ? (
        <>
          <View style={styles.modeRow}>
            <GabiChip
              icon={item.recipe.productionMode === "cook_upon_order" ? "flash-outline" : "restaurant-outline"}
              label={item.recipe.productionMode === "cook_upon_order" ? "Cook upon order" : "Prepared before selling"}
              tone={item.recipe.productionMode === "cook_upon_order" ? "primary" : "accent"}
            />
            {!item.recipe.isActive ? <GabiChip label="Archived" tone="neutral" /> : null}
          </View>

          <GabiCard raised>
            <View style={styles.costHero}>
              <View style={styles.costHeroMain}>
                <GabiText tone="faint" variant="eyebrow">Puhunan bawat {item.recipe.outputUnit}</GabiText>
                <GabiText money tone="primary" variant="heroPeso">{formatPeso(item.costPerOutputUnit)}</GabiText>
                <GabiText tone="muted" variant="caption">
                  {formatPeso(item.batchCost)} bawat batch · {formatQuantity(item.recipe.outputQuantity)} {item.recipe.outputUnit}
                </GabiText>
              </View>
              <View style={styles.priceCopy}>
                <GabiText tone="muted" variant="caption">
                  {item.recipe.suggestedSellingPrice !== null ? "Suggested price" : "Presyo ng paninda"}
                </GabiText>
                <GabiText money variant="h2">{advisoryPrice !== null ? formatPeso(advisoryPrice) : "Wala pa"}</GabiText>
                {unitProfit !== null ? (
                  <GabiChip
                    label={`${unitProfit >= 0 ? "Tubo" : "Lugi"} ${formatPeso(Math.abs(unitProfit))}${marginPercent !== null ? ` · ${Math.abs(marginPercent).toFixed(1)}%` : ""}`}
                    tone={unitProfit >= 0 ? "success" : "danger"}
                  />
                ) : null}
              </View>
            </View>
            <GabiNotice
              message="Advisory lang ang presyong ito. Hindi babaguhin ng recipe ang selling price ng paninda."
              tone="owner"
            />
          </GabiCard>

          <GabiCard>
            <GabiSectionHeader
              action={<GabiChip label={`${item.lines.length} linya`} tone="neutral" />}
              title="Mga sangkap at lot"
            />
            <View style={styles.lineList}>
              {item.lines.map((line) => (
                <View key={line.id} style={[styles.lineRow, { borderBottomColor: palette.border }]}>
                  <View style={[styles.lineIcon, { backgroundColor: line.isCustom ? extended.neutralChipBg : palette.softPrimary }]}>
                    <Ionicons
                      color={line.isCustom ? palette.mutedText : palette.primary}
                      name={line.isCustom ? "calculator-outline" : "cube-outline"}
                      size={18}
                    />
                  </View>
                  <View style={styles.lineCopy}>
                    <GabiText variant="buttonSm">
                      {line.sourceLabelSnapshot ?? line.customName ?? "Ingredient"}
                    </GabiText>
                    <View style={styles.inlineMeta}>
                      {line.isCustom ? <GabiChip label="Custom cost" tone="neutral" /> : null}
                      <GabiText tone="muted" variant="caption">
                        {line.isCustom
                          ? "Hindi kasama sa stock math"
                          : `${formatQuantity(line.quantity)} ${line.unit} · snapshot ${formatPeso(line.costPerUnitSnapshot ?? 0)}/${line.unit}`}
                      </GabiText>
                    </View>
                  </View>
                  <GabiText money variant="metricValue">{formatPeso(line.lineCostSnapshot)}</GabiText>
                </View>
              ))}
            </View>
            <View style={[styles.batchTotal, { borderTopColor: palette.border }]}>
              <GabiText variant="buttonSm">Batch ({formatQuantity(item.recipe.outputQuantity)} {item.recipe.outputUnit})</GabiText>
              <GabiText money variant="h2">{formatPeso(item.batchCost)}</GabiText>
            </View>
          </GabiCard>

          <RecipeMakeableCard
            makeable={item.makeable}
            outputUnit={item.recipe.outputUnit}
            productionMode={item.recipe.productionMode}
          />

          {item.recipe.notes ? (
            <GabiCard>
              <GabiText variant="h2">Notes</GabiText>
              <GabiText tone="muted" variant="body">{item.recipe.notes}</GabiText>
            </GabiCard>
          ) : null}

          {item.recipe.productionMode === "prepared_before_selling" ? (
            <>
              <GabiPrimaryButton
                disabled={!canProduce}
                icon="restaurant-outline"
                label="Magluto nito"
                onPress={() => router.push({ pathname: "/owner/production", params: { recipeId: item.recipe.id } })}
              />
              {!canProduce ? (
                <GabiText tone="danger" variant="caption">
                  Ayusin muna ang kulang o incompatible na grocery lot bago mag-production.
                </GabiText>
              ) : null}
            </>
          ) : (
            <GabiSoftButton
              icon="storefront-outline"
              label="Pumili ng stall para sa Kiosk"
              onPress={() => router.push("/kiosk")}
            />
          )}

          <View style={[styles.snapshotNote, { borderColor: palette.border }]}>
            <Ionicons color={palette.primary} name="shield-checkmark-outline" size={18} />
            <GabiText tone="muted" variant="caption" style={styles.snapshotCopy}>
              Bawat luto at benta ay gumagamit ng saved cost snapshot. Hindi nagbabago ang lumang record kapag nagbago ang presyo ng grocery.
            </GabiText>
          </View>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  costHero: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
  },
  costHeroMain: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 170,
  },
  priceCopy: {
    alignItems: "flex-end",
    gap: spacing.xs,
    minWidth: 120,
  },
  lineList: {
    gap: 0,
  },
  lineRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingVertical: spacing.sm,
  },
  lineIcon: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  lineCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  inlineMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  batchTotal: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  snapshotNote: {
    alignItems: "flex-start",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  snapshotCopy: {
    flex: 1,
  },
});
