import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './components/feedback/Toast'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'
import { ThemeProvider } from './components/ui/ThemeProvider'
import ReloadPrompt from './components/feedback/ReloadPrompt'
import { SelectedVehicleProvider } from './store/selectedVehicle'
import App from './App'
import './i18n'
import './index.css'

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
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 1,
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
