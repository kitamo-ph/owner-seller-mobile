# Google Play — Internal Testing Execution Plan

How KitaMo reaches testers on Google Play, and why Internal Testing is the correct target now (not public production).

## What Google Play does and does not do

- Google Play **distributes** the KitaMo app (the installable Android bundle) to devices. That's it.
- Google Play does **not run** KitaMo and does **not provide any backend, server, database, or auth** for it. KitaMo is local-first: all data lives on the tester's phone. Uploading to Play changes nothing about how the app stores or computes data.
- Because there is no backend, "publishing" here only means "make the installable app available to a chosen set of testers."

## Recommended release route

1. **Internal Testing (now).** Fastest track, up to 100 testers by email, available within minutes of upload, no Google review wait for the first internal release. This is the correct target tonight.
2. **5–10 real seller testers** for the pilot (night-market/karinderia owners). See `tester-plan.md`.
3. **Prepare 12–15 total tester emails** in advance — this matters for the next step.
4. **Closed Testing** if/when you want public production. New **personal** Play Console developer accounts (created 2023 or later) generally must run **Closed Testing with at least 12 testers opted in for 14 continuous days** before production access is granted. Internal Testing does **not** count toward that 14-day requirement, but it's the right place to shake out bugs first.
5. **Production / Public** only after testing, the 12×14 requirement (if it applies), and Google review. Not the immediate target.

## Why not production tonight

- A brand-new personal developer account likely cannot ship to public production immediately — the 12-tester / 14-day closed-testing gate applies first.
- Even without that gate, production goes through Google review (hours to days). Internal Testing is instant and is where pilot feedback should come from anyway.
- Nothing about KitaMo's value needs public production for the pilot — the sellers you hand-pick install from an internal opt-in link.

## Package name — DECIDED: `ph.kitamo.app`

The Android **package name is permanent and immutable once the first bundle is uploaded** to any track, and *is* the app's identity across Internal → Closed → Production (one app, one package).

Decision made: `android.package` is **`ph.kitamo.app`** (no `.pilot` suffix).
The designated versionCode 2 candidate uses this protected package, which
carries through Internal → Closed → Production. Do not change it.

The user-facing app title (`KitaMo`) is separate and editable in the Play Console at any time — only the package id is permanent.

## Current config snapshot (audited)

- App label: `KitaMo` — editable later; Play listing title is set in the Console.
- versionName `1.0.0`, versionCode `2`.
- The verified AAB has biometric/fingerprint, vibration, network-state,
  Wi-Fi-state, and app-local receiver permissions. It has no Internet, camera,
  microphone, location, Bluetooth, storage, SMS, ads, analytics, or payment
  permission.
- Expo SDK 54 / RN 0.81.5; the verified AAB has minimum API 24 and target API 36.
- `eas.json` `production` profile builds an Android App Bundle (`.aab`) — the required format for Play.

## Current Internal Testing candidate

- Artifact:
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`.
- Release name: `1.0.0 (2) - pilot`.
- SHA-256:
  `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
- Signing identity: verified against the EAS production upload certificate.
- Evidence:
  [versionCode 2 AAB verification](versioncode-2-aab-verification.md).

No Play upload has occurred. The privacy URL, support email, tester list, Play
Console declarations, Play App Signing, and owner rollout approval remain
unresolved. Any later build must use versionCode 3 or higher.
