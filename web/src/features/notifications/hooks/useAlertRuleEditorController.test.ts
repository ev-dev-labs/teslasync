import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertRule } from '@/api/types'
import type { AlertRuleEditorProps } from '../components/alert-editor-source-closure/types'
import { freshEditor } from '../components/alert-editor-source-closure/editorHydration'
import { ruleTemplates } from '../lib/alertRuleTemplates'
import { useAlertRuleEditorController } from './useAlertRuleEditorController'

const mocks = vi.hoisted(() => ({
  save: vi.fn<() => Promise<AlertRule>>(),
  dirty: vi.fn(),
  confirm: vi.fn(async () => true),
}))

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationChannels: () => ({ data: [], isLoading: false }),
  useAlertMetrics: () => ({ data: [], isLoading: false }),
  useSaveAlertRule: () => useMutation({ mutationFn: mocks.save, retry: false }),
  useTestAlertRule: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: null }),
}))
vi.mock('@/hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: mocks.confirm, dialogProps: {} }),
}))
vi.mock('@/hooks/useDirtyForm', () => ({ useDirtyForm: mocks.dirty }))
vi.mock('@/hooks/useNavigationGuard', () => ({ useNavigationGuard: vi.fn() }))
vi.mock('../components/alert-editor-source-closure/useSignalConditionModel', () => ({
  useSignalConditionModel: () => ({}),
}))

function makeRule(id = 42): AlertRule {
  return {
    id, name: `Rule ${id}`, enabled: true, severity: 'warn',
    signal_name: 'BatteryLevel', op: '<', value_num: 20,
    cooldown_min: 15, trigger_mode: 'once', kind: 'signal',
    all_vehicles: true, channel_ids: null, created_at: '', updated_at: '',
  }
}

function mount(rule: AlertRule | null = null) {
  let resolve!: (saved: AlertRule) => void
  let reject!: (error: Error) => void
  mocks.save.mockReturnValue(new Promise<AlertRule>((res, rej) => {
    resolve = res
    reject = rej
  }))
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onSaved = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const view = renderHook(
    (props: AlertRuleEditorProps) => useAlertRuleEditorController(props),
    { initialProps: { rule, onSaved }, wrapper },
  )
  const submit = async () => {
    act(() => view.result.current.handleSave())
    await waitFor(() => expect(view.result.current.saveRuleMut.isPending).toBe(true))
  }
  const succeed = async () => {
    await act(async () => { resolve(makeRule()) })
    await waitFor(() => expect(view.result.current.saveRuleMut.isSuccess).toBe(true))
  }
  return { ...view, onSaved, submit, succeed, resolve, reject }
}

function edit(view: ReturnType<typeof mount>, name = 'Submitted draft') {
  act(() => view.result.current.setEditor(current => ({
    ...current, name, signal_name: 'BatteryLevel', op: '<', value_num: '20',
  })))
  expect(view.result.current.canSave).toBe(true)
}

describe('alert rule save revision settlement', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('preserves a newer vehicle scope and its persisted draft after an older create succeeds', async () => {
    const view = mount()
    edit(view)
    await view.submit()
    act(() => view.result.current.setEditor(current => ({
      ...current, vehicle_selection: { kind: 'specific', vehicle_ids: [7] },
    })))
    const newer = view.result.current.editor
    await view.succeed()
    expect(view.result.current.editor).toEqual(newer)
    expect(view.onSaved).not.toHaveBeenCalled()
    expect(mocks.dirty).toHaveBeenLastCalledWith(true)
    await waitFor(() => {
      const stored = localStorage.getItem('teslasync:draft:v6:alertstudio:rule:new')
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!).value).toEqual(newer)
    }, { timeout: 2000 })
  })

  it('invalidates settlement before an edit has rendered', async () => {
    const view = mount()
    edit(view)
    await view.submit()
    await act(async () => {
      view.result.current.setEditor(current => ({ ...current, name: 'Newer draft' }))
      // Complete in the same batch as the revision-changing action.
      view.resolve(makeRule())
    })
    await waitFor(() => expect(view.result.current.saveRuleMut.isSuccess).toBe(true))
    expect(view.result.current.editor.name).toBe('Newer draft')
    expect(view.onSaved).not.toHaveBeenCalled()
  })

  it('ignores completion after switching rule scope away and back', async () => {
    const rule = makeRule()
    const view = mount(rule)
    edit(view)
    await view.submit()
    view.rerender({ rule: makeRule(99), onSaved: view.onSaved })
    view.rerender({ rule, onSaved: view.onSaved })
    const current = view.result.current.editor
    await view.succeed()
    expect(view.result.current.editor).toEqual(current)
    expect(view.onSaved).not.toHaveBeenCalled()
  })

  it.each(['reset', 'template', 'discard'] as const)(
    'preserves a %s revision made during pending work',
    async action => {
      const view = mount()
      edit(view)
      await view.submit()
      await act(async () => {
        if (action === 'reset') view.result.current.handleNewRule()
        else if (action === 'template') view.result.current.handleCloneTemplate(ruleTemplates[0])
        else view.result.current.handleDiscardDraft()
      })
      const current = view.result.current.editor
      await view.succeed()
      expect(view.result.current.editor).toEqual(current)
      expect(view.onSaved).not.toHaveBeenCalled()
    },
  )

  it('preserves the submitted draft and error on rejection', async () => {
    const view = mount()
    edit(view)
    const submitted = view.result.current.editor
    await view.submit()
    const error = new Error('Save rejected')
    await act(async () => { view.reject(error) })
    await waitFor(() => expect(view.result.current.saveRuleMut.isError).toBe(true))
    expect(view.result.current.saveRuleMut.error).toBe(error)
    expect(view.result.current.editor).toEqual(submitted)
    expect(mocks.dirty).toHaveBeenLastCalledWith(true)
    expect(view.onSaved).not.toHaveBeenCalled()
  })

  it('clears a matching successful create and notifies its owner', async () => {
    const view = mount()
    edit(view)
    await view.submit()
    await view.succeed()
    expect(view.result.current.editor).toEqual(freshEditor())
    expect(localStorage.getItem('teslasync:draft:v6:alertstudio:rule:new')).toBeNull()
    expect(mocks.dirty).toHaveBeenLastCalledWith(false)
    expect(view.onSaved).toHaveBeenCalledExactlyOnceWith(makeRule())
  })

  it.each([false, true])('settles an existing rule only for a matching revision (new edit: %s)', async newerEdit => {
    const view = mount(makeRule())
    edit(view)
    await view.submit()
    if (newerEdit) edit(view, 'Newer draft')
    const current = view.result.current.editor
    await view.succeed()
    expect(view.result.current.editor).toEqual(current)
    expect(mocks.dirty).toHaveBeenLastCalledWith(newerEdit)
    expect(view.onSaved).toHaveBeenCalledTimes(newerEdit ? 0 : 1)
  })
})
