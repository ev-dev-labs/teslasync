import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { NavigationGuardProvider } from '@/components/feedback'
import { request } from '@/api/client'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { AlertPack, PackInstallation } from '@/api/hooks/useAlertPacks'
import AlertPacksPanel from './AlertPacksPanel'
import InstallPackDialog from './InstallPackDialog'
import InstalledPackCard from './InstalledPackCard'
import '@/i18n'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
vi.mock('@/api/queryPolicy', () => ({ queryPolicy: () => ({ retry: false }) }))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: vi.fn(() => true) }))
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ formatTemperature: (value: number) => `${value} C` }) }))

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

function setup(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><NavigationGuardProvider>{ui}</NavigationGuardProvider></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(true)
  vi.mocked(request).mockReset()
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === '/alerts/packs') return [pack]
    if (path.startsWith('/alerts/pack-installations?')) return []
    if (path === '/vehicles') return [{ id: 1, display_name: 'Roadster', model: 'Model 3' }]
    if (path.endsWith('/install')) return installation
    if (path.endsWith('/remove')) return { status: 'removed' }
    throw new Error(`Unexpected request ${path}`)
  })
})

describe('Alert Packs', () => {
  it('paginates a 70-rule pack without dropping selections or installing just the visible page', async () => {
    const comprehensive: AlertPack = { ...pack, id: 'all', name: 'All alerts',
      rules: Array.from({ length: 70 }, (_, index) => ({
        ...pack.rules[0], id: `full-${index}`, rule: { ...pack.rules[0].rule, name: `Reminder ${index + 1}` },
      })) }
    setup(<InstallPackDialog pack={comprehensive} onClose={vi.fn()} />)
    expect(screen.getByText('70 of 70 rules selected')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Reminder 11' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reminder 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }))
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
    })
  })

  it('starts with a desktop comparison table, not repeated editors, and browsing is not a dirty edit', () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    expect(screen.getByRole('table', { name: 'Choose rules' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Notification message')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply master settings to all rules' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customize Charging complete' }))
    expect(screen.getAllByLabelText('Notification message')).toHaveLength(1)
    expect(screen.queryByLabelText('Threshold (%)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('uses compact mobile cards and keeps edited values when changing the focused rule', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false)
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Master cooldown (minutes)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Master settings/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Customize Charging complete' }))
    expect(screen.getAllByLabelText('Notification message')).toHaveLength(1)
    fireEvent.change(screen.getByRole('combobox', { name: 'Show rules' }), { target: { value: 'customized' } })
    expect(screen.queryByRole('checkbox', { name: 'Charging complete' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
    expect(screen.getByLabelText('Threshold (%)')).toHaveValue(25)
    const footer = screen.getByRole('button', { name: 'Install selected rules' }).closest('[data-modal-footer]')
    expect(footer).toHaveTextContent('2 of 2 rules selected')
  })

  it('inherits master settings, preserves individual overrides, and explicitly reapplies master settings', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Master cooldown (minutes)'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Master alert behavior'), { target: { value: 'repeat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
    expect(screen.getByText(/15 min cooldown/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Minimum minutes between notifications')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('switch', { name: 'Use individual delivery settings' })[0])
    fireEvent.change(screen.getAllByLabelText('Minimum minutes between notifications')[0], { target: { value: '120' } })
    fireEvent.change(screen.getAllByLabelText('Alert behavior')[0], { target: { value: 'once' } })
    fireEvent.change(screen.getByLabelText('Master cooldown (minutes)'), { target: { value: '30' } })
    expect(screen.getAllByLabelText('Minimum minutes between notifications')[0]).toHaveValue(120)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Charging complete' }))
    expect(screen.getByText(/30 min cooldown/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply master settings to all rules' }))
    expect(screen.getAllByRole('switch', { name: 'Use individual delivery settings' }).every(input => input.getAttribute('aria-checked') === 'false')).toBe(true)
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
      fireEvent.change(screen.getByLabelText('Master cooldown (minutes)'), { target: { value } })
      expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeDisabled()
    }
    fireEvent.change(screen.getByLabelText('Master cooldown (minutes)'), { target: { value: '1' } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
    fireEvent.change(screen.getByLabelText('Threshold (%)'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Use individual delivery settings' }))
    fireEvent.change(screen.getByLabelText('Minimum minutes between notifications'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Notification message'), { target: { value: '{{VehicleName}} needs a charge.' } })
    fireEvent.change(screen.getByLabelText('After installation'), { target: { value: 'enabled' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install selected rules' }))
    await screen.findByText(/Pack installed. Created 2 rules; reused 1/)
    const call = vi.mocked(request).mock.calls.find(([path]) => path.endsWith('/install'))
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      version: 1, all_vehicles: true, vehicle_ids: [], enabled: true, cooldown_s: 3600, trigger_mode: 'once', include_title: true,
      rules: [{ template_id: 'battery-low', value_num: 25, cooldown_s: 7200, trigger_mode: 'once', include_title: true, message: '{{VehicleName}} needs a charge.' }],
    })
  })

  it('keeps installation disabled for invalid threshold and zero selected rules', async () => {
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
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
      throw new Error('Installation failed')
    })
    setup(<InstallPackDialog pack={pack} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install selected rules' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
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
      method: 'POST', body: JSON.stringify({ delete_rule_ids: [] }),
    }))
  })

  it('clears the unsaved guard when edits are undone', async () => {
    const close = vi.fn()
    setup(<InstallPackDialog pack={pack} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Battery running low' }))
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
      method: 'POST', body: JSON.stringify({ delete_rule_ids: [1] }),
    }))
  })

  it('shows catalog errors with retry instead of hiding the section', async () => {
    vi.mocked(request).mockRejectedValue(new Error('Catalog unavailable'))
    setup(<AlertPacksPanel onEditRule={vi.fn()} />)
    expect(await screen.findAllByText("Can't reach server")).not.toHaveLength(0)
    expect(screen.getByText('Alert Packs')).toBeInTheDocument()
  })
})
