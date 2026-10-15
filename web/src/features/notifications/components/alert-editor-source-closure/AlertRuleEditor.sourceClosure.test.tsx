import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NavigationGuardProvider, GuardedLink } from '@/components/feedback'
import type { AlertRule, AlertRuleInput, AlertMessagePreviewRequest, AlertMessagePreviewResponse } from '@/api/types'
import { AlertRuleEditor } from '../AlertRuleEditor'
import { ruleTemplates } from '../../lib/alertRuleTemplates'
import { freshEditor } from './editorHydration'

const H = vi.hoisted(() => ({
  channels: [{ id: 11, name: 'Primary', kind: 'discord' }, { id: 12, name: 'Secondary', kind: 'slack' }] as
    Array<{ id: number; name: string; kind: string }> | undefined,
  channelsError: null as Error | null,
  channelsLoading: false,
  retryChannels: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  metricPreview: vi.fn(),
  saved: vi.fn(),
  cancel: vi.fn(),
  messagePreview: vi.fn((
    _body: AlertMessagePreviewRequest,
    options?: { onSuccess?: (response: AlertMessagePreviewResponse) => void },
  ) => options?.onSuccess?.({ title: 'Preview title', body: 'Preserved preview body' })),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [{ id: 2, vehicle_id: 2, display_name: 'Roadster', timezone: 'UTC', vin: 'TEST_ONLY',
      model: 'Model 3', trim_badging: '', exterior_color: '', wheel_type: '', state: 'online',
      healthy: true, created_at: '', updated_at: '' }],
    isLoading: false,
  }),
}))
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 2 }),
}))
vi.mock('@/api/hooks/useSignals', () => ({
  useAvailableSignals: () => ({
    data: { vehicle_id: 2, signals: [
      { name: 'BatteryLevel', value_kind: 'float', unit_kind: 'charge', category: 'battery' },
      { name: 'VehicleSpeed', value_kind: 'float', unit_kind: 'speed', category: 'driving' },
    ] },
    isLoading: false,
  }),
}))
vi.mock('@/api/hooks/useLocations', () => ({
  useGeofencesFull: () => ({ data: [{ id: 7, name: 'Home', enabled: true }], isLoading: false }),
}))
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationChannels: () => ({
    data: H.channels, error: H.channelsError, isError: H.channelsError != null,
    isLoading: H.channelsLoading, refetch: H.retryChannels,
  }),
  useAlertMetrics: () => ({
    data: [{ id: 'distance', label: 'Distance', category: 'driving', unit: 'm', windows: ['day'], ops: ['>'] }],
    isLoading: false,
  }),
  useSaveAlertRule: () => ({ mutate: H.save, isPending: false }),
  useTestAlertRule: () => ({ mutate: H.test, isPending: false }),
  usePreviewComputedMetric: () => ({ mutate: H.metricPreview, isPending: false, data: undefined }),
}))
vi.mock('@/api/hooks/useAlertMessageHelpers', () => ({
  useAlertMessageFormattingKey: () => 'source-closure-fixture',
  useAlertMessagePlaceholders: () => ({
    data: [{ key: 'VehicleName', label: 'Vehicle name', group: 'Common', example: 'Roadster' }],
    isLoading: false,
  }),
  useAlertMessagePresets: () => ({
    data: [{ id: 'vehicle', name: 'Vehicle preset', template: '{{VehicleName}}', tags: ['vehicle'], kind: '' }],
    isLoading: false,
  }),
  useAlertMessagePreview: () => ({ mutate: H.messagePreview, isPending: false }),
}))

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 42, name: 'Retained threshold', enabled: true, severity: 'warn',
    signal_name: 'BatteryLevel', op: '<', value_num: 20,
    cooldown_min: 15, trigger_mode: 'once', kind: 'signal',
    all_vehicles: false, vehicle_ids: [2], channel_ids: [11, 77],
    msg_template: '{{VehicleName}}', include_title: false, created_at: '', updated_at: '',
    ...overrides,
  }
}

function mount(rule: AlertRule | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rule ? '/notifications/rules?rule=42' : '/notifications/studio']}>
        <NavigationGuardProvider>
          <GuardedLink to="/vehicles">Leave editor</GuardedLink>
          <AlertRuleEditor rule={rule} onSaved={H.saved} onCancel={H.cancel} />
        </NavigationGuardProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, refreshSources: () => view.rerender(tree()) }
}

function select(id: string, value: string) {
  const control = document.getElementById(id)
  if (!control) throw new Error(`Missing preserved control ${id}`)
  fireEvent.change(control, { target: { value } })
}

function labeledControl(role: 'combobox' | 'textbox' | 'spinbutton', name: string, id: string) {
  const control = screen.getByRole(role, { name })
  expect(control).toHaveAttribute('id', id)
  expect(control).toHaveAccessibleName(name)
  const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)
  expect(label).toBeInstanceOf(HTMLLabelElement)
  expect(label?.control).toBe(control)
  return control
}

function associatedHelp(id: string) {
  const help = screen.getByRole('button', { name: `Help for ${id}` })
  expect(help).toHaveAttribute('data-help-for', id)
  const tooltip = document.getElementById(help.getAttribute('aria-describedby') ?? '')
  expect(tooltip).toHaveAttribute('role', 'tooltip')
  const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)
  expect(label).not.toContainElement(help)
  return tooltip
}

describe('AlertRuleEditor source closure mounted preservation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    H.channels = [{ id: 11, name: 'Primary', kind: 'discord' }, { id: 12, name: 'Secondary', kind: 'slack' }]
    H.channelsError = null
    H.channelsLoading = false
    H.retryChannels.mockClear()
    H.save.mockReset()
    H.test.mockClear()
    H.saved.mockClear()
    H.cancel.mockClear()
    H.metricPreview.mockClear()
    H.messagePreview.mockClear()
  })

  it('keeps all create controls, template categories/search/count and clone behavior reachable', async () => {
    mount()
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Status')).toHaveValue('true')
    expect(screen.getByLabelText('Alert behavior')).toHaveValue('once')
    expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('inherit')
    expect(screen.getByLabelText('Message template')).toHaveAttribute('maxlength', '1024')
    expect(screen.getByRole('checkbox', { name: 'Include title in notifications' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const totalTemplates = ruleTemplates.length
    expect(screen.getByText(`${totalTemplates} of ${totalTemplates} templates`)).toHaveAttribute('role', 'status')
    const filters = screen.getByRole('group', { name: 'Filter templates by category' })
    expect(filters).toHaveClass('flex-wrap')
    fireEvent.click(within(filters).getByRole('button', { name: /^Battery\s*\(/ }))
    expect(within(filters).getByRole('button', { name: /^Battery\s*\(/ })).toHaveAttribute('aria-pressed', 'true')
    const batteryTemplates = ruleTemplates.filter(template => template.category === 'Battery').length
    expect(screen.getByText(`${batteryTemplates} of ${totalTemplates} templates`)).toHaveAttribute('role', 'status')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'no match source closure' } })
    // The canonical SearchInput commits after its debounce, not on change.
    expect(await screen.findByText(`0 of ${totalTemplates} templates`)).toHaveAttribute('role', 'status')
    expect(screen.getByText('No templates found')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'Battery Low' } })
    expect(await screen.findByText(`2 of ${totalTemplates} templates`)).toHaveAttribute('role', 'status')
    expect(screen.getAllByRole('button', { name: /^Use template Battery Low \(/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Use template Battery Low (< 30%)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use template Battery Low (< 20%)' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Battery Low (< 20%)'))
    expect(screen.getByLabelText(/^Numeric value/)).toHaveValue('20.00')
    expect(screen.getByLabelText('Message template')).toHaveValue('Battery at {{BatteryLevel}}%')
    expect(screen.queryByRole('group', { name: 'Filter templates by category' })).not.toBeInTheDocument()
    expect(H.save).not.toHaveBeenCalled()
    expect(H.test).not.toHaveBeenCalled()
  })

  it('retains numeric/range/text/bool/changed controls and canonical speed conversion', () => {
    mount()
    select('alert-signal', 'BatteryLevel')
    const operator = labeledControl('combobox', 'Operator', 'alert-operator')
    expect(associatedHelp('alert-operator')).toHaveTextContent(
      "The comparison applied between the live signal value and your typed value. Available operators depend on the signal's value type.",
    )
    expect(within(operator).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual([
      '=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside',
    ])
    select('alert-operator', 'between')
    fireEvent.change(screen.getByLabelText(/^Minimum value/), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(/^Maximum value/), { target: { value: '80' } })
    expect(screen.getByLabelText(/^Minimum value/)).toHaveValue('10.00')
    select('alert-signal', 'Gear')
    expect(labeledControl('combobox', 'Operator', 'alert-operator')).toHaveValue('=')
    expect(within(operator).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['=', '!=', 'changed'])
    fireEvent.change(labeledControl('textbox', 'Text value required', 'alert-value-text'), { target: { value: 'D' } })
    select('alert-signal', 'Locked')
    expect(labeledControl('combobox', 'Boolean value required', 'alert-value-bool')).toHaveValue('true')
    select('alert-value-bool', 'false')
    expect(labeledControl('combobox', 'Boolean value required', 'alert-value-bool')).toHaveValue('false')
    select('alert-operator', 'changed')
    expect(screen.getByText('This rule fires whenever the selected signal changes.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Boolean value required' })).not.toBeInTheDocument()
    select('alert-signal', 'VehicleSpeed')
    select('alert-operator', '>')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Speed threshold' } })
    fireEvent.change(screen.getByLabelText(/^Numeric value/), { target: { value: '36' } })
    expect(screen.getByText('Enter km/h. Saved thresholds remain canonical SI values.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(H.save).toHaveBeenCalledWith(expect.objectContaining({ signal_name: 'VehicleSpeed', value_num: 10 }), expect.any(Object))
  })

  it('preserves repeat cap, escalation validation and once-mode clearing', () => {
    mount(makeRule())
    select('alert-trigger-mode', 'repeat')
    const repeatCap = labeledControl('spinbutton', 'Max alerts before condition resolves', 'alert-max-fires')
    expect(associatedHelp('alert-max-fires')).toHaveTextContent(
      'Cap the number of times this rule can re-fire while the condition keeps holding. The counter resets to zero as soon as the condition becomes false. Leave blank for unlimited.',
    )
    fireEvent.change(repeatCap, { target: { value: '4' } })
    expect(repeatCap).toHaveValue(4)
    fireEvent.click(screen.getByRole('switch', { name: 'Escalate to a higher severity if the condition stays unresolved' }))
    expect(screen.getByRole('button', { name: 'Update rule' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Escalate after (minutes)'), { target: { value: '30' } })
    select('alert-escalation-severity', 'critical')
    expect(screen.getByRole('button', { name: 'Update rule' })).not.toBeDisabled()
    select('alert-severity', 'critical')
    expect(screen.getByLabelText('Escalated severity')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Update rule' })).toBeDisabled()
    select('alert-trigger-mode', 'once')
    expect(screen.queryByRole('spinbutton', { name: 'Max alerts before condition resolves' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Escalate after (minutes)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 42, trigger_mode: 'once', max_fires_per_resolution: 4,
      escalation_after_min: null, escalation_severity: null,
    }), expect.any(Object))
  })

  it('keeps retained channel IDs, unsaved edits and separate test targets through refresh failure', () => {
    const view = mount(makeRule())
    expect(screen.getByText('Unavailable channel #77')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved retained name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Secondary (slack)' }))
    H.channelsError = new Error('channel refresh failed')
    view.refreshSources()
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved retained name')
    expect(screen.getByRole('button', { name: 'Primary', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Secondary (slack)', pressed: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(H.retryChannels).toHaveBeenCalledOnce()
    expect(H.test).not.toHaveBeenCalled()
    expect(H.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(H.test).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Unsaved retained name', value_num: 20, target: { channel_ids: [11] },
      msg_template: '{{VehicleName}}', include_title: false, vehicle_id: 2,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.save).toHaveBeenCalledWith(expect.objectContaining({ channel_ids: [11, 77], id: 42 }), expect.any(Object))
  })

  it('retains inherit/none/custom routing and prevents empty external test selection', () => {
    const view = mount(makeRule())
    select('alert-rule-channel-routing', 'none')
    fireEvent.click(screen.getByRole('button', { name: 'Secondary (slack)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Primary (discord)' }))
    expect(screen.getByRole('button', { name: 'Primary (discord)' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(H.test).toHaveBeenLastCalledWith(expect.objectContaining({ target: { channel_ids: [11] } }))
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({ channel_ids: [] }), expect.any(Object))
    select('alert-rule-channel-routing', 'custom')
    fireEvent.click(screen.getByRole('button', { name: 'Secondary', pressed: true }))
    expect(screen.getByRole('button', { name: 'Secondary', pressed: false })).toBeInTheDocument()
    H.channels = [{ id: 12, name: 'Secondary', kind: 'slack' }]
    view.refreshSources()
    expect(screen.getAllByText('Unavailable channel #11')).toHaveLength(2)
    expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('custom')
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({ channel_ids: [11] }), expect.any(Object))
    select('alert-rule-channel-routing', 'inherit')
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({ channel_ids: null }), expect.any(Object))
  })

  it('retains system/place/metric controls, scoped payloads and metric preview inputs', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Service rule' } })
    fireEvent.click(screen.getByRole('tab', { name: 'System service' }))
    expect(screen.queryByLabelText('Vehicles')).not.toBeInTheDocument()
    select('alert-system-component', 'mqtt')
    select('alert-system-transition', 'recovery')
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'system_component', component_name: 'mqtt', transition: 'recovery', all_vehicles: true, vehicle_ids: [],
    }), expect.any(Object))
    fireEvent.click(screen.getByRole('tab', { name: 'Place event' }))
    select('alert-place', '7')
    select('alert-place-transition', 'exit')
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'place', place_id: 7, transition: 'exit' }), expect.any(Object))
    fireEvent.click(screen.getByRole('tab', { name: 'Computed metric' }))
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'distance' } })
    expect(screen.getByLabelText('Window')).toHaveValue('day')
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '2' } })
    expect(screen.getByText('Live preview')).toBeInTheDocument()
    expect(H.metricPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      metric_id: 'distance', metric_window: 'day', metric_op: '>',
    }), expect.any(Object))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(H.save).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'computed_metric', metric_id: 'distance' }), expect.any(Object))
  })

  it('keeps the real message editor keyboard insertion, preview and preset modal wired to draft state', async () => {
    mount(makeRule())
    const textarea = screen.getByLabelText('Message template')
    fireEvent.change(textarea, { target: { value: '{{Veh', selectionEnd: 5 } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(textarea).toHaveValue('{{VehicleName}}'))
    expect(await screen.findByText('Preserved preview body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a preset' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Vehicle preset')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /Vehicle preset/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(textarea).toHaveValue('{{VehicleName}}')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include title in notifications' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(H.test).toHaveBeenCalledWith(expect.objectContaining({ msg_template: '{{VehicleName}}', include_title: true }))
  })

  it('keeps cancel confirmation and schema feedback rather than losing edits or sending invalid mutations', async () => {
    mount(makeRule())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(121) } })
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(screen.getByText('Name must be 120 characters or fewer')).toBeInTheDocument()
    expect(H.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(H.cancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveValue('x'.repeat(121))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(H.cancel).toHaveBeenCalledOnce())
  })

  it('preserves create success reset and saved callback without touching selected test destinations', async () => {
    H.save.mockImplementation((payload: AlertRuleInput, options?: { onSuccess?: (saved: AlertRule) => void }) => {
      options?.onSuccess?.(makeRule({ id: 999, name: payload.name }))
    })
    mount()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Created rule' } })
    select('alert-signal', 'BatteryLevel')
    fireEvent.change(screen.getByLabelText(/^Numeric value/), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Secondary (slack)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => expect(H.saved).toHaveBeenCalledWith(expect.objectContaining({ id: 999, name: 'Created rule' })))
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Alert behavior')).toHaveValue('once')
    expect(screen.getByLabelText('Rule delivery channels')).toHaveValue('inherit')
    expect(screen.getByRole('button', { name: 'Secondary (slack)' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeDisabled()
  })

  it('preserves edit success identity and clean cancel without resetting the edited rule', () => {
    H.save.mockImplementation((payload: AlertRuleInput, options?: { onSuccess?: (saved: AlertRule) => void }) => {
      options?.onSuccess?.(makeRule({ name: payload.name }))
    })
    mount(makeRule())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved edited name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    expect(H.saved).toHaveBeenCalledWith(expect.objectContaining({ id: 42, name: 'Saved edited name' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Saved edited name')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(H.cancel).toHaveBeenCalledOnce()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('restores version-six drafts, guards reset, and discards only after explicit confirmation', async () => {
    const stored = {
      ...freshEditor(), name: 'Recovered draft', signal_name: 'BatteryLevel', value_num: '20',
      trigger_mode: 'repeat', escalation_enabled: true, escalation_after_min: '30', escalation_severity: 'critical',
    }
    window.localStorage.setItem('teslasync:draft:v6:alertstudio:rule:new', JSON.stringify({
      version: 6, savedAt: Date.now(), value: stored,
    }))
    mount()
    expect(screen.getByLabelText('Name')).toHaveValue('Recovered draft')
    expect(screen.getByLabelText('Escalate after (minutes)')).toHaveValue(30)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New edit to recovered draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Name')).toHaveValue('New edit to recovered draft')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''))
    expect(screen.queryByLabelText('Escalate after (minutes)')).not.toBeInTheDocument()
    expect(H.save).not.toHaveBeenCalled()
    expect(H.test).not.toHaveBeenCalled()
  })

  it('keeps unknown kinds fail-closed and channel initial failure distinct from successful empty', () => {
    H.channels = undefined
    H.channelsError = new Error('initial channel failure')
    const view = mount(makeRule({ kind: 'future_event' as AlertRule['kind'] }))
    expect(screen.getByText(/This rule type cannot be edited/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update rule' })).toBeDisabled()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    expect(screen.queryByText('No external channels configured')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(H.retryChannels).toHaveBeenCalledOnce()
    H.channels = []
    H.channelsError = null
    view.refreshSources()
    expect(screen.getByText('No external channels configured')).toBeInTheDocument()
    expect(screen.getByText('Unavailable channel #77')).toBeInTheDocument()
    expect(H.save).not.toHaveBeenCalled()
    expect(H.test).not.toHaveBeenCalled()
  })
})
