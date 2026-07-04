/**
 * Base64Tool behaviour + hardening contract tests.
 *
 * The tool is a pure input→output converter, so every test drives the real
 * component through its accessible surface (labelled textarea + mode toggle +
 * copy affordance) and asserts the rendered result — never an implementation
 * detail. It locks the following guarantees:
 *
 *   - encode/decode of ASCII and multi-byte UTF-8 (the € / emoji / CJK path
 *     that the legacy raw `btoa`/`atob` implementation threw on);
 *   - a genuine round-trip (encode → decode returns the original string);
 *   - malformed Base64 surfaces an assertive inline error, never a fake
 *     "success" output panel;
 *   - the empty-input state shows nothing (no blank panel);
 *   - the mode toggle exposes `aria-pressed` and swaps the placeholder example;
 *   - the copy button writes the current output to the clipboard.
 *
 * `@testing-library/user-event` is not installed in this repo (see
 * EditableText.test.tsx), so interactions go through `fireEvent`. Real i18n is
 * loaded so the assertions run against the production strings, including the
 * `devtools.utils.base64Desc` catalog value that used to read "Base64Desc".
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@/i18n'
import { Base64Tool } from './Base64Tool'

function getInput(): HTMLTextAreaElement {
  return screen.getByLabelText('Input') as HTMLTextAreaElement
}

function setInput(value: string): void {
  fireEvent.change(getInput(), { target: { value } })
}

function modeButton(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('Base64Tool', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders in encode mode with a real, associated input label and no premature output', () => {
    render(<Base64Tool />)

    // Title + description. The description is a regression guard for the
    // `devtools.utils.base64Desc` catalog placeholder that rendered literally
    // as "Base64Desc" before the elevation.
    expect(screen.getByRole('heading', { name: 'Base64' })).toBeInTheDocument()
    expect(screen.getByText('Encode and decode Base64 text')).toBeInTheDocument()
    expect(screen.queryByText('Base64Desc')).toBeNull()

    // The input is reachable by its accessible label (was an unassociated span).
    expect(getInput().tagName).toBe('TEXTAREA')

    // Encode is the pressed toggle by default.
    expect(modeButton(/^encode$/i)).toHaveAttribute('aria-pressed', 'true')
    expect(modeButton(/^decode$/i)).toHaveAttribute('aria-pressed', 'false')

    // Nothing entered yet — no output panel, no error.
    expect(screen.queryByText('Output')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('encodes ASCII text to Base64 and exposes a copy affordance', () => {
    render(<Base64Tool />)
    setInput('Hello World')

    const output = screen.getByText('SGVsbG8gV29ybGQ=')
    expect(output.tagName).toBe('PRE')
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
  })

  it('encodes multi-byte UTF-8 that legacy btoa() rejected (€ regression)', () => {
    // `btoa('€')` throws InvalidCharacterError; the UTF-8-safe path must yield
    // the correct Base64 '4oKs' instead of falling back to "Invalid input".
    render(<Base64Tool />)
    setInput('€')

    expect(screen.getByText('4oKs')).toBeInTheDocument()
    expect(screen.queryByText('Invalid input')).toBeNull()
  })

  it('decodes Base64 back to UTF-8 text after switching to decode mode', () => {
    render(<Base64Tool />)

    fireEvent.click(modeButton(/^decode$/i))
    expect(modeButton(/^decode$/i)).toHaveAttribute('aria-pressed', 'true')
    expect(modeButton(/^encode$/i)).toHaveAttribute('aria-pressed', 'false')

    setInput('4oKs')
    expect(screen.getByText('€')).toBeInTheDocument()
  })

  it('round-trips arbitrary Unicode through encode → decode', () => {
    const original = 'Café ☕ 日本語 😀'
    const { container } = render(<Base64Tool />)

    setInput(original)
    const encoded = container.querySelector('pre')?.textContent ?? ''
    expect(encoded).not.toBe('')
    expect(encoded).not.toBe('Invalid input')

    // Feed the produced Base64 back through the decoder — it must reconstruct
    // the exact original string, proving the UTF-8 byte handling is lossless.
    fireEvent.click(modeButton(/^decode$/i))
    setInput(encoded)
    expect(screen.getByText(original)).toBeInTheDocument()
  })

  it('shows an assertive inline error for malformed Base64 and hides the output panel', () => {
    render(<Base64Tool />)
    fireEvent.click(modeButton(/^decode$/i))
    setInput('!!!not-base64!!!')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Invalid input')

    // An error must NOT masquerade as a successful conversion.
    expect(screen.queryByText('Output')).toBeNull()
    expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull()
  })

  it('clears the output when the input is emptied (no lingering blank panel)', () => {
    render(<Base64Tool />)
    setInput('Hello World')
    expect(screen.getByText('SGVsbG8gV29ybGQ=')).toBeInTheDocument()

    setInput('')
    expect(screen.queryByText('SGVsbG8gV29ybGQ=')).toBeNull()
    expect(screen.queryByText('Output')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('swaps the placeholder example when toggling encode/decode', () => {
    render(<Base64Tool />)
    expect(getInput()).toHaveAttribute('placeholder', 'Hello World')

    fireEvent.click(modeButton(/^decode$/i))
    expect(getInput()).toHaveAttribute('placeholder', 'SGVsbG8gV29ybGQ=')
  })

  it('copies the current output to the clipboard on demand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<Base64Tool />)
    setInput('Hello World')

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SGVsbG8gV29ybGQ='))
    // The button reflects the copied state so assistive tech announces it.
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })
})
