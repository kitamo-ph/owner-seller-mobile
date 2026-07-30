# Repository Authority Verification

## Purpose and scope

This report records the MOB-0 authority and integrity preflight for the relocated KitaMo Owner–Seller Mobile repository. It is discovery evidence only; it does not approve a later milestone or alter Git configuration, history, branches, source, configuration, or release artifacts.

Evidence labels: **Confirmed** is directly supported by inspected local evidence; **Likely** is supported but not independently guaranteed; **Unresolved** was not verifiable in scope; **Proposed for later review** is not current behavior.

## Audit context

| Item | Observed value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Working directory (`pwd`, `pwd -P`) | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Resolved Git root | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Valid Git worktree | **Confirmed** (`git rev-parse --is-inside-work-tree` returned `true`) |
| Remote | `origin` → `https://github.com/kitamo-ph/owner-seller-mobile.git` for fetch and push |
| Branch | `codex/pre-internal-hardening` |
| Full HEAD | `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| Short HEAD | `6ed9ace` |
| Latest subject | `Document pre-internal release validation` |
| Upstream | `origin/codex/pre-internal-hardening`; up to date at inspection |
| Worktree | Clean before documentation generation |

## Confirmed findings

- **Confirmed — authoritative location:** the resolved working directory and Git root are identical to the requested authoritative local path.
- **Confirmed — authoritative remote:** the sole configured remote observed was `origin`, and both URLs match `kitamo-ph/owner-seller-mobile`.
- **Confirmed — protected baseline:** `git show --no-patch --oneline 6ed9ace` resolved to the expected commit. `git merge-base --is-ancestor 6ed9ace HEAD` exited `0`; HEAD is exactly that commit.
- **Confirmed — protected branch:** the expected branch was already checked out. No branch switch, reset, clean, fetch, pull, or Git configuration mutation was performed.
- **Confirmed — history retained:** this is an existing Git repository, not a newly initialized repository.
- **Confirmed — worktrees:** `git worktree list --porcelain` returned one worktree, this repository, on `refs/heads/codex/pre-internal-hardening`.
- **Confirmed — nested repositories:** a bounded `find` excluding `.git` and `node_modules` found no nested `.git` directory or `.gitfile`.
- **Confirmed — ignored local state:** ignored items include `.env.local`, `.expo/`, `dist/`, `node_modules/`, `release-artifacts/`, generated `expo-env.d.ts`, and operating-system metadata. `.env.local` was treated as secret-bearing and its values were not inspected or copied.
- **Confirmed — protected AAB exists:** `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` exists. It was read only by the required SHA-256 checksum command and was not unpacked, executed, content-inspected, moved, renamed, or modified.

## Protected artifact evidence

| Property | Observed value |
| --- | --- |
| Repository-relative path | `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` |
| Size | 57,120,066 bytes |
| Modification timestamp | `2026-07-16T22:18:25+0800` |
| SHA-256 | `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd` |
| Git tracked | No |
| Git ignored | Yes, by `.gitignore` rule `release-artifacts/` |
| Exact-name script/reference | No pre-existing producer/overwrite script found; this audit report is the tracked documentation reference created by the task |

**Confirmed:** the ignored release-artifact directory prevents accidental Git staging under normal Git behavior, and no inspected script names or overwrites this exact file.

**Likely:** the lack of a producer script for the exact protected filename reduces automated-overwrite risk.

**Unresolved:** an ignored local file is not immutable. Its checksum is now documented, but the repository has no tracked checksum sidecar or write protection. Signing validity, Play signing lineage, bundle contents, and 16 KB compatibility were not revalidated because the brief prohibits artifact content inspection.

## Risks

- The protected AAB is local and ignored. Git cannot recover it if it is manually overwritten or deleted.
- Ignored generated and environment state exists. It was not treated as source authority.
- Release claims in `docs/release/` remain prior documentation, not newly verified artifact properties.

## Shared Contracts implications

The mobile repository and baseline commit are suitable as the evidence source for existing Android offline behavior. Shared Contracts should cite commit `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` when deriving compatibility evidence; later mobile changes must be assessed separately.

## Evidence sources and files inspected

- Git metadata through read-only Git commands
- `.gitignore`
- `release-artifacts/README.txt`
- `docs/release/release-engineering-environment.md`
- `docs/release/pre-internal-hardening-validation.md`
- `docs/release/claude-independent-pre-release-audit.md`

The secret-bearing `.env.local` file was detected but not inspected.

## Commands executed and outcomes

- `pwd`, `pwd -P`, `git rev-parse --show-toplevel`, and `git rev-parse --is-inside-work-tree` — authoritative path/root confirmed.
- `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, and `git rev-parse --short HEAD` — remote, branch, and exact baseline confirmed.
- `git status --short`, `git status --branch`, and `git status --short --ignored` — initially clean tracked worktree; ignored local state enumerated.
- `git worktree list --porcelain` and bounded `find` searches for nested `.git`/`.gitfile` — one worktree and no nested repository found.
- `git show --no-patch --oneline 6ed9ace` and `git merge-base --is-ancestor 6ed9ace HEAD` — expected commit exists and is the current ancestor/HEAD.
- `find` and `git ls-files --others --ignored --exclude-standard` — ignored artifact and generated state located. The latter produced a very large list because `node_modules/` is installed; conclusions use targeted follow-up commands.
- `stat`, `shasum -a 256`, `git check-ignore -v`, and `git ls-files --error-unmatch` for the protected AAB — metadata/checksum recorded; ignored and untracked status confirmed.
- `rg` for the protected filename and `release-artifacts` — no exact-name producer script found.

## Limitations

No network request was made to GitHub, so this report verifies configured local authority and upstream tracking metadata, not current server-side branch protection or remote object availability. The AAB was read only to compute SHA-256; no artifact internals, credentials, signing material, physical device, or Play Console state were inspected.

## Later release-verification addendum

On 2026-07-30, a separate, approved release-gate task performed read-only
content, signing, permission, backup, static cloud-boundary, bundle, and 16 KB
inspection of the protected versionCode 2 AAB. The independently verified EAS
production upload-certificate fingerprint exactly matched its signer. See the
[versionCode 2 AAB verification](../release/versioncode-2-aab-verification.md).

This addendum does not retroactively expand or rewrite the MOB-0 inspection scope
recorded above. Play Console state, upload, runtime installation, and owner-owned
release prerequisites remain outside this discovery report.

## Next approval gate

Recommended MOB-0 disposition: **Conditionally Accept**, subject to explicit Verification Pause A approval and an owner decision on whether the local protected AAB needs an external immutable backup/checksum record. No repository action is required to continue MOB-1 discovery.
