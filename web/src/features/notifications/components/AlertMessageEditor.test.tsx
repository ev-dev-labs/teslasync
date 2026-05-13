/**
 * AlertMessageEditor tests — Phase-50 / ADR-014.
 *
 * Smoke-level coverage of the four invariants that matter for the
 * editor UX:
 *
 *   1. The include_title checkbox reflects the prop and notifies the
 *      parent when toggled.
 *   2. Typing `{{` opens the autocomplete popover with placeholders
 *      pulled from `useAlertMessagePlaceholders`.
 *   3. Selecting a placeholder splices `{{Key}}` into the body and
 *      notifies the parent with the new value.
 *   4. The "Pick a preset" button opens a modal showing presets from
 *      `useAlertMessagePresets`; clicking one calls onTemplateChange
 *      with that preset's `template`.
 *
 * The three message-helper hooks are mocked at module scope so the
 * test suite is independent of the API client / TanStack cache.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../../../i18n'

import { AlertMessageEditor } from './AlertMessageEditor'
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
} from '@/api/types'

const placeholders: AlertMessagePlaceholder[] = [
  {
    key: 'BatteryLevel',
    label: 'Battery Level',
    description: 'State of charge percentage',
    group: 'Signals',
    example: '42',
  },
  {
    key: 'VehicleName',
    label: 'Vehicle Name',
    description: 'Display name of the triggering vehicle',
    group: 'Built-in',
    example: 'Falcon',
  },
  // Value, SignalName, Threshold are always returned by the backend
  // for op `<` rules — they need to be in the test baseline so the
  // op-validity preset filter doesn't hide presets that reference them.
  {
    key: 'Value',
    label: 'Triggering value',
    description: 'Current value of the signal that triggered the rule',
    group: 'Built-in',
    example: '18.2',
  },
  {
    key: 'SignalName',
    label: 'Signal name',
    description: 'Name of the signal the rule monitors',
    group: 'Built-in',
    example: 'BatteryLevel',
  },
  {
    key: 'Threshold',
    label: 'Threshold',
    description: 'Configured threshold the rule compared against',
    group: 'Built-in',
    example: '20',
  },
]

const presets: AlertMessagePreset[] = [
  {
    id: 'signal-default',
    name: 'Default',
    description: 'Sensible default for signal rules',
    template: '{{VehicleName}}: {{Value}}',
    kind: 'signal',
    tags: ['default'],
  },
  {
    id: 'signal-concise',
    name: 'Concise',
    description: 'One-liner',
    template: '{{SignalName}}={{Value}}',
    kind: 'signal',
    tags: ['concise'],
  },
]

const previewMutate = vi.fn()

vi.mock('@/api/hooks/useAlertMessageHelpers', () => ({
  useAlertMessagePlaceholders: () => ({
    data: placeholders,
    isLoading: false,
  }),
  useAlertMessagePresets: () => ({
    data: presets,
    isLoading: false,
  }),
  useAlertMessagePreview: () => ({
    mutate: previewMutate,
    isPending: false,
  }),
  alertMessageKeys: { presets: () => [], placeholders: () => [] },
}))

function renderEditor(overrides: Partial<React.ComponentProps<typeof AlertMessageEditor>> = {}) {
  const onTemplateChange = vi.fn()
  const onIncludeTitleChange = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Controlled wrapper: route the change handlers through real
  // useState so the textarea + checkbox stay in sync with the props
  // that drive their controlled values. Without this, React resets
  // `<Textarea value={msgTemplate}>` to its initial empty string on
  // every render and the autocomplete state machine never sees
  // anything past the initial keystroke.
  function Harness() {
    const [msgTemplate, setMsg] = useState(overrides.msgTemplate ?? '')
    const [includeTitle, setInclude] = useState(overrides.includeTitle ?? true)
    return (
      <AlertMessageEditor
        msgTemplate={msgTemplate}
        includeTitle={includeTitle}
        draft={{ kind: 'signal', signal_name: 'BatteryLevel', op: '<', severity: 'warn' }}
        {...overrides}
        onTemplateChange={next => {
          setMsg(next)
          onTemplateChange(next)
        }}
        onIncludeTitleChange={next => {
          setInclude(next)
          onIncludeTitleChange(next)
        }}
      />
    )
  }
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  )
  return { onTemplateChange, onIncludeTitleChange }
}

describe('AlertMessageEditor', () => {
  beforeEach(() => {
    previewMutate.mockClear()
  })

  it('reflects includeTitle and notifies parent on toggle', () => {
    const { onIncludeTitleChange } = renderEditor({ includeTitle: true })
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(onIncludeTitleChange).toHaveBeenCalledWith(false)
  })

  it('opens autocomplete after typing {{ and inserts the chosen placeholder', async () => {
    const { onTemplateChange } = renderEditor()
    const textarea = screen.getByPlaceholderText(/leave blank for the smart default/i) as HTMLTextAreaElement

    // Simulate the user typing `{{`. `fireEvent.change` is the only
    // way to push a new value through React's controlled-input value
    // tracker — direct `textarea.value = ...` bypasses it and the
    // onChange handler never fires. We then redefine `selectionEnd`
    // so the autocomplete state machine sees a caret of 2 (jsdom
    // wouldn't otherwise update it from a synthetic event).
    Object.defineProperty(textarea, 'selectionEnd', {
      value: 2,
      configurable: true,
      writable: true,
    })
    act(() => {
      fireEvent.change(textarea, { target: { value: '{{' } })
    })

    // Wait a tick for the popover's useLayoutEffect to commit.
    await act(async () => {
      await Promise.resolve()
    })

    const option = screen.getByRole('button', { name: /BatteryLevel/ })
    fireEvent.click(option)
    expect(onTemplateChange).toHaveBeenLastCalledWith('{{BatteryLevel}}')
  })

  it('preset modal opens and applies the chosen template', () => {
    const { onTemplateChange } = renderEditor()
    const trigger = screen.getByRole('button', { name: /pick a preset/i })
    fireEvent.click(trigger)

    // The preset cards live inside the modal; match the card by its
    // unique template code that's part of the accessible name.
    const card = screen.getByRole('button', { name: /\{\{VehicleName\}\}: \{\{Value\}\}/ })
    fireEvent.click(card)
    expect(onTemplateChange).toHaveBeenCalledWith('{{VehicleName}}: {{Value}}')
  })

  it('debounces and fires a preview request via the mutation', async () => {
    renderEditor({ msgTemplate: 'Battery at {{BatteryLevel}}%' })
    // PREVIEW_DEBOUNCE_MS = 150 ms; advance the macrotask queue.
    await new Promise(r => setTimeout(r, 200))
    expect(previewMutate).toHaveBeenCalled()
    const lastCall = previewMutate.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      msg_template: 'Battery at {{BatteryLevel}}%',
      include_title: true,
      signal_name: 'BatteryLevel',
      op: '<',
    })
  })

  it('hides presets whose template references placeholders the current op does not provide', () => {
    // Add a range preset (uses {{Min}}/{{Max}}) and a threshold preset
    // (uses {{Threshold}}) on the fly. The mocked placeholders list
    // does NOT include Min/Max, so the range preset must NOT appear
    // (op `<` doesn't populate Min/Max). Threshold IS in the baseline
    // so the threshold preset must appear.
    presets.push(
      {
        id: 'signal-range',
        name: 'Range',
        description: 'For between/outside rules',
        template: '{{SignalName}} = {{Value}} · expected {{Min}}–{{Max}}',
        kind: 'signal',
        tags: ['range'],
      },
      {
        id: 'signal-threshold',
        name: 'Threshold',
        description: 'For < <= > >= rules',
        template: '{{SignalName}} is {{Value}} (threshold {{Threshold}})',
        kind: 'signal',
        tags: ['threshold'],
      },
    )
    try {
      renderEditor()
      fireEvent.click(screen.getByRole('button', { name: /pick a preset/i }))
      // Threshold preset is op-valid for `<` → present.
      expect(
        screen.queryByRole('button', { name: /\(threshold \{\{Threshold\}\}\)/ }),
      ).not.toBeNull()
      // Range preset depends on Min/Max which are NOT in the available
      // set for op `<` → must be filtered out.
      expect(
        screen.queryByRole('button', { name: /expected \{\{Min\}\}–\{\{Max\}\}/ }),
      ).toBeNull()
      // Tag chip for "range" should likewise be hidden because no
      // surviving preset carries that tag.
      expect(screen.queryByRole('button', { name: /^range$/i })).toBeNull()
    } finally {
      // Restore module-level fixtures so the rest of the suite is
      // unaffected by the in-test mutations above.
      presets.length = 2
    }
  })

  it('shows range presets when the placeholder list includes Min/Max', () => {
    presets.push({
      id: 'signal-range',
      name: 'Range',
      description: 'For between/outside rules',
      template: '{{SignalName}} = {{Value}} · expected {{Min}}–{{Max}}',
      kind: 'signal',
      tags: ['range'],
    })
    placeholders.push(
      { key: 'Min', label: 'Range min', description: '', group: 'Built-in', example: '' },
      { key: 'Max', label: 'Range max', description: '', group: 'Built-in', example: '' },
    )
    const baselinePh = 5
    try {
      renderEditor({
        draft: {
          kind: 'signal',
          signal_name: 'BatteryLevel',
          op: 'between',
          severity: 'warn',
        },
      })
      fireEvent.click(screen.getByRole('button', { name: /pick a preset/i }))
      expect(
        screen.queryByRole('button', { name: /expected \{\{Min\}\}–\{\{Max\}\}/ }),
      ).not.toBeNull()
    } finally {
      presets.length = 2
      placeholders.length = baselinePh
    }
  })
})
