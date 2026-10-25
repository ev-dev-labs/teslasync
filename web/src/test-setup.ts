import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import * as resilience from '@/lib/resilience'
import * as numberFormat from '@/lib/numberFormat'
import {
  createReactI18nextMock,
  installTestPolyfills,
} from '@/test/setup'

vi.mock('react-i18next', () => createReactI18nextMock({ language: 'en' }))

// Global default mock for useSettings. Many components reach for it
// transitively via useDateFormat / useUnits / useFormatting; without a
// stub these components fail with "No QueryClient set" inside jsdom
// because a bare render() doesn't wrap in QueryClientProvider. Tests
// that need bespoke settings can still vi.mock('@/hooks/useSettings')
// in their own file — file-level vi.mock takes precedence over the
// setupFiles registration. The defaults here mirror the
// `defaults: AppSettings` object inside the real hook so transitive
// callers see the exact same values they would in production when no
// override row exists.
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>(
    '@/hooks/useSettings',
  )
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  }
  return {
    ...actual,
    useSettings: () => ({
      settings: defaults,
      isMiles: false,
      isFahrenheit: false,
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  }
})

// useTimezone() transitively reaches useSelectedVehicle → useVehicles
// (react-query) AND useMatch / useSearchParams (Router context). Both
// crash in bare jsdom renders. Stub it to return UTC by default;
// tests that need vehicle/local-time can still mock it per-file.
// ChartContainer always mounts annotation query/mutations. Bare page
// tests have no QueryClient — stub the hooks so they don't throw.
// useAnnotations.test.tsx calls vi.unmock to exercise the real module.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({
    data: [],
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    fetchStatus: 'idle',
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  }),
  useChartAnnotationsAsData: () => ({
    annotations: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
  )
  const toastApi = {
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }
  return {
    ...actual,
    useToast: () => {
      try {
        return actual.useToast()
      } catch {
        return toastApi
      }
    },
  }
})

// Shared chart hooks (useChartPalette) read the theme and the raw settings
// query. Bare component renders mount neither ThemeProvider nor a
// QueryClient; outside those providers fall back to the default dark theme
// and an idle settings query (palette defaults) instead of throwing. Inside a
// provider the real hooks run unchanged, and files that mock either module
// themselves still win.
vi.mock('@/components/ui/ThemeProvider', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/ThemeProvider')>(
    '@/components/ui/ThemeProvider',
  )
  const fallback = {
    themeId: 'neon-cyan' as const,
    modeId: 'dark',
    theme: {
      id: 'neon-cyan' as const, name: 'Signal Blue',
      primary: '#3b82f6', primaryRGB: '59, 130, 246', accent: '#06b6d4', accentRGB: '6, 182, 212',
    },
    mode: {
      id: 'dark', name: 'Dark', bg: '#0b0d12', surface1: '#11151c', surface2: '#171c25',
      surface3: '#202733', glassBg: 'rgba(255, 255, 255, 0.025)', glassBorder: 'rgba(255, 255, 255, 0.08)',
      textPrimary: '#f4f7fb', textSecondary: '#aab4c3', textMuted: '#758195', colorScheme: 'dark' as const,
    },
    setTheme: () => {},
    setMode: () => {},
    setCustomColors: () => {},
    themes: {},
    modes: {},
  }
  return {
    ...actual,
    useTheme: () => {
      try {
        return actual.useTheme()
      } catch {
        return fallback as unknown as ReturnType<typeof actual.useTheme>
      }
    },
  }
})

vi.mock('@/api/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useSettings')>(
    '@/api/hooks/useSettings',
  )
  const { QueryClientContext } = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  )
  const { useContext } = await vi.importActual<typeof import('react')>('react')
  const idle = {
    data: undefined, error: null, isError: false, isPending: true, isLoading: false,
    isFetching: false, isSuccess: false, status: 'pending', fetchStatus: 'idle',
    dataUpdatedAt: 0, refetch: () => Promise.resolve(idle),
  }
  return {
    ...actual,
    useSettings: () => {
      // The provider is fixed for a mounted tree, so the branch is stable
      // across renders of the same component.
      const client = useContext(QueryClientContext)
      if (client) return actual.useSettings()
      return idle as unknown as ReturnType<typeof actual.useSettings>
    },
  }
})

vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>(
    '@/lib/timezone',
  )
  // Resolves through the (possibly file-mocked) settings so a test that saves
  // a user timezone sees it. No vehicle is selected in bare renders, and the
  // browser zone is replaced by UTC so results never depend on the host TZ.
  const { useSettings } = await import('@/hooks/useSettings')
  return {
    ...actual,
    useTimezone: (mode: Parameters<typeof actual.useTimezone>[0] = 'vehicle') => {
      const settings = (useSettings() as { settings?: { timezone_user?: string | null } } | undefined)?.settings
      const userTz = settings?.timezone_user?.trim() ? settings.timezone_user : 'UTC'
      return actual.resolveTimezone(mode, undefined, userTz)
    },
  }
})


// Reset the module-scoped auth-expired latch in resilience.ts between
// every test. vitest's per-file isolation is not enough on its own —
// within a single file, a test that exercises a 401 path will leave
// the latch set, and subsequent tests in that file would silently
// observe a no-op handleAuthExpired() call. Wrapped in a try/catch so
// tests that vi.mock('@/lib/resilience') without exposing the test
// hook don't blow up here.
beforeEach(() => {
  try {
    resilience._resetAuthExpiredLatch?.()
  } catch {
    /* test mocked the module and stripped the hook — fine */
  }
  // Same leak class as the auth latch: formatter locale/precision is module
  // state, so a French-locale or precision-4 case would otherwise bleed into
  // later tests in the same file. Runs before file-level hooks, which can
  // still pin their own values on top.
  try {
    numberFormat._resetFormatterPreferences?.()
  } catch {
    /* test mocked the module and stripped the hook — fine */
  }
  if (navigator.onLine) window.dispatchEvent(new Event('online'))
})

installTestPolyfills()
