/**
 * RegexTesterTool contract + regression tests.
 *
 * RegexTesterTool is the interactive regex dev-tool card. Its single export owns
 * three controlled inputs (pattern / flags / test string) and derives a match
 * list plus error / empty / truncated states. These tests exercise every branch
 * of that derivation and the hardening added during elevation:
 *
 *   1. Chrome + a11y — title / description and three *labelled* controls
 *                      (pattern input, flags select, test-string textarea) that
 *                      are reachable by accessible name.
 *   2. Idle          — an empty "0 Matches" badge, no alert, no empty-state copy,
 *                      including the "valid pattern but no test string" branch.
 *   3. Global multi  — a real multi-match run with badge-numbered rows + indices.
 *   4. Flag recompute — case-sensitive `g` vs case-insensitive `gi` re-derive.
 *   5. Non-global    — `''` (No Flags) yields exactly one match, not every hit.
 *   6. Invalid regex — a malformed pattern surfaces a role="alert" with the real
 *                      engine message + marks the input aria-invalid, instead of
 *                      the pre-hardening silent "0 Matches".
 *   7. Invalid early — the pattern is validated independently of the test string,
 *                      so feedback shows before any test string is typed.
 *   8. Zero-width    — `a*` finds all three matches (was truncated to one by the
 *                      old `if (!m[0]) break`) and renders an "(empty match)"
 *                      placeholder for the zero-width hits.
 *   9. No matches    — a valid pattern with zero hits degrades to explicit
 *                      empty-state copy rather than a bare badge.
 *  10. Truncation    — >MAX_MATCHES hits are capped with a "1000+" badge and a
 *                      limit note, proving the runaway-scan guard.
 *
 * react-i18next is stubbed so t('English') returns its key verbatim, keeping the
 * assertions locale-file independent (repo convention — see CronParser.test.tsx
 * / BackendTool.test.tsx). No network is touched: the tool is pure-client.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
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

import { RegexTesterTool } from './RegexTester'

function typePattern(value: string) {
  fireEvent.change(screen.getByLabelText('Pattern'), { target: { value } })
}

function typeTestString(value: string) {
  fireEvent.change(screen.getByLabelText('Test String'), { target: { value } })
}

function selectFlags(value: string) {
  fireEvent.change(screen.getByLabelText('Flags'), { target: { value } })
}

/** The single element whose own text ends in "Matches" is the count badge. */
function countBadge() {
  return screen.getByText(/Matches$/)
}

afterEach(() => {
  cleanup()
})

describe('RegexTesterTool', () => {
  it('renders the tool chrome and three labelled, accessible controls', () => {
    render(<RegexTesterTool />)

    expect(screen.getByText('Regex Tester')).toBeInTheDocument()
    expect(screen.getByText('Regex Tester Desc')).toBeInTheDocument()

    // Every control is wired to a real <label>, so it is reachable by name.
    expect(screen.getByLabelText('Pattern')).toBeInTheDocument()
    expect(screen.getByLabelText('Flags')).toBeInTheDocument()
    expect(screen.getByLabelText('Test String')).toBeInTheDocument()

    // The flags select defaults to global.
    expect(screen.getByLabelText('Flags')).toHaveValue('g')
    // Idle count badge — no matches, no error.
    expect(countBadge()).toHaveTextContent('0 Matches')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stays idle (no error, no empty-state) with empty inputs or a pattern but no test string', () => {
    render(<RegexTesterTool />)

    // Fully empty: badge only, nothing else leaks in.
    expect(countBadge()).toHaveTextContent('0 Matches')
    expect(screen.queryByText('No matches found')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    // A valid pattern with no test string must not report an error or a
    // premature "no matches" — the test string simply hasn't been entered.
    typePattern('abc')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Pattern')).not.toHaveAttribute('aria-invalid', 'true')
    expect(countBadge()).toHaveTextContent('0 Matches')
    expect(screen.queryByText('No matches found')).toBeNull()
  })

  it('lists every global match with a numbered badge, matched text, and its index', () => {
    render(<RegexTesterTool />)

    typePattern('\\d+') // -> the literal regex \d+
    typeTestString('a12b345')

    expect(countBadge()).toHaveTextContent('2 Matches')
    // Matched substrings and their positions.
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('345')).toBeInTheDocument()
    expect(screen.getByText('At Index 1')).toBeInTheDocument()
    expect(screen.getByText('At Index 4')).toBeInTheDocument()
    // Rows are badge-numbered 1..n.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-derives matches when the flags change from case-sensitive to case-insensitive', () => {
    render(<RegexTesterTool />)

    typePattern('a')
    typeTestString('AaA')

    // Default 'g' is case-sensitive: only the lowercase 'a' at index 1 matches.
    expect(countBadge()).toHaveTextContent('1 Matches')
    expect(screen.getByText('At Index 1')).toBeInTheDocument()
    expect(screen.queryByText('At Index 0')).toBeNull()

    // 'gi' folds case and now matches all three characters.
    selectFlags('gi')
    expect(countBadge()).toHaveTextContent('3 Matches')
    expect(screen.getByText('At Index 0')).toBeInTheDocument()
    expect(screen.getByText('At Index 2')).toBeInTheDocument()
  })

  it('returns only the first match when the global flag is absent', () => {
    render(<RegexTesterTool />)

    typePattern('a')
    selectFlags('') // No Flags -> non-global single exec
    typeTestString('banana')

    expect(countBadge()).toHaveTextContent('1 Matches')
    expect(screen.getByText('At Index 1')).toBeInTheDocument()
    // Non-global must NOT surface the later 'a' occurrences.
    expect(screen.queryByText('At Index 3')).toBeNull()
    expect(screen.queryByText('At Index 5')).toBeNull()
  })

  it('surfaces an alert with the engine error and marks the input invalid for a malformed pattern', () => {
    render(<RegexTesterTool />)

    typePattern('[') // unterminated character class
    typeTestString('abc')

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    // The real runtime message is shown for the developer.
    expect(alert).toHaveTextContent(/invalid/i)
    // The input is flagged and the count badge is replaced (not a silent "0").
    expect(screen.getByLabelText('Pattern')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Invalid pattern')).toBeInTheDocument()
    expect(screen.queryByText(/Matches$/)).toBeNull()
  })

  it('validates the pattern before any test string is entered', () => {
    render(<RegexTesterTool />)

    typePattern('(') // unterminated group, no test string yet

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Pattern')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/Matches$/)).toBeNull()
  })

  it('finds every zero-width match instead of stopping at the first empty one', () => {
    render(<RegexTesterTool />)

    typePattern('a*')
    typeTestString('baa')

    // Regression: the old `if (!m[0]) break` truncated this to a single match.
    expect(countBadge()).toHaveTextContent('3 Matches')
    expect(screen.getByText('aa')).toBeInTheDocument()
    // The two zero-width hits render an explicit placeholder, not a blank cell.
    expect(screen.getAllByText('(empty match)')).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an explicit empty state when a valid pattern matches nothing', () => {
    render(<RegexTesterTool />)

    typePattern('z')
    typeTestString('abc')

    expect(countBadge()).toHaveTextContent('0 Matches')
    expect(screen.getByText('No matches found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('caps runaway match counts and flags the result as truncated', () => {
    render(<RegexTesterTool />)

    typePattern('a')
    typeTestString('a'.repeat(1001)) // 1001 possible hits -> capped at 1000

    expect(countBadge()).toHaveTextContent('1000+ Matches')
    expect(screen.getByText('Result limit reached')).toBeInTheDocument()
  })
})
