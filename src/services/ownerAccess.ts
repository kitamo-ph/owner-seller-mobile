import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import {
  createOwnerPinAttemptManager,
  type OwnerPinVerificationResult,
} from "@/domain/ownerPinSecurity";

const PIN_HASH_KEY = "kitamo.owner.pinHash.v1";
const PIN_SALT_KEY = "kitamo.owner.pinSalt.v1";
const BIOMETRIC_KEY = "kitamo.owner.biometric.v1";
const PIN_FAILED_ATTEMPTS_KEY = "kitamo.owner.pinFailedAttempts.v1";
const PIN_LOCKOUT_UNTIL_KEY = "kitamo.owner.pinLockoutUntil.v1";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const ownerPinAttemptManager = createOwnerPinAttemptManager({
  failedAttemptsKey: PIN_FAILED_ATTEMPTS_KEY,
  lockoutUntilKey: PIN_LOCKOUT_UNTIL_KEY,
  storage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, secureStoreOptions),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
});

export type OwnerAccessStatus = {
  hasPin: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
};

export function isValidOwnerPin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}

async function hashPin(pin: string, salt: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

async function canUseBiometrics() {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function getOwnerAccessStatus(): Promise<OwnerAccessStatus> {
  const [pinHash, biometricFlag, biometricAvailable] = await Promise.all([
    SecureStore.getItemAsync(PIN_HASH_KEY),
    SecureStore.getItemAsync(BIOMETRIC_KEY),
    canUseBiometrics(),
  ]);

  return {
    hasPin: Boolean(pinHash),
    biometricAvailable,
    biometricEnabled: Boolean(pinHash) && biometricAvailable && biometricFlag === "true",
  };
}

export async function saveOwnerPin(pin: string) {
  if (!isValidOwnerPin(pin)) {
    throw new Error("Use a 4 to 6 digit PIN.");
  }

  const salt = Crypto.randomUUID();
  const pinHash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_SALT_KEY, salt, secureStoreOptions);
  await SecureStore.setItemAsync(PIN_HASH_KEY, pinHash, secureStoreOptions);
  await ownerPinAttemptManager.clear();
}

export async function verifyOwnerPin(pin: string) {
  const [storedHash, salt] = await Promise.all([
    SecureStore.getItemAsync(PIN_HASH_KEY),
    SecureStore.getItemAsync(PIN_SALT_KEY),
  ]);

  if (!storedHash || !salt || !isValidOwnerPin(pin)) {
    return false;
  }

  return (await hashPin(pin, salt)) === storedHash;
}

export function getOwnerPinAttemptState() {
  return ownerPinAttemptManager.load();
}

export function clearOwnerPinAttemptState() {
  return ownerPinAttemptManager.clear();
}

export function verifyOwnerPinWithThrottle(pin: string, now = Date.now()): Promise<OwnerPinVerificationResult> {
  return ownerPinAttemptManager.verify({
    now,
    pin,
    verifyPin: verifyOwnerPin,
  });
}

export async function authenticateOwnerWithBiometrics() {
  const status = await getOwnerAccessStatus();
  if (!status.biometricEnabled) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: "Use PIN",
    disableDeviceFallback: true,
    promptMessage: "Unlock KitaMo Owner Mode",
  });
  if (result.success) {
    await ownerPinAttemptManager.clear();
  }
  return result.success;
}

export async function setOwnerBiometricEnabled(enabled: boolean) {
  if (enabled && !(await canUseBiometrics())) {
    throw new Error("Set up fingerprint or face unlock on this phone first.");
  }

  await SecureStore.setItemAsync(BIOMETRIC_KEY, enabled ? "true" : "false", secureStoreOptions);
}

export async function clearOwnerAccess() {
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_HASH_KEY),
    SecureStore.deleteItemAsync(PIN_SALT_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
    ownerPinAttemptManager.clear(),
  ]);
}
