import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { formatQuantity } from "@/components/ui/KitaMoUI";
import type { MakeableResult } from "@/domain/recipeCosting";
import type { IngredientUnit, RecipeProductionMode } from "@/domain/types";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export function RecipeMakeableCard({
  makeable,
  outputUnit,
  productionMode,
  compact = false,
}: {
  makeable: MakeableResult;
  outputUnit: IngredientUnit;
  productionMode: RecipeProductionMode;
  compact?: boolean;
}) {
  const { palette, extended } = useGabiTheme();

  if (productionMode === "cook_upon_order") {
    return (
      <View style={[styles.card, compact ? styles.compact : null, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name="flash-outline" size={compact ? 17 : 20} />
        <View style={styles.copy}>
          <GabiText tone="primary" variant="buttonSm">Cook upon order</GabiText>
          <GabiText style={{ color: extended.violetChipText }} variant="caption">
            Hindi kailangang i-produce. Kinukuwenta at ibinabawas ang sangkap sa bawat Kiosk sale.
          </GabiText>
        </View>
      </View>
    );
  }

  if (!makeable.stockLimited) {
    return (
      <View style={[styles.card, compact ? styles.compact : null, { backgroundColor: palette.softWarning }]}>
        <Ionicons color={palette.warning} name="information-circle-outline" size={compact ? 17 : 20} />
        <View style={styles.copy}>
          <GabiText tone="warning" variant="buttonSm">Walang stock limit na makukuwenta</GabiText>
          <GabiText style={{ color: extended.warningDeep }} variant="caption">
            Custom cost lang ang recipe na ito. Kasama sa puhunan, pero hindi sa grocery stock math.
          </GabiText>
        </View>
      </View>
    );
  }

  const batches = makeable.batches ?? 0;
  const units = makeable.units ?? 0;
  const blocked = batches <= 0;
  const backgroundColor = blocked ? palette.softDanger : batches <= 1 ? palette.softWarning : palette.softSuccess;
  const foreground = blocked ? extended.dangerDeep : batches <= 1 ? extended.warningDeep : extended.successDeep;

  return (
    <View style={[styles.card, compact ? styles.compact : null, { backgroundColor }]}>
      <Ionicons color={foreground} name={blocked ? "alert-circle-outline" : "restaurant-outline"} size={compact ? 17 : 20} />
      <View style={styles.copy}>
        <GabiText style={{ color: foreground }} variant="buttonSm">
          {blocked
            ? "Hindi pa kayang lutuin"
            : `Kaya pang lutuin: ${formatQuantity(batches)} batch (${formatQuantity(units)} ${outputUnit})`}
        </GabiText>
        {makeable.bottleneckLabel ? (
          <GabiText style={{ color: foreground }} variant="caption">
            {blocked ? "Kulang sa" : "Unang mauubos"}: {makeable.bottleneckLabel}
          </GabiText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "flex-start",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  compact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
