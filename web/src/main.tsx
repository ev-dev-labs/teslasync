import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { createQueryClient } from '@/api/queryClient'
import { ToastProvider } from './components/feedback/Toast'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'
import { NavigationGuardProvider } from './components/feedback/NavigationGuardProvider'
import { AchievementUnlockListener } from './components/feedback/AchievementUnlockListener'
import { QueryBroadcastBridge } from './components/QueryBroadcastBridge'
import { FormatterPrefsBridge } from './components/FormatterPrefsBridge'
import { ThemeProvider } from './components/ui/ThemeProvider'
import { FontProvider, applyFontCSS, readStoredFontPrefs } from './components/ui/FontProvider'
import ReloadPrompt from './components/feedback/ReloadPrompt'
import { SelectedVehicleProvider } from './store/selectedVehicle'
import { OperationalModeProvider } from './hooks/useOperationalMode'
import { installGlobalErrorReporting, reportFrontendError } from './lib/errorReporter'
import App from './App'
import './i18n'
import './index.css'

// ── RUM bootstrap (Phase 44 / Prompt 0060) ────────────────────────────────────
// OpenTelemetry and Zone.js are intentionally loaded outside the entry chunk.
// Most deployments leave RUM disabled; they should not download the SDK only
// to execute its no-op branch. Configured deployments start it concurrently
// with React bootstrap so instrumentation never blocks first paint.
const rumEndpoint = (import.meta.env.VITE_OTLP_HTTP_ENDPOINT ?? '').trim()
if (rumEndpoint) {
  void import('./observability/rum')
    .then(({ initRum }) => initRum())
    .catch((error) => {
      console.warn('[rum] OpenTelemetry bootstrap failed:', error)
    })
} else if (import.meta.env.DEV) {
  console.info('[rum] VITE_OTLP_HTTP_ENDPOINT not set; OpenTelemetry RUM disabled.')
}

// ── Frontend error reporting (Phase 46 / Prompt 01) ───────────────────────────
// Install global window.error / window.unhandledrejection listeners BEFORE
// React mounts so we capture even very-early bootstrap exceptions. The
// reporter no-ops in dev mode (HMR + StrictMode generate too much noise to
// be useful) and gracefully buffers when offline. ErrorBoundary forwards
// React render errors and the queryCache subscription below forwards
// TanStack Query failures.
installGlobalErrorReporting()

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

// ── Font bootstrap (Typography Unit 0) ────────────────────────────────────────
// Belt to the inline <script> in index.html: re-apply the cached typography CSS
// variables from the `teslasync-font-*` localStorage keys BEFORE React mounts so
// the pre-module paint and the React mount agree on font / scale / line-height /
// tracking / heading weight. FontProvider keeps this in sync with the server-side
// `font_*` settings once its hydration fetch resolves.
try {
  applyFontCSS(readStoredFontPrefs())
} catch {
  // Best-effort — FontProvider re-applies on mount if this fails.
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

// Phase-46 / Prompt 53: defaults moved to `api/queryClient.ts` so the
// pause-when-hidden contract (`refetchIntervalInBackground: false`) and
// the rest of the shared options live in a single, testable module.
const queryClient = createQueryClient()

// Phase 46 / Prompt 01: subscribe the queryCache to the error reporter so
// background refetch failures (where no <QueryError> is mounted because
// the user navigated away from the originating page) still get captured.
// `event.action.type === 'error'` only fires on the moment a query
// transitions into the error state — the coalescing window in the
// reporter handles repeated identical errors from refetch retries.
queryClient.getQueryCache().subscribe((event) => {
  if (!event || event.type !== 'updated') return
  const action = (event as { action?: { type?: string; error?: unknown } }).action
  if (action?.type !== 'error') return
  if (action.error !== undefined && action.error !== null) {
    reportFrontendError(action.error, 'query')
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* Phase-40 / Prompt 69: rebroadcast cross-tab queryInvalidate
            messages into this tab's QueryClient. Mounted directly under
            QueryClientProvider so useQueryClient() resolves. */}
        <QueryBroadcastBridge />
        {/* Phase-45 / Prompt 06: keep module-level formatter globals
            (numberFormat locale + precision) in sync with the persisted
            settings even on pages that never call useSettings() and after
            cross-tab settings broadcasts. */}
        <FormatterPrefsBridge />
        <BrowserRouter future={{ v7_startTransition: true }}>
          {/* Phase-45 / Prompt 16: in-app unsaved-changes guard. Intercepts
              <GuardedLink> / <GuardedNavLink> clicks and browser back/forward
              navigation when any registered useNavigationGuard reports a
              dirty form. Coexists with useDirtyForm's beforeunload listener
              (tab close / reload / external links). MUST live inside
              <BrowserRouter> so useNavigate / useLocation resolve. */}
          <NavigationGuardProvider>
            <ThemeProvider>
              <FontProvider>
                <SelectedVehicleProvider>
                  <ToastProvider>
                    <OperationalModeProvider>
                      <App />
                      <ReloadPrompt />
                      {/* Phase-40 / Prompt 63: celebrate locked → unlocked transitions
                          with a transient toast + confetti. Mounted alongside the
                          standard toast stack so the SSE subscription is global. */}
                      <AchievementUnlockListener />
                    </OperationalModeProvider>
                  </ToastProvider>
                </SelectedVehicleProvider>
              </FontProvider>
            </ThemeProvider>
          </NavigationGuardProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// The splash is an inline no-FOUC surface, not a network loading gate. Dismiss
// it after React has had two animation frames to commit and paint the shell;
// waiting for window.load would keep it visible behind slow fonts or images.
window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    const splash = document.getElementById('splash')
    if (!splash) return
    splash.classList.add('fade-out')
    window.setTimeout(() => splash.remove(), 200)
  })
})

// ── Web Vitals reporting (Phase 40 / Prompt 35, Phase 45 / Prompt 12) ──────
// Lazy-loaded so it never blocks first paint. In production, ship metrics to
// the backend (`POST /api/v1/web-vitals`) where they're aggregated as
// Prometheus histograms. In dev we log to the console — production reporting
// would be noisy from HMR reloads and unhelpful before the bundle is final.
if (import.meta.env.PROD) {
  void import('./lib/webVitalsReporter')
    .then(({ startWebVitalsReporter }) => {
      startWebVitalsReporter()
    })
    .catch(() => {
      // Telemetry must never break the app; swallow load failures silently.
    })
} else {
  void import('web-vitals')
    .then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const report = (m: { name: string; value: number; id: string; rating?: string }) => {
        console.debug('[web-vitals]', m.name, Math.round(m.value), m.rating ?? '', m.id)
      }
      onCLS(report)
      onINP(report)
      onLCP(report)
      onFCP(report)
      onTTFB(report)
    })
    .catch((err) => {
      console.warn('[web-vitals] failed to load:', err)
    })
}
