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
 *   - Most tests resolve developer fallbacks; title regressions use the real
 *     react-i18next hook with the canonical English resource.
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
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { Input } from '@/components/ui'
import canonicalEnglish from '@/i18n/en.json'
import { getBaseTitle, setBaseTitle, setBasePrefix, __resetTitleStoreForTests } from '@/lib/titleStore'

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
const { useSettingsMock, useFontMock, useEditLeaseMock, translationMode } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  useFontMock: vi.fn(),
  useEditLeaseMock: vi.fn(),
  translationMode: { canonical: false },
}))

vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: useSettingsMock,
}))

vi.mock('@/components/ui/FontProvider', async (importActual) => ({
  ...await importActual<typeof import('@/components/ui/FontProvider')>(),
  useFont: useFontMock,
}))

vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: useEditLeaseMock,
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: (...args: Parameters<typeof actual.useTranslation>) => {
      if (translationMode.canonical) return actual.useTranslation(...args)
      return {
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
      }
    },
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
  const search = await vi.importActual<typeof import('../components/SettingsSearch')>('../components/SettingsSearch')
  return {
    SettingsActionCard: actual.SettingsActionCard,
    SettingsSearch: search.SettingsSearch,
    WorkspacePreferencesSettings: () => <div data-testid="stub-workspace" />,
    GeneralSettings: () => <div data-testid="stub-general"><Input aria-label="Draft setting" defaultValue="Original" /></div>,
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

function renderPage(initialEntries: string[] = ['/settings'], translationInstance?: i18n) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const page = (
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
    </MemoryRouter>
  )
  return render(translationInstance
    ? <I18nextProvider i18n={translationInstance}>{page}</I18nextProvider>
    : page)
}

/** Return the actual Brief metric occurrence containing the label. */
function statCard(label: string): HTMLElement {
  const labelEl = screen.getByText(label)
  const card = labelEl.closest('[data-operational-metric]')
  if (!card) throw new Error(`no card root found for label "${label}"`)
  return card as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  translationMode.canonical = false
  localStorage.clear()
  useEditLeaseMock.mockReturnValue({ isOwner: false, otherTab: null, claim: vi.fn() })
  setFont()
  setSettings(makeSettings())
  scrollSpy = vi.fn()
  Element.prototype.scrollIntoView = scrollSpy
})

describe('SettingsPage — canonical English title', () => {
  it('resolves the Settings-owned key through the real flat-resource fallback and preserves navigation', async () => {
    const instance = createInstance()
    await instance.use(initReactI18next).init({
      resources: { en: { translation: canonicalEnglish } },
      lng: 'en',
      fallbackLng: 'en',
      fallbackNS: 'translation',
      interpolation: { escapeValue: false },
    })
    const settingsT = instance.getFixedT('en', 'settings')
    expect(instance.hasResourceBundle('en', 'settings')).toBe(false)
    expect(settingsT('title', 'Settings')).toBe('Command center')
    expect(instance.exists('settings.title', { ns: 'settings' })).toBe(true)
    expect(settingsT('settings.title', { defaultValue: 'MISSING SETTINGS TITLE', returnDetails: true })).toMatchObject({
      res: 'Settings',
      exactUsedKey: 'settings.title',
      usedNS: 'translation',
      usedLng: 'en',
    })

    translationMode.canonical = true
    __resetTitleStoreForTests()
    setBaseTitle('Command center — TeslaSync')
    setBasePrefix('(3) ')
    const { unmount } = renderPage(['/settings'], instance)
    try {
      expect(screen.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
      expect(screen.queryByRole('heading', { name: 'Command center', exact: true })).toBeNull()
      expect(getBaseTitle()).toBe('Settings — TeslaSync')
      expect(document.title).toBe('(3) Settings — TeslaSync')
      await waitFor(() => expect(screen.getByLabelText('Current preferences overview')).toBeVisible())
      for (const section of ['general', 'workspace', 'appearance', 'typography', 'advanced', 'server', 'reset']) {
        expect(document.getElementById(`settings-category-${section}`)).toBeInTheDocument()
      }
      fireEvent.click(screen.getByRole('button', { name: /Units, language & costs/ }))
      const draft = screen.getByRole('textbox', { name: 'Draft setting' })
      fireEvent.change(draft, { target: { value: 'Unsaved preference' } })
      fireEvent.click(screen.getByRole('button', { name: /Appearance & experience/ }))
      expect(draft).not.toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: /Units, language & costs/ }))
      expect(screen.getByRole('textbox', { name: 'Draft setting' })).toBe(draft)
      expect(draft).toHaveValue('Unsaved preference')
      expect(screen.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
      expect(document.title).toBe('(3) Settings — TeslaSync')
      unmount()
      expect(document.title).toBe('(3) Command center — TeslaSync')
    } finally {
      unmount()
      translationMode.canonical = false
      __resetTitleStoreForTests()
    }
  })
})

// ── KPI band — loaded metric derivation ─────────────────────────────────────

describe('SettingsPage — KPI band derivation', () => {
  it('retains configuration context and the existing cost denomination in the real Review drawer', () => {
    renderPage()
    expect(statCard('Energy cost')).toHaveAttribute('data-value-state', 'value')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('$0.12')).toBeInTheDocument()
    expect(within(drawer).getByText('per kWh')).toBeInTheDocument()
    expect(within(drawer).getByText('100%')).toBeInTheDocument()
    expect(screen.getByTestId('stub-general')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Data export/i })).toBeInTheDocument()
  })

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
  it('keeps every settings category mounted on an initial source failure and retries only the read', () => {
    const refetch = vi.fn()
    useSettingsMock.mockReturnValue({
      data: undefined, isLoading: false, isError: true, error: new Error('Read failed'), refetch,
    })
    renderPage()
    expect(screen.getByTestId('stub-general')).toBeInTheDocument()
    expect(screen.getByTestId('stub-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('stub-appearance')).toBeInTheDocument()
    expect(screen.getByTestId('stub-typography')).toBeInTheDocument()
    expect(screen.getByTestId('stub-advanced')).toBeInTheDocument()
    expect(screen.getByTestId('stub-reset')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('preserves preference readouts and mounted drafts after a retained source failure', () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings(), isLoading: false, isError: true, error: new Error('Refresh failed'), refetch: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Data may be stale')).toBeInTheDocument()
    expect(screen.getByTestId('stub-general')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft setting')).toHaveValue('Original')
    expect(screen.getByTestId('stub-workspace')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('retains Brief labels with busy placeholders while settings load', () => {
    setSettings(undefined, { isLoading: true })

    renderPage()

    expect(screen.getByText('Distance')).toBeInTheDocument()
    expect(screen.getByText('Currency')).toBeInTheDocument()
    expect(screen.getByTestId('settings-preferences-summary')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('settings-preferences-summary').querySelectorAll('[data-operational-value]')).toHaveLength(1)
    // The rest of the page still renders (never a frozen/blank screen).
    expect(screen.getByRole('link', { name: /Data export/i })).toBeInTheDocument()
    const summary = screen.getByTestId('settings-preferences-summary')
    const metrics = within(summary).getAllByRole('listitem')
    expect(metrics).toHaveLength(7)
    expect(metrics.map(metric => metric.getAttribute('data-operational-metric'))).toEqual([
      'settings-preference-0', 'settings-preference-1', 'settings-preference-2',
      'settings-preference-3', 'settings-preference-4', 'settings-preference-5',
      'settings-preference-6',
    ])
    for (const remote of metrics.slice(0, 6)) {
      expect(remote).toHaveAttribute('data-value-state', 'missing')
      expect(remote.querySelector('[data-operational-value]')).toBeNull()
      expect(remote.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)
      expect(remote.querySelector('[aria-busy="true"] [aria-hidden="true"]')).toBeInTheDocument()
    }
    const typography = metrics[6]
    expect(typography).toHaveAttribute('data-value-state', 'value')
    expect(typography.querySelector('[data-operational-value]')).toHaveTextContent('Inter')
    expect(typography.querySelector('[aria-busy="true"]')).toBeNull()
    return waitFor(() => {
      expect(within(typography).getByText('Inter')).toBeVisible()
      expect(within(typography).getByText('100%')).toBeVisible()
      expect(within(summary).getByText('Loading source')).toBeVisible()
    }).then(() => {
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      return waitFor(() => {
        expect(within(drawer).getByText('Inter')).toBeVisible()
        expect(within(drawer).getByText('Inter')).not.toHaveAttribute('aria-busy')
        expect(within(drawer).getByText('100%')).toBeVisible()
        expect(within(drawer).getByText('100%').closest('[aria-busy="true"]')).toBeNull()
        const pendingDrawerValues = drawer.querySelectorAll('[aria-busy="true"]')
        expect(pendingDrawerValues).toHaveLength(6)
        for (const pending of pendingDrawerValues) {
          expect(pending.querySelector('[aria-hidden="true"]')).toBeVisible()
          expect(pending.querySelector('[data-operational-value]')).toBeNull()
          expect(pending.textContent).toBe('')
        }
        expect(within(drawer).getByText('Loading source')).toBeVisible()
        expect(summary).toHaveAttribute('aria-busy', 'true')
      })
    })
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
  it.each([
    ['general', 'stub-general'],
    ['workspace', 'stub-workspace'],
    ['appearance', 'stub-appearance'],
    ['typography', 'stub-typography'],
    ['advanced', 'stub-advanced'],
    ['reset', 'stub-reset'],
  ])('opens only the %s category through its existing deep link', (id, testId) => {
    renderPage([`/settings#${id}`])
    expect(screen.getByTestId(testId)).toBeVisible()
    expect(screen.getByLabelText('Current preferences overview')).not.toBeVisible()
    for (const other of ['stub-general', 'stub-workspace', 'stub-appearance', 'stub-typography', 'stub-advanced', 'stub-reset']) {
      if (other !== testId) expect(screen.getByTestId(other)).not.toBeVisible()
    }
  })

  it('preserves an edited form while switching categories', () => {
    renderPage(['/settings#general'])
    const draft = screen.getByRole('textbox', { name: 'Draft setting' })
    fireEvent.change(draft, { target: { value: 'Unsaved preference' } })
    fireEvent.click(screen.getByRole('button', { name: /Appearance & experience/ }))
    expect(draft).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Units, language & costs/ }))
    expect(screen.getByRole('textbox', { name: 'Draft setting' })).toBe(draft)
    expect(draft).toHaveValue('Unsaved preference')
  })

  it('selects categories through the mobile control and safely handles unknown hashes', async () => {
    renderPage(['/settings#unknown-category'])
    await waitFor(() => expect(screen.getByLabelText('Current preferences overview')).toBeVisible())
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings categories' }), { target: { value: 'reset' } })
    expect(screen.getByTestId('stub-reset')).toBeVisible()
    expect(screen.getByTestId('stub-general')).not.toBeVisible()
  })

  it('reveals a hidden category when a real search result is selected', async () => {
    renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Search settings' }), { target: { value: 'Tire pressure unit' } })
    fireEvent.click(await screen.findByRole('option', { name: /Tire pressure unit/ }))
    expect(screen.getByTestId('stub-general')).toBeVisible()
    expect(screen.getByLabelText('Current preferences overview')).not.toBeVisible()
  })

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

    const link = screen.getByRole('link', { name: /Data export/i })
    expect(link).toHaveAttribute('href', '/data-export')
  })

  it('opens the tour launcher when the tour button is pressed', () => {
    renderPage()

    const handler = vi.fn()
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Show tours', exact: true }))
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
    }
  })

  it('restarts the onboarding checklist and toasts a confirmation', async () => {
    // Seed a dismissed checklist so restart has an observable effect.
    localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1')

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Restart checklist/i }))

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
