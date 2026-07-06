/**
 * UrlEncoder contract tests.
 *
 * This module has two runtime exports:
 *
 *   - `transformUrl(mode, input)` — a pure, framework-free codec. There is no
 *     network, so every branch is driven purely by the (mode, input) pair. Both
 *     directions of the URI codec can throw a `URIError`; these tests pin the
 *     success paths, the empty idle path, and both failure paths (malformed
 *     percent-escapes on decode, lone UTF-16 surrogate on encode).
 *
 *   - `UrlEncoderTool` — the React tool card wiring the codec to a labelled
 *     textarea, an encode/decode toggle group, and a copyable output panel.
 *
 * Key regression under test: the old component caught the codec throw but
 * returned the *localised error message* as `output`, so a malformed decode was
 * rendered inside the styled output panel WITH a Copy button — the user could
 * "copy" the words "Invalid Input" as if they were a real result. The hardened
 * version routes failures to an assertive `role="alert"` and never shows the
 * output panel for an error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { transformUrl, UrlEncoderTool } from './UrlEncoder'

/* ═══════════════════════════════════════════════════════════════════════════
   transformUrl — pure codec
   ═══════════════════════════════════════════════════════════════════════════ */

describe('transformUrl', () => {
  it('percent-encodes reserved characters in encode mode', () => {
    expect(transformUrl('encode', 'hello world&foo=bar')).toEqual({
      output: 'hello%20world%26foo%3Dbar',
      error: false,
    })
  })

  it('decodes a percent-encoded string back to its literal form', () => {
    expect(transformUrl('decode', 'hello%20world%26foo%3Dbar')).toEqual({
      output: 'hello world&foo=bar',
      error: false,
    })
  })

  it('round-trips an arbitrary string through encode then decode', () => {
    const raw = 'a b/c?d=é 😀#frag'
    const encoded = transformUrl('encode', raw)
    expect(encoded.error).toBe(false)
    expect(transformUrl('decode', encoded.output)).toEqual({ output: raw, error: false })
  })

  it('treats empty input as the neutral idle state (no error) for both modes', () => {
    expect(transformUrl('encode', '')).toEqual({ output: '', error: false })
    expect(transformUrl('decode', '')).toEqual({ output: '', error: false })
  })

  it('flags a malformed percent-escape on decode as an error, not a bogus output', () => {
    // Prove the failure is real: the raw codec throws on these.
    expect(() => decodeURIComponent('%zz')).toThrow()
    expect(() => decodeURIComponent('%')).toThrow()

    expect(transformUrl('decode', '%zz')).toEqual({ output: '', error: true })
    expect(transformUrl('decode', '%E0%A4')).toEqual({ output: '', error: true })
  })

  it('flags a lone UTF-16 surrogate on encode as an error (encodeURIComponent throws)', () => {
    expect(() => encodeURIComponent('\uD800')).toThrow()

    expect(transformUrl('encode', '\uD800')).toEqual({ output: '', error: true })
  })

  it('encodes a string that only decode would reject (mode is respected)', () => {
    // "%zz" is a valid literal to *encode* even though it is invalid to decode.
    expect(transformUrl('encode', '%zz')).toEqual({ output: '%25zz', error: false })
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   UrlEncoderTool — component
   ═══════════════════════════════════════════════════════════════════════════ */

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

function typeInput(value: string) {
  fireEvent.change(screen.getByLabelText('Input Label'), { target: { value } })
}

function output(): HTMLElement | null {
  return document.querySelector('pre')
}

describe('UrlEncoderTool', () => {
  it('renders the tool shell with a labelled input, an encode/decode toggle group, and no output initially', () => {
    render(<UrlEncoderTool />)

    expect(screen.getByText('Url Encoder')).toBeInTheDocument()
    expect(screen.getByText('Url Encoder Desc')).toBeInTheDocument()

    // The textarea is programmatically labelled (WCAG 3.3.2), reachable by its
    // accessible name rather than a detached <span>.
    expect(screen.getByLabelText('Input Label')).toBeInTheDocument()

    // The mode buttons form a named group with a pressed-state toggle.
    const group = screen.getByRole('group', { name: 'Encoding mode' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encode' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Decode' })).toHaveAttribute('aria-pressed', 'false')

    // Idle: no output panel, no copy affordance, no error alert.
    expect(output()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('encodes live as the user types and reveals a copyable output panel', () => {
    render(<UrlEncoderTool />)

    typeInput('hello world&foo=bar')

    expect(screen.getByText('Output Label')).toBeInTheDocument()
    expect(output()).toHaveTextContent('hello%20world%26foo%3Dbar')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('copies the exact encoded output to the clipboard', async () => {
    render(<UrlEncoderTool />)

    typeInput('a b&c')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('a%20b%26c')
    })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('switches to decode mode, moves the pressed state, and decodes the input', () => {
    render(<UrlEncoderTool />)

    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))

    expect(screen.getByRole('button', { name: 'Decode' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Encode' })).toHaveAttribute('aria-pressed', 'false')

    typeInput('hello%20world%26foo%3Dbar')
    expect(output()).toHaveTextContent('hello world&foo=bar')
  })

  it('re-runs the transform when the mode flips with input already present', () => {
    render(<UrlEncoderTool />)

    // Encode mode: "%zz" is valid input → "%25zz".
    typeInput('%zz')
    expect(output()).toHaveTextContent('%25zz')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Flip to decode without retyping: the SAME "%zz" is now malformed.
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Input')
    expect(output()).toBeNull()
  })

  it('surfaces a malformed decode as an assertive alert with NO copyable output panel (regression)', () => {
    render(<UrlEncoderTool />)

    fireEvent.click(screen.getByRole('button', { name: 'Decode' }))
    typeInput('%zz')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Invalid Input')

    // The pre-fix build rendered the error string inside the output panel with a
    // Copy button. Neither must exist now.
    expect(output()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(screen.queryByText('Output Label')).not.toBeInTheDocument()
  })

  it('returns to the idle state when the input is cleared (state transition)', () => {
    render(<UrlEncoderTool />)

    typeInput('hello world')
    expect(output()).toHaveTextContent('hello%20world')

    typeInput('')
    expect(output()).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Output Label')).not.toBeInTheDocument()
  })

  it('reflects typed input in the textarea value', () => {
    render(<UrlEncoderTool />)

    const input = screen.getByLabelText('Input Label') as HTMLTextAreaElement
    typeInput('some input')

    expect(input.value).toBe('some input')
  })
})
