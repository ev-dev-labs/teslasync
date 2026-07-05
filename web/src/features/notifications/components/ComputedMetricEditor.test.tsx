/**
 * ComputedMetricEditor — operand panel for kind='computed_metric' alert rules.
 *
 * Behavioural coverage for the single runtime export (the component) and the
 * three private pure helpers it exercises through the rendered output
 * (`opLabel` / `opKey` via the operator option labels, `unitSuffix` via the
 * live-preview line):
 *
 *   • accessibility — every control (metric / window / operator select +
 *     threshold spinbutton) carries a programmatic name, so assistive tech
 *     announces the field even though the visible caption is a sibling <Text>;
 *   • metric selection — emits onChange seeded with the metric's first window
 *     and first operator, and DEGRADES SAFELY when a malformed registry entry
 *     omits its `windows`/`ops` arrays (the null-safety fix — old code threw on
 *     `def.windows.length`);
 *   • dependent enable/disable — window + operator selects stay disabled until a
 *     metric is chosen;
 *   • operator humanisation — `%_change_>`/`%_change_<` render as "% change >"/
 *     "% change <";
 *   • change plumbing — window, operator, and threshold edits each thread back
 *     through onChange;
 *   • loading — the metric select is disabled and shows the loading placeholder;
 *   • the five live-preview states — idle (and NO network call), computing,
 *     success (formatted value + unit suffix + fire/NOT-fire verdict), the
 *     never-blank fallback, and the error alert.
 *
 * The one network hook (`usePreviewComputedMetric`) is mocked at module scope so
 * the suite never touches the API client / TanStack cache, and `react-i18next`
 * is stubbed so `t(key, default, vars)` deterministically interpolates the
 * English fallback. `@testing-library/user-event` is not installed in this repo
 * (see the sibling AlertMessageEditor / ResponseViewer tests), so interactions
 * are driven with `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type {
  ComputedMetricSummary,
  ComputedMetricPreview,
} from '@/api/types'

// Shared, mutable preview-mutation stand-in. Hoisted so the vi.mock factory
// below can close over it while individual tests drive `.data` / `.isPending` /
// the `.mutate` implementation per scenario.
const { previewState } = vi.hoisted(() => ({
  previewState: {
    mutate: vi.fn(),
    data: undefined,
    isPending: false,
  } as { mutate: Mock; data: ComputedMetricPreview | undefined; isPending: boolean },
}))

vi.mock('@/api/hooks/useNotifications', () => ({
  usePreviewComputedMetric: () => previewState,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      const template = typeof defOrOpts === 'string' ? defOrOpts : key
      const vars = (typeof defOrOpts === 'object' ? defOrOpts : maybeOpts) ?? {}
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        name in vars ? String(vars[name]) : '',
      )
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}))

import {
  ComputedMetricEditor,
  type ComputedMetricEditorValue,
} from './ComputedMetricEditor'

/* ── fixtures ─────────────────────────────────────────────────────────── */

const metrics: ComputedMetricSummary[] = [
  {
    id: 'cost_per_mi',
    label: 'Cost per mile',
    unit: 'currency_per_mi',
    windows: ['7d', '30d'],
    ops: ['>', '>=', '<'],
  },
  {
    id: 'energy_used',
    label: 'Energy used',
    unit: 'kwh',
    windows: ['24h', '7d'],
    ops: ['%_change_>', '%_change_<'],
  },
]

function makeValue(over: Partial<ComputedMetricEditorValue> = {}): ComputedMetricEditorValue {
  return {
    metric_id: '',
    metric_window: '',
    metric_op: '>',
    metric_threshold: '',
    vehicle_id: null,
    ...over,
  }
}

const completeValue = makeValue({
  metric_id: 'cost_per_mi',
  metric_window: '7d',
  metric_op: '>',
  metric_threshold: '0.5',
})

/**
 * Controlled harness: threads onChange back into local state so the selects
 * reflect edits the way the real AlertStudioPage parent would. Returns the
 * onChange spy for assertions.
 */
function renderEditor(
  initial: ComputedMetricEditorValue,
  opts: { metrics?: ComputedMetricSummary[]; loading?: boolean } = {},
) {
  const onChange = vi.fn()
  function Harness() {
    const [val, setVal] = useState(initial)
    return (
      <ComputedMetricEditor
        value={val}
        metrics={opts.metrics ?? metrics}
        loading={opts.loading}
        onChange={next => {
          onChange(next)
          setVal(next)
        }}
      />
    )
  }
  render(<Harness />)
  return { onChange }
}

const metricSelect = () => screen.getByRole('combobox', { name: 'Metric' })
const windowSelect = () => screen.getByRole('combobox', { name: 'Window' })
const opSelect = () => screen.getByRole('combobox', { name: 'Operator' })
const thresholdInput = () => screen.getByRole('spinbutton', { name: 'Threshold' })

beforeEach(() => {
  previewState.mutate = vi.fn()
  previewState.data = undefined
  previewState.isPending = false
})

afterEach(() => {
  cleanup()
})

describe('ComputedMetricEditor', () => {
  it('renders every control with a programmatic accessible name', () => {
    renderEditor(makeValue())
    expect(metricSelect()).toBeInTheDocument()
    expect(windowSelect()).toBeInTheDocument()
    expect(opSelect()).toBeInTheDocument()
    expect(thresholdInput()).toBeInTheDocument()
  })

  it('lists every registry metric as an option', () => {
    renderEditor(makeValue())
    const select = metricSelect()
    expect(within(select).getByRole('option', { name: 'Cost per mile' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Energy used' })).toBeInTheDocument()
    // Placeholder option is present while nothing is chosen.
    expect(within(select).getByRole('option', { name: 'Choose a metric' })).toBeInTheDocument()
  })

  it('seeds the first window + first operator when a metric is picked', () => {
    const { onChange } = renderEditor(makeValue())
    fireEvent.change(metricSelect(), { target: { value: 'energy_used' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_id: 'energy_used',
        metric_window: '24h',
        metric_op: '%_change_>',
      }),
    )
  })

  it('degrades safely when the chosen metric omits its windows/ops arrays', () => {
    // A malformed registry entry with no `windows`/`ops`. The old code did
    // `def.windows.length` and threw a TypeError here; the hardened code uses
    // optional chaining and falls back to an empty window + the current op.
    const malformed = [
      { id: 'broken', label: 'Broken metric', unit: 'count' },
    ] as unknown as ComputedMetricSummary[]
    const { onChange } = renderEditor(makeValue({ metric_op: '<' }), { metrics: malformed })

    expect(() =>
      fireEvent.change(metricSelect(), { target: { value: 'broken' } }),
    ).not.toThrow()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_id: 'broken',
        metric_window: '',
        metric_op: '<',
      }),
    )
  })

  it('disables window + operator selects until a metric is selected', () => {
    renderEditor(makeValue())
    expect(windowSelect()).toBeDisabled()
    expect(opSelect()).toBeDisabled()
  })

  it('enables the dependent selects once a metric is selected', () => {
    renderEditor(makeValue({ metric_id: 'cost_per_mi', metric_window: '7d' }))
    expect(windowSelect()).toBeEnabled()
    expect(opSelect()).toBeEnabled()
  })

  it('humanises %_change operators in the operator dropdown', () => {
    renderEditor(makeValue({ metric_id: 'energy_used', metric_window: '24h', metric_op: '%_change_>' }))
    const select = opSelect()
    expect(within(select).getByRole('option', { name: '% change >' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '% change <' })).toBeInTheDocument()
  })

  it('threads window, operator, and threshold edits through onChange', () => {
    const { onChange } = renderEditor(
      makeValue({ metric_id: 'cost_per_mi', metric_window: '7d', metric_op: '>' }),
    )

    fireEvent.change(windowSelect(), { target: { value: '30d' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ metric_window: '30d' }))

    fireEvent.change(opSelect(), { target: { value: '>=' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ metric_op: '>=' }))

    fireEvent.change(thresholdInput(), { target: { value: '200' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ metric_threshold: '200' }))
  })

  it('disables the metric select and shows the loading placeholder while loading', () => {
    renderEditor(makeValue(), { loading: true })
    const select = metricSelect()
    expect(select).toBeDisabled()
    expect(within(select).getByRole('option', { name: /Loading metrics/ })).toBeInTheDocument()
  })

  it('renders without crashing on an empty metrics list and stays in the idle preview', () => {
    renderEditor(makeValue(), { metrics: [] })
    expect(metricSelect()).toBeInTheDocument()
    expect(
      screen.getByText(/Pick a metric, window, operator, and threshold to preview\./),
    ).toBeInTheDocument()
    expect(previewState.mutate).not.toHaveBeenCalled()
  })

  it('shows the idle hint and issues NO preview request when inputs are incomplete', () => {
    // metric_threshold is blank → `ready` is false.
    renderEditor(makeValue({ metric_id: 'cost_per_mi', metric_window: '7d', metric_op: '>' }))
    expect(
      screen.getByText(/Pick a metric, window, operator, and threshold to preview\./),
    ).toBeInTheDocument()
    expect(previewState.mutate).not.toHaveBeenCalled()
  })

  it('shows the computing state while the preview is pending', () => {
    previewState.isPending = true
    renderEditor(completeValue)
    expect(screen.getByText('Computing…')).toBeInTheDocument()
  })

  it('fires a preview request with the parsed numeric threshold once inputs are ready', () => {
    previewState.data = {
      kind: 'computed_metric',
      metric_id: 'cost_per_mi',
      metric_window: '7d',
      metric_op: '>',
      threshold: 0.5,
      value: 0.5,
      would_trigger: false,
    }
    renderEditor(completeValue)
    expect(previewState.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_id: 'cost_per_mi',
        metric_window: '7d',
        metric_op: '>',
        metric_threshold: 0.5,
        vehicle_id: undefined,
      }),
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('renders the success line with the formatted value, unit suffix, and NOT-fire verdict', () => {
    previewState.data = {
      kind: 'computed_metric',
      metric_id: 'cost_per_mi',
      metric_window: '7d',
      metric_op: '>',
      threshold: 0.5,
      value: 0.5,
      would_trigger: false,
    }
    renderEditor(completeValue)
    const line = screen.getByText(/would NOT fire/)
    expect(line).toHaveTextContent('0.50')
    expect(line).toHaveTextContent('/mi')
    expect(line).toHaveTextContent('NOT')
  })

  it('omits the NOT verdict when the metric would fire', () => {
    previewState.data = {
      kind: 'computed_metric',
      metric_id: 'cost_per_mi',
      metric_window: '7d',
      metric_op: '>',
      threshold: 0.5,
      value: 1.25,
      would_trigger: true,
    }
    renderEditor(completeValue)
    const line = screen.getByText(/would/i)
    expect(line).toHaveTextContent('1.25')
    expect(line.textContent).not.toContain('NOT')
  })

  it('shows a never-blank fallback when ready but no preview data has arrived', () => {
    // data undefined, not pending, no error → the hardened empty state.
    renderEditor(completeValue)
    expect(screen.getByText('No preview available yet.')).toBeInTheDocument()
  })

  it('surfaces a preview failure as an assertive alert', () => {
    previewState.mutate = vi.fn(
      (_payload: unknown, opts?: { onError?: (e: unknown) => void }) => {
        opts?.onError?.(new Error('preview failed'))
      },
    ) as Mock
    renderEditor(completeValue)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('preview failed')
  })
})
