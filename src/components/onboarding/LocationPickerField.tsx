import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice } from "@/components/gabi/GabiFeedback";
import { GabiText } from "@/components/gabi/GabiText";
import { createTypedLocationRef, type LocationRef } from "@/domain/onboarding";
import type { LocationProviderAvailability } from "@/services/locationProvider";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";

import { GuidedField } from "./GuidedField";

export type LocationPickerFieldProps = {
  value: LocationRef | null;
  onChange: (value: LocationRef | null) => void;
  onBlur?: () => void;
  error?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  providerStatus?: LocationProviderAvailability;
  onOpenProvider?: () => void;
  placeholder?: string;
};

const providerMessages: Record<Exclude<LocationProviderAvailability, "available">, { title: string; message: string }> = {
  not_configured: {
    title: "Typed address muna",
    message: "Walang approved live-map provider sa build na ito. Valid pa rin ang na-type na address kahit walang pin.",
  },
  offline: {
    title: "Walang internet — ayos lang",
    message: "I-type ang address at magpatuloy. Puwedeng ilagay ang map pin sa isang future build.",
  },
  permission_denied: {
    title: "Hindi pinayagan ang lokasyon",
    message: "Hindi ito haharang sa setup. I-type ang address; hindi kailangan ang coordinates.",
  },
  services_unavailable: {
    title: "Hindi available ang location services",
    message: "I-type ang address para magpatuloy. Walang pekeng map result na ise-save ang KitaMo.",
  },
};

export function LocationPickerField({
  value,
  onChange,
  onBlur,
  error,
  label = "Lokasyon",
  required = true,
  disabled = false,
  providerStatus = "not_configured",
  onOpenProvider,
  placeholder = "Barangay, lungsod, landmark, o buong address",
}: LocationPickerFieldProps) {
  const typedAddress = value?.formattedAddress ?? "";

  function changeTypedAddress(formattedAddress: string) {
    if (!formattedAddress.length) {
      onChange(null);
      return;
    }

    // Preserve the exact text while the owner is typing. Normalization happens
    // on blur so a trailing space never makes the cursor jump backward.
    onChange({
      lat: null,
      lng: null,
      formattedAddress,
      barangay: value?.source === "typed" ? value.barangay ?? null : null,
      cityMunicipality: value?.source === "typed" ? value.cityMunicipality ?? null : null,
      province: value?.source === "typed" ? value.province ?? null : null,
      postalCode: value?.source === "typed" ? value.postalCode ?? null : null,
      source: "typed",
      placeId: null,
    });
  }

  function blurAddress() {
    const normalizedAddress = value?.formattedAddress.trim() ?? "";
    if (!normalizedAddress) {
      onChange(null);
    } else if (value?.source === "typed") {
      onChange(
        createTypedLocationRef(normalizedAddress, {
          barangay: value.barangay,
          cityMunicipality: value.cityMunicipality,
          province: value.province,
          postalCode: value.postalCode,
        }),
      );
    }
    onBlur?.();
  }

  return (
    <View style={styles.wrap}>
      <GuidedField
        disabled={disabled}
        errorMessage={error}
        helperText="Valid ang typed address kahit walang GPS, internet, o map pin."
        label={label}
        onBlur={blurAddress}
        onChangeText={changeTypedAddress}
        placeholder={placeholder}
        required={required}
        showValidState
        value={typedAddress}
      />

      {value?.formattedAddress.trim() ? <LocationSummary value={value} /> : null}

      {providerStatus === "available" && onOpenProvider ? (
        <GabiSoftButton icon="map-outline" label="Hanapin o ilagay ang pin sa mapa" onPress={onOpenProvider} />
      ) : providerStatus === "available" ? (
        <GabiNotice
          message="May location provider ngunit walang picker na nakakabit sa screen na ito. I-type muna ang address."
          title="Typed address fallback"
          tone="warning"
        />
      ) : (
        <GabiNotice
          message={providerMessages[providerStatus].message}
          title={providerMessages[providerStatus].title}
          tone={providerStatus === "not_configured" ? "owner" : "warning"}
        />
      )}
    </View>
  );
}

export function LocationSummary({
  value,
  inherited = false,
}: {
  value: LocationRef;
  inherited?: boolean;
}) {
  const { palette, extended } = useGabiTheme();
  const hasCoordinates = value.lat !== null && value.lng !== null;
  const area = [value.barangay, value.cityMunicipality, value.province, value.postalCode]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");

  return (
    <View
      accessibilityLabel={`${inherited ? "Kapareho ng lokasyon ng negosyo" : "Napiling lokasyon"}: ${value.formattedAddress}`}
      style={[
        styles.summary,
        {
          backgroundColor: inherited ? palette.softPrimary : palette.surface,
          borderColor: inherited ? palette.primary : palette.border,
        },
      ]}
    >
      <View style={[styles.summaryIcon, { backgroundColor: inherited ? palette.primary : palette.softSuccess }]}>
        <Ionicons
          color={inherited ? palette.kioskHeaderText : palette.success}
          name={inherited ? "copy-outline" : "location"}
          size={19}
        />
      </View>
      <View style={styles.summaryCopy}>
        <GabiText numberOfLines={3} variant="buttonSm">{value.formattedAddress.trim()}</GabiText>
        {area ? <GabiText numberOfLines={2} tone="muted" variant="caption">{area}</GabiText> : null}
        <GabiText style={{ color: hasCoordinates ? palette.success : extended.textFaint }} variant="caption">
          {hasCoordinates
            ? `${sourceLabel(value.source)} · ${value.lat?.toFixed(4)}, ${value.lng?.toFixed(4)}`
            : "Typed address · walang pin pa (valid pa rin)"}
        </GabiText>
      </View>
    </View>
  );
}

function sourceLabel(source: LocationRef["source"]) {
  if (source === "gps") return "GPS location";
  if (source === "search") return "Search result";
  if (source === "pin") return "Map pin";
  return "Typed address";
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  summary: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  summaryIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
});
