import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { request } from '@/api/client'
import type { AlertRule, NotificationChannel } from '@/api/hooks/useNotifications'
import { ToastProvider } from '@/components/feedback/Toast'
import RuleListTools from './RuleListTools'
import RuleChannelDialog from './RuleChannelDialog'
import '@/i18n'

vi.mock('@/api/client', () => ({ request: vi.fn() }))

const rule: AlertRule = {
  id: 1, name: 'Battery', enabled: true, all_vehicles: true, vehicle_ids: [], signal_name: 'BatteryLevel',
  op: '<', value_num: 20, severity: 'warn', cooldown_min: 60, trigger_mode: 'once', kind: 'signal',
  created_at: '', updated_at: '',
}
const channels: NotificationChannel[] = [
  { id: 2, name: 'Team chat', kind: 'discord', enabled: true, config: { webhook_url: '' }, created_at: '', updated_at: '' },
  { id: 3, name: 'Phone', kind: 'ntfy', enabled: true, config: { server_url: '', topic: '' }, created_at: '', updated_at: '' },
]

function setup(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { vi.mocked(request).mockReset() })

it('requires confirmation and deletes only the selected IDs', async () => {
  vi.mocked(request).mockResolvedValue({ deleted_ids: [1] })
  const deleted = vi.fn()
  setup(<RuleListTools total={2} search="" onSearch={vi.fn()} actions={[]} rules={[rule, { ...rule, id: 4 }]} selected={new Set([1])} onSelect={vi.fn()} channels={channels}
    channelFilter="" onChannelFilter={vi.fn()} beforeDelete={async () => true} onDeleted={deleted} />)
  expect(screen.getByRole('checkbox', { name: 'Select all matching rules' })).toBePartiallyChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete 1 rule?' })
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete', exact: true }))
  await waitFor(() => expect(deleted).toHaveBeenCalledWith([1]))
  expect(request).toHaveBeenCalledWith('/alerts/rules/bulk/delete', { method: 'POST', body: '{"ids":[1]}' })
})

it('reveals one delete action only after selection and reuses it for select-all', async () => {
  function Harness() {
    const [selected, setSelected] = useState(new Set<number>())
    return <RuleListTools total={2} search="" onSearch={vi.fn()} actions={[]} rules={[rule, { ...rule, id: 4 }]} selected={selected} onSelect={setSelected} channels={channels}
      channelFilter="" onChannelFilter={vi.fn()} beforeDelete={async () => true} onDeleted={vi.fn()} />
  }
  setup(<Harness />)
  expect(screen.queryByRole('region', { name: 'Bulk actions for selected items' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all matching rules' }))
  expect(screen.getAllByRole('button', { name: /Delete/ })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete 2 rules?' })
  fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
  expect(request).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'Select all matching rules' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
})

it('omits management controls for a truly empty list but keeps filters for no matches', () => {
  const onSearch = vi.fn()
  const onChannelFilter = vi.fn()
  const props = { total: 0, search: '', onSearch, actions: [], rules: [], selected: new Set<number>(),
    onSelect: vi.fn(), channels, channelFilter: '', onChannelFilter, beforeDelete: async () => true, onDeleted: vi.fn() }
  const view = setup(<RuleListTools {...props} />)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  view.unmount()
  setup(<RuleListTools {...props} total={2} search="unmatched" channelFilter="2" />)
  expect(screen.getByRole('combobox', { name: 'Filter by notification channel' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Select all matching rules' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(onSearch).toHaveBeenCalledWith('')
  expect(onChannelFilter).toHaveBeenCalledWith('')
})

it('groups enable, disable and delete in one contextual toolbar', async () => {
  const enable = vi.fn().mockResolvedValue(undefined)
  setup(<RuleListTools total={2} search="" onSearch={vi.fn()}
    actions={[{ id: 'enable', label: 'Enable', onClick: enable }, { id: 'disable', label: 'Disable', onClick: vi.fn() }]}
    rules={[rule, { ...rule, id: 4 }]} selected={new Set([1])} onSelect={vi.fn()} channels={channels}
    channelFilter="" onChannelFilter={vi.fn()} beforeDelete={async () => true} onDeleted={vi.fn()} />)
  const toolbar = screen.getByRole('region', { name: 'Bulk actions for selected items' })
  expect(within(toolbar).getByRole('button', { name: 'Disable', exact: true })).toBeVisible()
  expect(within(toolbar).getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Enable', exact: true }))
  expect(enable).toHaveBeenCalledWith([1])
  await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Enable', exact: true })).toBeEnabled())
})

it('keeps failed deletion selected and respects dirty-editor cancellation', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Database unavailable'))
  const deleted = vi.fn()
  const before = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  setup(<RuleListTools total={1} search="" onSearch={vi.fn()} actions={[]} rules={[rule]} selected={new Set([1])} onSelect={vi.fn()} channels={channels}
    channelFilter="" onChannelFilter={vi.fn()} beforeDelete={before} onDeleted={deleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
  await waitFor(() => expect(before).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete', exact: true }))
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(deleted).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
})

it('saves only channel selection and keeps alert content out of the quick-edit request', async () => {
  vi.mocked(request).mockResolvedValue({ ...rule, channel_ids: [2] })
  const close = vi.fn()
  setup(<RuleChannelDialog rule={rule} channels={channels} onClose={close} />)
  fireEvent.click(screen.getByRole('switch', { name: 'All enabled channels, including future channels' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Phone (ntfy)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith('/alerts/rules/1', expect.objectContaining({ method: 'PUT', body: '{"channel_ids":[2]}' }))
})

it('distinguishes no external channels from all present and future channels', async () => {
  vi.mocked(request).mockResolvedValue(rule)
  const view = setup(<RuleChannelDialog rule={{ ...rule, channel_ids: [] }} channels={channels} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/alerts/rules/1', expect.objectContaining({ body: '{"channel_ids":[]}' })))
  view.unmount()
  setup(<RuleChannelDialog rule={{ ...rule, channel_ids: [2] }} channels={channels} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('switch', { name: 'All enabled channels, including future channels' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/alerts/rules/1', expect.objectContaining({ body: '{"channel_ids":null}' })))
})

it('does not silently discard unavailable channels or close a failed channel update', async () => {
  vi.mocked(request).mockRejectedValue(new Error('Channel save failed'))
  const close = vi.fn()
  setup(<RuleChannelDialog rule={{ ...rule, channel_ids: [99] }} channels={channels} onClose={close} />)
  expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable channel selections' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Team chat (discord)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'Team chat (discord)' })).toBeChecked()
})
