import type { LocationRef } from "@/domain/onboarding";

export type LocationProviderAvailability =
  | "available"
  | "not_configured"
  | "offline"
  | "permission_denied"
  | "services_unavailable";

export type LocationProviderFailureCode = Exclude<LocationProviderAvailability, "available"> | "not_found";

export type LocationProviderFailure = {
  ok: false;
  code: LocationProviderFailureCode;
  message: string;
};

export type LocationProviderSuccess<T> = {
  ok: true;
  value: T;
};

export type LocationProviderResult<T> = LocationProviderSuccess<T> | LocationProviderFailure;

export type LocationSearchSuggestion = {
  id: string;
  primaryText: string;
  secondaryText: string | null;
  placeId: string | null;
};

export type LocationCoordinates = {
  lat: number;
  lng: number;
};

/**
 * Boundary for a future, explicitly approved map/location implementation.
 *
 * Turn 6 can render every loading, denied, offline, and typed-address state
 * against this contract without importing a native Maps SDK into form code.
 * Implementations must return an honest failure instead of synthesizing a pin,
 * address, suggestion, or permission result.
 */
export interface LocationProviderAdapter {
  readonly id: string;
  getAvailability(): Promise<LocationProviderAvailability>;
  requestCurrentLocation(): Promise<LocationProviderResult<LocationRef>>;
  search(query: string): Promise<LocationProviderResult<readonly LocationSearchSuggestion[]>>;
  resolveSuggestion(suggestion: LocationSearchSuggestion): Promise<LocationProviderResult<LocationRef>>;
  reverseGeocode(coordinates: LocationCoordinates): Promise<LocationProviderResult<LocationRef>>;
}

const NOT_CONFIGURED_MESSAGE =
  "Live map and location services are not configured in this offline build. Type an address to continue.";

function unavailable<T>(): LocationProviderResult<T> {
  return {
    ok: false,
    code: "not_configured",
    message: NOT_CONFIGURED_MESSAGE,
  };
}

/**
 * The authoritative adapter for the current release. It deliberately performs
 * no network request, permission request, geocoding, or native map operation.
 */
export const unavailableLocationProvider: LocationProviderAdapter = {
  id: "unconfigured-local-only",
  async getAvailability() {
    return "not_configured";
  },
  async requestCurrentLocation() {
    return unavailable<LocationRef>();
  },
  async search(_query) {
    return unavailable<readonly LocationSearchSuggestion[]>();
  },
  async resolveSuggestion(_suggestion) {
    return unavailable<LocationRef>();
  },
  async reverseGeocode(_coordinates) {
    return unavailable<LocationRef>();
  },
};

export function getApprovedLocationProvider(): LocationProviderAdapter {
  return unavailableLocationProvider;
}

export const liveLocationArchitectureRequirements = {
  nativeDependencies: ["expo-location", "react-native-maps"] as const,
  androidPermissions: [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.INTERNET",
  ] as const,
  providerConfiguration: [
    "an approved Android Maps SDK provider and API key",
    "an approved place-search and forward/reverse-geocoding provider",
    "foreground-only runtime location permission copy and handling",
  ] as const,
};
