# Play Console Data Safety — Draft Answer Guide (KitaMo Android)

> Release-candidate draft prepared from the finalization code and dependency audit. Conservative by design; items marked **REVIEW** need a final human check in Play Console after the signed AAB is uploaded. Google's definitions of "collected" (transmitted off device) and "shared" are what matter — data that never leaves the device is generally NOT "collected" under Play's definition.

Play Console status: prepared but not entered or owner-confirmed.

## Audit basis (what the code actually does)

- The app's own logic makes **zero network requests** (no fetch/axios/XHR/WebSocket in `src/` or `app/`; `expo-network` only reads connectivity state for the Online/Offline badge).
- The Android seller binary contains **no Supabase or other cloud-authentication
  client, endpoint, key, or cloud sync**. Local Owner PIN/biometric access control
  remains present. Future cloud documents are planning-only and are not
  executable.
- Dependencies: Expo runtime, expo-sqlite (local DB), expo-secure-store, expo-local-authentication, expo-crypto, expo-clipboard, expo-sharing + React Native Share (OS share sheet), expo-haptics, expo-network, expo-router, react-native UI libraries, zod, and zustand. **No analytics, ads, crash-reporting, cloud database, or payment SDKs.**
- Android backup is disabled. Business data is not transferred through Android backup/restore.
- Owner PIN protection stores a salted hash in Android secure storage. Optional biometric unlock is handled by Android; the app receives only the authentication result and never receives biometric templates.
- The designated versionCode 2 AAB was statically verified. Its exact permissions
  are biometric/fingerprint, vibration, network/Wi-Fi state, and the app-local
  dynamic-receiver permission. It contains no `INTERNET`, legacy
  external-storage, system-overlay, camera, microphone, location, or Bluetooth
  permission. See the
  [versionCode 2 verification](../release/versioncode-2-aab-verification.md).

## Suggested form answers

**Does your app collect or share any of the required user data types?**
→ Suggested answer: **No** — all user-entered data is stored locally and never transmitted by the app. **REVIEW**: confirm on the final build (see verification step below) and confirm Google's current guidance on locally-stored data at submission time.

If reviewers prefer declaring locally-stored data anyway, the fallback per-type answers:

| Data type | Collected? | Shared? | Notes |
| --- | --- | --- | --- |
| Personal info (name, contact number) | No (stored on device only; owner-entered business contact) | No | Never transmitted |
| Financial info (sales amounts, payment references) | No (local records; references typed manually) | No | No payment processing |
| Location | No | No | No permission, no API use |
| Photos/videos/audio | No | No | No permission, no API use |
| Contacts / calendar | No | No | No permission |
| App activity / analytics | No | No | No analytics SDK |
| Device or other IDs | No by app logic | No | **REVIEW**: see platform note |
| Messages, health, browsing | No | No | Not applicable |

**Is data encrypted in transit?** Not applicable (no transmission by the app). **REVIEW** if any answer above changes.

**Can users request data deletion?** Data lives only on the device; uninstalling deletes everything. Owner Settings includes a confirmed full local reset that also removes the local Owner lock.

## Platform/tooling caveats (be honest about these)

- **Expo/EAS runtime metadata — REVIEW**: the versionCode 2 AAB contains Expo
  Updates framework metadata with `ENABLED=false` and no update URL. Static
  inspection found no configured Expo update channel; this is not a dynamic
  network test. Reconcile the answer with Google's pre-launch report before
  answering "no collection" definitively.
- **Google Play itself** collects install/diagnostic data outside the app's control; the Data Safety form covers the app, not the store.
- **Share sheet**: receipt text a user shares leaves the app via the app they choose — user-initiated, not app collection.

## Final verification step before submission

1. Recompute the designated versionCode 2 AAB checksum before upload and require
   the exact value in the verification record. Do not rebuild it.
2. After an owner-authorized Internal Testing upload, run Play Console's
   pre-launch report / app-bundle analysis and read the detected-permissions
   list. Expected: `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `VIBRATE`,
   `USE_BIOMETRIC`, `USE_FINGERPRINT`, and the app-local receiver permission.
   Investigate anything else before rollout.
3. Fill the form from this document, resolving every **REVIEW** item against
   Google's current wording and what the Console detects.
