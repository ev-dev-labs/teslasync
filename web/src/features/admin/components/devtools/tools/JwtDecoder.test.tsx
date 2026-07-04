/**
 * JwtDecoder contract tests.
 *
 * This module has two runtime exports:
 *
 *   - `decodeJwt(token)` — a pure, framework-free parser. There is no network,
 *     so every branch is driven purely by the token string. These tests exercise
 *     the full surface plus the base64url / UTF-8 hardening that the old inline
 *     `atob(...)` implementation got wrong.
 *
 *   - `JwtDecoderTool` — the React tool card that wires the parser to a labelled
 *     textarea and two `ResultPanel`s (header + payload) with an error alert.
 *
 * Key regression under test: JWT segments are **base64url** (`+`→`-`, `/`→`_`,
 * `=` padding stripped). The browser's `atob` only speaks standard base64, so
 * the previous code threw "Invalid character" — surfaced as a bogus "Invalid
 * JWT" — for any real token whose header/payload contained a `-` or `_`. It also
 * mangled multibyte UTF-8 claims. The fixtures below reproduce exactly that.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

import { decodeJwt, JwtDecoderTool } from './JwtDecoder'

/* ── Fixtures (all verified out-of-band) ──────────────────────────────────── */

// Standard jwt.io token. Its header/payload happen to be padding-safe standard
// base64, so it decoded even before the fix — the "still works" baseline.
const STD_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

// Payload segment contains a '-' (base64url for '+') AND a multibyte UTF-8 claim
// (name = "José 😀"). `atob` on this payload throws "Invalid character".
const URLSAFE_PAYLOAD_SEG = 'eyJuYW1lIjoiSm9zw6kg8J-YgCIsInN1YiI6IjEyMyJ9'
const URLSAFE_UTF8_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.' + URLSAFE_PAYLOAD_SEG + '.sig'

// Payload segment contains a '_' (base64url for '/') AND is missing '=' padding
// (length % 4 === 2). Header valid; empty trailing signature (alg:none style).
const UNDERSCORE_UNPADDED_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.eyJxIjoiPz8_Iiwic2NvcGUiOiJhL2IifQ.'

/* ═══════════════════════════════════════════════════════════════════════════
   decodeJwt — pure parser
   ═══════════════════════════════════════════════════════════════════════════ */

describe('decodeJwt', () => {
  it('decodes a standard JWT into header and payload objects with no error', () => {
    const result = decodeJwt(STD_JWT)

    expect(result.error).toBeUndefined()
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(result.payload).toEqual({
      sub: '1234567890',
      name: 'John Doe',
      iat: 1516239022,
    })
  })

  it('decodes a URL-safe (base64url "-") payload that raw atob rejects — regression', () => {
    // Prove the bug is real: the raw segment is not valid *standard* base64.
    expect(() => atob(URLSAFE_PAYLOAD_SEG)).toThrow()

    const result = decodeJwt(URLSAFE_UTF8_JWT)

    expect(result.error).toBeUndefined()
    // Multibyte UTF-8 claim must round-trip exactly, not as mojibake.
    expect(result.payload).toEqual({ name: 'José 😀', sub: '123' })
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('decodes a URL-safe (base64url "_") payload that is also missing "=" padding', () => {
    const result = decodeJwt(UNDERSCORE_UNPADDED_JWT)

    expect(result.error).toBeUndefined()
    expect(result.payload).toEqual({ q: '???', scope: 'a/b' })
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('treats empty / whitespace-only input as the neutral idle state (no error)', () => {
    expect(decodeJwt('')).toEqual({ header: null, payload: null })
    expect(decodeJwt('   \n\t ')).toEqual({ header: null, payload: null })
  })

  it('flags a token with fewer than two segments as invalid', () => {
    const result = decodeJwt('not-a-jwt')

    expect(result.error).toBe('invalid')
    expect(result.header).toBeNull()
    expect(result.payload).toBeNull()
  })

  it('flags a token with an empty header or payload segment as invalid', () => {
    expect(decodeJwt('.eyJhIjoxfQ.sig').error).toBe('invalid')
    expect(decodeJwt('eyJhbGciOiJIUzI1NiJ9..sig').error).toBe('invalid')
  })

  it('flags a token whose segments are not valid base64-encoded JSON as invalid', () => {
    // 'abc'/'def' decode to bytes that are not parseable JSON.
    const result = decodeJwt('abc.def.ghi')

    expect(result.error).toBe('invalid')
    expect(result.payload).toBeNull()
  })

  it('trims surrounding whitespace before parsing', () => {
    const result = decodeJwt(`  ${STD_JWT}  `)

    expect(result.error).toBeUndefined()
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   JwtDecoderTool — component
   ═══════════════════════════════════════════════════════════════════════════ */

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  })
})

function typeJwt(value: string) {
  fireEvent.change(screen.getByLabelText('Jwt Input'), { target: { value } })
}

function allPreText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('pre'))
    .map((pre) => pre.textContent ?? '')
    .join('\n')
}

describe('JwtDecoderTool', () => {
  it('renders the tool shell with an accessible, labelled input and no result panels initially', () => {
    const { container } = render(<JwtDecoderTool />)

    expect(screen.getByText('Jwt Decoder')).toBeInTheDocument()
    expect(screen.getByText('Jwt Decoder Desc')).toBeInTheDocument()

    // The textarea is programmatically labelled (WCAG 3.3.2), so it is
    // reachable by its accessible name rather than a detached <span>.
    expect(screen.getByLabelText('Jwt Input')).toBeInTheDocument()

    // Idle: neither panel, nor an error alert, nor any JSON output.
    expect(screen.queryByText('Jwt Header')).not.toBeInTheDocument()
    expect(screen.queryByText('Jwt Payload')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(container.querySelectorAll('pre')).toHaveLength(0)
  })

  it('decodes a valid JWT and renders both the header and payload panels', () => {
    const { container } = render(<JwtDecoderTool />)

    typeJwt(STD_JWT)

    expect(screen.getByText('Jwt Header')).toBeInTheDocument()
    expect(screen.getByText('Jwt Payload')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const pre = allPreText(container)
    expect(pre).toContain('"alg": "HS256"')
    expect(pre).toContain('"name": "John Doe"')
    expect(pre).toContain('"sub": "1234567890"')
  })

  it('renders (not errors on) a URL-safe token with multibyte claims — end-to-end regression', () => {
    const { container } = render(<JwtDecoderTool />)

    typeJwt(URLSAFE_UTF8_JWT)

    // The pre-fix build would have shown the "Invalid Jwt" alert here.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Jwt Payload')).toBeInTheDocument()

    const pre = allPreText(container)
    expect(pre).toContain('"name": "José 😀"')
    expect(pre).toContain('"sub": "123"')
  })

  it('shows an assertive error alert and no panels for a malformed token', () => {
    const { container } = render(<JwtDecoderTool />)

    typeJwt('this-is-not-a-jwt')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Invalid Jwt')
    expect(screen.queryByText('Jwt Header')).not.toBeInTheDocument()
    expect(container.querySelectorAll('pre')).toHaveLength(0)
  })

  it('clears panels and the error when the input is emptied again (state transitions)', () => {
    const { container } = render(<JwtDecoderTool />)

    // valid → panels
    typeJwt(STD_JWT)
    expect(screen.getByText('Jwt Payload')).toBeInTheDocument()

    // invalid → alert, panels gone
    typeJwt('broken')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Jwt Payload')).not.toBeInTheDocument()

    // empty → back to idle: no alert, no panels, no output
    typeJwt('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Jwt Header')).not.toBeInTheDocument()
    expect(allPreText(container)).toBe('')
  })

  it('reflects typed input in the textarea value', () => {
    render(<JwtDecoderTool />)

    const input = screen.getByLabelText('Jwt Input') as HTMLTextAreaElement
    typeJwt(STD_JWT)

    expect(input.value).toBe(STD_JWT)
  })
})
