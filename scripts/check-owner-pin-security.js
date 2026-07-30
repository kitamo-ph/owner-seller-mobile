const assert = require("node:assert/strict");
const path = require("node:path");

const compiledDir = path.join(process.cwd(), "node_modules/.cache/kitamo-owner-pin-check");
const {
  OWNER_PIN_LOCKOUT_MS,
  createOwnerPinAttemptManager,
  createSingleFlightProtectedAction,
  formatOwnerPinLockoutMessage,
} = require(path.join(compiledDir, "ownerPinSecurity.js"));

function createMemoryStorage(values = new Map()) {
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

function createManager(storage) {
  return createOwnerPinAttemptManager({
    storage,
    failedAttemptsKey: "failed",
    lockoutUntilKey: "lockout",
  });
}

async function checkPersistentAttemptLimits() {
  const storage = createMemoryStorage();
  const firstProcess = createManager(storage);
  const verifyCorrectPin = async (pin) => pin === "2468";
  const start = 1_000_000;

  const firstWrong = await firstProcess.verify({ pin: "1111", verifyPin: verifyCorrectPin, now: start });
  assert.equal(firstWrong.status, "wrong");
  assert.equal(firstWrong.state.failedAttempts, 1);

  const restartedProcess = createManager(storage);
  assert.equal((await restartedProcess.load()).failedAttempts, 1, "failed attempts must survive a new manager/process");

  let result = firstWrong;
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    result = await restartedProcess.verify({ pin: "1111", verifyPin: verifyCorrectPin, now: start + attempt });
  }
  assert.equal(result.status, "locked");
  assert.equal(result.state.failedAttempts, 5);
  assert.equal(result.state.lockoutUntil, start + 5 + OWNER_PIN_LOCKOUT_MS);

  let verifierCalledWhileLocked = false;
  const processAfterForceClose = createManager(storage);
  const stillLocked = await processAfterForceClose.verify({
    pin: "2468",
    verifyPin: async () => {
      verifierCalledWhileLocked = true;
      return true;
    },
    now: start + 100,
  });
  assert.equal(stillLocked.status, "locked");
  assert.equal(verifierCalledWhileLocked, false, "a restart must not bypass the persisted lockout");
  assert.match(formatOwnerPinLockoutMessage(stillLocked.remainingMs), /^Too many attempts\. Try again in \d+ seconds?\.$/);

  const successfulAfterCooldown = await processAfterForceClose.verify({
    pin: "2468",
    verifyPin: verifyCorrectPin,
    now: start + 5 + OWNER_PIN_LOCKOUT_MS,
  });
  assert.equal(successfulAfterCooldown.status, "success");
  assert.deepEqual(await processAfterForceClose.load(), { failedAttempts: 0, lockoutUntil: 0 });
  assert.equal(storage.values.size, 0, "successful verification must clear persisted attempt state");

  const storedValues = [...storage.values.values()].join(" ");
  assert.equal(storedValues.includes("2468"), false, "attempt persistence must never contain the raw PIN");
}

async function checkProtectedWipe() {
  let wipeCount = 0;
  let verificationCount = 0;
  const action = createSingleFlightProtectedAction({
    verify: async (pin) => {
      verificationCount += 1;
      return pin === "2468";
    },
    execute: async () => {
      wipeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { cleared: true };
    },
  });

  assert.deepEqual(await action(null), { status: "cancelled" });
  assert.equal(wipeCount, 0, "cancellation cannot wipe data");

  assert.deepEqual(await action("1111"), { status: "denied" });
  assert.equal(wipeCount, 0, "wrong PIN cannot wipe data");

  const firstTap = action("2468");
  const duplicateTap = action("2468");
  const [firstResult, duplicateResult] = await Promise.all([firstTap, duplicateTap]);
  assert.equal(firstResult.status, "completed");
  assert.equal(duplicateResult.status, "completed");
  assert.equal(wipeCount, 1, "duplicate taps must share one wipe operation");
  assert.equal(verificationCount, 2, "only the wrong attempt and one correct attempt should verify");
}

async function main() {
  await checkPersistentAttemptLimits();
  await checkProtectedWipe();
  console.log("persistent Owner PIN throttle: passed");
  console.log("protected local wipe: passed");
  console.log("ALL OWNER PIN SECURITY CHECKS PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
