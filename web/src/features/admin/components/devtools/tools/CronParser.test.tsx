/**
 * CronParserTool contract + regression tests.
 *
 * CronParserTool is the interactive cron dev-tool card. Its single export owns
 * a controlled text input, five quick-fill presets, and three mutually-derived
 * output regions. These tests exercise every branch of that state machine:
 *
 *   1. Chrome        — title / description / labelled input / all preset buttons.
 *   2. Idle          — an empty-input hint, and NO parsed output or alert; the
 *                      5-field guard keeps the pure helpers from being called.
 *   3. Invalid       — a non-5-field expression surfaces a role="alert" message
 *                      instead of a silently blank panel (the pre-hardening bug).
 *   4. Valid         — a real describeCron summary + a badge-numbered run list.
 *   5. Preset click  — fills the controlled input and drives the parsed output.
 *   6. No upcoming   — a structurally-valid expression that never fires degrades
 *                      to the empty-state copy rather than an empty run region.
 *   7. Whitespace    — surrounding / internal whitespace collapses to 5 fields.
 *
 * react-i18next is stubbed so t('English') returns its key verbatim, keeping the
 * assertions locale-file independent (repo convention — see BackendTool.test.tsx
 * / TelemetryErrorsPanel.test.tsx). The pure cron helpers are spied but call
 * through to their real implementations by default, so the happy path stays an
 * honest integration test; a single test forces the "valid but zero runs" branch
 * deterministically via mockReturnValueOnce instead of running getNextCronRuns'
 * ~525k-iteration safety loop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('../helpers', async () => {
  const actual = await vi.importActual<typeof import('../helpers')>('../helpers')
  return {
    ...actual,
    describeCron: vi.fn(actual.describeCron),
    getNextCronRuns: vi.fn(actual.getNextCronRuns),
  }
})

import { describeCron, getNextCronRuns } from '../helpers'
import { CronParserTool } from './CronParser'

const mockedDescribe = vi.mocked(describeCron)
const mockedNextRuns = vi.mocked(getNextCronRuns)

const IDLE_HINT = 'Enter a cron expression or pick a preset to preview its schedule'
const INVALID_MSG = 'Enter all 5 cron fields: minute, hour, day, month, weekday'
const NO_RUNS_MSG = 'No upcoming runs in the next year'

const PRESETS = ['Every Minute', 'Every Hour', 'Every Day', 'Every Week', 'Every Month']

function typeExpr(value: string) {
  fireEvent.change(screen.getByLabelText('Cron Expression'), { target: { value } })
}

beforeEach(() => {
  mockedDescribe.mockClear()
  mockedNextRuns.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('CronParserTool', () => {
  it('renders the tool chrome: title, description, labelled input, and every preset button', () => {
    render(<CronParserTool />)

    expect(screen.getByText('Cron Parser')).toBeInTheDocument()
    expect(screen.getByText('Cron Parser Desc')).toBeInTheDocument()
    // The input is wired to a real <label>, so it's reachable by accessible name.
    expect(screen.getByLabelText('Cron Expression')).toBeInTheDocument()

    for (const label of PRESETS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('shows an idle hint and no parsed output before anything is entered', () => {
    render(<CronParserTool />)

    expect(screen.getByText(IDLE_HINT)).toBeInTheDocument()
    // None of the settled states leak into idle…
    expect(screen.queryByText('Description')).toBeNull()
    expect(screen.queryByText('Next Runs')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // …and the 5-field guard keeps the pure helpers untouched on empty input.
    expect(mockedDescribe).not.toHaveBeenCalled()
    expect(mockedNextRuns).not.toHaveBeenCalled()
  })

  it('surfaces a validation alert for an expression without exactly five fields', () => {
    render(<CronParserTool />)

    typeExpr('1 2 3')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(INVALID_MSG)
    // Invalid input renders neither a description nor a run list…
    expect(screen.queryByText('Description')).toBeNull()
    expect(screen.queryByText('Next Runs')).toBeNull()
    // …and the idle hint is replaced by the alert.
    expect(screen.queryByText(IDLE_HINT)).toBeNull()
    // The guard means the helpers stay untouched for a 3-field string.
    expect(mockedNextRuns).not.toHaveBeenCalled()
  })

  it('parses a valid expression into a human description and a badge-numbered run list', () => {
    render(<CronParserTool />)

    typeExpr('* * * * *')

    // Real describeCron renders the "Every minute" summary under its label.
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Every minute')).toBeInTheDocument()
    // describeCron / getNextCronRuns were invoked with the parsed 5-field array.
    const fields = ['*', '*', '*', '*', '*']
    expect(mockedDescribe).toHaveBeenCalledWith(fields)
    expect(mockedNextRuns).toHaveBeenCalledWith(fields, 5)
    // Exactly five run rows, badge-numbered 1..5 (clock-independent count).
    expect(screen.getByText('Next Runs')).toBeInTheDocument()
    expect(screen.getAllByText(/^[1-5]$/)).toHaveLength(5)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText(NO_RUNS_MSG)).toBeNull()
  })

  it('fills the input and drives the parsed output when a preset is clicked', () => {
    render(<CronParserTool />)

    fireEvent.click(screen.getByRole('button', { name: 'Every Hour' }))

    // The controlled input reflects the preset's cron string…
    expect(screen.getByLabelText('Cron Expression')).toHaveValue('0 * * * *')
    // …and the real describeCron summary for "0 * * * *" is shown.
    expect(screen.getByText('At minute 0 of every hour')).toBeInTheDocument()
    expect(mockedNextRuns).toHaveBeenCalledWith(['0', '*', '*', '*', '*'], 5)
  })

  it('degrades to an empty-state message when a valid expression yields no upcoming runs', () => {
    // Force the "structurally valid but never fires" branch deterministically
    // (e.g. Feb 30) without the real ~525k-iteration exhaustion loop.
    mockedNextRuns.mockReturnValueOnce([])
    render(<CronParserTool />)

    typeExpr('0 0 30 2 *')

    // The description still renders (the expression parses)…
    expect(screen.getByText('Description')).toBeInTheDocument()
    // …but the run region shows the empty-state copy, never a blank panel.
    expect(screen.getByText(NO_RUNS_MSG)).toBeInTheDocument()
    expect(screen.queryByText('1')).toBeNull()
    expect(mockedNextRuns).toHaveBeenCalledWith(['0', '0', '30', '2', '*'], 5)
  })

  it('collapses surrounding and internal whitespace when splitting into fields', () => {
    render(<CronParserTool />)

    typeExpr('  0   0   *   *   0  ')

    // Real describeCron for the weekly-midnight expression proves the trimmed,
    // whitespace-collapsed 5-field array reached the helper.
    expect(screen.getByText('At 00:00 on Sun')).toBeInTheDocument()
    expect(mockedDescribe).toHaveBeenCalledWith(['0', '0', '*', '*', '0'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
