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
  if (item.costStatus === "actual") return "Aktwal na cost";
  if (item.costStatus === "estimated") return "Tantiyang cost";
  if (item.costStatus === "no_price") return "Walang presyo";
  return "May kulang sa cost";
}

export function RecipeLibraryCard({
  item,
  onOpen,
  onProduce,
  onMoreActions,
  highlighted = false,
}: {
  item: RecipeLibraryCardView;
  onOpen: () => void;
  onProduce?: () => void;
  onMoreActions: () => void;
  highlighted?: boolean;
}) {
  const { palette } = useGabiTheme();

  return (
    <GabiCard
      raised
      style={
        highlighted
          ? { borderColor: palette.primary, borderWidth: 2 }
          : undefined
      }
    >
      {highlighted ? (
        <GabiChip
          icon="checkmark-circle-outline"
          label="Handa na ang Recipe"
          tone="success"
        />
      ) : null}
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
          <GabiChip label="May tantiyang sangkap" tone="warning" />
        ) : null}
        {item.missingInformation ? (
          <GabiChip label="May kulang" tone="danger" />
        ) : null}
      </View>

      <View style={styles.moneyRow}>
        <View style={styles.metric}>
          <GabiText tone="faint" variant="eyebrow">
            Cost kada unit
          </GabiText>
          <GabiText money variant="cardTitle">
            {item.unitCost === null
              ? "Hindi pa makwenta"
              : `${formatPeso(item.unitCost)}/${item.unitLabel}`}
          </GabiText>
        </View>
        <View style={styles.metric}>
          <GabiText tone="faint" variant="eyebrow">
            Presyo ng benta
          </GabiText>
          <GabiText money variant="cardTitle">
            {item.sellingPrice === null
              ? "Walang presyo"
              : formatPeso(item.sellingPrice)}
          </GabiText>
        </View>
      </View>

      <View style={styles.readiness}>
        <GabiText
          tone={item.productionReady ? "success" : "warning"}
          variant="caption"
        >
          {item.productionReady ? "Handa sa Production" : "Hindi pa handa sa Production"}
        </GabiText>
        <GabiText
          tone={item.kioskReady ? "success" : "muted"}
          variant="caption"
        >
          {item.kioskReady ? "Handa sa Benta" : "Hindi pa handa sa Benta"}
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
              label="Mag-production"
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
