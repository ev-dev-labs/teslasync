/**
 * Build identity resolution — the single source of truth for `APP_VERSION`,
 * `GIT_SHA` and therefore `BUILD_ID` (`src/sw/buildContract.ts`).
 *
 * Imported by `vite.config.ts` so the build and its gates/tests can never
 * disagree about what a given environment produces.
 *
 * ## The two failure modes this exists to prevent
 *
 * **1. A permanently stale client version.**
 * `vite.config.ts` used to resolve `process.env.VITE_APP_VERSION || pkg.version`.
 * `release.yml` passed no build args to the web image, so every published SPA
 * carried `package.json`'s `2.0.0` while the API reported its git tag. At the
 * v2.1 release `evaluateContractHandshake` compares client `2.0.0` against
 * server `2.1.0`, returns `assets-stale`, and raises a **non-dismissible**
 * `updateRequired` prompt — which reloading never clears, because the next
 * build embeds `2.0.0` again. The fix has two halves: the release workflow
 * must thread the canonical version in, and an *un*versioned build must not
 * produce a version string that `parseVersion` can read.
 *
 * That second half is why an unversioned build reports `dev-<pkg.version>`
 * rather than `<pkg.version>`:
 *
 *   parseVersion('2.0.0')      -> { major: 2, ... }  -> compares as OLDER  ✗
 *   parseVersion('dev-2.0.0')  -> null               -> verdict 'unknown'  ✓
 *
 * `parseVersion` only matches a leading optional `v` followed by a digit, so
 * the `dev-` prefix makes the value deliberately unparseable — the handshake
 * treats it as "no signal" and never escalates. The literal package version is
 * still present as a substring, so the human-facing provenance string stays
 * informative and `scripts/check-pwa-precache.mjs` / `check-pwa-contract.mjs`
 * still find it in the built worker.
 *
 * **2. Cache buckets that never rotate.**
 * `BUILD_ID = APP_VERSION + '+' + GIT_SHA`, and every versioned Cache Storage
 * bucket is suffixed with it. The web image has no `.git`, so `git rev-parse`
 * failed and `GIT_SHA` became `dev`; combined with the `2.0.0` fallback, EVERY
 * deploy produced the identical `2.0.0+dev`. Stale app chunks from the
 * previous deploy therefore survived `activate` and were served against the
 * new API. Release builds must supply an immutable per-build SHA.
 */

/** `dev`, used for an absent git SHA and as the unversioned-build marker. */
export const DEV_MARKER = 'dev'

/** Prefix that makes an unversioned build's version deliberately unparseable. */
export const UNVERSIONED_PREFIX = `${DEV_MARKER}-`

/**
 * @typedef {Object} BuildIdentity
 * @property {string}  appVersion  Value for `VITE_APP_VERSION` / `__PWA_APP_VERSION__`.
 * @property {string}  gitSha      Value for `VITE_GIT_SHA` / `__PWA_GIT_SHA__`.
 * @property {string}  buildId     `appVersion + '+' + gitSha` — mirrors `BUILD_ID`.
 * @property {boolean} isRelease   True when a usable release version survived resolution.
 * @property {boolean} rotatesPerBuild True when `gitSha` is a real commit id.
 * @property {boolean} releaseIntent True when VITE_RELEASE_BUILD declared a release.
 * @property {string|null} degradedFrom Version that was dropped because no SHA
 *   was resolvable and the build did not declare release intent.
 */

/**
 * Normalise a supplied release version: trims, drops a single leading `v`, and
 * rejects values that are empty or that `parseVersion` could not read anyway.
 *
 * Returning `null` (rather than passing junk through) is what stops a
 * mis-typed build arg from silently producing a parseable-but-wrong version.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeReleaseVersion(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const stripped = trimmed.replace(/^v/, '')
  // Must look like a release version to the SAME regex the handshake uses.
  if (!/^\d+(\.\d+)*/.test(stripped)) return null
  return stripped
}

/**
 * Resolve the build identity for one build.
 *
 * ## Half-configured identities degrade instead of exploding
 *
 * A version WITHOUT an immutable SHA is not a publishable identity: it looks
 * like a release (`1.2.3+dev`) but its cache buckets never rotate. The first
 * version of this resolver produced exactly that and let the PWA contract fail
 * the build — which was correct for a release and wrong for everybody else,
 * because `docker-compose.yml` mapped the SHARED `VERSION` variable (used by
 * four Go image builds) into the web image. A self-hoster who legitimately set
 * `VERSION=1.2.3` in `.env` for their API image got a failing
 * `docker compose build` for the web image, with no way to satisfy it short of
 * inventing a SHA.
 *
 * So: unless the caller explicitly asserts RELEASE INTENT
 * (`VITE_RELEASE_BUILD=1`, set only by `.github/workflows/release.yml`), a
 * version supplied without a resolvable SHA DEGRADES to the ordinary
 * unversioned identity — deliberately unparseable, therefore incapable of
 * pinning a false "update required", and honest about not rotating caches. The
 * degradation is reported in `degradedFrom` so it can be surfaced rather than
 * hidden.
 *
 * With release intent asserted the half-identity is preserved verbatim so
 * `releaseIdentityProblems` still rejects it and the release build still fails
 * loudly.
 *
 * @param {Object} options
 * @param {Record<string, string | undefined>} [options.env]  Usually `process.env`.
 * @param {string} [options.packageVersion]  `web/package.json` `version`.
 * @param {() => string | null} [options.readGitSha]  Returns a short SHA or null.
 * @returns {BuildIdentity}
 */
export function resolveBuildIdentity({ env = {}, packageVersion, readGitSha } = {}) {
  const released = normalizeReleaseVersion(env.VITE_APP_VERSION)
  const releaseIntent = isReleaseIntent(env)

  const suppliedSha = typeof env.VITE_GIT_SHA === 'string' ? env.VITE_GIT_SHA.trim() : ''
  const discoveredSha = suppliedSha === '' && readGitSha ? (readGitSha() ?? '') : ''
  const resolvedSha = (suppliedSha || discoveredSha).trim()
  const gitSha = resolvedSha || DEV_MARKER

  const unversioned = `${UNVERSIONED_PREFIX}${(packageVersion ?? '').trim() || DEV_MARKER}`

  // Half-configured and NOT a declared release → degrade to unversioned.
  const degrade = released !== null && resolvedSha === '' && !releaseIntent
  const appVersion = degrade ? unversioned : (released ?? unversioned)

  return {
    appVersion,
    gitSha,
    buildId: `${appVersion}+${gitSha}`,
    isRelease: !degrade && released !== null,
    rotatesPerBuild: gitSha !== DEV_MARKER,
    releaseIntent,
    degradedFrom: degrade ? released : null,
  }
}

/** `true` when the caller declared this build to be a real release. */
export function isReleaseIntent(env = {}) {
  const raw = typeof env.VITE_RELEASE_BUILD === 'string' ? env.VITE_RELEASE_BUILD.trim().toLowerCase() : ''
  return raw === '1' || raw === 'true'
}

/**
 * A release identity must be BOTH parseable (so the handshake can compare it)
 * and rotating (so cache buckets bust per deploy). `2.0.0+dev` satisfies
 * neither requirement it appears to satisfy: it looks like a release version
 * but never changes.
 *
 * Only applied when the build DECLARED itself a release
 * ({@link isReleaseIntent}) or actually produced a release identity — an
 * ordinary local/compose build is unversioned by design and has nothing to
 * answer for here.
 *
 * @param {BuildIdentity} identity
 * @returns {string[]} Human-readable reasons the identity is unfit to publish.
 */
export function releaseIdentityProblems(identity) {
  const problems = []
  if (!identity.isRelease) {
    problems.push(
      `app version "${identity.appVersion}" was not supplied by the release build `
      + '(VITE_APP_VERSION build arg missing) — the published SPA would carry '
      + "package.json's version forever and go permanently stale against the API",
    )
  }
  if (!identity.rotatesPerBuild) {
    problems.push(
      `build id "${identity.buildId}" ends with "+${DEV_MARKER}" — no VITE_GIT_SHA build arg, `
      + 'so every deploy reuses the same versioned Cache Storage buckets and stale '
      + 'app chunks survive activate()',
    )
  }
  return problems
}
