# Play Console — App Content Declarations

Every item in Play Console → App content must be complete and accurate before a release can roll out. Answers below are drafted from a code/dependency audit of KitaMo; confirm each in the Console. **REVIEW** = a human must verify against Google's current wording and the pre-launch report.

Status: prepared but not entered or owner-confirmed in Play Console.

## Privacy policy

- [ ] Public URL set (host the content of `docs/play-store/privacy-policy-draft.md`).
- Posture: local-first, no accounts, no transmission of business data to any KitaMo server.

## Data safety

- [ ] Complete from `docs/play-store/data-safety-draft.md`.
- Suggested top answer: **no data collected or shared** (data never leaves the device). **REVIEW** the current Google definition of "collected" for locally-stored data, and reconcile with the detected-permissions report.

## Ads

- [ ] **No ads.** No ads SDK is present (audited: no admob/ads/analytics dependency).

## App access / sign-in details

- [ ] Declare **"All functionality is available without special access"** (no login/account).
- This matters: KitaMo has no sign-in, so reviewers can open every screen directly. If you leave this blank, review can stall waiting for credentials that don't exist. Explicitly state no login is required.

## Target audience and content

- [ ] Target age: **18+** (business tool). Not designed for or appealing to children.
- [ ] Not a news app.

## Content rating

- [ ] Complete the IARC questionnaire. Category: business / productivity. No user-generated public content, no violence, no gambling, no regulated content. Expected rating: Everyone / PEGI 3, but let the questionnaire decide.

## Permissions declaration

- Declared in `app.json`: `USE_BIOMETRIC` and `USE_FINGERPRINT` for the optional local Owner unlock.
- Blocked in `app.json`: `INTERNET`, legacy external storage, and system overlay.
- Verified versionCode 2 permissions:
  `android.permission.USE_BIOMETRIC`,
  `android.permission.USE_FINGERPRINT`, `android.permission.VIBRATE`,
  `android.permission.ACCESS_WIFI_STATE`,
  `android.permission.ACCESS_NETWORK_STATE`, and
  `ph.kitamo.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- The app-local signature receiver permission is not accessible to unrelated
  apps. Network/Wi-Fi state permissions do not grant network transport.
- **None** of: camera, location, contacts, microphone, Bluetooth, broad storage/photos, SMS/Call Log.
- [x] Local inspection of
  `KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` matches the set above and contains
  no `INTERNET` permission; see the
  [versionCode 2 verification](versioncode-2-aab-verification.md).
- [ ] **REVIEW** Play's detected permission list in the pre-launch report; investigate any difference before submitting. No sensitive-permission declaration form should be required for the verified set.

## Financial features / regulated category

- [ ] **REVIEW.** KitaMo records a seller's **own** sales, costs, and profit. It does **not**: process payments, move money, connect to GCash/Maya/banks, offer loans/credit, or handle third-party funds. Payment "references" are text the user types into local records.
- If Play flags a financial/government category, answer that it is a **private bookkeeping/expense-tracking tool**, not a regulated financial service, and cite the no-payment-processing posture.

## Other declarations

- [ ] Government app: **No**.
- [ ] COVID-19 / health: **No**.
- [ ] Data deletion: uninstalling deletes all data (local-only); note this where Play asks about account/data deletion.

## Standing true statements (safe to reuse verbatim)

- No login. No cloud sync. No backend. No ads. No analytics SDK. No payment processing. No camera/OCR. No Bluetooth. Business data is stored locally on the device and is not transmitted to KitaMo servers.
