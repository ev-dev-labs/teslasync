#!/usr/bin/env node
/**
 * Executable PWA manifest / service-worker contract (PWA-01 … PWA-08).
 *
 * Runs as part of `postbuild`, and standalone via `npm run check:pwa-contract`.
 *
 * Two families of assertion:
 *
 *   1. **Source contracts** — hold without a build. The cached-read allowlist
 *      must not name a sensitive endpoint, must be GET-shaped, and must point
 *      at routes that actually exist in `internal/api/router.go`. The service
 *      worker must not force an auto-update.
 *   2. **Build contracts** — need `dist/`. The generated web manifest must be
 *      installable on Android AND iOS: real icon files at their declared
 *      pixel sizes, a maskable pair, an `id`/`scope`/`start_url` that agree,
 *      and the iOS meta tags Safari needs for a standalone launch.
 *
 * Pass `--source-only` to skip the build contracts (used by CI steps that run
 * before `vite build`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
// Build identity is resolved from the same module `vite.config.ts` uses, so
// this gate can never disagree with the build about what BUILD_ID is.
import { releaseIdentityProblems, resolveBuildIdentity } from './buildIdentity.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')
const DIST_ROOT = join(WEB_ROOT, 'dist')
const SOURCE_ONLY = process.argv.includes('--source-only')

const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function readFile(path) {
  return readFileSync(path, 'utf8')
}

/** Width/height from a PNG IHDR chunk. Returns null for a non-PNG. */
function pngSize(path) {
  const buffer = readFileSync(path)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// ── 1. Source contracts ─────────────────────────────────────────────────────

function checkApiCacheAllowlist() {
  const source = readFile(join(WEB_ROOT, 'src', 'sw', 'apiCachePolicy.ts'))

  const listMatch = /CACHEABLE_READ_PATTERNS[^=]*=\s*\[([\s\S]*?)\]/.exec(source)
  if (!listMatch) {
    fail('apiCachePolicy.ts: CACHEABLE_READ_PATTERNS could not be parsed')
    return
  }
  const patterns = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (patterns.length === 0) {
    fail('apiCachePolicy.ts: the cached-read allowlist is empty')
    return
  }

  const markerMatch = /SENSITIVE_PATH_MARKERS[^=]*=\s*\[([\s\S]*?)\]/.exec(source)
  const markers = markerMatch
    ? [...markerMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : []
  if (markers.length === 0) {
    fail('apiCachePolicy.ts: SENSITIVE_PATH_MARKERS could not be parsed')
  }

  for (const pattern of patterns) {
    if (!pattern.startsWith('/')) {
      fail(`cached-read allowlist entry is not an absolute path: ${pattern}`)
    }
    const lower = pattern.toLowerCase()
    const hit = markers.find((marker) => lower.includes(marker))
    if (hit != null) {
      fail(
        `cached-read allowlist entry "${pattern}" contains the sensitive marker "${hit}" — it would be rejected at runtime, so listing it is a contradiction`,
      )
    }
  }

  // Every allowlisted read must correspond to a real backend route.
  const routerPath = join(REPO_ROOT, 'internal', 'api', 'router.go')
  if (!existsSync(routerPath)) {
    notes.push('internal/api/router.go not found — skipped route cross-check')
    return
  }
  const router = readFile(routerPath)
  for (const pattern of patterns) {
    // `/vehicles/:id/state` → the last literal segment must appear in a chi
    // route registration somewhere in the router.
    const segments = pattern.split('/').filter((s) => s !== '' && s !== ':id')
    const needle = segments.length === 0 ? '/' : segments[segments.length - 1]
    if (!router.includes(`"${needle}"`) && !router.includes(`/${needle}`)) {
      fail(
        `cached-read allowlist entry "${pattern}" has no matching route in internal/api/router.go`,
      )
    }
  }
  notes.push(`cached-read allowlist: ${patterns.length} vetted GET endpoints`)
}

/** Crude comment stripper — enough to keep prose out of the AST assertions. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Parsed-source cache.
 *
 * The ownership check now walks the tree once per component, and the contract
 * test walks it several more times. Re-parsing ~700 files with TypeScript each
 * time is the dominant cost, so the AST is memoised per file and invalidated
 * by content (synthetic sources in tests share the default `input.tsx` name,
 * so the key alone is not enough).
 */
const parseCache = new Map()

function parseSource(fileName, source) {
  const hit = parseCache.get(fileName)
  if (hit !== undefined && hit.text === source) return hit.sourceFile

  const scriptKind = /\.[cm]?ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.TSX
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind,
  )
  parseCache.set(fileName, { text: source, sourceFile })
  return sourceFile
}

/**
 * Count JSX mounts of `<Name …>` / `<Name />` using the TypeScript parser.
 *
 * ## Why a real parser
 *
 * This started as a hand-rolled scanner that stripped comments and string
 * literals before matching `<Name`. It was **fail-open**, and the earlier
 * comment claiming otherwise was wrong. Two constructs desynchronised it and
 * silently swallowed every mount that followed:
 *
 *   - an apostrophe in raw JSX text — `<p>You're offline</p>` — which is not
 *     a string literal at all, but looked like the start of one; and
 *   - a regex literal containing a quote — `/['"]/` — same failure.
 *
 * Everything up to the next matching quote was deleted, so a duplicate mount
 * appended after such a line was invisible to the gate. That is the worst
 * possible direction for a contract check: it reports green while the defect
 * ships.
 *
 * `ts.createSourceFile` with `ScriptKind.TSX` gives the real grammar for
 * free — the compiler is already a devDependency because `tsc` runs in this
 * package. Only exact `JsxSelfClosingElement` / `JsxOpeningElement` tag
 * identifiers are counted, which rules out by construction:
 *
 *   - comments, string literals, template literals and regex literals
 *     (they are not JSX elements);
 *   - imports, re-exports and type positions (`typeof OfflineBanner`);
 *   - the closing half of a paired tag (`JsxClosingElement`), so
 *     `<Name>…</Name>` counts once;
 *   - member and namespaced tags (`<Feedback.OfflineBanner />`,
 *     `<svg:OfflineBanner />`) whose `tagName` is not a bare identifier;
 *   - prefix collisions (`<OfflineBannerHost />`), because the identifier is
 *     compared for equality rather than by `startsWith`.
 *
 * Exported for `src/sw/__tests__/pwaContractOwnership.test.ts`.
 *
 * @param fileName only selects the parse mode; `.ts` is parsed as TS (where
 *                 `<X>` is a type assertion, not JSX) and everything else as
 *                 TSX.
 */
export function countComponentMounts(source, componentName, fileName = 'input.tsx') {
  const sourceFile = parseSource(fileName, source)

  let count = 0
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName
      if (ts.isIdentifier(tag) && tag.text === componentName) count += 1
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)

  return count
}

/** Files excluded from the "production mount" count. */
export function isNonProductionSourceFile(relativePath) {
  const path = relativePath.split(sep).join('/')
  return (
    /(^|\/)__tests__\//.test(path)
    || /(^|\/)__mocks__\//.test(path)
    || /(^|\/)__fixtures__\//.test(path)
    || /(^|\/)test\//.test(path)
    || /\.test\.[cm]?[jt]sx?$/.test(path)
    || /\.spec\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)test-setup\.[cm]?[jt]sx?$/.test(path)
  )
}

/** Memoised so repeated tree walks (one per component) do not re-stat. */
const fileListCache = new Map()

/** Every `.ts` / `.tsx` file under `dir` that ships to users. */
export function listProductionSourceFiles(dir, rootDir = dir, out = null) {
  const isTopLevel = out === null
  if (isTopLevel) {
    const cached = fileListCache.get(dir)
    if (cached !== undefined) return cached
  }
  const files = out ?? []

  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    if (statSync(absolute).isDirectory()) {
      if (entry === 'node_modules') continue
      listProductionSourceFiles(absolute, rootDir, files)
      continue
    }
    if (!/\.[cm]?tsx?$/.test(entry)) continue
    const rel = relative(rootDir, absolute)
    if (isNonProductionSourceFile(rel)) continue
    files.push(absolute)
  }

  if (isTopLevel) fileListCache.set(dir, files)
  return files
}

/**
 * Every production file that mounts `<Name>`, with its mount count.
 * Paths are returned repo-relative (`src/...`) for readable failures.
 */
export function findComponentMounts(srcDir, componentName) {
  const hits = []
  for (const file of listProductionSourceFiles(srcDir)) {
    const count = countComponentMounts(
      readFileSync(file, 'utf8'),
      componentName,
      file,
    )
    if (count > 0) {
      hits.push({
        file: `src/${relative(srcDir, file).split(sep).join('/')}`,
        count,
      })
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file))
}

function checkServiceWorkerSource() {
  const source = stripComments(readFile(join(WEB_ROOT, 'src', 'sw', 'sw.ts')))

  // PWA-03: no forced auto-update. `skipWaiting` may appear only inside the
  // message handler that a page explicitly drives.
  const installListener = /addEventListener\(\s*'install'/.test(source)
  if (installListener) {
    fail(
      "sw.ts registers an 'install' listener — a forced self.skipWaiting() there would swap the app out from under the user (PWA-03)",
    )
  }
  const skipWaitingCount = (source.match(/self\.skipWaiting\(\)/g) ?? []).length
  if (skipWaitingCount !== 1) {
    fail(
      `sw.ts must call self.skipWaiting() exactly once (inside the SKIP_WAITING message handler); found ${skipWaitingCount}`,
    )
  }

  for (const [needle, why] of [
    ['sanitizeNotificationUrl', 'notification deep links must be sanitised (PWA-06)'],
    ['evaluateNotification', 'the device notification policy must be applied (PWA-05)'],
    ['staleCacheNames', 'stale build caches must be purged on activate (PWA-04)'],
    ['CACHED_AT_HEADER', 'cached API reads must be stamped with a capture time (PWA-02)'],
    ['skipWritesUnderLowBandwidth', 'low-bandwidth mode must suppress bulk media caching (PWA-07)'],
    [
      'isCachedEntryExpired',
      'the offline fallback must enforce API_CACHE_MAX_AGE_SECONDS instead of serving an unbounded stale read (PWA-02)',
    ],
    [
      'readCachedAt',
      'the offline fallback must read the capture stamp before deciding to serve a cached entry (PWA-02)',
    ],
    [
      'isApiReadCacheName',
      'a purge must sweep the API bucket of every build id, not just the current one',
    ],
  ]) {
    if (!source.includes(needle)) fail(`sw.ts is missing ${needle} — ${why}`)
  }
}

/**
 * Every identity transition must drop the previous session's cached API
 * reads. `navigateToReauth()` is the single funnel for sign-out, session
 * expiry and reauth, so the purge belongs there — before the navigation, not
 * after it, because after it the document is gone.
 */
function checkIdentityTransitionPurge() {
  const resiliencePath = join(WEB_ROOT, 'src', 'lib', 'resilience.ts')
  if (!existsSync(resiliencePath)) {
    fail('src/lib/resilience.ts not found — cannot verify the sign-out purge')
    return
  }
  const source = stripComments(readFile(resiliencePath))

  const fn = /export function navigateToReauth\(\)[^{]*\{([\s\S]*?)\n\}/.exec(source)
  if (!fn) {
    fail('resilience.ts: navigateToReauth() could not be parsed')
    return
  }
  const body = fn[1]

  if (!body.includes('purgeServiceWorkerApiCache()')) {
    fail(
      'navigateToReauth() does not purge the cached API reads — a signed-out browser would keep serving the previous identity’s data from Cache Storage',
    )
  }
  if (!body.includes("broadcast({ type: 'auth.logout' })")) {
    fail('navigateToReauth() does not broadcast auth.logout, so sibling tabs never purge')
  }

  const purgeAt = body.indexOf('purgeServiceWorkerApiCache()')
  const assignAt = body.indexOf('window.location.assign')
  const reloadAt = body.indexOf('window.location.reload')
  const navigateAt = Math.min(
    assignAt === -1 ? Number.MAX_SAFE_INTEGER : assignAt,
    reloadAt === -1 ? Number.MAX_SAFE_INTEGER : reloadAt,
  )
  if (purgeAt !== -1 && navigateAt !== Number.MAX_SAFE_INTEGER && purgeAt > navigateAt) {
    fail('navigateToReauth() purges AFTER navigating — the purge would never run')
  }

  // The receiving half of the funnel: a sibling tab that did not navigate.
  const hostPath = join(WEB_ROOT, 'src', 'components', 'feedback', 'ReloadPrompt.tsx')
  if (existsSync(hostPath)) {
    const host = stripComments(readFile(hostPath))
    if (!host.includes("'auth.logout'") || !host.includes('purgeServiceWorkerApiCache')) {
      fail(
        'ReloadPrompt.tsx does not purge on the auth.logout broadcast — the sibling-tab funnel is unwired',
      )
    }
  } else {
    fail('ReloadPrompt.tsx not found — cannot verify the auth.logout purge funnel')
  }

  notes.push('identity transition: purge wired on both the direct and broadcast funnels')
}

/**
 * The browser-offline announcement must be globally available exactly once.
 *
 * It used to be mounted by `<Layout>` and gated on standard presentation
 * mode, which made ownership positional: the six routes that never mount
 * `<Layout>` (/quick-stats, /glance, /year-review/:year, /s/:token, /watch,
 * /onboarding) and every report/kiosk view announced it zero times. The owner
 * is now `<ReloadPrompt>`, the app-root PWA host.
 *
 * The first version of this check only asked "does ReloadPrompt mount it, and
 * does Layout not?". That was false assurance in two directions:
 *
 *  1. a second mount added to ANY other file — a new shell, a route wrapper,
 *     a modal host — would sail through and double the announcement;
 *  2. nothing asserted that `main.tsx` still renders `<ReloadPrompt />`. The
 *     focused tests render the host directly, so deleting the root mount
 *     would make production silent while every gate stayed green.
 *
 * It is now a whole-source-tree count over the TypeScript AST: exactly one
 * production mount of `<OfflineBanner>`, in ReloadPrompt, and exactly one
 * production mount of `<ReloadPrompt>`, in `main.tsx`.
 */
function checkOfflineAnnouncementOwnership() {
  const hostRelative = 'src/components/feedback/ReloadPrompt.tsx'
  const rootRelative = 'src/main.tsx'
  const hostPath = join(WEB_ROOT, 'src', 'components', 'feedback', 'ReloadPrompt.tsx')
  const srcDir = join(WEB_ROOT, 'src')

  if (!existsSync(hostPath)) {
    fail('ReloadPrompt.tsx not found — cannot verify offline announcement ownership')
    return
  }

  /**
   * Assert a component is mounted exactly once across production source, in
   * the expected file. Used for both halves of the ownership chain.
   */
  const expectSingleMount = (componentName, expectedFile, zeroMessage, extraMessage) => {
    const mounts = findComponentMounts(srcDir, componentName)
    const total = mounts.reduce((sum, entry) => sum + entry.count, 0)

    if (total === 0) {
      fail(zeroMessage)
      return
    }
    if (total > 1) {
      fail(
        `<${componentName}> is mounted ${total} times in production source (${mounts
          .map((entry) => `${entry.file}×${entry.count}`)
          .join(', ')}) — ${extraMessage}`,
      )
      return
    }
    if (mounts[0].file !== expectedFile) {
      fail(
        `<${componentName}> is mounted by ${mounts[0].file} instead of ${expectedFile} — ownership must not move without updating this contract`,
      )
    }
  }

  // ── Exactly one production mount of <OfflineBanner>, and it is the host ──
  expectSingleMount(
    'OfflineBanner',
    hostRelative,
    'no production file mounts <OfflineBanner> — every route would announce the offline transition zero times',
    'each extra mount is a duplicate live region and a doubled announcement',
  )

  // ── Exactly one production mount of the host itself, and it is main.tsx ──
  //
  // Checking only inside main.tsx was fail-open in the other direction: a
  // second <ReloadPrompt /> added to App.tsx, a shell, or a route wrapper
  // would duplicate every live region AND every lifecycle subscription the
  // host owns (update polling, the BroadcastChannel listeners, the
  // auth.logout purge) while main.tsx still read as correct.
  expectSingleMount(
    'ReloadPrompt',
    rootRelative,
    'no production file mounts <ReloadPrompt /> — the offline announcer, update prompt and lifecycle recovery would all be dead in production even though their focused tests still pass',
    'a second host duplicates every live region and lifecycle subscription it owns',
  )

  // The disclosure that sits beside the banner must stay non-live, otherwise
  // the same transition is spoken twice.
  const host = stripComments(readFile(hostPath))
  if (!host.includes('announce={false}')) {
    fail(
      'ReloadPrompt.tsx must render <CachedDataNotice announce={false}> so the offline transition is announced once, by the banner',
    )
  }

  notes.push(
    `offline announcement: 1 production <OfflineBanner> mount (${hostRelative}), 1 <ReloadPrompt /> mount (${rootRelative})`,
  )
}

function checkViteConfig() {
  const source = readFile(join(WEB_ROOT, 'vite.config.ts'))
  if (/registerType:\s*'autoUpdate'/.test(source)) {
    fail("vite.config.ts uses registerType: 'autoUpdate' — forced auto-update is prohibited (PWA-03)")
  }
  if (!/registerType:\s*'prompt'/.test(source)) {
    fail("vite.config.ts must set registerType: 'prompt'")
  }
  for (const key of ['id:', 'scope:', 'display_override:', 'launch_handler:', 'share_target:']) {
    if (!source.includes(key)) {
      fail(`vite.config.ts manifest is missing "${key}" (PWA-01)`)
    }
  }
}

function checkIndexHtmlSource() {
  const html = readFile(join(WEB_ROOT, 'index.html'))
  assertInstallMeta(html, 'index.html')
}

function assertInstallMeta(html, label) {
  const required = [
    ['viewport-fit=cover', 'safe-area insets need viewport-fit=cover'],
    ['name="apple-mobile-web-app-capable"', 'iOS standalone launch requires the vendor-prefixed tag'],
    ['name="mobile-web-app-capable"', 'Android standalone launch'],
    ['name="apple-mobile-web-app-title"', 'iOS home-screen label'],
    ['name="apple-mobile-web-app-status-bar-style"', 'iOS status bar styling'],
    ['rel="apple-touch-icon"', 'iOS home-screen icon'],
    ['name="theme-color"', 'Android toolbar colour'],
  ]
  for (const [needle, why] of required) {
    if (!html.includes(needle)) fail(`${label} is missing ${needle} — ${why}`)
  }
}

// ── 2. Build contracts ──────────────────────────────────────────────────────

function checkManifest() {
  const manifestPath = join(DIST_ROOT, 'manifest.webmanifest')
  if (!existsSync(manifestPath)) {
    fail('dist/manifest.webmanifest not found — run `npm run build` first')
    return
  }
  let manifest
  try {
    manifest = JSON.parse(readFile(manifestPath))
  } catch (error) {
    fail(`dist/manifest.webmanifest is not valid JSON: ${error.message}`)
    return
  }

  for (const field of [
    'id',
    'name',
    'short_name',
    'start_url',
    'scope',
    'display',
    'theme_color',
    'background_color',
    'icons',
  ]) {
    if (manifest[field] == null || manifest[field] === '') {
      fail(`manifest is missing required field "${field}"`)
    }
  }

  if (manifest.display !== 'standalone') {
    fail(`manifest.display must be "standalone", got "${manifest.display}"`)
  }
  if (typeof manifest.start_url === 'string' && typeof manifest.scope === 'string') {
    if (!manifest.start_url.startsWith(manifest.scope)) {
      fail(
        `manifest.start_url (${manifest.start_url}) must be inside manifest.scope (${manifest.scope})`,
      )
    }
  }
  if (manifest.short_name != null && manifest.short_name.length > 12) {
    fail(`manifest.short_name "${manifest.short_name}" exceeds the 12-character home-screen budget`)
  }

  const shareTarget = manifest.share_target
  if (
    shareTarget?.action !== '/share-target'
    || shareTarget?.method !== 'POST'
    || shareTarget?.enctype !== 'multipart/form-data'
    || shareTarget?.params?.title !== 'title'
    || shareTarget?.params?.text !== 'text'
    || shareTarget?.params?.url !== 'url'
  ) {
    fail('manifest share_target must POST title/text/url as multipart/form-data to /share-target')
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  const seen = new Set()
  for (const icon of icons) {
    const src = String(icon.src ?? '')
    const file = join(DIST_ROOT, src.replace(/^\/+/, ''))
    if (!existsSync(file)) {
      fail(`manifest icon ${src} is declared but missing from dist/`)
      continue
    }
    const [declaredW, declaredH] = String(icon.sizes ?? '')
      .split('x')
      .map((n) => Number.parseInt(n, 10))
    const actual = pngSize(file)
    if (actual == null) {
      fail(`manifest icon ${src} is not a readable PNG`)
      continue
    }
    if (actual.width !== declaredW || actual.height !== declaredH) {
      fail(
        `manifest icon ${src} declares ${icon.sizes} but the file is ${actual.width}x${actual.height}`,
      )
    }
    for (const purpose of String(icon.purpose ?? 'any').split(/\s+/)) {
      seen.add(`${purpose}:${icon.sizes}`)
    }
  }

  for (const required of ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']) {
    if (!seen.has(required)) {
      fail(`manifest is missing a ${required.replace(':', ' ')} icon (Android install + adaptive icon)`)
    }
  }

  // Shortcuts must point at routes that exist, or the OS long-press menu
  // dumps the user on the 404 page.
  const registryPath = join(WEB_ROOT, 'src', 'lib', 'routeRegistry.ts')
  if (existsSync(registryPath)) {
    const registry = readFile(registryPath)
    for (const shortcut of manifest.shortcuts ?? []) {
      const url = String(shortcut.url ?? '')
      if (!registry.includes(`path: '${url}'`)) {
        fail(`manifest shortcut "${shortcut.name}" points at ${url}, which is not in routeRegistry.ts`)
      }
    }
  }

  notes.push(
    `manifest: ${icons.length} icons, ${(manifest.shortcuts ?? []).length} shortcuts, share target enabled`,
  )
}

function checkBuiltIndexHtml() {
  const path = join(DIST_ROOT, 'index.html')
  if (!existsSync(path)) {
    fail('dist/index.html not found — run `npm run build` first')
    return
  }
  const html = readFile(path)
  assertInstallMeta(html, 'dist/index.html')
  if (!/rel="manifest"/.test(html)) {
    fail('dist/index.html has no <link rel="manifest"> — the app is not installable')
  }
}

function checkBuiltServiceWorker() {
  const path = join(DIST_ROOT, 'sw.js')
  if (!existsSync(path)) {
    fail('dist/sw.js not found — run `npm run build` first')
    return
  }
  const worker = readFileSync(path, 'utf8')

  // The bundled worker builds cache names at runtime from CACHE_PREFIX +
  // bucket + BUILD_ID, so the concatenated literal never appears. Assert the
  // ingredients instead: the namespace, the bucket names, and the build
  // IDENTITY that gets appended to each versioned bucket.
  //
  // The identity is resolved from the SAME module the build uses
  // (`scripts/buildIdentity.mjs`) rather than read from package.json. That
  // distinction is the fix for two shipped defects:
  //
  //   * package.json's version is NOT the release version. `release.yml` now
  //     threads the canonical release version in as VITE_APP_VERSION, so a
  //     v2.1 image legitimately embeds `2.1.0` while package.json still says
  //     `2.0.0`. Asserting package.json here would fail every real release —
  //     and, worse, the previous behaviour (falling back to package.json) is
  //     exactly what pinned the shipped SPA at `2.0.0` forever and made the
  //     contract handshake raise a non-dismissible "update required" prompt
  //     from the first minor release onward.
  //   * the version alone does not make caches rotate. BUILD_ID is
  //     `<version>+<git sha>`, and the image has no `.git`, so without a
  //     VITE_GIT_SHA build arg every deploy produced the identical
  //     `<version>+dev` and `staleCacheNames()` had nothing to evict. Both
  //     halves are asserted, and a release identity ending in `+dev` is
  //     rejected outright.
  //
  // Ordinary local builds are unversioned by design (`dev-<pkg version>`,
  // deliberately unparseable) and stay green.
  const identity = resolveBuildIdentity({
    env: process.env,
    packageVersion: JSON.parse(readFile(join(WEB_ROOT, 'package.json'))).version,
    readGitSha: () => {
      try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim()
      } catch {
        return null
      }
    },
  })
  if (!worker.includes('teslasync-')) {
    fail('dist/sw.js does not namespace its caches with the teslasync- prefix')
  }
  if (!worker.includes('app-route-assets') || !worker.includes('i18n-locale-assets')) {
    fail('dist/sw.js is missing an expected runtime cache bucket')
  }
  if (!worker.includes(identity.appVersion)) {
    fail(
      `dist/sw.js does not embed the build version ${identity.appVersion} — cache versioning would collapse across deploys (PWA-04)`,
    )
  }
  if (!worker.includes(identity.gitSha)) {
    fail(
      `dist/sw.js does not embed the build sha ${identity.gitSha} — versioned cache buckets would not rotate for this deploy (PWA-04)`,
    )
  }
  for (const problem of identity.isRelease ? releaseIdentityProblems(identity) : []) {
    fail(`release build identity is not publishable: ${problem} (PWA-04)`)
  }
  if (!worker.includes('x-teslasync-cached-at')) {
    fail('dist/sw.js does not stamp cached API reads with a capture time (PWA-02)')
  }

  // PWA-03: workbox-precaching legitimately installs its own `install`
  // listener, so the presence of one is not the signal. What matters is that
  // `self.skipWaiting()` is reachable ONLY from the SKIP_WAITING message
  // handler a page explicitly drives.
  const skipWaitingCalls = (worker.match(/self\.skipWaiting\(\)/g) ?? []).length
  if (skipWaitingCalls !== 1) {
    fail(
      `dist/sw.js must call self.skipWaiting() exactly once (the SKIP_WAITING message handler); found ${skipWaitingCalls} — forced auto-update is prohibited (PWA-03)`,
    )
  }
  if (!worker.includes('SKIP_WAITING')) {
    fail('dist/sw.js has no SKIP_WAITING handler, so an update could never be applied')
  }

  notes.push(
    `sw.js: ${(worker.length / 1024).toFixed(1)} KB, 1 message-driven skipWaiting, build ${identity.buildId}`,
  )
}

// ── Run ─────────────────────────────────────────────────────────────────────

/**
 * Guarded so the module can be imported by the contract test without running
 * the audit (and without `process.exit`-ing the test runner). Same pattern as
 * `scripts/audit-forced-colors.mjs`.
 */
function main() {
  checkApiCacheAllowlist()
  checkServiceWorkerSource()
  checkIdentityTransitionPurge()
  checkOfflineAnnouncementOwnership()
  checkViteConfig()
  checkIndexHtmlSource()

  if (!SOURCE_ONLY) {
    checkManifest()
    checkBuiltIndexHtml()
    checkBuiltServiceWorker()
  }

  for (const note of notes) console.log(`[pwa-contract] ${note}`)

  if (failures.length > 0) {
    console.error('[pwa-contract] CONTRACT VIOLATIONS:')
    failures.forEach((failure) => console.error(`  - ${failure}`))
    process.exit(1)
  }

  console.log(
    `[pwa-contract] OK — ${SOURCE_ONLY ? 'source' : 'source + build'} contracts satisfied`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
