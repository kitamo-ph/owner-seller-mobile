import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { GabiText } from "@/components/gabi/GabiText";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type RecipeLibraryGroup =
  | "all"
  | "recipes"
  | "prepared"
  | "ingredients"
  | "selling"
  | "resale"
  | "drafts"
  | "archived";

export type RecipeLibraryCostFilter =
  | "all"
  | "actual"
  | "estimated"
  | "no_price"
  | "incomplete";

const groups: {
  value: RecipeLibraryGroup;
  label: string;
  icon: IoniconName;
}[] = [
  { value: "all", label: "Lahat", icon: "apps-outline" },
  { value: "selling", label: "Handa ibenta", icon: "pricetag-outline" },
  { value: "prepared", label: "Tinimpla", icon: "flask-outline" },
  { value: "drafts", label: "Draft", icon: "document-text-outline" },
  { value: "ingredients", label: "Sangkap", icon: "leaf-outline" },
  { value: "resale", label: "Biniling paninda", icon: "basket-outline" },
  { value: "recipes", label: "May kulang", icon: "alert-circle-outline" },
  { value: "archived", label: "Naka-archive", icon: "archive-outline" },
];

const costFilters: {
  value: RecipeLibraryCostFilter;
  label: string;
}[] = [
  { value: "all", label: "Lahat ng cost" },
  { value: "actual", label: "Aktwal" },
  { value: "estimated", label: "Tantiya" },
  { value: "no_price", label: "Walang presyo" },
  { value: "incomplete", label: "May kulang" },
];

function FilterButton({
  icon,
  label,
  selected,
  onPress,
}: {
  icon?: IoniconName;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette, extended } = useGabiTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterButton,
        {
          backgroundColor: selected
            ? palette.softPrimary
            : pressed
              ? extended.neutralChipBg
              : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          color={selected ? palette.primary : palette.mutedText}
          name={icon}
          size={18}
        />
      ) : null}
      <GabiText
        tone={selected ? "primary" : "muted"}
        variant="buttonSm"
      >
        {label}
      </GabiText>
    </Pressable>
  );
}

export function RecipeLibraryFilters({
  group,
  costFilter,
  onChangeGroup,
  onChangeCostFilter,
}: {
  group: RecipeLibraryGroup;
  costFilter: RecipeLibraryCostFilter;
  onChangeGroup: (group: RecipeLibraryGroup) => void;
  onChangeCostFilter: (filter: RecipeLibraryCostFilter) => void;
}) {
  return (
    <View style={styles.container}>
      <GabiText variant="buttonSm">Ipakita</GabiText>
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {groups.map((option) => (
          <FilterButton
            icon={option.icon}
            key={option.value}
            label={option.label}
            onPress={() => onChangeGroup(option.value)}
            selected={group === option.value}
          />
        ))}
      </ScrollView>

      <GabiText variant="buttonSm">Kalagayan ng cost</GabiText>
      <ScrollView
        contentContainerStyle={styles.row}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {costFilters.map((option) => (
          <FilterButton
            key={option.value}
            label={option.label}
            onPress={() => onChangeCostFilter(option.value)}
            selected={costFilter === option.value}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  row: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterButton: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
