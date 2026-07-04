/**
 * HashCalculatorTool contract tests.
 *
 * Covers the tool's single export end-to-end with behavioural, multi-facet
 * assertions (never a smoke render):
 *
 *   - structure/a11y: the ToolCard heading, a *label-associated* textarea
 *     (getByLabelText, not a loose <span>), and a compute button that is
 *     disabled while there is nothing to hash;
 *   - the happy path: a real Web Crypto SHA-256 digest of a FIPS-180-2 test
 *     vector ("abc") is rendered and offered for copy inside a live region;
 *   - the stale-result guard: editing the input retracts the now-mismatched
 *     digest so a hash never contradicts the box above it;
 *   - the secure-context branch: when `crypto.subtle` is undefined (plain-HTTP
 *     LAN access) a precise error is shown as an alert and NO copyable hash;
 *   - the failure branch: when `digest()` rejects, a generic error replaces the
 *     prior hash and the button recovers from its loading state (finally).
 *
 * Web Crypto is real in the jsdom/Node test env, so the happy path asserts an
 * exact known digest; the two failure branches stub the `crypto` global (and
 * restore it via `vi.unstubAllGlobals()`), never touching the real network.
 * `react-i18next` is mocked so `t(key, fallback)` returns the fallback and
 * `t(key)` returns the key verbatim — deterministic, translation-file-free.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'

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
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { HashCalculatorTool } from './HashCalculator'

// SHA-256("abc") — FIPS-180-2 Appendix B.1 known-answer test vector.
const SHA256_ABC =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const INPUT_LABEL = 'Text to hash'
const COMPUTE_NAME = /compute sha256/i

function getTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText(INPUT_LABEL) as HTMLTextAreaElement
}
function getComputeButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: COMPUTE_NAME }) as HTMLButtonElement
}

afterEach(() => {
  // Restore the real `crypto` global stubbed by the failure-branch tests.
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HashCalculatorTool', () => {
  it('renders the card, a label-associated input, and a compute button disabled while empty', () => {
    render(<HashCalculatorTool />)

    expect(
      screen.getByRole('heading', { name: 'Hash Calculator' }),
    ).toBeInTheDocument()

    // The label is programmatically tied to the textarea (a11y), so a
    // screen reader can name it — a loose <span> would not be found here.
    const ta = getTextarea()
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveAttribute('placeholder', 'Enter text to hash...')

    // Nothing to hash yet → the action is disabled and neither a result nor
    // an error region is mounted.
    expect(getComputeButton()).toBeDisabled()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('enables the compute button once text is entered and disables it again when cleared', () => {
    render(<HashCalculatorTool />)

    expect(getComputeButton()).toBeDisabled()

    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    expect(getComputeButton()).toBeEnabled()

    fireEvent.change(getTextarea(), { target: { value: '' } })
    expect(getComputeButton()).toBeDisabled()
  })

  it('computes the SHA-256 digest and offers it for copy inside a live region', async () => {
    render(<HashCalculatorTool />)

    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    fireEvent.click(getComputeButton())

    // Real Web Crypto resolves to the exact FIPS test vector.
    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument()

    const region = screen.getByRole('status')
    expect(region).toHaveTextContent(SHA256_ABC)
    // A copy affordance is presented for the successful result.
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    // A success is never also an error.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retracts a stale hash as soon as the input is edited', async () => {
    render(<HashCalculatorTool />)

    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    fireEvent.click(getComputeButton())
    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument()

    // Editing the source must remove the now-mismatched digest immediately.
    fireEvent.change(getTextarea(), { target: { value: 'abcd' } })

    expect(screen.queryByText(SHA256_ABC)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('shows a secure-context alert and no copyable result when SubtleCrypto is unavailable', async () => {
    // Emulate plain-HTTP LAN access where `crypto.subtle` is undefined.
    vi.stubGlobal('crypto', { subtle: undefined })

    render(<HashCalculatorTool />)
    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    fireEvent.click(getComputeButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/secure context/i)

    // A failure must not be dressed up as a copyable hash.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('surfaces a generic error, clears the prior hash, and recovers when digest() rejects', async () => {
    render(<HashCalculatorTool />)

    // First produce a real, successful digest.
    fireEvent.change(getTextarea(), { target: { value: 'abc' } })
    fireEvent.click(getComputeButton())
    expect(await screen.findByText(SHA256_ABC)).toBeInTheDocument()

    // Now make the NEXT digest reject without touching the input, so the
    // catch branch — not the onChange reset — is what clears the stale hash.
    const digest = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('crypto', { subtle: { digest } })

    fireEvent.click(getComputeButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not compute hash/i)
    expect(digest).toHaveBeenCalledTimes(1)
    // Realm-safe: assert the encoded payload's bytes rather than instanceof
    // (jsdom's Uint8Array differs from the test module's global constructor).
    const [algo, payload] = digest.mock.calls[0] as [string, ArrayLike<number>]
    expect(algo).toBe('SHA-256')
    expect(Array.from(payload)).toEqual([97, 98, 99]) // UTF-8 bytes of "abc"
    expect(screen.queryByText(SHA256_ABC)).toBeNull()
    // `finally` cleared the loading flag, so the button is operable again.
    expect(getComputeButton()).toBeEnabled()
  })
})
