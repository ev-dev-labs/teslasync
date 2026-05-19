/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { PluginOption } from 'vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'path'

const enablePwaInDev = process.env.VITE_PWA_DEV === 'true'

/**
 * Bundle analyser. Activated by `ANALYZE=1 npm run build` (or
 * `npm run build:analyze`). When off, the import is never resolved so the
 * dev/CI build stays exactly as fast and reproducible as before. Loaded via
 * `require()` rather than a top-level `import` so contributors who have
 * not yet run `npm install` can still build without errors (the missing
 * module path is only touched when ANALYZE=1).
 */
function bundleVisualizer(): PluginOption | null {
  if (process.env.ANALYZE !== '1') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { visualizer } = require('rollup-plugin-visualizer') as typeof import('rollup-plugin-visualizer')
    return visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
      title: 'TeslaSync bundle analyser',
    }) as PluginOption
  } catch (err) {
    console.warn('[vite] ANALYZE=1 set but rollup-plugin-visualizer is not installed. Run `npm install` to enable.', err)
    return null
  }
}

// Build-time provenance for the footer status bar (Phase-40 / Prompt 59).
//   - VITE_APP_VERSION: package.json `version`, overridable via env.
//   - VITE_GIT_SHA:     short HEAD sha; "dev" when not in a git checkout.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }
const appVersion = process.env.VITE_APP_VERSION || pkg.version || 'dev'
let gitSha = process.env.VITE_GIT_SHA || ''
if (!gitSha) {
  try {
    gitSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    gitSha = 'dev'
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
  },
  plugins: [
    react(),
    VitePWA({
      // Auto-apply SW updates instead of waiting for a user "Reload now"
      // prompt. The previous 'prompt' mode stranded mobile/PWA users on
      // older buggy SWs whenever they dismissed the update toast — which
      // mattered for any bug shipped in the SW or the auth-recovery path
      // (see resilience.ts handleAuthExpired). 'autoUpdate' requires
      // skipWaiting/clientsClaim listeners in sw.ts (injectManifest mode
      // does not auto-inject them — see src/sw/sw.ts install/activate).
      registerType: 'autoUpdate',
      // Phase 40 / Prompt 52 — switched from the default `generateSW`
      // strategy to `injectManifest` so we can register a custom `push`
      // event handler in the service worker. Workbox runtime caching
      // (Google Fonts, map tiles) is re-implemented inside `src/sw/sw.ts`
      // so caching behaviour does not regress.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectManifest: {
        // HTML intentionally excluded — index.html MUST NOT be precached
        // behind a ForwardAuth proxy (Authentik/Authelia/oauth2-proxy).
        // workbox-precaching's `directoryIndex` default rewrites a GET /
        // to /index.html and serves it from cache, swallowing top-level
        // navigations that the proxy needs to intercept on session
        // expiry. The result was a refresh loop on / that only cleared
        // when the user manually deleted site cookies (which Chrome
        // bundles with SW unregistration). Navigation requests are now
        // handled by the NavigationRoute(NetworkFirst) registered in
        // sw.ts so offline launch still works without the loop.
        globPatterns: ['**/*.{js,css,svg,png,ico,woff,woff2,json}'],
      },
      includeAssets: ['favicon.svg', 'icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'TeslaSync',
        short_name: 'TeslaSync',
        description: 'Advanced Tesla Fleet Management & Analytics Platform',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0f',
        theme_color: '#00f0ff',
        orientation: 'any',
        categories: ['auto', 'utilities'],
        icons: [
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
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
        ],
      },
      devOptions: {
        enabled: enablePwaInDev,
        // Custom SW source is TypeScript — esbuild handles compilation
        // when `type: 'module'` is set on the registered worker.
        type: 'module',
      },
    }),
    bundleVisualizer(),
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
    coverage: {
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
})
