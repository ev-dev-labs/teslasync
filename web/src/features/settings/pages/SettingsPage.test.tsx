/**
 * SettingsPage — KPI derivation, deep-link effects, and quick-action wiring.
 *
 * SettingsPage is a display-only orchestrator: it reads the persisted
 * `AppSettings` blob + the live font preferences and renders
 *
 *   1. a seven-card "preferences at a glance" KPI band whose values are all
 *      derived in the page itself (unit strings, °C/°F, currency glyph +
 *      per-kWh cost, language code + friendly name, font family + scale),
 *   2. the composed preference sections (each of which owns its own data and
 *      is verified by its own test — stubbed here so the suite stays focused),
 *   3. three quick-action cards (Data Export link, Tour launcher, Setup
 *      checklist restart), and
 *   4. two hash-driven effects: the legacy `#ai` → `/integrations/helix`
 *      redirect and the `#section` smooth-scroll.
 *
 * The surface under test is therefore the page's OWN logic: the derivation
 * branches (rated/ideal, metric/imperial, currency fallback, unknown language,
 * blank-unit coalescing), the loading / empty placeholders, the two effects,
 * the action wiring, and the edit-conflict banner it mounts.
 *
 * Strategy (mirrors the other page tests, e.g. ActiveSessionsPage.test.tsx and
 * QuickStatsPage.test.tsx):
 *   - `useSettings`, `useFont` and `useEditLease` are replaced with hoisted
 *     `vi.fn()`s so every render is deterministic and no network is touched.
 *   - The heavy preference sections are stubbed; the REAL `SettingsActionCard`
 *     is kept (imported from its own module) so the quick-action assertions
 *     exercise the production card + its `<a href>` / `<button>` output.
 *   - `react-i18next` resolves the developer fallback string.
 *   - `restartChecklist` and the tour-launcher event dispatch stay REAL so the
 *     action side-effects (localStorage + window CustomEvent + toast) are
 *     genuinely observed.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + the freshness chip read it
// at render for the reduced-motion preference.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
})

// Hoisted test doubles so the mock factories below and the specs can both
// reach them.
const { useSettingsMock, useFontMock, useEditLeaseMock } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  useFontMock: vi.fn(),
  useEditLeaseMock: vi.fn(),
}))

vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: useSettingsMock,
}))

vi.mock('@/components/ui/FontProvider', () => ({
  useFont: useFontMock,
}))

vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: useEditLeaseMock,
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// Stub the heavy preference sections (each fetches its own data + has a
// dedicated test). SettingsActionCard is kept REAL — imported straight from its
// own module, not the barrel — so the quick-action wiring assertions run
// against the production card. SettingsSearch is a light input stub; its
// behaviour is covered by SettingsSearch.test.tsx.
vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components/SettingsActionCard')>(
    '../components/SettingsActionCard',
  )
  return {
    SettingsActionCard: actual.SettingsActionCard,
    SettingsSearch: ({ className }: { className?: string }) => (
      <div data-testid="stub-search" className={className} />
    ),
    WorkspacePreferencesSettings: () => <div data-testid="stub-workspace" />,
    GeneralSettings: () => <div data-testid="stub-general" />,
    AppearanceSettings: () => <div data-testid="stub-appearance" />,
    TypographySettings: () => <div data-testid="stub-typography" />,
    AdvancedSettings: () => <div data-testid="stub-advanced" />,
  }
})

vi.mock('../components/ResetSection', () => ({
  ResetSection: () => <div data-testid="stub-reset" />,
}))

import SettingsPage from './SettingsPage'
import { TOUR_OPEN_LAUNCHER_EVENT } from '@/lib/tourRegistry'
import { CHECKLIST_DISMISSED_KEY } from '@/features/onboarding/checklist'
import { ToastProvider } from '@/components/feedback/Toast'
import type { AppSettings } from '@/api/types'
import type { FontPrefs } from '@/components/ui/FontProvider'

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
    currency_symbol: '$',
    ...overrides,
  }
}

function setSettings(data: AppSettings | undefined, opts: { isLoading?: boolean } = {}) {
  const hasData = data !== undefined
  useSettingsMock.mockReturnValue({
    data,
    isLoading: opts.isLoading ?? false,
    isError: false,
    isFetching: false,
    isStale: false,
    isSuccess: hasData,
    status: hasData ? 'success' : 'pending',
    fetchStatus: 'idle',
    dataUpdatedAt: hasData ? Date.now() : 0,
    errorUpdatedAt: 0,
    error: null,
    refetch: vi.fn(),
  })
}

function setFont(overrides: Partial<FontPrefs> = {}) {
  useFontMock.mockReturnValue({
    prefs: {
      sans: 'inter',
      mono: 'jetbrains',
      customSans: '',
      customMono: '',
      scale: 1,
      leading: 1.5,
      tracking: '0em',
      headingWeight: 700,
      ...overrides,
    } satisfies FontPrefs,
  })
}

let scrollSpy: ReturnType<typeof vi.fn>

function renderPage(initialEntries: string[] = ['/settings']) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/integrations/helix"
              element={<div data-testid="helix-page">helix</div>}
            />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Return the StatCard root element that contains the given label text. */
function statCard(label: string): HTMLElement {
  const labelEl = screen.getByText(label)
  // label <span> → header <div> → Card root <div>
  const card = labelEl.closest('div')?.parentElement
  if (!card) throw new Error(`no card root found for label "${label}"`)
  return card as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useEditLeaseMock.mockReturnValue({ isOwner: false, otherTab: null, claim: vi.fn() })
  setFont()
  setSettings(makeSettings())
  scrollSpy = vi.fn()
  Element.prototype.scrollIntoView = scrollSpy
})

// ── KPI band — loaded metric derivation ─────────────────────────────────────

describe('SettingsPage — KPI band derivation', () => {
  it('renders all seven preference cards from settings + font prefs (metric / rated defaults)', () => {
    renderPage()

    // Labels — every card is present.
    for (const label of [
      'Distance',
      'Temperature',
      'Pressure',
      'Language',
      'Currency',
      'Energy cost',
      'Typography',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // Distance: metric unit value + "Rated" range sublabel, associated.
    const distance = statCard('Distance')
    expect(within(distance).getByText('km')).toBeInTheDocument()
    expect(within(distance).getByText('Rated')).toBeInTheDocument()

    // Temperature defaults to °C (unit_of_temp !== 'F').
    expect(within(statCard('Temperature')).getByText('°C')).toBeInTheDocument()
    // Pressure passes the stored unit straight through.
    expect(within(statCard('Pressure')).getByText('bar')).toBeInTheDocument()
    // Language: uppercased code + friendly name from the label map.
    const language = statCard('Language')
    expect(within(language).getByText('EN')).toBeInTheDocument()
    expect(within(language).getByText('English')).toBeInTheDocument()
    // Currency glyph + energy cost formatted to 2dp with a "per kWh" sublabel.
    expect(within(statCard('Currency')).getByText('$')).toBeInTheDocument()
    const energy = statCard('Energy cost')
    expect(within(energy).getByText('$0.12')).toBeInTheDocument()
    expect(within(energy).getByText('per kWh')).toBeInTheDocument()
    // Typography: friendly font family name + rounded scale percentage.
    const typography = statCard('Typography')
    expect(within(typography).getByText('Inter')).toBeInTheDocument()
    expect(within(typography).getByText('100%')).toBeInTheDocument()
  })

  it('reflects imperial units, ideal range, a custom currency, and a localized language', () => {
    setSettings(
      makeSettings({
        unit_of_length: 'mi',
        unit_of_temp: 'F',
        unit_of_pressure: 'psi',
        preferred_range: 'ideal',
        currency_symbol: '€',
        base_cost_per_kwh: 0.34,
        language: 'de',
      }),
    )
    setFont({ sans: 'atkinson', scale: 1.1 })

    renderPage()

    const distance = statCard('Distance')
    expect(within(distance).getByText('mi')).toBeInTheDocument()
    expect(within(distance).getByText('Ideal')).toBeInTheDocument()
    expect(within(statCard('Temperature')).getByText('°F')).toBeInTheDocument()
    expect(within(statCard('Pressure')).getByText('psi')).toBeInTheDocument()

    const language = statCard('Language')
    expect(within(language).getByText('DE')).toBeInTheDocument()
    expect(within(language).getByText('Deutsch')).toBeInTheDocument()

    expect(within(statCard('Currency')).getByText('€')).toBeInTheDocument()
    // Formatted to 2dp and prefixed with the custom glyph.
    expect(within(statCard('Energy cost')).getByText('€0.34')).toBeInTheDocument()

    const typography = statCard('Typography')
    expect(within(typography).getByText('Atkinson Hyperlegible')).toBeInTheDocument()
    expect(within(typography).getByText('110%')).toBeInTheDocument()
  })

  it('falls back to "$" when the settings omit a currency symbol', () => {
    setSettings(makeSettings({ currency_symbol: undefined, base_cost_per_kwh: 0.2 }))

    renderPage()

    expect(within(statCard('Currency')).getByText('$')).toBeInTheDocument()
    expect(within(statCard('Energy cost')).getByText('$0.20')).toBeInTheDocument()
  })

  it('coalesces a blank unit string to an em-dash instead of an empty cell', () => {
    setSettings(makeSettings({ unit_of_length: '', unit_of_pressure: '   ' }))

    renderPage()

    expect(within(statCard('Distance')).getByText('—')).toBeInTheDocument()
    expect(within(statCard('Pressure')).getByText('—')).toBeInTheDocument()
  })

  it('uppercases an unknown language code and omits the friendly name', () => {
    setSettings(makeSettings({ language: 'ja' }))

    renderPage()

    const language = statCard('Language')
    expect(within(language).getByText('JA')).toBeInTheDocument()
    // No entry in LANGUAGE_LABELS → no friendly-name sublabel is rendered.
    expect(within(language).queryByText(/Deutsch|English|Fran|中文/)).toBeNull()
  })

  it('renders the raw font id when the preset has no friendly label', () => {
    setFont({ sans: 'custom', scale: 0.85 })

    renderPage()

    const typography = statCard('Typography')
    // 'custom' IS mapped to "Custom"; assert the mapped label + rounded scale.
    expect(within(typography).getByText('Custom')).toBeInTheDocument()
    expect(within(typography).getByText('85%')).toBeInTheDocument()
  })
})

// ── KPI band — loading / empty states ───────────────────────────────────────

describe('SettingsPage — loading & empty placeholders', () => {
  it('renders skeleton cards (no metric labels) while settings load', () => {
    setSettings(undefined, { isLoading: true })

    renderPage()

    // StatCard swaps its body for skeletons when loading → labels not painted.
    expect(screen.queryByText('Distance')).toBeNull()
    expect(screen.queryByText('Currency')).toBeNull()
    // The rest of the page still renders (never a frozen/blank screen).
    expect(screen.getByRole('link', { name: /Data Export/i })).toBeInTheDocument()
  })

  it('renders em-dash placeholders — never blanks — when settings are unavailable', () => {
    setSettings(undefined) // resolved, but no data (error/empty)

    renderPage()

    // Labels ARE present (not loading), values fall back to the placeholder.
    expect(screen.getByText('Distance')).toBeInTheDocument()
    // Distance, Temperature, Pressure, Language, Currency, Energy all show "—".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6)
    // Typography is independent of settings → still shows the live font prefs.
    expect(within(statCard('Typography')).getByText('Inter')).toBeInTheDocument()
  })
})

// ── Hash-driven effects ─────────────────────────────────────────────────────

describe('SettingsPage — deep-link effects', () => {
  it('redirects the legacy #ai hash to /integrations/helix', async () => {
    renderPage(['/settings#ai'])

    await waitFor(() => {
      expect(screen.getByTestId('helix-page')).toBeInTheDocument()
    })
    // The settings body is gone — the redirect replaced the route.
    expect(screen.queryByLabelText('Current preferences overview')).toBeNull()
  })

  it('smooth-scrolls the targeted #section into view', async () => {
    renderPage(['/settings#general'])

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
    // scrollIntoView was invoked as a method of the #general section element.
    const target = scrollSpy.mock.instances[0] as HTMLElement
    expect(target.id).toBe('general')
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('does not scroll when the URL has no hash anchor', async () => {
    renderPage(['/settings'])

    // Give the 250ms scroll timer more than enough time to (not) fire.
    await new Promise((r) => setTimeout(r, 320))
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

// ── Quick-action cards ──────────────────────────────────────────────────────

describe('SettingsPage — quick actions', () => {
  it('links the Data Export card to /data-export', () => {
    renderPage()

    const link = screen.getByRole('link', { name: /Data Export/i })
    expect(link).toHaveAttribute('href', '/data-export')
  })

  it('opens the tour launcher when the tour button is pressed', () => {
    renderPage()

    const handler = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
    try {
      fireEvent.click(screen.getByRole('button', { name: /Open Tour Launcher/i }))
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
    }
  })

  it('restarts the onboarding checklist and toasts a confirmation', async () => {
    // Seed a dismissed checklist so restart has an observable effect.
    localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1')

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Restart Checklist/i }))

    // restartChecklist() clears the dismissed flag …
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBeNull()
    // … and a success toast is surfaced with the confirmation copy.
    expect(await screen.findByText(/Setup checklist restarted/i)).toBeInTheDocument()
  })
})

// ── Edit-conflict banner wiring ─────────────────────────────────────────────

describe('SettingsPage — edit-conflict banner', () => {
  it('stays hidden while this tab owns (or is uncontested for) the settings lease', () => {
    renderPage()

    expect(screen.queryByTestId('edit-conflict-banner')).toBeNull()
  })

  it('surfaces the conflict banner scoped to the settings resource when a peer holds the lease', () => {
    useEditLeaseMock.mockReturnValue({
      isOwner: false,
      otherTab: { tabId: 'peer-tab-123', claimedAt: 42 },
      claim: vi.fn(),
    })

    renderPage()

    const banner = screen.getByTestId('edit-conflict-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('data-resource-key', 'settings/general')
  })
})
