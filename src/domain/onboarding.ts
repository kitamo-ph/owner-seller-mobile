import { z } from "zod";

const optionalLocationTextSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().min(1).nullable().optional(),
);

export const locationSourceSchema = z.enum(["gps", "search", "pin", "typed"]);
export type LocationSource = z.infer<typeof locationSourceSchema>;

export const locationRefSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90).nullable(),
    lng: z.number().finite().min(-180).max(180).nullable(),
    formattedAddress: z.string().trim().min(1),
    barangay: optionalLocationTextSchema,
    cityMunicipality: optionalLocationTextSchema,
    province: optionalLocationTextSchema,
    postalCode: optionalLocationTextSchema,
    source: locationSourceSchema,
    placeId: optionalLocationTextSchema,
  })
  .superRefine((location, context) => {
    const hasLatitude = location.lat !== null;
    const hasLongitude = location.lng !== null;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "Latitude and longitude must be provided together.",
        path: hasLatitude ? ["lng"] : ["lat"],
      });
    }

    if (location.source !== "typed" && (!hasLatitude || !hasLongitude)) {
      context.addIssue({
        code: "custom",
        message: "Provider-backed locations require coordinates.",
        path: ["source"],
      });
    }
  });

export type LocationRef = z.infer<typeof locationRefSchema>;

export const TURN6_BUSINESS_TYPES = [
  "Food / Restaurant",
  "Sari-sari Store",
  "Grocery / Mini Mart",
  "Hardware",
  "Retail",
  "Online Selling",
  "Beauty / Salon",
  "Services",
  "Repair Shop",
  "Pharmacy / Health",
  "Clothing / Fashion",
  "Other",
] as const;

export type Turn6BusinessType = (typeof TURN6_BUSINESS_TYPES)[number];

// Compatibility aliases used by the shared guided-form components.
export const GUIDED_BUSINESS_TYPES = TURN6_BUSINESS_TYPES;
export type GuidedBusinessType = Turn6BusinessType;

const legacyBusinessTypeLabels: Readonly<Record<string, Turn6BusinessType>> = {
  "sari-sari store": "Sari-sari Store",
  karinderia: "Food / Restaurant",
  "street food": "Food / Restaurant",
  kiosk: "Retail",
  "school canteen": "Food / Restaurant",
  "small booth": "Retail",
  other: "Other",
};

const suggestionRules: readonly {
  type: Turn6BusinessType;
  keywords: readonly string[];
}[] = [
  {
    type: "Food / Restaurant",
    keywords: [
      "sushi",
      "restaurant",
      "resto",
      "karinderia",
      "canteen",
      "cafe",
      "coffee",
      "bakery",
      "bakeshop",
      "food",
      "pagkain",
      "meal",
      "burger",
      "chicken",
      "lechon",
      "catering",
      "lutong",
      "ihaw",
      "milk tea",
      "snack",
    ],
  },
  {
    type: "Sari-sari Store",
    keywords: ["sari sari", "sari-sari", "tindahan"],
  },
  {
    type: "Grocery / Mini Mart",
    keywords: ["grocery", "mini mart", "minimart", "supermarket"],
  },
  {
    type: "Hardware",
    keywords: ["hardware", "construction supply", "building supply"],
  },
  {
    type: "Online Selling",
    keywords: ["online", "e-commerce", "ecommerce"],
  },
  {
    type: "Beauty / Salon",
    keywords: ["salon", "beauty", "spa", "nail", "barber"],
  },
  {
    type: "Repair Shop",
    keywords: ["repair", "talyer", "auto shop", "fix"],
  },
  {
    type: "Pharmacy / Health",
    keywords: ["pharmacy", "drugstore", "botika", "health", "medical"],
  },
  {
    type: "Clothing / Fashion",
    keywords: ["clothing", "fashion", "apparel", "ukay", "boutique"],
  },
  {
    type: "Services",
    keywords: ["services", "service", "laundry", "printing"],
  },
  {
    type: "Retail",
    keywords: ["retail", "store", "shop", "trading", "supplies"],
  },
];

export function getBusinessTypeLabel(value: string) {
  const normalizedValue = value.trim();
  return legacyBusinessTypeLabels[normalizedValue.toLowerCase()] ?? normalizedValue;
}

function normalizeSuggestionText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestBusinessType(businessName: string): Turn6BusinessType | null {
  const normalizedName = normalizeSuggestionText(businessName);
  if (!normalizedName) {
    return null;
  }

  const paddedName = ` ${normalizedName} `;
  return (
    suggestionRules.find(({ keywords }) =>
      keywords.some((keyword) => paddedName.includes(` ${normalizeSuggestionText(keyword)} `)),
    )?.type ?? null
  );
}

export function normalizeLocationRef(value: LocationRef): LocationRef {
  return locationRefSchema.parse(value);
}

export function createTypedLocationRef(
  formattedAddress: string,
  details: Partial<Pick<LocationRef, "barangay" | "cityMunicipality" | "province" | "postalCode">> = {},
): LocationRef {
  return normalizeLocationRef({
    lat: null,
    lng: null,
    formattedAddress,
    barangay: details.barangay ?? null,
    cityMunicipality: details.cityMunicipality ?? null,
    province: details.province ?? null,
    postalCode: details.postalCode ?? null,
    source: "typed",
    placeId: null,
  });
}

export function inheritLocationRef(value: LocationRef): LocationRef {
  return normalizeLocationRef({ ...value });
}

export function parseLocationRefJson(
  value: string | null | undefined,
  legacyAddress: string | null | undefined = null,
): LocationRef | null {
  if (value?.trim()) {
    try {
      const parsed = locationRefSchema.safeParse(JSON.parse(value));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Fall through to the preserved legacy address.
    }
  }

  const fallbackAddress = legacyAddress?.trim();
  return fallbackAddress ? createTypedLocationRef(fallbackAddress) : null;
}

export function serializeLocationRef(value: LocationRef) {
  const location = normalizeLocationRef(value);
  return JSON.stringify({
    lat: location.lat,
    lng: location.lng,
    formattedAddress: location.formattedAddress,
    barangay: location.barangay ?? null,
    cityMunicipality: location.cityMunicipality ?? null,
    province: location.province ?? null,
    postalCode: location.postalCode ?? null,
    source: location.source,
    placeId: location.placeId ?? null,
  });
}

export type BusinessSetupValues = {
  businessName: string;
  businessType: string | null;
  businessTypeCustom?: string | null;
  locationRef: LocationRef | null;
};

export type BusinessSetupValidation = {
  valid: boolean;
  summary: string | null;
  errors: {
    businessName?: string;
    businessType?: string;
    businessTypeCustom?: string;
    location?: string;
  };
};

export function validateBusinessSetup(input: BusinessSetupValues): BusinessSetupValidation {
  const errors: BusinessSetupValidation["errors"] = {};
  if (!input.businessName.trim()) {
    errors.businessName = "Ilagay ang pangalan ng negosyo.";
  }
  if (!input.businessType?.trim()) {
    errors.businessType = "Piliin ang uri ng negosyo.";
  }
  if (input.businessType?.trim().toLowerCase() === "other" && !input.businessTypeCustom?.trim()) {
    errors.businessTypeCustom = "Ilagay ang uri ng negosyo.";
  }
  if (!input.locationRef || !locationRefSchema.safeParse(input.locationRef).success) {
    errors.location = "Ilagay ang lokasyon ng negosyo.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    summary: valid ? null : "Kumpletuhin ang mga kailangang field.",
    errors,
  };
}

export type StallSetupValues = {
  stallName: string;
  businessId: string | null;
  locationRef: LocationRef | null;
};

export type StallSetupValidation = {
  valid: boolean;
  summary: string | null;
  errors: {
    stallName?: string;
    business?: string;
    location?: string;
  };
};

export function validateStallSetup(input: StallSetupValues): StallSetupValidation {
  const errors: StallSetupValidation["errors"] = {};
  if (!input.stallName.trim()) {
    errors.stallName = "Ilagay ang pangalan ng stall.";
  }
  if (!input.businessId?.trim()) {
    errors.business = "Piliin ang negosyo.";
  }
  if (!input.locationRef || !locationRefSchema.safeParse(input.locationRef).success) {
    errors.location = "Ilagay ang lokasyon ng stall.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    summary: valid ? null : "Kumpletuhin ang mga kailangang field.",
    errors,
  };
}

export type GuidedSetupRole = "owner" | "seller";
export type SellerConnectionState = "not_applicable" | "unconnected";
export type GuidedSetupDestination =
  | "name"
  | "role"
  | "owner-business"
  | "owner-stall"
  | "owner-app"
  | "seller-connect"
  | "seller-limited";

export type GuidedSetupState = {
  displayName?: string | null;
  role?: GuidedSetupRole | null;
  hasBusiness: boolean;
  hasStall: boolean;
  firstRunComplete: boolean;
  sellerConnectionState?: SellerConnectionState | null;
};

export function resolveGuidedSetupDestination(state: GuidedSetupState): GuidedSetupDestination {
  if (state.role !== "seller" && state.hasBusiness && state.hasStall) {
    return "owner-app";
  }
  if (state.role !== "seller" && state.hasBusiness) {
    return "owner-stall";
  }
  if (!state.displayName?.trim()) {
    return "name";
  }
  if (!state.role) {
    return "role";
  }
  if (state.role === "seller") {
    return state.sellerConnectionState === "unconnected" ? "seller-limited" : "seller-connect";
  }
  return "owner-business";
}
