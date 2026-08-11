import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiChip } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { inheritLocationRef } from "@/domain/onboarding";
import type { Branch } from "@/domain/types";
import type { LocationProviderAvailability } from "@/services/locationProvider";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GuidedField, GuidedFieldLabel } from "./GuidedField";
import { LocationPickerField, LocationSummary } from "./LocationPickerField";
import type {
  StallBusinessOption,
  StallDetailsErrors,
  StallDetailsField,
  StallDetailsFormValue,
} from "./types";

const branchTypes: readonly { value: Branch["branchType"]; label: string }[] = [
  { value: "stall", label: "Puwesto" },
  { value: "branch", label: "Branch" },
  { value: "kiosk", label: "Kiosk" },
  { value: "booth", label: "Booth" },
  { value: "home kitchen", label: "Home kitchen" },
  { value: "pop-up", label: "Pop-up" },
];

export type StallDetailsFormProps = {
  value: StallDetailsFormValue;
  businesses: readonly StallBusinessOption[];
  onChange: (value: StallDetailsFormValue) => void;
  onBusinessChange?: (businessId: string) => void;
  onBlurField?: (field: StallDetailsField) => void;
  errors?: StallDetailsErrors;
  disabled?: boolean;
  preselectedBusinessId?: string | null;
  locationProviderStatus?: LocationProviderAvailability;
  onOpenLocationProvider?: () => void;
  introMessage?: string;
};

export function StallDetailsForm({
  value,
  businesses,
  onChange,
  onBusinessChange,
  onBlurField,
  errors = {},
  disabled = false,
  preselectedBusinessId,
  locationProviderStatus = "not_configured",
  onOpenLocationProvider,
  introMessage,
}: StallDetailsFormProps) {
  const { palette, extended } = useGabiTheme();
  const selectedBusiness = businesses.find((business) => business.id === value.businessId) ?? null;
  const inheritedLocation = selectedBusiness?.locationRef ?? null;

  function update<K extends keyof StallDetailsFormValue>(key: K, nextValue: StallDetailsFormValue[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  function selectBusiness(business: StallBusinessOption) {
    const nextLocation = value.inheritsBusinessLocation
      ? business.locationRef
        ? inheritLocationRef(business.locationRef)
        : null
      : value.locationRef;
    onChange({ ...value, businessId: business.id, locationRef: nextLocation });
    onBusinessChange?.(business.id);
    onBlurField?.("business");
  }

  function toggleInheritedLocation() {
    if (disabled || !selectedBusiness) return;
    const inheritsBusinessLocation = !value.inheritsBusinessLocation;
    onChange({
      ...value,
      inheritsBusinessLocation,
      locationRef:
        inheritsBusinessLocation && selectedBusiness.locationRef
          ? inheritLocationRef(selectedBusiness.locationRef)
          : value.locationRef,
    });
    onBlurField?.("location");
  }

  return (
    <View style={styles.form}>
      {introMessage ? <GabiNotice message={introMessage} tone="owner" /> : null}

      <View style={styles.intro}>
        <GabiText variant="h1">Isang stall na lang at tapos na!</GabiText>
        <GabiText tone="muted" variant="body">
          Ang stall ay ang puwesto, branch, cart, o lugar kung saan ka nagbebenta.
        </GabiText>
      </View>

      <GuidedField
        autoCapitalize="words"
        disabled={disabled}
        errorMessage={errors.stallName}
        label="Pangalan ng stall"
        maxLength={60}
        onBlur={() => onBlurField?.("stallName")}
        onChangeText={(stallName) => update("stallName", stallName)}
        placeholder="Main Stall"
        required
        returnKeyType="next"
        showValidState
        value={value.stallName}
      />

      <View style={styles.fieldWrap}>
        <GuidedFieldLabel label="Negosyo" required />
        {businesses.length ? (
          <View accessibilityRole="radiogroup" style={styles.businessList}>
            {businesses.map((business) => {
              const selected = business.id === value.businessId;
              const preselected = business.id === preselectedBusinessId;
              return (
                <Pressable
                  accessibilityLabel={business.name}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  key={business.id}
                  onPress={() => selectBusiness(business)}
                  style={({ pressed }) => [
                    styles.businessOption,
                    {
                      backgroundColor: disabled
                        ? extended.disabledBg
                        : selected || pressed
                          ? palette.softPrimary
                          : palette.surface,
                      borderColor: disabled
                        ? extended.disabledBg
                        : selected
                          ? palette.primary
                          : palette.border,
                    },
                  ]}
                >
                  <View style={[styles.businessIcon, { backgroundColor: selected ? palette.primary : palette.softPrimary }]}>
                    <Ionicons
                      color={selected ? palette.kioskHeaderText : palette.primary}
                      name="storefront-outline"
                      size={19}
                    />
                  </View>
                  <View style={styles.businessCopy}>
                    <GabiText numberOfLines={1} variant="buttonSm">{business.name}</GabiText>
                    <GabiText numberOfLines={2} tone="muted" variant="caption">
                      {business.locationRef?.formattedAddress ?? "Wala pang saved na lokasyon"}
                    </GabiText>
                  </View>
                  {preselected ? <GabiChip label="galing dito" tone="primary" /> : null}
                  <View style={[styles.radio, { borderColor: selected ? palette.primary : extended.radioOff }]}>
                    {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <GabiNotice message="Gumawa muna ng negosyo bago magdagdag ng stall." title="Walang mapipiling negosyo" tone="warning" />
        )}
        {errors.business ? <GabiText accessibilityLiveRegion="polite" tone="danger" variant="caption">{errors.business}</GabiText> : null}
      </View>

      <View style={styles.fieldWrap}>
        <GuidedFieldLabel label="Lokasyon ng stall" required />
        <Pressable
          accessibilityLabel="Kapareho ng lokasyon ng negosyo"
          accessibilityRole="switch"
          accessibilityState={{ checked: value.inheritsBusinessLocation, disabled: disabled || !selectedBusiness }}
          disabled={disabled || !selectedBusiness}
          onPress={toggleInheritedLocation}
          style={[
            styles.inheritanceRow,
            {
              backgroundColor: disabled || !selectedBusiness
                ? extended.disabledBg
                : value.inheritsBusinessLocation
                  ? palette.softPrimary
                  : palette.surface,
              borderColor: disabled || !selectedBusiness
                ? extended.disabledBg
                : value.inheritsBusinessLocation
                  ? palette.primary
                  : palette.border,
            },
          ]}
        >
          <View style={styles.inheritanceCopy}>
            <GabiText style={disabled || !selectedBusiness ? { color: extended.disabledText } : undefined} variant="buttonSm">
              Kapareho ng lokasyon ng negosyo
            </GabiText>
            <GabiText style={disabled || !selectedBusiness ? { color: extended.disabledText } : undefined} tone="muted" variant="caption">
              {selectedBusiness
                ? "Naka-on = hindi mo na kailangang i-type ulit."
                : "Pumili muna ng negosyo sa itaas."}
            </GabiText>
          </View>
          <View pointerEvents="none">
            <Switch
              thumbColor={palette.surface}
              trackColor={{ false: palette.border, true: palette.primary }}
              value={value.inheritsBusinessLocation}
            />
          </View>
        </Pressable>

        {value.inheritsBusinessLocation ? (
          inheritedLocation ? (
            <LocationSummary inherited value={inheritedLocation} />
          ) : (
            <GabiNotice
              message="Walang lokasyong mamanahin. Ayusin ang lokasyon ng negosyo o patayin ang toggle at mag-type ng address."
              title="Walang saved na business location"
              tone="warning"
            />
          )
        ) : (
          <LocationPickerField
            disabled={disabled}
            error={errors.location}
            label="Ibang lokasyon ng stall"
            onBlur={() => onBlurField?.("location")}
            onChange={(locationRef) => update("locationRef", locationRef)}
            onOpenProvider={onOpenLocationProvider}
            providerStatus={locationProviderStatus}
            value={value.locationRef}
          />
        )}
        {value.inheritsBusinessLocation && errors.location ? (
          <GabiText accessibilityLiveRegion="polite" tone="danger" variant="caption">{errors.location}</GabiText>
        ) : null}
      </View>

      <View style={styles.fieldWrap}>
        <GuidedFieldLabel label="Uri" showOptionalBadge />
        <View style={styles.typeChoices}>
          {branchTypes.map((option) => {
            const selected = value.branchType === option.value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                key={option.value}
                onPress={() => {
                  update("branchType", option.value);
                  onBlurField?.("branchType");
                }}
                style={[
                  styles.typeChoice,
                  {
                    backgroundColor: disabled
                      ? extended.disabledBg
                      : selected
                        ? palette.primary
                        : palette.surface,
                    borderColor: disabled
                      ? extended.disabledBg
                      : selected
                        ? palette.primary
                        : palette.border,
                  },
                ]}
              >
                <GabiText style={{ color: disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.text }} variant="caption">
                  {option.label}
                </GabiText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <GuidedField
        disabled={disabled}
        label="Paalala"
        maxLength={500}
        multiline
        onBlur={() => onBlurField?.("notes")}
        onChangeText={(notes) => update("notes", notes)}
        placeholder="Hal. sa tapat ng palengke, bukas ng gabi"
        value={value.notes}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.lg,
  },
  intro: {
    gap: spacing.xs,
  },
  fieldWrap: {
    gap: spacing.sm,
  },
  businessList: {
    gap: spacing.sm,
  },
  businessOption: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 66,
    padding: spacing.sm,
  },
  businessIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  businessCopy: {
    flex: 1,
    gap: 2,
  },
  radio: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  radioDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  inheritanceRow: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 68,
    padding: spacing.sm,
  },
  inheritanceCopy: {
    flex: 1,
    gap: 2,
  },
  typeChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  typeChoice: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
