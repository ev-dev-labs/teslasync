/**
 * TimestampTool behaviour + hardening contract tests.
 *
 * The tool is a self-contained, network-free converter between Unix epoch and
 * ISO-8601 timestamps, plus a live "current time" readout. Every test drives
 * the real component through its accessible surface (labelled inputs, the
 * "Now" control, the current-time group, and the rendered conversion rows) and
 * asserts the rendered result — never an implementation detail.
 *
 * It locks the guarantees the elevation established / fixed:
 *
 *   - the ToolCard renders real localized copy, NOT the raw i18n key
 *     placeholders that leaked before ("Timestamp Desc", "Unix Timestamp",
 *     "Iso Timestamp") and the row label reads "ISO", never the mojibake "Iso"
 *     that t('Iso') produced — the same class of bug the sibling Base64Tool /
 *     HttpStatusTool tests guard against;
 *   - a valid Unix seconds value converts to the correct ISO / Local / Relative
 *     trio, and a 13-digit value is treated as milliseconds (the seconds-vs-ms
 *     heuristic branch);
 *   - LEADING/TRAILING WHITESPACE no longer tips a 10-digit seconds value into
 *     the milliseconds branch (the pre-elevation `unix.length > 10` heuristic
 *     rendered " 1700000000" as a 1970 date — this is the headline bug fix);
 *   - malformed input surfaces an assertive inline `role="alert"` instead of a
 *     silently-wrong date (parseInt used to accept "1700000000xyz") or a blank
 *     panel;
 *   - a valid ISO value converts back to the correct Unix / Local / Relative;
 *   - the "Now" control fills BOTH inputs with the current instant;
 *   - clearing an input tears down its conversion rows (no lingering panel);
 *   - the live current-time readout advances as wall-clock time passes;
 *   - the current-time group and the icon-only-adjacent "Now" control expose
 *     real accessible names.
 *
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * Base64Tool.test.tsx), so interactions go through `fireEvent`. Real i18n is
 * loaded so assertions run against the production en.json strings. Fake timers
 * pin "now" to a fixed instant exactly ONE day after the primary test input, so
 * the live clock never collides with a conversion value and the Relative row is
 * deterministically "1d ago".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@/i18n'
import { TimestampTool } from './TimestampTool'

// 2023-11-15T22:13:20Z == unix 1700086400 == exactly 1 day after 1700000000.
const NOW_ISO = '2023-11-15T22:13:20.000Z'
const NOW_UNIX = '1700086400'
// The primary conversion input: 2023-11-14T22:13:20Z, one day earlier.
const INPUT_UNIX_SECONDS = '1700000000'
const INPUT_UNIX_MILLIS = '1700000000000'
const INPUT_ISO = '2023-11-14T22:13:20.000Z'

function unixInput(): HTMLInputElement {
  return screen.getByLabelText('Unix Timestamp') as HTMLInputElement
}

function isoInput(): HTMLInputElement {
  return screen.getByLabelText('ISO Timestamp') as HTMLInputElement
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } })
}

describe('TimestampTool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_ISO))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders localized card copy, the live current-time readout, and labelled inputs with no premature output', () => {
    render(<TimestampTool />)

    // Title + description come from the namespaced catalog keys. The negative
    // assertions are regression guards for the flat, defaultless keys that used
    // to render literally (t('Timestamp Desc') → "Timestamp Desc").
    expect(screen.getByRole('heading', { name: 'Timestamp' })).toBeInTheDocument()
    expect(screen.getByText('Convert between Unix and ISO 8601 timestamps')).toBeInTheDocument()
    expect(screen.queryByText('Timestamp Desc')).toBeNull()

    // The live readout shows the current unix seconds AND ISO string.
    expect(screen.getByText(NOW_UNIX)).toBeInTheDocument()
    expect(screen.getByText(NOW_ISO)).toBeInTheDocument()

    // Both inputs are reachable by their accessible labels (association via
    // htmlFor/id) and start empty.
    expect(unixInput().tagName).toBe('INPUT')
    expect(isoInput().tagName).toBe('INPUT')
    expect(unixInput().value).toBe('')
    expect(isoInput().value).toBe('')

    // Nothing entered yet — no conversion rows, no error alert.
    expect(screen.queryByText(/ago$/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('converts a Unix seconds value to a correct ISO / Local / Relative trio with an uppercase "ISO" label', () => {
    render(<TimestampTool />)
    type(unixInput(), INPUT_UNIX_SECONDS)

    // ISO row: exact UTC instant. getByText on /^ISO:/ also proves the label is
    // uppercase "ISO" (t('devtools.utils.timestampIso')), not the old "Iso".
    const isoRow = screen.getByText(/^ISO:/)
    expect(isoRow.textContent).toMatch(/^ISO:/)
    expect(screen.getByText(INPUT_ISO)).toBeInTheDocument()

    // Relative row is deterministically one day (exactly 86400s) behind "now".
    expect(screen.getByText('1d ago')).toBeInTheDocument()

    // Local row renders a real formatted string, never the "—" fallback.
    const localRow = screen.getByText(/^Local:/)
    expect(localRow.textContent).not.toContain('—')
    expect(localRow.textContent).toMatch(/Local: \S/)

    // A valid conversion is not an error.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a 13-digit value as milliseconds (seconds-vs-ms heuristic branch)', () => {
    render(<TimestampTool />)
    type(unixInput(), INPUT_UNIX_MILLIS)

    // 1700000000000 ms and 1700000000 s denote the same instant — both must
    // resolve to the identical ISO string, proving the ms branch is taken for
    // 11+ digit inputs.
    expect(screen.getByText(INPUT_ISO)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('trims surrounding whitespace instead of misreading seconds as milliseconds (regression)', () => {
    render(<TimestampTool />)
    // Before the fix, " 1700000000".length === 11 > 10 tipped this into the ms
    // branch → new Date(1700000000) → a January 1970 date. The hardened parser
    // trims first, so the 10 significant digits are correctly read as seconds.
    type(unixInput(), `  ${INPUT_UNIX_SECONDS}  `)

    expect(screen.getByText(INPUT_ISO)).toBeInTheDocument()
    expect(screen.queryByText(/^1970-/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('rejects malformed Unix input with an assertive inline error and no fake conversion', () => {
    render(<TimestampTool />)

    // parseInt('1700000000xyz') used to yield 1700000000 and render a
    // confidently-wrong date; the strict integer parser now flags it.
    type(unixInput(), '1700000000xyz')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a valid Unix timestamp')

    // An error must NOT masquerade as a successful conversion.
    expect(screen.queryByText(/^ISO:/)).toBeNull()
    expect(screen.queryByText(/ago$/)).toBeNull()

    // Pure garbage is rejected the same way.
    type(unixInput(), 'not-a-number')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid Unix timestamp')
  })

  it('converts an ISO value back to a correct Unix / Local / Relative trio', () => {
    render(<TimestampTool />)
    type(isoInput(), '2023-11-14T22:13:20Z')

    // Unix row: the epoch seconds for the entered instant.
    const unixRow = screen.getByText(/^Unix:/)
    expect(unixRow.textContent).toContain(INPUT_UNIX_SECONDS)
    expect(screen.getByText(INPUT_UNIX_SECONDS)).toBeInTheDocument()

    // Deterministic relative label + a real Local render.
    expect(screen.getByText('1d ago')).toBeInTheDocument()
    expect(screen.getByText(/^Local:/).textContent).not.toContain('—')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('rejects malformed ISO input with an assertive inline error', () => {
    render(<TimestampTool />)
    type(isoInput(), 'definitely-not-a-date')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a valid ISO 8601 timestamp')
    expect(screen.queryByText(/^Unix:/)).toBeNull()
  })

  it('fills both inputs with the current instant when "Now" is clicked', () => {
    render(<TimestampTool />)
    expect(unixInput().value).toBe('')
    expect(isoInput().value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Now' }))

    // Both inputs are populated with the pinned "now".
    expect(unixInput().value).toBe(NOW_UNIX)
    expect(isoInput().value).toBe(NOW_ISO)

    // Both columns now describe the same instant as "now", so each Relative row
    // reads "0s ago" — one per column.
    expect(screen.getAllByText('0s ago')).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tears down conversion rows when an input is cleared (no lingering panel)', () => {
    render(<TimestampTool />)
    type(unixInput(), INPUT_UNIX_SECONDS)
    expect(screen.getByText(INPUT_ISO)).toBeInTheDocument()
    expect(screen.getByText('1d ago')).toBeInTheDocument()

    type(unixInput(), '')
    expect(screen.queryByText(INPUT_ISO)).toBeNull()
    expect(screen.queryByText(/ago$/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('advances the live current-time readout as wall-clock time passes', () => {
    render(<TimestampTool />)
    expect(screen.getByText(NOW_UNIX)).toBeInTheDocument()

    // The 1s interval ticks setNow(new Date()); advancing the fake clock 5s
    // should roll the readout forward by exactly five seconds.
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByText(String(Number(NOW_UNIX) + 5))).toBeInTheDocument()
    expect(screen.getByText('2023-11-15T22:13:25.000Z')).toBeInTheDocument()
    expect(screen.queryByText(NOW_UNIX)).toBeNull()
  })

  it('exposes the current-time group and the "Now" control through real accessible names', () => {
    render(<TimestampTool />)

    // The live readout is a labelled group so assistive tech can identify it.
    expect(screen.getByRole('group', { name: 'Current time' })).toBeInTheDocument()

    // The "Now" button carries a descriptive title alongside its visible text.
    const nowButton = screen.getByRole('button', { name: 'Now' })
    expect(nowButton).toHaveAttribute('title', 'Fill inputs with the current time')
  })
})
