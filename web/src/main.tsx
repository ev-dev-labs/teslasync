import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './components/feedback/Toast'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'
import { AchievementUnlockListener } from './components/feedback/AchievementUnlockListener'
import { ThemeProvider } from './components/ui/ThemeProvider'
import ReloadPrompt from './components/feedback/ReloadPrompt'
import { SelectedVehicleProvider } from './store/selectedVehicle'
import App from './App'
import './i18n'
import './index.css'

// ── Density bootstrap (Phase 40 / Prompt 44) ──────────────────────────────────
// Apply the cached UI density to <body> BEFORE React mounts so the first
// paint uses the correct row heights / padding instead of flashing the
// default `comfortable` and reflowing once the settings query resolves.
// `<DensityApplier />` (mounted under <App />) keeps this in sync with the
// server-side setting once useSettings() returns.
const DENSITY_LS_KEY = 'teslasync-density'
const ALLOWED_DENSITIES = ['compact', 'comfortable', 'spacious'] as const
try {
  const cached = localStorage.getItem(DENSITY_LS_KEY)
  const initial =
    cached && (ALLOWED_DENSITIES as readonly string[]).includes(cached)
      ? cached
      : 'comfortable'
  document.body.dataset.density = initial
} catch {
  document.body.dataset.density = 'comfortable'
}

if (import.meta.env.DEV && import.meta.env.VITE_PWA_DEV !== 'true' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then(registrations => {
      registrations.forEach(registration => {
        void registration.unregister()
      })
    })
    .catch(error => {
      console.warn('[SW] Failed to clear development service worker:', error)
    })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
      // PWA: serve cached data when the device is offline instead of
      // throwing immediately. TanStack Query keeps the query in 'paused'
      // state until `navigator.onLine` flips back to true, then automatically
      // refetches. Combined with `<OfflineBanner>` this gives Tesla owners a
      // usable app inside tunnels / dead-zones without a hard error wall.
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
      // PWA: queue mutations triggered while offline (instead of erroring) and
      // replay them automatically when the connection returns. Long-term
      // durability across full page reloads requires a persister — see the
      // out-of-scope note in phase-40 prompt 36.
      networkMode: 'offlineFirst',
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <SelectedVehicleProvider>
              <ToastProvider>
                <App />
                <ReloadPrompt />
                {/* Phase-40 / Prompt 63: celebrate locked → unlocked transitions
                    with a transient toast + confetti. Mounted alongside the
                    standard toast stack so the SSE subscription is global. */}
                <AchievementUnlockListener />
              </ToastProvider>
            </SelectedVehicleProvider>
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// ── Web Vitals reporting (Phase 40 / Prompt 35) ───────────────────────────────
// Lazy-loaded so it never blocks first paint. In dev we log to the console;
// production currently no-ops (a future prompt will POST to a backend endpoint).
// Captures the Core Web Vitals plus FCP/TTFB so we can correlate with the
// performance budget in copilot-instructions.md (FCP < 1.5s on 4G).
void import('web-vitals').then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
  const report = (m: { name: string; value: number; id: string; rating?: string }) => {
    if (import.meta.env.DEV) {
      console.debug('[web-vitals]', m.name, Math.round(m.value), m.rating ?? '', m.id)
    }
  }
  onCLS(report)
  onINP(report)
  onLCP(report)
  onFCP(report)
  onTTFB(report)
}).catch((err) => {
  if (import.meta.env.DEV) {
    console.warn('[web-vitals] failed to load:', err)
  }
})
