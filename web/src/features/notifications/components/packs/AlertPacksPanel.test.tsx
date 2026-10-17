import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NavigationGuardProvider } from '@/components/feedback'
import { request } from '@/api/client'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { AlertPack, PackInstallation } from '@/api/hooks/useAlertPacks'
import AlertPacksPanel from './AlertPacksPanel'
import AlertPacksPage from '../../pages/AlertPacksPage'
import InstallPackDialog from './InstallPackDialog'
import InstalledPackCard from './InstalledPackCard'
import { formatDateTime } from '@/lib/dateFormat'
import '@/i18n'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
vi.mock('@/api/queryPolicy', () => ({ queryPolicy: () => ({ retry: false }) }))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: vi.fn(() => true) }))
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ formatTemperature: (value: number) => `${value} C` }) }))

// InstalledPackCard reads locale/timezone through useSettings; the global
// mock pins en-US/UTC, so provide a controllable double mirroring the global
// defaults. The global timezone stub resolves the user zone from
// settings.timezone_user, so overriding these prefs drives both.
const displayPrefs = vi.hoisted(() => ({ locale: 'en-US', tz_display_default: 'vehicle', timezone_user: '' }))
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings')
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', preferred_range: 'rated',
        language: 'en', base_cost_per_kwh: 0.12, api_suspended: false, theme: 'neon-cyan', mode: 'dark',
        custom_primary: '#00b4d8', custom_accent: '#e63946', gas_price_per_unit: 0, gas_unit: 'gallon',
        gas_efficiency_mpg: 25, decimal_precision: 2, quiet_hours_enabled: false, quiet_hours_start: '22:00',
        quiet_hours_end: '07:00', alert_digest_mode: 'instant', currency_symbol: '$', locale: displayPrefs.locale,
        tz_display_default: displayPrefs.tz_display_default, timezone_user: displayPrefs.timezone_user,
        tab_badge_enabled: true, critical_flash_enabled: true, ui_density: 'comfortable',
        time_format_default: 'relative', chart_palette: 'cb_safe', ai_mode: 'off', ai_features: {},
        ai_provider_config: {}, ai_cost_cap_cents: 0,
      },
      isMiles: false, isFahrenheit: false, isPSI: false, decimals: 2,
      locale: displayPrefs.locale, density: 'comfortable' as const, rangeType: 'rated' as const,
    }),
  }
})

const pack: AlertPack = {
  id: 'everyday', version: 1, name: 'Everyday essentials', description: 'Useful reminders',
  rules: [{
    id: 'battery-low', unit: '%', rule: {
      id: 0, name: 'Battery running low', enabled: false, all_vehicles: true, vehicle_ids: [],
      signal_name: 'BatteryLevel', op: '<', value_num: 20, severity: 'warn', cooldown_min: 60,
      trigger_mode: 'once', kind: 'signal', msg_template: '{{VehicleName}} at {{Value}}%',
      include_title: true, created_at: '', updated_at: '',
    },
  }, {
    id: 'charge-complete', unit: '', rule: {
      id: 0, name: 'Charging complete', enabled: false, all_vehicles: true, vehicle_ids: [],
      signal_name: 'DetailedChargeState', op: '=', value_text: 'Complete', severity: 'info', cooldown_min: 60,
      trigger_mode: 'once', kind: 'signal', msg_template: '{{VehicleName}} finished charging.',
      include_title: true, created_at: '', updated_at: '',
    },
  }],
}

const installation: PackInstallation = {
  id: 10, pack_id: 'everyday', name: 'Everyday essentials', version: 1, scope_key: 'all', created_at: '2026-09-18T10:00:00Z',
  members: [
    { template_id: 'battery-low', rule_id: 1, name: 'Owned rule', owned: true, shared: false, enabled: false },
    { template_id: 'charge-complete', rule_id: 2, name: 'My existing rule', owned: false, shared: false, enabled: true },
    { template_id: 'other', rule_id: 3, name: 'Shared rule', owned: true, shared: true, enabled: true },
  ],
}

function setup(ui: React.ReactNode, configure?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  configure?.(client)
  return { ...render(<QueryClientProvider client={client}><MemoryRouter><NavigationGuardProvider>{ui}</NavigationGuardProvider></MemoryRouter></QueryClientProvider>), client }
}

const fieldRoles = {
  'Notification message': 'textbox',
  'Minimum minutes between notifications': 'spinbutton',
  'Alert behavior': 'combobox',
  'Operator': 'combobox',
  'Channels': 'combobox',
} as const

function ruleFields(name: keyof typeof fieldRoles) {
  return screen.getAllByRole(fieldRoles[name], { name })
}

beforeEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(true)
  displayPrefs.locale = 'en-US'
  displayPrefs.tz_display_default = 'vehicle'
  displayPrefs.timezone_user = ''
  vi.mocked(request).mockReset()
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === '/alerts/packs') return [pack]
    if (path === '/settings') return { locale: 'en-US', tz_display_default: 'user', timezone_user: 'UTC' }
    if (path.startsWith('/alerts/pack-installations?')) return []
    if (path === '/vehicles') return [{ id: 1, display_name: 'Roadster', model: 'Model 3' }]
    if (path === '/notifications') return [
      { id: 2, name: 'Phone', kind: 'ntfy', enabled: true },
      { id: 3, name: 'Team', kind: 'ntfy', enabled: true },
    ]
    if (path.endsWith('/install')) return installation
    if (path.endsWith('/remove')) return { status: 'removed' }
    throw new Error(`Unexpected request ${path}`)
  })
})

afterEach(() => onlineManager.setOnline(true))

describe('Alert Packs', () => {
  it.each(['paused', 'idle'] as const)('keeps unresolved %s catalog and installations distinct from empty results', status => {
    if (status === 'paused') onlineManager.setOnline(false)
    setup(<AlertPacksPanel onEditRule={vi.fn()} />, client => {
      if (status === 'idle') {
        client.setQueryDefaults(['alert-packs'], { enabled: false })
        client.setQueryDefaults(['alert-pack-installations'], { enabled: false })
      }
    })
    const message = status === 'paused' ? 'Refresh paused' : 'Pending'
    expect(screen.getByRole('status', { name: 'Alert packs' })).toHaveTextContent(message)
    expect(screen.getByRole('status', { name: 'Installed packs' })).toHaveTextContent(message)
    expect(screen.queryByText('No matching packs')).not.toBeInTheDocument()
    expect(screen.queryByText('No packs on this page')).not.toBeInTheDocument()
    expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('offers catalog refresh for authoritative emptiness and clear search only for filtered no-match', async () => {
    const { client } = setup(<AlertPacksPanel onEditRule={vi.fn()} />, queryClient => {
      queryClient.setQueryData(['alert-packs'], [])
      queryClient.setQueryDefaults(['alert-packs'], { enabled: false })
    })
    expect(screen.getByText('No Alert packs found.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await screen.findByText('No packs on this page')
    client.setQueryData(['alert-packs'], [pack])
    await screen.findByRole('button', { name: 'Preview Everyday essentials' })
    fireEvent.change(screen.getByPlaceholderText('Search packs...'), { target: { value: 'unmatched' } })
    expect(await screen.findByText('No matching packs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('button', { name: 'Preview Everyday essentials' })).toBeInTheDocument()
  })

  it('names retained-source warnings and places them before catalog and installed decisions', async () => {
    vi.mocked(request).mockRejectedValue(new Error('Refresh failed'))
    setup(<AlertPacksPanel onEditRule={vi.fn()} />, client => {
      client.setQueryData(['alert-packs'], [pack])
      client.setQueryData(['alert-pack-installations', 0], [installation])
    })
    const catalogWarning = await screen.findByText('Alert packs may be out of date')
    const installedWarning = await screen.findByText('Installed packs may be out of date')
    const preview = screen.getByRole('button', { name: 'Preview Everyday essentials' })
    const edit = screen.getByRole('button', { name: 'Edit Owned rule' })
    expect(catalogWarning.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(installedWarning.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['paused', 'idle'] as const)('explains %s vehicle and channel prerequisites without presenting an empty fleet', status => {
    if (status === 'paused') onlineManager.setOnline(false)
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />, client => {
      if (status === 'idle') {
        client.setQueryDefaults(['vehicles'], { enabled: false })
        client.setQueryDefaults(['notification-channels'], { enabled: false })
      }
    })
    const message = status === 'paused' ? 'Refresh paused' : 'Pending'
    expect(screen.getByRole('status', { name: 'Vehicles' })).toHaveTextContent(message)
    expect(screen.getByRole('status', { name: 'Channels' })).toHaveTextContent(message)
    expect(screen.queryByText('No external channels configured.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
  })

  it('retains vehicle and channel choices with named warnings before the affected controls', async () => {
    const originalRequest = vi.mocked(request).getMockImplementation()!
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/vehicles' || path === '/notifications') return Promise.reject(new Error('Refresh failed'))
      return originalRequest(path, options)
    })
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />, client => {
      client.setQueryData(['vehicles'], [{ id: 1, display_name: 'Roadster', model: 'Model 3' }], { updatedAt: 1 })
      client.setQueryData(['notification-channels'], [{ id: 2, name: 'Phone', kind: 'ntfy', enabled: true }])
    })
    const channelsWarning = await screen.findByText('Channels may be out of date')
    const vehiclesWarning = await screen.findByText('Vehicles may be out of date')
    const defaults = screen.getByRole('region', { name: 'Pack defaults' })
    expect(channelsWarning.compareDocumentPosition(defaults) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(vehiclesWarning.compareDocumentPosition(screen.getByRole('button', { name: 'Vehicles' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ruleFields('Channels')[0]).toBeEnabled()
    expect(within(ruleFields('Channels')[0]).getByRole('option', { name: 'Phone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
    expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it.each([true, false])('associates numeric errors with the exact selected fields (desktop=%s)', async desktop => {
    vi.mocked(useMediaQuery).mockReturnValue(desktop)
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    const threshold = screen.getByLabelText('Threshold (%)')
    fireEvent.change(threshold, { target: { value: '' } })
    expect(threshold).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(threshold.getAttribute('aria-describedby')!)).toHaveTextContent('Enter a valid number (0-100)')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Battery running low' }))
    expect(threshold).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
    fireEvent.change(threshold, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Battery running low' }))
    for (const value of ['', '0', '1.5', '10081']) {
      const cooldown = ruleFields('Minimum minutes between notifications')[0]
      fireEvent.change(cooldown, { target: { value } })
      expect(cooldown).toHaveAttribute('aria-invalid', 'true')
      expect(document.getElementById(cooldown.getAttribute('aria-describedby')!)).toHaveTextContent('Enter a valid number (1-10080)')
      expect(ruleFields('Minimum minutes between notifications')[1]).not.toHaveAttribute('aria-invalid', 'true')
    }
    fireEvent.change(ruleFields('Minimum minutes between notifications')[0], { target: { value: '10080' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
    if (!desktop) fireEvent.click(screen.getByRole('button', { name: /Pack defaults/ }))
    const master = screen.getByLabelText('Default cooldown (minutes)')
    fireEvent.change(master, { target: { value: '' } })
    expect(master).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(master.getAttribute('aria-describedby')!)).toHaveTextContent('Enter a valid number (1-10080)')
    fireEvent.change(master, { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
  })

  it('keeps negative Celsius thresholds and their original bounds', async () => {
    const temperaturePack = { ...pack, rules: [{ ...pack.rules[0], unit: '°C', rule: { ...pack.rules[0].rule, value_num: -20 } }] }
    setup(<InstallPackDialog pack={temperaturePack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    const threshold = screen.getByLabelText('Threshold (°C)')
    fireEvent.change(threshold, { target: { value: '-100' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
    fireEvent.change(threshold, { target: { value: '-101' } })
    expect(threshold).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(threshold, { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
  })

  it('renders installed timestamps using saved locale and timezone and updates when preferences change', () => {
    displayPrefs.locale = 'de-DE'
    displayPrefs.tz_display_default = 'user'
    displayPrefs.timezone_user = 'Asia/Tokyo'
    const card = <InstalledPackCard installation={installation} name="Essentials" onEditRule={vi.fn()} />
    const first = setup(card)
    const expected = formatDateTime(installation.created_at, { locale: 'de-DE', tz: 'Asia/Tokyo' })
    expect(screen.getByText(`Version 1 · installed ${expected}`)).toBeInTheDocument()
    first.unmount()
    displayPrefs.locale = 'en-US'
    displayPrefs.tz_display_default = 'utc'
    setup(card)
    expect(screen.getByText(`Version 1 · installed ${formatDateTime(installation.created_at, { locale: 'en-US', tz: 'UTC' })}`)).toBeInTheDocument()
    expect(installation.created_at).toBe('2026-09-18T10:00:00Z')
  })

  it('uses one compact page header without duplicating the catalog introduction', async () => {
    setup(<AlertPacksPage />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Alert packs' })
    expect(screen.getAllByRole('heading', { name: 'Alert packs' })).toHaveLength(1)
    expect(heading).toHaveAttribute('data-route-focus-target', 'true')
    expect(heading.closest('header')).toHaveClass('border-0', 'bg-transparent')
    const help = screen.getByRole('button', { name: 'More info: Alert packs' })
    expect(help).toHaveAttribute('aria-describedby')
    expect(screen.getAllByText(/Start with a goal, not a blank rule/)).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Preview Everyday essentials' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Installed packs' })).toBeInTheDocument()
  })

  it('renders a flat property grid with no grouped editors or mysterious default behavior option', () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    const table = screen.getByRole('table', { name: 'Choose rules' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      'Selected', 'Rule', 'Severity', 'Operator', 'Value', 'Cooldown (minutes)', 'Alert behavior', 'Notification message', 'Channels', 'Include title', 'Defaults',
    ])
    expect(within(table).getAllByRole('row')[1].querySelectorAll('td')[2]).toHaveTextContent('warn')
    expect(within(table).getAllByRole('row')[1].querySelectorAll('td')[1]).not.toHaveTextContent('warn')
    expect(screen.getByRole('region', { name: 'Rule settings editor' })).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('region', { name: 'Rule settings editor' })).toHaveAttribute('tabindex', '0')
    expect(table.parentElement).toHaveClass('min-w-[1960px]')
    expect(ruleFields('Notification message')[0]).toHaveAttribute('rows', '3')
    for (const cell of within(table).getAllByRole('cell')) {
      expect(cell.querySelectorAll('input,select,textarea').length).toBeLessThanOrEqual(1)
    }
    const behavior = ruleFields('Alert behavior')[0]
    expect(within(behavior).getAllByRole('option').map(option => option.textContent)).toEqual(['Re-alert until resolved', 'Notify on event'])
    expect(within(screen.getByLabelText('Default alert behavior')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Re-alert until resolved', 'Notify on event'])
    expect(screen.getByLabelText('Default cooldown (minutes)')).toHaveValue(15)
    expect(behavior).toHaveValue('once')
    expect(screen.getByRole('region', { name: 'Pack defaults' })).toBeInTheDocument()
  })

  it('keeps title inheritance independent and resets only delivery overrides', () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    const title = screen.getAllByRole('checkbox', { name: 'Include title in notifications' })[0]
    fireEvent.change(screen.getByLabelText('Default title inclusion'), { target: { value: 'false' } })
    expect(title).not.toBeChecked()
    fireEvent.click(title)
    fireEvent.change(screen.getByLabelText('Default title inclusion'), { target: { value: 'true' } })
    fireEvent.change(screen.getByLabelText('Default title inclusion'), { target: { value: 'false' } })
    expect(title).toBeChecked()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset delivery to pack defaults' })[0])
    expect(title).not.toBeChecked()
  })

  it('keeps overrides field-specific and resetting delivery preserves messages and operators, not channels', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(ruleFields('Channels')[0]).toBeEnabled())
    fireEvent.change(ruleFields('Minimum minutes between notifications')[0], { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Default alert behavior'), { target: { value: 'repeat' } })
    expect(ruleFields('Alert behavior')[0]).toHaveValue('repeat')
    fireEvent.change(ruleFields('Operator')[0], { target: { value: '>=' } })
    fireEvent.change(ruleFields('Channels')[0], { target: { value: '2' } })
    fireEvent.change(ruleFields('Notification message')[0], { target: { value: 'My reviewed message' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset delivery to pack defaults' })[0])
    expect(ruleFields('Minimum minutes between notifications')[0]).toHaveValue(15)
    expect(ruleFields('Operator')[0]).toHaveValue('>=')
    expect(ruleFields('Channels')[0]).toHaveValue('all')
    expect(ruleFields('Notification message')[0]).toHaveValue('My reviewed message')
    expect(ruleFields('Notification message')[1]).not.toHaveValue('My reviewed message')
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body.trigger_mode).toBe('repeat')
      expect(body.rules[0]).not.toHaveProperty('trigger_mode')
      expect(body.rules[0]).not.toHaveProperty('cooldown_s')
    })
  })

  it('treats all and no channels distinctly and undoing operator/channel changes leaves a pristine preview', async () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    await waitFor(() => expect(ruleFields('Channels')[0]).toBeEnabled())
    fireEvent.change(ruleFields('Channels')[0], { target: { value: 'none' } })
    expect(ruleFields('Channels')[0]).toHaveValue('none')
    fireEvent.change(ruleFields('Operator')[0], { target: { value: '>=' } })
    fireEvent.change(ruleFields('Operator')[0], { target: { value: '<' } })
    fireEvent.change(ruleFields('Channels')[0], { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Discard configuration' })).not.toBeInTheDocument()
  })

  it.each([true, false])('inherits channel defaults while preserving explicit all/none overrides (desktop=%s)', async desktop => {
    vi.mocked(useMediaQuery).mockReturnValue(desktop)
    const threeRules = { ...pack, rules: [...pack.rules, { ...pack.rules[0], id: 'another-rule' }] }
    setup(<InstallPackDialog pack={threeRules} onClose={vi.fn()} />)
    if (!desktop) fireEvent.click(screen.getByRole('button', { name: /Pack defaults/ }))
    const defaults = screen.getByLabelText('Default channels')
    await waitFor(() => expect(defaults).toBeEnabled())
    fireEvent.change(defaults, { target: { value: 'none' } })
    expect(ruleFields('Channels').every(element => (element as HTMLSelectElement).value === 'none')).toBe(true)
    fireEvent.change(defaults, { target: { value: '2' } })
    expect(ruleFields('Channels').every(element => (element as HTMLSelectElement).value === 'custom')).toBe(true)
    fireEvent.change(ruleFields('Channels')[0], { target: { value: 'all' } })
    fireEvent.change(ruleFields('Channels')[1], { target: { value: 'none' } })
    fireEvent.change(defaults, { target: { value: '3' } })
    expect(ruleFields('Channels')[0]).toHaveValue('all')
    expect(ruleFields('Channels')[1]).toHaveValue('none')
    expect(ruleFields('Channels')[2]).toHaveValue('custom')
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).not.toHaveProperty('channel_ids')
      expect(body).toMatchObject({ cooldown_s: 900, trigger_mode: 'once',
        rules: [{ channel_ids: null }, { channel_ids: [] }, { channel_ids: [2, 3] }] })
    })
  })

  it('resets channel-only overrides individually and across filtered-out rules', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    const defaults = screen.getByLabelText('Default channels')
    await waitFor(() => expect(defaults).toBeEnabled())
    fireEvent.change(defaults, { target: { value: '2' } })
    fireEvent.change(ruleFields('Channels')[0], { target: { value: 'all' } })
    fireEvent.change(ruleFields('Channels')[1], { target: { value: 'none' } })
    expect(screen.getAllByRole('button', { name: 'Reset delivery to pack defaults' })[0]).toBeEnabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset delivery to pack defaults' })[0])
    expect(ruleFields('Channels')[0]).toHaveValue('custom')
    expect(screen.getAllByRole('button', { name: 'Reset delivery to pack defaults' })[0]).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Search pack rules...'), { target: { value: 'Battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply defaults to all rules' }))
    fireEvent.change(defaults, { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      expect(JSON.parse(String(call?.[1]?.body)).rules).toMatchObject([{ channel_ids: [] }, { channel_ids: [] }])
    })
  })

  it('guards default-channel edits and clears the guard after undoing them', async () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    const defaults = screen.getByLabelText('Default channels')
    await waitFor(() => expect(defaults).toBeEnabled())
    fireEvent.change(defaults, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    fireEvent.change(defaults, { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves explicit template channel selections until reset', async () => {
    const preset = { ...pack, rules: pack.rules.map((template, index) => ({
      ...template, rule: { ...template.rule, channel_ids: index === 0 ? [3] : [] },
    })) }
    setup(<InstallPackDialog pack={preset} onClose={vi.fn()} />)
    const defaults = screen.getByLabelText('Default channels')
    await waitFor(() => expect(defaults).toBeEnabled())
    fireEvent.change(defaults, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      expect(JSON.parse(String(call?.[1]?.body)).rules).toMatchObject([{ channel_ids: [3] }, { channel_ids: [] }])
    })
  })

  it('identifies an empty message in its row and prevents installation until repaired', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(ruleFields('Notification message')[0], { target: { value: ' ' } })
    expect(screen.getByText('Enter a notification message.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
    fireEvent.change(ruleFields('Notification message')[0], { target: { value: '{{VehicleName}} ready.' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
  })

  it('paginates a 70-rule pack without dropping selections or installing just the visible page', async () => {
    const comprehensive: AlertPack = { ...pack, id: 'all', name: 'All alerts',
      rules: Array.from({ length: 70 }, (_, index) => ({
        ...pack.rules[0], id: `full-${index}`, rule: { ...pack.rules[0].rule, name: `Reminder ${index + 1}` },
      })) }
    setup(<InstallPackDialog pack={comprehensive} onClose={vi.fn()} />)
    expect(screen.getByText('70 of 70 rules selected')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Reminder 11' })).not.toBeInTheDocument()
    fireEvent.change(ruleFields('Notification message')[1], { target: { value: 'Edited across pages' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reminder 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reminder 11' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body.rules).toHaveLength(68)
      expect(body.rules.map((rule: { template_id: string }) => rule.template_id)).not.toContain('full-0')
      expect(body.rules.map((rule: { template_id: string }) => rule.template_id)).not.toContain('full-10')
      expect(body.rules.map((rule: { template_id: string }) => rule.template_id)).toContain('full-69')
      expect(body.rules.find((rule: { template_id: string }) => rule.template_id === 'full-1').message).toBe('Edited across pages')
    })
  })

  it('makes primary fields immediately editable and focusing them does not dirty the draft', () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    expect(screen.getByRole('table', { name: 'Choose rules' })).toBeInTheDocument()
    expect(ruleFields('Notification message')).toHaveLength(2)
    expect(ruleFields('Minimum minutes between notifications')).toHaveLength(2)
    expect(ruleFields('Alert behavior')).toHaveLength(2)
    expect(ruleFields('Channels')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Apply defaults to all rules' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Customize/ })).not.toBeInTheDocument()
    fireEvent.focus(ruleFields('Notification message')[0])
    fireEvent.blur(ruleFields('Notification message')[0])
    expect(screen.getByLabelText('Threshold (%)')).toHaveValue(20)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('edits mobile cards directly and keeps values through filtering', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false)
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Default cooldown (minutes)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pack defaults/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '25' } })
    expect(ruleFields('Notification message')).toHaveLength(2)
    fireEvent.change(screen.getByRole('combobox', { name: 'Show rules' }), { target: { value: 'customized' } })
    expect(screen.queryByRole('checkbox', { name: 'Charging complete' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Threshold (%)')).toHaveValue(25)
    const footer = screen.getByRole('button', { name: 'Install selected rules' }).closest('[data-modal-footer]')
    expect(footer).toHaveTextContent('2 of 2 rules selected')
  })

  it('inherits master settings, preserves individual overrides, and explicitly reapplies master settings', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Default cooldown (minutes)'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Default alert behavior'), { target: { value: 'repeat' } })
    expect(ruleFields('Minimum minutes between notifications')[0]).toHaveValue(15)
    fireEvent.change(ruleFields('Minimum minutes between notifications')[0], { target: { value: '120' } })
    fireEvent.change(ruleFields('Alert behavior')[0], { target: { value: 'once' } })
    fireEvent.change(screen.getByLabelText('Default cooldown (minutes)'), { target: { value: '30' } })
    expect(ruleFields('Minimum minutes between notifications')[0]).toHaveValue(120)
    expect(ruleFields('Minimum minutes between notifications')[1]).toHaveValue(30)
    fireEvent.click(screen.getByRole('button', { name: 'Apply defaults to all rules' }))
    expect(ruleFields('Minimum minutes between notifications').every(input => (input as HTMLInputElement).value === '30')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        cooldown_s: 1800, trigger_mode: 'repeat',
        rules: [{ template_id: 'battery-low' }, { template_id: 'charge-complete' }],
      })
      expect(JSON.parse(String(call?.[1]?.body)).rules.every((rule: Record<string, unknown>) => !('cooldown_s' in rule) && !('trigger_mode' in rule))).toBe(true)
    })
  })

  it('selects matching rules without dropping hidden choices and rejects invalid master cooldowns', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(screen.getByPlaceholderText('Search pack rules...'), { target: { value: 'Battery' } })
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Charging complete' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all matching rules' }))
    expect(screen.getByText('1 of 2 rules selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all matching rules' }))
    expect(screen.getByText('2 of 2 rules selected')).toBeInTheDocument()
    for (const value of ['', '0', '1.5', '10081']) {
      fireEvent.change(screen.getByLabelText('Default cooldown (minutes)'), { target: { value } })
      expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
    }
    fireEvent.change(screen.getByLabelText('Default cooldown (minutes)'), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled()
  })

  it('browses and previews without installing or exposing Helix when AI is off', async () => {
    setup(<AlertPacksPanel onEditRule={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Everyday essentials' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Install selected rules' })
    expect(screen.queryByTestId('ai-feature-alert-pack-builder-root')).not.toBeInTheDocument()
    expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('installs only selected rules with reviewed threshold, message and explicit enable choice', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Charging complete' }))
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '25' } })
    fireEvent.change(ruleFields('Minimum minutes between notifications')[0], { target: { value: '120' } })
    fireEvent.change(ruleFields('Operator')[0], { target: { value: '<=' } })
    fireEvent.change(ruleFields('Channels')[0], { target: { value: '2' } })
    fireEvent.change(ruleFields('Notification message')[0], { target: { value: '{{VehicleName}} needs a charge.' } })
    fireEvent.change(screen.getByLabelText('After installation'), { target: { value: 'enabled' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await screen.findByText(/Pack installed. Created 2 rules; reused 1/)
    const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      version: 1, all_vehicles: true, vehicle_ids: [], enabled: true, cooldown_s: 900, trigger_mode: 'once', include_title: true,
      rules: [{ template_id: 'battery-low', op: '<=', channel_ids: [2], value_num: 25, cooldown_s: 7200, message: '{{VehicleName}} needs a charge.' }],
    })
  })

  it('keeps installation disabled for invalid threshold and zero selected rules', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '101' } })
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Battery running low' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Charging complete' }))
    expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
  })

  it('retains draft and shows errors when installation fails', async () => {
    vi.mocked(request).mockImplementation(async path => {
      if (path === '/vehicles') return []
      if (path === '/notifications') return []
      throw new Error('Installation failed')
    })
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await screen.findByText("Can't reach server")
    expect(screen.getByLabelText('Threshold (%)')).toHaveValue(30)
    expect(screen.queryByText(/Pack installed/)).not.toBeInTheDocument()
  })

  it('asks before discarding actual configuration changes but not a pristine preview', async () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard configuration' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('removes tracking without deleting any rules by default', async () => {
    setup(<InstalledPackCard installation={installation} name="Essentials" onEditRule={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove pack' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('switch')).toHaveLength(1)
    expect(within(dialog).getByRole('switch', { name: 'Owned rule' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/alerts/pack-installations/10/remove', {
      method: 'POST', body: JSON.stringify({ delete_rule_ids: [] }), requiresLiveMode: true,
    }))
  })

  it('clears the unsaved guard when edits are undone', async () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Discard configuration' })).not.toBeInTheDocument()
  })

  it('preserves a proposed custom name and requires explicit installation', async () => {
    setup(<InstallPackDialog pack={{ ...pack, id: 'custom', name: 'Weekend peace of mind' }} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Preview Weekend peace of mind' })).toBeInTheDocument()
    expect(screen.getByLabelText('Pack name')).toHaveValue('Weekend peace of mind')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await waitFor(() => {
      const call = vi.mocked(request).mock.calls.find(([path]) => path === '/alerts/packs/custom/install')
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ name: 'Weekend peace of mind', enabled: false })
    })
  })

  it('only explicitly deletes an owned unshared rule and opens the ordinary editor', async () => {
    const edit = vi.fn()
    setup(<InstalledPackCard installation={installation} name="Essentials" onEditRule={edit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit My existing rule' }))
    expect(edit).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove pack' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Owned rule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/alerts/pack-installations/10/remove', {
      method: 'POST', body: JSON.stringify({ delete_rule_ids: [1] }), requiresLiveMode: true,
    }))
  })

  it('shows catalog errors with retry instead of hiding the section', async () => {
    vi.mocked(request).mockRejectedValue(new Error('Catalog unavailable'))
    setup(<AlertPacksPage />)
    expect(await screen.findAllByText("Can't reach server")).not.toHaveLength(0)
    expect(screen.getByRole('heading', { level: 1, name: 'Alert packs' })).toBeInTheDocument()
  })
})
