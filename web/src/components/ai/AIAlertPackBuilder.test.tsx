import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AlertPack } from '@/api/hooks/useAlertPacks'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { AIAlertPackBuilder } from './AIAlertPackBuilder'
import '@/i18n'

const mocks = vi.hoisted(() => ({ enabled: false, start: vi.fn(), cancel: vi.fn(), event: undefined as ((event: AiStreamEvent) => void) | undefined }))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => mocks.enabled }))
vi.mock('@/hooks/useAiStream', () => ({
  useAiStream: (options: { url: string; onEvent: (event: AiStreamEvent) => void }) => {
    expect(options.url).toBe('/ai/alerts/packs/draft')
    mocks.event = options.onEvent
    return { state: 'done', error: null, text: '', start: mocks.start, cancel: mocks.cancel }
  },
}))
const catalog = {
  id: 'custom', version: 1, name: 'Custom pack', description: 'Build a group.',
  rules: [{ id: 'battery-low', rule: { name: 'Battery running low' } }, { id: 'charge-complete', rule: { name: 'Charging complete' } }],
} as AlertPack
beforeEach(() => { mocks.enabled = false; mocks.event = undefined; vi.clearAllMocks() })

it('does not mount a stream when AI is off', () => {
  render(<AIAlertPackBuilder catalog={catalog} onApply={vi.fn()} />)
  expect(screen.queryByTestId('ai-feature-alert-pack-builder-root')).not.toBeInTheDocument()
  expect(mocks.event).toBeUndefined()
})

it('requires a goal, accepts only supported proposals and hands off without installing', () => {
  mocks.enabled = true
  const apply = vi.fn()
  const view = render(<AIAlertPackBuilder catalog={catalog} onApply={apply} />)
  expect(screen.getByRole('button', { name: /Suggest an alert pack/ })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('What would you like to keep an eye on?'), { target: { value: 'Battery and charging reminders' } })
  fireEvent.click(screen.getByRole('button', { name: /Suggest an alert pack/ }))
  expect(mocks.start).toHaveBeenCalledOnce()
  act(() => mocks.event?.({ type: 'tool_result', name: 'propose_alert_pack', ok: true, data: {
    status: 'ok', name: 'Weekend', rationale: 'Useful reminders', template_ids: ['battery-low','invented'],
  } } as AiStreamEvent))
  expect(screen.queryByRole('button', { name: 'Review this proposed pack' })).not.toBeInTheDocument()
  act(() => mocks.event?.({ type: 'tool_result', name: 'propose_alert_pack', ok: true, data: {
    status: 'ok', name: 'Weekend', rationale: 'Useful reminders', template_ids: ['battery-low','charge-complete'],
  } } as AiStreamEvent))
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Review this proposed pack' }))
  expect(apply).toHaveBeenCalledWith({ ...catalog, name: 'Weekend' })
  fireEvent.change(screen.getByLabelText('What would you like to keep an eye on?'), { target: { value: 'Different goal' } })
  expect(screen.queryByRole('button', { name: 'Review this proposed pack' })).not.toBeInTheDocument()
  view.unmount()
  expect(mocks.cancel).toHaveBeenCalled()
})
