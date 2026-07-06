/**
 * JsonFormatterTool contract tests.
 *
 * JsonFormatterTool is a "Utilities" devtool that pretty-prints pasted text as
 * 2-space indented JSON, or reports the parse failure. It is a pure,
 * self-contained widget (no network, react-query, or router), so these tests
 * drive it through its single textarea and assert the rendered contract across
 * every facet:
 *
 *   1. Structure   — the tool renders its (i18n-defaulted) title/description and
 *                    a *labelled* input. The label association is the a11y bug
 *                    this elevation fixes (the old standalone <span> gave the
 *                    textarea no accessible name).
 *   2. Empty state — before any input the output area is a neutral EmptyState
 *                    (role="status"), never a blank panel (guideline #6).
 *   3. Formatting  — minified valid JSON is re-emitted multi-line with 2-space
 *                    indentation, matching JSON.stringify(…, null, 2) exactly.
 *   4. Primitives  — a bare JSON primitive (`null`) formats to "null" instead of
 *                    collapsing to the empty/error branch (a naive
 *                    truthiness-gated implementation would drop it).
 *   5. Error path  — invalid JSON surfaces an accessible `alert` with the
 *                    translatable "Invalid JSON" heading AND the preserved raw
 *                    parser detail, and hides the formatted output entirely.
 *   6. Edge case   — whitespace-only input reads as "empty", not "invalid".
 *   7. Lifecycle   — the memoised result re-derives correctly across the full
 *                    empty → valid → invalid → empty transition sequence.
 *   8. Interaction — the CopyButton writes the formatted JSON (not the raw
 *                    input) to the clipboard and confirms with a "Copied" toggle.
 *
 * `react-i18next` is mocked (the same seam the sibling devtools tests use) so
 * `t(key, fallback)` returns the English default and label assertions stay
 * deterministic. Expected output is derived from the real `JSON.stringify` so
 * the assertions can never drift from the component's own formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { JsonFormatterTool } from './JsonFormatter'

const INPUT_LABEL = 'JSON Input'
const EMPTY_MSG = 'Paste JSON above to validate and pretty-print it.'
const INVALID_MSG = 'Invalid JSON'

const inputEl = () => screen.getByLabelText(INPUT_LABEL) as HTMLTextAreaElement
const copyBtn = () => screen.queryByRole('button', { name: 'Copy' })
const preEl = (c: HTMLElement) => c.querySelector('pre')
const pretty = (raw: string) => JSON.stringify(JSON.parse(raw), null, 2)

function type(v: string) {
  fireEvent.change(inputEl(), { target: { value: v } })
}

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  // The CopyButton reaches for navigator.clipboard; jsdom has no real one.
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

describe('JsonFormatterTool', () => {
  it('renders its title, description, and a labelled JSON input', () => {
    render(<JsonFormatterTool />)

    expect(
      screen.getByRole('heading', { name: 'JSON Formatter' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Validate and pretty-print JSON with 2-space indentation.',
      ),
    ).toBeInTheDocument()

    // a11y fix: the control is reachable by its accessible name (previously the
    // <span> label was not associated) and is the shared <Textarea>.
    expect(inputEl().tagName).toBe('TEXTAREA')
  })

  it('shows a neutral empty state (not a blank panel) before any input', () => {
    render(<JsonFormatterTool />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(EMPTY_MSG)
    // Nothing to copy and no error yet.
    expect(copyBtn()).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('pretty-prints minified valid JSON with 2-space indentation', () => {
    const { container } = render(<JsonFormatterTool />)
    type('{"b":2,"a":1}')

    const pre = preEl(container)
    expect(pre).not.toBeNull()
    // Output matches the real formatter exactly (insertion order preserved).
    expect(pre!.textContent).toBe(pretty('{"b":2,"a":1}'))
    // The reformat actually happened — it is multi-line + indented, not the
    // compact source string.
    expect(pre!.textContent).toContain('\n  "b": 2')
    // The empty state is replaced and a copy affordance is offered.
    expect(screen.queryByRole('status')).toBeNull()
    expect(copyBtn()).toBeInTheDocument()
  })

  it('formats a bare JSON primitive (null) instead of treating it as empty/error', () => {
    const { container } = render(<JsonFormatterTool />)
    type('null')

    expect(preEl(container)!.textContent).toBe('null')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('surfaces an accessible error for invalid JSON and hides the output', () => {
    const { container } = render(<JsonFormatterTool />)
    type('{ not valid')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(INVALID_MSG)
    // The raw parser detail is preserved as a secondary line, so the alert says
    // more than just the translatable heading.
    expect(alert.textContent!.length).toBeGreaterThan(INVALID_MSG.length)
    // No formatted output / copy button while the input is invalid.
    expect(preEl(container)).toBeNull()
    expect(copyBtn()).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('treats a whitespace-only value as empty rather than invalid', () => {
    render(<JsonFormatterTool />)
    type('   \n  ')

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(EMPTY_MSG)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-derives correctly across the empty → valid → invalid → empty lifecycle', () => {
    const { container } = render(<JsonFormatterTool />)

    // empty
    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_MSG)

    // valid → formatted output
    type('{"ok":true}')
    expect(preEl(container)!.textContent).toBe(pretty('{"ok":true}'))
    expect(screen.queryByRole('status')).toBeNull()

    // invalid → alert, output gone
    type('{oops}')
    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_MSG)
    expect(preEl(container)).toBeNull()

    // cleared → empty again
    type('')
    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_MSG)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('copies the formatted JSON (not the raw input) to the clipboard on demand', async () => {
    render(<JsonFormatterTool />)
    type('{"x":1}')
    const expected = pretty('{"x":1}')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(expected)
    // The affordance confirms success by toggling to "Copied".
    expect(
      await screen.findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument()
  })
})
