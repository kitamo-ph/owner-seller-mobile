export const OWNER_PIN_MAX_ATTEMPTS = 5;
export const OWNER_PIN_LOCKOUT_MS = 30_000;

export type OwnerPinAttemptState = {
  failedAttempts: number;
  lockoutUntil: number;
};

export type OwnerPinAttemptStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type OwnerPinVerificationResult =
  | { status: "success"; state: OwnerPinAttemptState }
  | { status: "wrong"; state: OwnerPinAttemptState; attemptsBeforeLockout: number }
  | { status: "locked"; state: OwnerPinAttemptState; remainingMs: number };

export const emptyOwnerPinAttemptState: OwnerPinAttemptState = {
  failedAttempts: 0,
  lockoutUntil: 0,
};

function parseStoredInteger(value: string | null) {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function ownerPinLockoutRemainingMs(state: OwnerPinAttemptState, now = Date.now()) {
  return Math.max(0, state.lockoutUntil - now);
}

export function formatOwnerPinLockoutMessage(remainingMs: number) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

export function createOwnerPinAttemptManager({
  storage,
  failedAttemptsKey,
  lockoutUntilKey,
}: {
  storage: OwnerPinAttemptStorage;
  failedAttemptsKey: string;
  lockoutUntilKey: string;
}) {
  async function load(): Promise<OwnerPinAttemptState> {
    const [failedAttempts, lockoutUntil] = await Promise.all([
      storage.getItem(failedAttemptsKey),
      storage.getItem(lockoutUntilKey),
    ]);
    return {
      failedAttempts: parseStoredInteger(failedAttempts),
      lockoutUntil: parseStoredInteger(lockoutUntil),
    };
  }

  async function save(state: OwnerPinAttemptState) {
    await Promise.all([
      storage.setItem(failedAttemptsKey, String(state.failedAttempts)),
      storage.setItem(lockoutUntilKey, String(state.lockoutUntil)),
    ]);
  }

  async function clear() {
    await Promise.all([
      storage.removeItem(failedAttemptsKey),
      storage.removeItem(lockoutUntilKey),
    ]);
  }

  async function verify({
    pin,
    verifyPin,
    now = Date.now(),
  }: {
    pin: string;
    verifyPin: (candidate: string) => Promise<boolean>;
    now?: number;
  }): Promise<OwnerPinVerificationResult> {
    const current = await load();
    const remainingMs = ownerPinLockoutRemainingMs(current, now);
    if (remainingMs > 0) {
      return { status: "locked", state: current, remainingMs };
    }

    if (await verifyPin(pin)) {
      await clear();
      return { status: "success", state: emptyOwnerPinAttemptState };
    }

    const failedAttempts = current.failedAttempts + 1;
    const shouldLock = failedAttempts >= OWNER_PIN_MAX_ATTEMPTS;
    const nextState = {
      failedAttempts,
      lockoutUntil: shouldLock ? now + OWNER_PIN_LOCKOUT_MS : 0,
    };
    await save(nextState);

    if (shouldLock) {
      return {
        status: "locked",
        state: nextState,
        remainingMs: OWNER_PIN_LOCKOUT_MS,
      };
    }

    return {
      status: "wrong",
      state: nextState,
      attemptsBeforeLockout: OWNER_PIN_MAX_ATTEMPTS - failedAttempts,
    };
  }

  return { clear, load, verify };
}

export type ProtectedActionResult<T> =
  | { status: "cancelled" }
  | { status: "denied" }
  | { status: "completed"; value: T };

export function createSingleFlightProtectedAction<T>({
  verify,
  execute,
}: {
  verify: (credential: string) => Promise<boolean>;
  execute: () => Promise<T>;
}) {
  let inFlight: Promise<ProtectedActionResult<T>> | null = null;

  return (credential: string | null): Promise<ProtectedActionResult<T>> => {
    if (inFlight) return inFlight;
    if (!credential) return Promise.resolve({ status: "cancelled" });

    inFlight = (async () => {
      if (!(await verify(credential))) {
        return { status: "denied" } as const;
      }
      return { status: "completed", value: await execute() } as const;
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}
