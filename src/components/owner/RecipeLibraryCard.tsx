import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiCard, GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { formatPeso } from "@/components/ui/KitaMoUI";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

export type RecipeLibraryCardView = {
  id: string;
  name: string;
  classificationLabel: string;
  statusLabel: string;
  sellingPrice: number | null;
  costStatus: "actual" | "estimated" | "no_price" | "incomplete";
  unitCost: number | null;
  unitLabel: string;
  productionReady: boolean;
  kioskReady: boolean;
  isDraft: boolean;
  isArchived: boolean;
  usesEstimatedInput: boolean;
  missingInformation: boolean;
  primaryActionLabel: string;
};

function costLabel(item: RecipeLibraryCardView) {
  if (item.costStatus === "actual") return "Actual cost";
  if (item.costStatus === "estimated") return "Estimated cost";
  if (item.costStatus === "no_price") return "No price yet";
  return "Cost incomplete";
}

function readinessLabel(ready: boolean, subject: string) {
  return ready ? `Ready for ${subject}` : `Not ready for ${subject}`;
}

export function RecipeLibraryCard({
  item,
  onOpen,
  onProduce,
  onMoreActions,
}: {
  item: RecipeLibraryCardView;
  onOpen: () => void;
  onProduce?: () => void;
  onMoreActions: () => void;
}) {
  const { palette } = useGabiTheme();

  return (
    <GabiCard raised>
      <Pressable
        accessibilityHint="Open this item in the Recipe editor"
        accessibilityLabel={`${item.name}, ${item.classificationLabel}, ${item.statusLabel}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.header,
          pressed ? { opacity: 0.72 } : null,
        ]}
      >
        <View
          style={[styles.icon, { backgroundColor: palette.softPrimary }]}
        >
          <Ionicons
            color={palette.primary}
            name={
              item.classificationLabel === "Prepared base"
                ? "flask-outline"
                : item.classificationLabel === "Ingredient"
                  ? "leaf-outline"
                  : item.classificationLabel === "Resale product"
                    ? "basket-outline"
                    : "restaurant-outline"
            }
            size={22}
          />
        </View>
        <View style={styles.headerCopy}>
          <GabiText numberOfLines={2} variant="cardTitle">
            {item.name}
          </GabiText>
          <GabiText tone="muted" variant="caption">
            {item.classificationLabel} · {item.statusLabel}
          </GabiText>
        </View>
        <Ionicons
          color={palette.mutedText}
          name="chevron-forward"
          size={20}
        />
      </Pressable>

      <View style={styles.chips}>
        <GabiChip
          icon={
            item.costStatus === "actual"
              ? "checkmark-circle-outline"
              : item.costStatus === "estimated"
                ? "calculator-outline"
                : "alert-circle-outline"
          }
          label={costLabel(item)}
          tone={
            item.costStatus === "actual"
              ? "success"
              : item.costStatus === "estimated"
                ? "warning"
                : "danger"
          }
        />
        {item.isDraft ? (
          <GabiChip
            icon="document-text-outline"
            label="Draft"
            tone="primary"
          />
        ) : null}
        {item.usesEstimatedInput ? (
          <GabiChip label="Uses an estimate" tone="warning" />
        ) : null}
        {item.missingInformation ? (
          <GabiChip label="Missing information" tone="danger" />
        ) : null}
      </View>

      <View style={styles.moneyRow}>
        <View style={styles.metric}>
          <GabiText tone="faint" variant="eyebrow">
            Unit cost
          </GabiText>
          <GabiText money variant="cardTitle">
            {item.unitCost === null
              ? "Not available"
              : `${formatPeso(item.unitCost)}/${item.unitLabel}`}
          </GabiText>
        </View>
        <View style={styles.metric}>
          <GabiText tone="faint" variant="eyebrow">
            Selling price
          </GabiText>
          <GabiText money variant="cardTitle">
            {item.sellingPrice === null
              ? "No price yet"
              : formatPeso(item.sellingPrice)}
          </GabiText>
        </View>
      </View>

      <View style={styles.readiness}>
        <GabiText
          tone={item.productionReady ? "success" : "warning"}
          variant="caption"
        >
          {readinessLabel(item.productionReady, "production")}
        </GabiText>
        <GabiText
          tone={item.kioskReady ? "success" : "muted"}
          variant="caption"
        >
          {readinessLabel(item.kioskReady, "Kiosk")}
        </GabiText>
      </View>

      <View style={styles.actions}>
        <View style={styles.action}>
          <GabiSoftButton
            compact
            icon="create-outline"
            label={item.primaryActionLabel}
            onPress={onOpen}
          />
        </View>
        {onProduce && item.productionReady ? (
          <View style={styles.action}>
            <GabiSoftButton
              compact
              icon="restaurant-outline"
              label="Produce"
              onPress={onProduce}
            />
          </View>
        ) : null}
        <Pressable
          accessibilityLabel={`More actions for ${item.name}`}
          accessibilityRole="button"
          onPress={onMoreActions}
          style={({ pressed }) => [
            styles.moreButton,
            {
              backgroundColor: pressed
                ? palette.softPrimary
                : palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <Ionicons
            color={palette.primary}
            name="ellipsis-horizontal"
            size={22}
          />
        </Pressable>
      </View>
    </GabiCard>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
  },
  icon: {
    alignItems: "center",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  moneyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    gap: 2,
    minWidth: 128,
  },
  readiness: {
    gap: spacing.xs,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
  moreButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
});
