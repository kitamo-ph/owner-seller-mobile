import type {
  BusinessSetupValidation,
  BusinessSetupValues,
  LocationRef,
  StallSetupValidation,
  StallSetupValues,
  Turn6BusinessType,
} from "@/domain/onboarding";
import type { Branch } from "@/domain/types";

export type BusinessDetailsFormValue = Omit<BusinessSetupValues, "businessType"> & {
  businessType: Turn6BusinessType | null;
  businessTypeCustom: string;
  notes: string;
};

export type BusinessDetailsErrors = BusinessSetupValidation["errors"];
export type BusinessDetailsField = keyof BusinessDetailsErrors | "notes";

export type StallDetailsFormValue = StallSetupValues & {
  inheritsBusinessLocation: boolean;
  branchType: Branch["branchType"];
  notes: string;
};

export type StallDetailsErrors = StallSetupValidation["errors"];
export type StallDetailsField = keyof StallDetailsErrors | "branchType" | "notes";

export type StallBusinessOption = {
  id: string;
  name: string;
  locationRef: LocationRef | null;
};
