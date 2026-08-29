/**
 * @module sw/buildContract
 *
 * Build identity + cache versioning + API-contract handshake.
 *
 * This module is imported by BOTH the service worker (`sw.ts`, built by
 * vite-plugin-pwa's nested Vite build, which inherits the parent config's
 * `define` and `resolve.alias`) and the page (`hooks/usePwaUpdate.ts`). It
 * therefore contains no DOM and no ServiceWorker API access — only pure
 * functions and build-time constants — so it is safe in both scopes and
 * unit-testable in jsdom.
 *
 * ## Why cache names carry the build id
 *
 * The failure mode this prevents (PWA-04): a deploy ships new API response
 * shapes; a returning PWA still has the previous build's JavaScript chunks in
 * a runtime cache; the SW serves those stale chunks against the new API and
 * the user gets silent `undefined` reads instead of an update prompt.
 *
 * Embedding {@link BUILD_ID} in every app-owned runtime cache name makes that
 * physically impossible: a new build starts with empty app caches and the
 * previous build's caches are deleted on `activate`. Vendor caches (fonts,
 * map tiles) are deliberately NOT versioned — they carry no application
 * contract and re-downloading them on every deploy would be pure waste.
 */

/**
 * Application version, injected at build time from `package.json` via the
 * `define` block in `vite.config.ts`.
 *
 * A bare global identifier is used rather than `import.meta.env` because this
 * module is compiled by BOTH the app project (DOM lib) and the service-worker
 * project (WebWorker lib, `types: []`). Pulling in `vite/client` for the
 * worker just to type `import.meta.env` would drag the whole DOM typing
 * surface into a worker that must not have it. `typeof` guards keep the
 * module usable when the define is absent (a plain `tsc` run, an esbuild-only
 * dev worker).
 */
declare const __PWA_APP_VERSION__: string | undefined
declare const __PWA_GIT_SHA__: string | undefined

function readDefine(value: string | undefined): string {
  return typeof value === 'string' && value !== '' ? value : 'dev'
}

export const APP_VERSION: string =
  typeof __PWA_APP_VERSION__ === 'undefined' ? 'dev' : readDefine(__PWA_APP_VERSION__)

/** Short git SHA of the build, or `dev` outside a git checkout. */
export const GIT_SHA: string =
  typeof __PWA_GIT_SHA__ === 'undefined' ? 'dev' : readDefine(__PWA_GIT_SHA__)

/**
 * Stable identity of one built asset set. Two deploys with different code
 * always differ here, and the page and the service worker always agree
 * because both are compiled from this constant in the same build.
 */
export const BUILD_ID = `${APP_VERSION}+${GIT_SHA}`

/**
 * The REST contract generation this frontend build was written against.
 *
 * Bump by hand ONLY when a backend change makes previously-shipped frontend
 * assets incorrect rather than merely incomplete (a removed field, a changed
 * unit, a renamed route). The value is compared against the server's reported
 * application version by {@link evaluateContractHandshake}; a mismatch marks
 * cached assets as untrustworthy and escalates the update prompt from
 * "available" to "required".
 */
export const API_CONTRACT_VERSION = 1

/** Namespace prefix for every Cache Storage bucket this app owns. */
export const CACHE_PREFIX = 'teslasync'

/**
 * Buckets whose contents encode the application contract. These are recreated
 * on every deploy so a new HTML document can never be paired with a previous
 * build's JavaScript, CSS, locale bundle, or cached API read.
 */
export const VERSIONED_BUCKETS = [
  // Order matters for `scripts/check-pwa-precache.mjs`, which asserts that the
  // locale cache is registered before the general app-asset cache so a burst
  // of translated pages cannot evict application chunks from their budget.
  // The first textual occurrence of each bucket name in the built worker comes
  // from this array, so it must lead with the locale bucket.
  'i18n-locale-assets',
  'navigations',
  'app-route-assets',
  'app-route-images',
  'api-reads',
  'share-target',
] as const

/**
 * Buckets that are contract-free third-party content. Namespaced so
 * {@link isOwnedCacheName} can still find them, but never version-busted.
 */
export const UNVERSIONED_BUCKETS = [
  'google-fonts-stylesheets',
  'google-fonts-webfonts',
  'map-tiles',
  'device-state',
] as const

export type VersionedBucket = (typeof VERSIONED_BUCKETS)[number]
export type UnversionedBucket = (typeof UNVERSIONED_BUCKETS)[number]
export type CacheBucket = VersionedBucket | UnversionedBucket

const VERSIONED = new Set<string>(VERSIONED_BUCKETS)

/**
 * Cache Storage name for a bucket.
 *
 * Versioned buckets become `teslasync-<bucket>-<build id>`; unversioned ones
 * stay `teslasync-<bucket>`. Callers must never hand-write a cache name —
 * `activate` deletes anything owned that this build does not claim.
 */
export function cacheName(bucket: CacheBucket): string {
  return VERSIONED.has(bucket)
    ? `${CACHE_PREFIX}-${bucket}-${BUILD_ID}`
    : `${CACHE_PREFIX}-${bucket}`
}

/** Every cache name this build legitimately owns. */
export function currentCacheNames(): string[] {
  return [...VERSIONED_BUCKETS, ...UNVERSIONED_BUCKETS].map((bucket) =>
    cacheName(bucket),
  )
}

/** `true` when a Cache Storage key belongs to TeslaSync (any build). */
export function isOwnedCacheName(name: string): boolean {
  return name.startsWith(`${CACHE_PREFIX}-`)
}

/**
 * Prefix shared by the authenticated-API-read bucket of every build.
 * `cacheName('api-reads')` appends `-<BUILD_ID>` to this.
 */
export const API_CACHE_BUCKET_PREFIX = `${CACHE_PREFIX}-api-reads`

/**
 * `true` when a cache name is an API-read bucket from ANY build.
 *
 * Used by both sides of the purge: the page sweeps these directly on an
 * identity transition, and the worker sweeps them when a page asks. Scoping
 * to the current build id would leave a previous deploy's bucket — which is
 * exactly as identity-bearing — on disk after a sign-out.
 */
export function isApiReadCacheName(name: string): boolean {
  return (
    name === API_CACHE_BUCKET_PREFIX
    || name.startsWith(`${API_CACHE_BUCKET_PREFIX}-`)
  )
}

/**
 * Cache names that must be deleted during `activate`: anything we own that
 * is not in {@link currentCacheNames}. Workbox's own precache keys and any
 * unrelated origin caches are left untouched.
 */
export function staleCacheNames(existing: readonly string[]): string[] {
  const keep = new Set(currentCacheNames())
  return existing.filter((name) => isOwnedCacheName(name) && !keep.has(name))
}

/** Parsed numeric components of a `major.minor.patch` version string. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Parse the leading `major[.minor[.patch]]` of a version string. Returns
 * `null` for anything that does not start with a digit (`dev`, `unknown`,
 * an empty string), which callers treat as "no signal" rather than "older".
 */
export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string') return null
  const match = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  }
}

/** `-1 | 0 | 1` ordering of two parsed versions. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * Verdict of comparing the running frontend build against the live backend.
 *
 * - `compatible`    — same major/minor, or no usable signal in either
 *                     direction beyond patch drift. Nothing to do.
 * - `assets-stale`  — the server is NEWER by major or minor. The assets in
 *                     this tab predate the current API contract; an update
 *                     is REQUIRED, not optional.
 * - `server-behind` — the server is OLDER by major or minor. Normal during a
 *                     rolling deploy. Surfaced as a warning; we never force a
 *                     downgrade because there is nothing newer to install.
 * - `unknown`       — the server did not report a parseable version (dev
 *                     builds, `app_version: "dev"`). Never escalates.
 */
export type ContractVerdict =
  | 'compatible'
  | 'assets-stale'
  | 'server-behind'
  | 'unknown'

export interface ContractHandshake {
  verdict: ContractVerdict
  /** `true` when the update prompt must not be dismissible-forever. */
  updateRequired: boolean
  clientVersion: string
  serverVersion: string | null
  buildId: string
  apiContractVersion: number
}

export interface ContractHandshakeInput {
  /** `app_version` from `GET /system/version`. */
  serverAppVersion?: unknown
  /** Overridable for tests; defaults to this build's {@link APP_VERSION}. */
  clientAppVersion?: string
}

/**
 * Compare the running build against the backend it is talking to.
 *
 * Deliberately tolerant: only a major/minor gap is treated as a contract
 * break. Patch releases are additive by project convention, and treating
 * every patch bump as "your app is stale" would nag users through a rolling
 * deploy where half the pods still answer with the previous patch.
 */
export function evaluateContractHandshake(
  input: ContractHandshakeInput = {},
): ContractHandshake {
  const clientVersion = input.clientAppVersion ?? APP_VERSION
  const client = parseVersion(clientVersion)
  const server = parseVersion(input.serverAppVersion)

  const base = {
    clientVersion,
    serverVersion:
      typeof input.serverAppVersion === 'string' ? input.serverAppVersion : null,
    buildId: BUILD_ID,
    apiContractVersion: API_CONTRACT_VERSION,
  }

  if (client == null || server == null) {
    return { ...base, verdict: 'unknown', updateRequired: false }
  }

  // Patch drift is contract-neutral — compare on major.minor only.
  const order = compareVersions({ ...client, patch: 0 }, { ...server, patch: 0 })
  if (order === 0) {
    return { ...base, verdict: 'compatible', updateRequired: false }
  }
  if (order < 0) {
    return { ...base, verdict: 'assets-stale', updateRequired: true }
  }
  return { ...base, verdict: 'server-behind', updateRequired: false }
}
