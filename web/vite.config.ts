/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'path'

const enablePwaInDev = process.env.VITE_PWA_DEV === 'true'

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
      registerType: 'prompt',
      // Phase 40 / Prompt 52 — switched from the default `generateSW`
      // strategy to `injectManifest` so we can register a custom `push`
      // event handler in the service worker. Workbox runtime caching
      // (Google Fonts, map tiles) is re-implemented inside `src/sw/sw.ts`
      // so caching behaviour does not regress.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      injectManifest: {
        // Same precache scope as the previous generateSW config.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,json}'],
      },
      includeAssets: ['favicon.svg', 'offline.html', 'icons/*.svg', 'icons/*.png'],
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
      reporter: ['text', 'lcov'],
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
