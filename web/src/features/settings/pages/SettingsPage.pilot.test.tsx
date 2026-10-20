import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Unknown readings are omitted from the brief face; the Review-details
// drawer counts them. Pins the exact hidden-count sentence.
function expectHiddenCount(summary: HTMLElement, text: string) {
  fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
  const drawer = screen.getByRole('dialog')
  try {
    expect(within(drawer).getByText(text)).toBeInTheDocument()
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' })
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}
import { Input } from '@/components/ui'
import type { AppSettings } from '@/api/types'
import type { FontFamilyId } from '@/components/ui/FontProvider'

const { sourceState } = vi.hoisted(() => {
  const sourceState: {
    realBrief: boolean
    settings: Partial<AppSettings> | undefined
    error: Error | null
    sans: FontFamilyId
    scale: number
  } = { realBrief: false, settings: undefined, error: null, sans: 'inter', scale: 1 }
  return { sourceState }
})

const { motion, settingsQuery, claimLease } = vi.hoisted(() => ({
  motion: { reduce: false },
  settingsQuery: {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  claimLease: vi.fn(),
}))

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: motion.reduce, durationMs: motion.reduce ? 0 : 250 }),
}))
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ ...settingsQuery, data: sourceState.settings, error: sourceState.error }),
}))
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  } }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€' }),
}))
vi.mock('@/hooks/useEditLease', () => ({ useEditLease: claimLease }))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: String, precision: 2, locale: 'en' }),
}))
vi.mock('@/components/ui/FontProvider', async (importActual) => ({
  ...await importActual<typeof import('@/components/ui/FontProvider')>(),
  useFont: () => ({ prefs: { sans: sourceState.sans, scale: sourceState.scale } }),
}))
vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => ({ success: vi.fn() }),
}))
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/feedback', () => ({
  EditConflictBanner: ({ resourceKey }: { resourceKey: string }) => (
    <div data-testid="lease" data-resource-key={resourceKey} />
  ),
  DataStateNotice: () => null,
  QueryError: () => null,
}))
vi.mock('@/components/motion', async (importActual) => ({
  ...await importActual<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('../components', async () => {
  const { SettingsActionCard } = await vi.importActual<typeof import('../components/SettingsActionCard')>(
    '../components/SettingsActionCard',
  )
  return {
    SettingsActionCard,
    SettingsSearch: () => null,
    GeneralSettings: () => <Input aria-label="Pilot unsaved preference" defaultValue="Original" />,
    WorkspacePreferencesSettings: () => <div data-testid="workspace-panel" />,
    AppearanceSettings: () => <div id="appearance" data-testid="appearance-panel" />,
    TypographySettings: () => <div data-testid="typography-panel" />,
    AdvancedSettings: () => <div data-testid="advanced-panel" />,
  }
})
vi.mock('../components/ResetSection', () => ({ ResetSection: () => <div data-testid="reset-panel" /> }))
vi.mock('../components/ServerSection', () => ({ ServerSection: () => <div data-testid="server-panel" /> }))
vi.mock('../components/operationalbrief-all/SettingsSummaryBrief', async (importActual) => {
  const actual = await importActual<typeof import('../components/operationalbrief-all/SettingsSummaryBrief')>()
  return {
  SettingsSummaryBrief: (props: Parameters<typeof actual.SettingsSummaryBrief>[0]) => {
    if (sourceState.realBrief) return <actual.SettingsSummaryBrief {...props} />
    const { metrics } = props
    return (
    <div data-testid="pilot-summary">
      {metrics.map((metric, index) => <div key={index}>{metric.label}{metric.context}</div>)}
    </div>
    )
  },
  }
})

import SettingsPage from './SettingsPage'

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

function LocationReceipt() {
  const location = useLocation()
  return <output data-testid="pilot-location">{location.pathname}{location.search}{location.hash}</output>
}

function renderPage(entry = '/settings#general') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<><SettingsPage /><LocationReceipt /></>} />
        <Route path="/integrations/helix" element={<div data-testid="legacy-target" />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  motion.reduce = false
  sourceState.realBrief = false
  sourceState.settings = undefined
  sourceState.error = null
  sourceState.sans = 'inter'
  sourceState.scale = 1
  settingsQuery.isLoading = false
  settingsQuery.isError = false
  vi.clearAllMocks()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})

describe('SettingsPage real mixed-source Brief', () => {
    function renderRealPage() {
      sourceState.realBrief = true
      sourceState.sans = 'atkinson'
      sourceState.scale = 1.25
      return renderPage('/settings')
    }

    it('keeps browser typography and scale visible while all six remote values are pending, including Review details', () => {
      settingsQuery.isLoading = true
      const { container } = renderRealPage()
      const summary = screen.getByTestId('settings-preferences-summary')
      expect(summary).toHaveAttribute('aria-busy', 'true')
      expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(7)
      expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(1)
      expect(summary.querySelector('[data-operational-metric="settings-preference-6"]'))
        .toHaveTextContent('Atkinson Hyperlegible')
      for (let index = 0; index < 6; index++) {
        const remote = summary.querySelector(`[data-operational-metric="settings-preference-${index}"]`)
        expect(remote).toHaveAttribute('data-value-state', 'missing')
        expect(remote?.querySelector('[data-operational-value]')).toBeNull()
      }
      assertOperationalBriefDisclosure(summary, 'Loading source')
      expect(container.querySelector('.lg\\:grid-cols-settings-navigation')).toBeInTheDocument()
      expect(container.querySelector('.grid-cols-settings-shortcuts')).toBeInTheDocument()
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      expect(within(drawer).getByText('Atkinson Hyperlegible')).toBeVisible()
      expect(within(drawer).getByText('Atkinson Hyperlegible')).not.toHaveAttribute('aria-busy')
      const typographyGroup = within(drawer).getByRole('group', { name: 'Typography' })
      expect(within(typographyGroup).getByText('125%')).toBeVisible()
      expect(drawer.querySelectorAll('[aria-busy="true"]')).toHaveLength(6)
      expect(within(drawer).queryByText('$', { exact: true })).toBeNull()
      expect(within(drawer).queryByText('°C', { exact: true })).toBeNull()
    })

    it('retains local typography on a fatal remote failure without asserting successful remote defaults', () => {
      settingsQuery.isError = true
      sourceState.error = new Error('Remote settings unavailable')
      renderRealPage()
      const summary = screen.getByTestId('settings-preferences-summary')
      assertOperationalBriefDisclosure(summary, 'Source unavailable')
      expect(within(summary).getByText('Atkinson Hyperlegible')).toBeVisible()
      for (const label of ['Distance', 'Temperature', 'Pressure', 'Language', 'Currency', 'Energy cost']) {
        assertOperationalMetricUnavailable(summary, label)
      }
      expectHiddenCount(summary, '6 empty fields are hidden.')
      expect(within(summary).queryByText('Source available')).toBeNull()
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      expect(within(drawer).getByText('Atkinson Hyperlegible')).toBeVisible()
      expect(within(drawer).getByText('125%')).toBeVisible()
      expect(within(drawer).getByText('Source unavailable')).toBeVisible()
    })

    it('preserves retained remote values and source status alongside the independent browser font', () => {
      sourceState.settings = {
        unit_of_length: 'km', unit_of_temp: 'F', unit_of_pressure: 'bar',
        language: 'de', currency_symbol: '€', base_cost_per_kwh: 0, preferred_range: 'ideal',
      }
      sourceState.error = new Error('Refresh failed')
      settingsQuery.isError = true
      renderRealPage()
      const summary = screen.getByTestId('settings-preferences-summary')
      assertOperationalBriefDisclosure(summary, 'Retained source')
      expect(within(summary).getByText('Atkinson Hyperlegible')).toBeVisible()
      expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(7)
      expect(summary.querySelector('[data-operational-metric="settings-preference-5"]'))
        .toHaveTextContent('€0')
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      expect(within(drawer).getByText('Retained source')).toBeVisible()
      expect(within(drawer).getByText('Atkinson Hyperlegible')).toBeVisible()
      expect(within(drawer).getByText('€0')).toBeVisible()
      expect(drawer.querySelector('[aria-busy="true"]')).toBeNull()
    })

    it('resolves pending remote values without losing the local typography identity or an open drawer', () => {
      settingsQuery.isLoading = true
      const { rerender } = renderRealPage()
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
      settingsQuery.isLoading = false
      sourceState.settings = {
        unit_of_length: 'km', unit_of_temp: 'F', unit_of_pressure: 'bar',
        language: 'de', currency_symbol: '€', base_cost_per_kwh: 0.25, preferred_range: 'ideal',
      }
      rerender(<MemoryRouter initialEntries={['/settings']}><Routes>
        <Route path="/settings" element={<><SettingsPage /><LocationReceipt /></>} />
      </Routes></MemoryRouter>)
      const summary = screen.getByTestId('settings-preferences-summary')
      expect(summary).not.toHaveAttribute('aria-busy')
      expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(7)
      expect(within(summary).getByText('Atkinson Hyperlegible')).toBeVisible()
      // The drawer stayed open across the rerender: assert the recovered
      // status in its header directly instead of reopening it.
      const drawer = screen.getByRole('dialog')
      expect(within(drawer.querySelector('[data-drawer-header]') as HTMLElement).getByText('Source available')).toBeVisible()
      expect(within(drawer).getByText('€0.25')).toBeVisible()
      expect(within(drawer).getByText('°F')).toBeVisible()
      expect(within(drawer).getByText('125%')).toBeVisible()
      expect(drawer.querySelector('[aria-busy="true"]')).toBeNull()
    })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

describe('SettingsPage bounded pilot accessibility and preservation', () => {
  it.each([
    { reduce: false, behavior: 'smooth' },
    { reduce: true, behavior: 'instant' },
  ])('scrolls the existing hash target with reduce=$reduce', ({ reduce, behavior }) => {
    motion.reduce = reduce
    renderPage()
    vi.advanceTimersByTime(250)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior, block: 'start' })
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances[0]).toBe(document.getElementById('general'))
  })

  it('cancels a pending anchor scroll on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    vi.advanceTimersByTime(250)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('keeps legacy navigation and a missing hash target safe', () => {
    const { unmount } = renderPage('/settings#missing-pilot-target')
    vi.advanceTimersByTime(250)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    unmount()
    renderPage('/settings#ai')
    expect(screen.getByTestId('legacy-target')).toBeInTheDocument()
    vi.advanceTimersByTime(250)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('retains all mounted categories, draft identity, query parameters, and the settings lease', () => {
    renderPage('/settings?pilot=preserved#general')
    const draft = screen.getByRole('textbox', { name: 'Pilot unsaved preference' })
    fireEvent.change(draft, { target: { value: 'Unsaved pilot preference' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings categories' }), { target: { value: 'appearance' } })
    expect(draft).not.toBeVisible()
    expect(screen.getByTestId('pilot-location')).toHaveTextContent('/settings?pilot=preserved#appearance')
    for (const id of ['overview', 'general', 'workspace', 'appearance', 'typography', 'advanced', 'server', 'reset']) {
      expect(document.getElementById(`settings-category-${id}`)).toBeInTheDocument()
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Settings categories' }), { target: { value: 'general' } })
    expect(screen.getByRole('textbox', { name: 'Pilot unsaved preference' })).toBe(draft)
    expect(draft).toHaveValue('Unsaved pilot preference')
    expect(claimLease).toHaveBeenCalledWith('settings/general')
    expect(screen.getByTestId('lease')).toHaveAttribute('data-resource-key', 'settings/general')
  })

  it('uses the shared decorative Icon geometry without adding icon tab stops or losing action names', () => {
    renderPage('/settings')
    const summaryIcons = screen.getByTestId('pilot-summary').querySelectorAll('svg')
    expect(summaryIcons).toHaveLength(7)
    for (const icon of summaryIcons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
      expect(icon).toHaveClass('h-5', 'w-5', 'shrink-0')
    }
    expect(screen.getByRole('link', { name: /Data export/ })).toHaveAttribute('href', '/data-export')
    for (const name of ['Show tours', 'Restart checklist']) {
      const action = screen.getByRole('button', { name, exact: true })
      expect(action).toHaveClass('min-h-11')
      expect(within(action).queryByRole('img')).not.toBeInTheDocument()
      expect(action.querySelector('svg')).toHaveAttribute('focusable', 'false')
    }
  })
})
