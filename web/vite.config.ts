/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'path'
// @ts-expect-error — plain .mjs helper shared with scripts/ and the contract
// test; it has no type declarations and does not need any.
import { resolveBuildIdentity } from './scripts/buildIdentity.mjs'

const enablePwaInDev = process.env.VITE_PWA_DEV === 'true'
const mockedE2eBuild =
  process.env.npm_lifecycle_event === 'e2e:build'
  && process.env.E2E_MOCKS !== '0'

// ── CLEAN-02: transform-plugin ownership across two Vite majors ──────────────
// `vite build` / `vite dev` run on the Vite in devDependencies (5.x), where
// `@vitejs/plugin-react` configures the automatic JSX runtime through Vite's
// `esbuild` option. Vitest 4 does NOT use that Vite — it resolves its own
// nested Vite 8 (rolldown/OXC), where `esbuild` and `optimizeDeps.esbuildOptions`
// are deprecated in favour of `oxc` / `optimizeDeps.rolldownOptions`. Loading
// plugin-react under Vitest is what emitted:
//   [vite] warning: `esbuild` option was specified by "vite:react-babel" plugin.
//                   This option is deprecated, please use `oxc` instead.
//   [vite] warning: `optimizeDeps.esbuildOptions` option was specified by
//                   "vite:react-babel" plugin. ... use `optimizeDeps.rolldownOptions`
//   Both esbuild and oxc options were set. oxc options will be used and esbuild
//   options will be ignored.
// plugin-react only contributes Fast Refresh (dev server) and the automatic JSX
// runtime (build). Vitest needs neither: it compiles JSX itself and reads
// `"jsx": "react-jsx"` from tsconfig.json, so the OXC pipeline already emits the
// automatic runtime. Skipping the plugin under Vitest removes the deprecated
// options at their source without pinning plugin-react to a major that drops
// Vite 5 support. `scripts/check-vite-deprecations.mjs` is the executable
// regression gate; `src/__tests__/viteTransformConfig.test.ts` is the fast one.
const isVitest = process.env.VITEST !== undefined

// ── CLEAN-04: source maps are private by default ─────────────────────────────
// `sourcemap: true` emitted `.map` files AND a `//# sourceMappingURL=` comment
// into every chunk. Those maps were copied verbatim into the nginx document
// root by Dockerfile.web, so any visitor could reconstruct the entire frontend
// source tree. There is no error-tooling upload integration in this repo, so
// the default is now "no maps at all" and the production image cannot leak what
// was never built.
//
//   VITE_SOURCEMAP_MODE=private  → 'hidden' maps: full `.map` files are emitted
//                                  for CI-only analysis (bundle-size icon
//                                  locality, the duplicate-module gate) with NO
//                                  `sourceMappingURL` comment, so browsers never
//                                  request them. They MUST NOT be published.
//   anything else / unset        → false: nothing is emitted.
//
// `scripts/check-source-maps.mjs` enforces both halves of this contract against
// the actual build output plus the Docker/nginx serving path.
const sourcemapMode = (process.env.VITE_SOURCEMAP_MODE ?? '').trim().toLowerCase()
const sourcemap: 'hidden' | false = sourcemapMode === 'private' ? 'hidden' : false

const verifyEnglishCatalogSplit = {
  name: 'verify-english-catalog-split',
  buildStart() {
    execSync(`${JSON.stringify(process.execPath)} scripts/split-i18n-catalog.mjs --check`, {
      cwd: __dirname,
      stdio: 'inherit',
    })
    execSync(`${JSON.stringify(process.execPath)} scripts/audit-i18n-namespaces.mjs --strict`, {
      cwd: __dirname,
      stdio: 'inherit',
    })
  },
}

// ── Build identity (release version + cache-busting SHA) ─────────────────────
// Resolution lives in `scripts/buildIdentity.mjs` so the build, the release
// gate (`scripts/check-release-build-identity.mjs`) and the contract test
// (`src/__tests__/releaseBuildIdentity.contract.test.ts`) all exercise the same
// code path.
//
// - VITE_APP_VERSION: supplied by release.yml (canonical release version).
//   When absent the build is UNVERSIONED and reports `dev-<pkg.version>`, which
//   `parseVersion` deliberately cannot read — an unversioned SPA must never
//   look "older" than the API and pin an undismissible updateRequired prompt.
// - VITE_GIT_SHA: supplied by release.yml (immutable per-build commit), else
//   discovered from the local checkout, else `dev`. It is the rotating half of
//   BUILD_ID, which suffixes every versioned Cache Storage bucket.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }

// A Vitest run is a controlled fixture, never a deployable artifact, and it is
// the ONLY context where the ambient identity is allowed to be a bare package
// version. `usePwaUpdate`'s handshake specs read the module-level `APP_VERSION`
// from `src/sw/buildContract.ts` (there is no injection point — the hook calls
// `evaluateContractHandshake()` with no client override), so an unparseable
// `dev-…` identity would make every verdict `unknown` and silently void the
// assets-stale / server-behind / updateRequired assertions instead of failing
// them. Pinning the package version keeps those specs meaningful.
//
// This must never widen: an explicit VITE_APP_VERSION still wins, and the
// production property — that a build without a release version reports an
// UNPARSEABLE identity — is asserted at the resolver level by
// `src/__tests__/releaseBuildIdentity.contract.test.ts` and against the real
// image by `.github/workflows/ci.yml` ("Web image build identity is
// unversioned-and-harmless").
const identityEnv =
  isVitest && !process.env.VITE_APP_VERSION
    ? { ...process.env, VITE_APP_VERSION: pkg.version }
    : process.env

const buildIdentity = resolveBuildIdentity({
  env: identityEnv,
  packageVersion: pkg.version,
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
const appVersion = buildIdentity.appVersion
const gitSha = buildIdentity.gitSha

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
    // Bare-identifier twins of the two values above, consumed by
    // `src/sw/buildContract.ts`. That module is shared by the page and the
    // service worker, and the worker's TypeScript project deliberately has
    // no `vite/client` types, so it cannot reference `import.meta.env`.
    // vite-plugin-pwa's nested SW build inherits this `define` block
    // (see node_modules/vite-plugin-pwa/dist/vite-build-*.js — `prepareViteBuild`
    // copies `viteOptions.define`), so both bundles agree on the build id.
    __PWA_APP_VERSION__: JSON.stringify(appVersion),
    __PWA_GIT_SHA__: JSON.stringify(gitSha),
  },
  plugins: [
    // See the `isVitest` note above (CLEAN-02).
    ...(isVitest ? [] : [react()]),
    verifyEnglishCatalogSplit,
    VitePWA({
      // Mocked browser suites intercept every API request. Omitting the worker
      // prevents Workbox from bypassing those fixtures; production builds and
      // deployed, unmocked smoke retain the full PWA lifecycle.
      disable: mockedE2eBuild,
      // PWA-03: NO forced auto-update.
      //
      // 'autoUpdate' reloads controlled pages the moment a new SW activates.
      // On a phone that means the app can be swapped out mid-form, and on a
      // desktop it means a background tab silently discards unsaved work. The
      // update lifecycle is owned by `hooks/usePwaUpdate.ts` instead: it
      // surfaces release context, refuses to reload while a registered
      // navigation guard reports unsaved work, coordinates sibling tabs, and
      // escalates to a REQUIRED update only when the API contract handshake
      // says the cached assets predate the running backend.
      //
      // 'prompt' mode requires src/sw/sw.ts to keep its message-driven
      // SKIP_WAITING handler (injectManifest cannot inject one) and to NOT
      // call self.skipWaiting() from `install`.
      registerType: 'prompt',
      // switched from the default `generateSW`
      // strategy to `injectManifest` so we can register a custom `push`
      // event handler in the service worker. Workbox runtime caching
      // (Google Fonts, map tiles) is re-implemented inside `src/sw/sw.ts`
      // so caching behaviour does not regress.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectManifest: {
        // Precache only the small install/offline shell. Route JavaScript and
        // CSS are cached on demand by sw.ts instead of downloading all 500+
        // lazy chunks during first install. Large branding source files are
        // intentionally absent from this list.
        //
        // HTML remains excluded — index.html MUST NOT be precached
        // behind a ForwardAuth proxy (Authentik/Authelia/oauth2-proxy).
        // workbox-precaching's `directoryIndex` default rewrites a GET /
        // to /index.html and serves it from cache, swallowing top-level
        // navigations that the proxy needs to intercept on session
        // expiry. The result was a refresh loop on / that only cleared
        // when the user manually deleted site cookies (which Chrome
        // bundles with SW unregistration). Navigation requests are now
        // handled by the NavigationRoute(NetworkFirst) registered in
        // sw.ts so offline launch still works without the loop.
        globPatterns: [
          // `manifest.webmanifest` is NOT listed: vite-plugin-pwa already adds
          // the generated manifest to the precache itself, and listing it again
          // produces a duplicate entry that `check-pwa-precache.mjs` rejects.
          'watch-manifest.json',
          'assets/spritesheet-*.svg',
        ],
      },
      includeAssets: [
        'favicon.svg',
        'icons/apple-touch-icon.png',
        'icons/badge-72.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-192.png',
        'icons/icon-maskable-512.png',
      ],
      manifest: {
        // `id` pins the app identity across `start_url` changes. Without it a
        // future start_url edit is treated by Android as a DIFFERENT app and
        // the user ends up with two icons on the home screen.
        id: '/',
        name: 'TeslaSync',
        short_name: 'TeslaSync',
        description: 'Advanced Tesla Fleet Management & Analytics Platform',
        start_url: '/',
        // `scope` must contain `start_url`. Navigations outside it (the
        // ForwardAuth provider's own login origin, for example) leave the
        // standalone window and open in the browser, which is exactly the
        // behaviour we want for an external identity provider.
        scope: '/',
        lang: 'en',
        dir: 'ltr',
        display: 'standalone',
        // Ordered fallback chain. iOS ignores this entirely and keys off
        // `apple-mobile-web-app-capable` in index.html; Android honours it.
        display_override: ['standalone', 'minimal-ui', 'browser'],
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        orientation: 'any',
        categories: ['auto', 'utilities'],
        // Focus the existing window instead of spawning a second one when a
        // notification deep link or an OS shortcut launches the app.
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        prefer_related_applications: false,
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Quick Glance',
            short_name: 'Glance',
            url: '/glance',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Notification inbox',
            short_name: 'Inbox',
            url: '/notifications/inbox',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Vehicles',
            short_name: 'Vehicles',
            url: '/vehicles',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
      devOptions: {
        enabled: enablePwaInDev,
        // Custom SW source is TypeScript — esbuild handles compilation
        // when `type: 'module'` is set on the registered worker.
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Default is 5000ms. CI runners (especially shared / cgroup-throttled
    // self-hosted ones) routinely starve vitest workers enough that 5s
    // is below the noise floor for tests that mount QueryClient + Router
    // + lazy-loaded chart components. 30s is generous enough to absorb
    // CI jitter while still catching genuinely runaway tests. Locally
    // the suite still completes in ~80s.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // ── CLEAN-01: cyclic cross-chunk re-exports are build errors ───────────
      // Rollup emits CYCLIC_CROSS_CHUNK_REEXPORT when a module is re-exported
      // through a barrel that is itself a (transitive) dependency of that
      // module AND the two land in different chunks. The emitted chunks then
      // import each other, and the runtime execution order is whatever the
      // bundler happened to pick — the classic "X is not a function during
      // module init" production-only crash.
      //
      // The concrete instance was `components/feedback/index.ts` <->
      // `components/feedback/ErrorDisplay.tsx`, closed by
      // `_StatusAwareError -> @/components/ui (barrel) -> ui/SignalConfigModal
      // -> @/components/feedback (barrel)`. Both edges now use direct module
      // paths. Promoting the warning to an error keeps it that way: the fix is
      // always to import the concrete module instead of the category barrel
      // from *inside* `components/` (feature/page call sites keep using the
      // category barrels).
      onwarn(warning, defaultHandler) {
        if (warning.code === 'CYCLIC_CROSS_CHUNK_REEXPORT') {
          throw new Error(
            `[vite] CYCLIC_CROSS_CHUNK_REEXPORT is not allowed: ${warning.message}\n`
            + 'Import the concrete module instead of the category barrel from inside src/components/.',
          )
        }
        defaultHandler(warning)
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-motion': ['framer-motion'],
          // lucide-react is deliberately NOT force-grouped. Naming it here
          // hoisted every icon the whole app imports — 426 modules — into a
          // single chunk that the entry statically imports, so ~200 icons that
          // only lazy routes ever render were downloaded during cold start.
          // Letting Rollup place icons by importer keeps shell icons in the
          // startup closure and route-only icons in their route chunk.
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
})
