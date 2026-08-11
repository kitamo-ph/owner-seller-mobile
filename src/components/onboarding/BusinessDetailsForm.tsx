import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiText } from "@/components/gabi/GabiText";
import { suggestBusinessType, type Turn6BusinessType } from "@/domain/onboarding";
import type { LocationProviderAvailability } from "@/services/locationProvider";
import { spacing } from "@/theme/spacing";

import { BusinessTypeSelector } from "./BusinessTypeSelector";
import { GuidedField } from "./GuidedField";
import { LocationPickerField } from "./LocationPickerField";
import type {
  BusinessDetailsErrors,
  BusinessDetailsField,
  BusinessDetailsFormValue,
} from "./types";

export type BusinessDetailsFormProps = {
  value: BusinessDetailsFormValue;
  onChange: (value: BusinessDetailsFormValue) => void;
  onBlurField?: (field: BusinessDetailsField) => void;
  errors?: BusinessDetailsErrors;
  suggestedType?: Turn6BusinessType | null;
  disabled?: boolean;
  locationProviderStatus?: LocationProviderAvailability;
  onOpenLocationProvider?: () => void;
  introMessage?: string;
  locationAccessory?: ReactNode;
};

export function BusinessDetailsForm({
  value,
  onChange,
  onBlurField,
  errors = {},
  suggestedType,
  disabled = false,
  locationProviderStatus = "not_configured",
  onOpenLocationProvider,
  introMessage,
  locationAccessory,
}: BusinessDetailsFormProps) {
  const inferredType = useMemo(
    () => suggestedType ?? suggestBusinessType(value.businessName),
    [suggestedType, value.businessName],
  );

  function update<K extends keyof BusinessDetailsFormValue>(key: K, nextValue: BusinessDetailsFormValue[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <View style={styles.form}>
      {introMessage ? <GabiNotice message={introMessage} tone="owner" /> : null}

      <View style={styles.intro}>
        <GabiText variant="h1">Kwento mo naman ang business mo.</GabiText>
        <GabiText tone="muted" variant="body">Tatlong bagay lang. Puwede mong baguhin ang mga ito mamaya.</GabiText>
      </View>

      <GuidedField
        autoCapitalize="words"
        disabled={disabled}
        errorMessage={errors.businessName}
        label="Pangalan ng negosyo"
        maxLength={60}
        onBlur={() => onBlurField?.("businessName")}
        onChangeText={(businessName) => update("businessName", businessName)}
        placeholder="Hal. Rovs Sushi"
        required
        returnKeyType="next"
        showValidState
        value={value.businessName}
      />

      <BusinessTypeSelector
        customError={errors.businessTypeCustom}
        customValue={value.businessTypeCustom}
        disabled={disabled}
        error={errors.businessType}
        onBlur={() => onBlurField?.("businessType")}
        onChange={(businessType) => update("businessType", businessType)}
        onCustomChange={(businessTypeCustom) => update("businessTypeCustom", businessTypeCustom)}
        suggestedType={inferredType}
        value={value.businessType}
      />

      <LocationPickerField
        disabled={disabled}
        error={errors.location}
        label="Lokasyon ng negosyo"
        onBlur={() => onBlurField?.("location")}
        onChange={(locationRef) => update("locationRef", locationRef)}
        onOpenProvider={onOpenLocationProvider}
        providerStatus={locationProviderStatus}
        value={value.locationRef}
      />
      {locationAccessory}

      <GuidedField
        disabled={disabled}
        label="Detalye"
        maxLength={500}
        multiline
        onBlur={() => onBlurField?.("notes")}
        onChangeText={(notes) => update("notes", notes)}
        placeholder="Hal. bukas 8AM–8PM, may delivery"
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
});
