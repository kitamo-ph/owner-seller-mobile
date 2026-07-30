# Google Play — Internal Testing Upload Checklist

Exact manual steps to get the first internal build onto testers' phones. Every step here is done by a human in the Play Console / terminal — none of it is automated by this repo.

## Before you start

- [x] Verify the protected package name is `ph.kitamo.app`; do not change it
  (see `google-play-internal-testing-execution.md`).
- [ ] Real-phone QA pass complete (`docs/release/final-release-readiness.md` checklist).
- [ ] All repo checks green (see the command list in the release-readiness doc).
- [ ] Real app icon (512×512), feature graphic (1024×500), and 4+ phone screenshots ready.
- [ ] Privacy policy hosted at a public URL; support email chosen.

## Step-by-step

1. **Register / pay developer account** — https://play.google.com/console, $25 one-time, complete identity verification (can take days; start early).
2. **Create app** — All apps → Create app. Name: `KitaMo` (or `KitaMo Pilot`), default language, App (not Game), **Free**.
3. **Set app name** — matches the listing; max 30 chars.
4. **App / Free** — confirm Free; you cannot switch a Free app to Paid later.
5. **Support email** — Store settings → set the real support email.
6. **Select and verify the existing `.aab`** — use only
   `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`; recompute
   SHA-256 and require
   `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
   Do not rebuild or replace it. See the
   [verification record](versioncode-2-aab-verification.md).
7. **Upload to Internal Testing** — Testing → Internal testing → Create new
   release → upload that exact versionCode 2 AAB. Accept Play App Signing when
   prompted.
8. **Add release notes** — paste from
   `docs/play-store/release-notes-internal.md`. Release name:
   `1.0.0 (2) - pilot`.
9. **Add tester emails** — Internal testing → Testers → create an email list → add testers' Gmail addresses (see `tester-plan.md`).
10. **Copy the opt-in link** — Internal testing → Testers → copy the "Join on the web" URL.
11. **Install on a phone** — open the opt-in link on a tester phone (signed into a listed Gmail), Become a tester → install from Play.
12. **Run the smoke test** — 5-minute smoke test from `final-release-readiness.md` (Demo → sell 8 bundle items → receipt ₱150 → reopen, data persists).
13. **Collect bugs** — one shared thread, using the format in `docs/play-store/internal-tester-guide.md`.
14. **Prepare Closed Testing (only if going to production)** — create a Closed testing track, add ≥12 testers, keep them opted in 14 continuous days (new-account production gate).

## App Content section (Play requires all complete before rollout)

Fill from `docs/play-store/data-safety-draft.md` and `privacy-policy-draft.md`:

- [ ] Privacy policy URL
- [ ] App access (see below — declare "no login")
- [ ] Ads — **No ads**
- [ ] Content rating — complete the questionnaire (business/productivity, no UGC)
- [ ] Target audience — 18+
- [ ] Data safety — from the draft, resolving every **REVIEW** flag against the pre-launch report
- [ ] Government apps / Financial features — **REVIEW**: KitaMo tracks a seller's own money but does not process payments, offer credit, or handle others' funds; answer conservatively and be ready to explain it is a private bookkeeping tool.
- [ ] News app — No

## versionCode discipline (critical)

- `eas.json` uses `appVersionSource: local`, so **versionCode comes from `app.json`** and `production.autoIncrement` is `false`.
- **Every new upload needs a higher `versionCode`.** Play rejects a reused versionCode.
- The designated candidate already uses versionCode `2`.
- Any later or replacement build must use versionCode `3` or higher. Make that
  application/configuration change only in a separately approved build task.
- Do not change `production.autoIncrement` or any Expo/EAS identity as part of
  this upload-documentation workflow.
