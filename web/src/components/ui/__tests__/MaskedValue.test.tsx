/**
 * Phase-46 / Prompt 32 — `<MaskedValue>` component tests.
 *
 * Verifies the privacy contract: initial render is masked, the toggle
 * reveals/hides, the auto-hide timer fires, the audit POST is wired
 * behind the `auditOnReveal` flag, and the copy button always carries
 * the raw value (never the masked form).
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// `apiUrl` is read at module load by MaskedValue. Mock it so the
// reveal-audit POST has a deterministic, harmless target.
vi.mock('@/api/client', () => ({
  apiUrl: (path: string) => `http://localhost/api/v1${path}`,
}))

import { MaskedValue } from '../MaskedValue'

const BULLET = '\u2022'

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  vi.useFakeTimers()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  // Provide a default fetch stub. Tests that need to assert on fetch
  // installs a tracked spy via `vi.spyOn(global, 'fetch')`.
  global.fetch = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MaskedValue', () => {
  it('renders masked by default for token variant', () => {
    render(<MaskedValue value="sk_live_abcdef1234" variant="token" ariaLabel="API token" />)
    const code = screen.getByTestId('masked-value').querySelector('code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe(`${BULLET.repeat(12)}1234`)
  })

  it('reveals the raw value when the toggle is clicked', () => {
    render(<MaskedValue value="sk_live_abcdef1234" variant="token" ariaLabel="API token" />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    const code = screen.getByTestId('masked-value').querySelector('code')
    expect(code!.textContent).toBe('sk_live_abcdef1234')
    // The toggle now flips to a hide affordance.
    expect(screen.getByRole('button', { name: 'Hide value' })).toBeInTheDocument()
  })

  it('hides again after the auto-hide timer fires', () => {
    render(
      <MaskedValue
        value="sk_live_abcdef1234"
        variant="token"
        ariaLabel="API token"
        autoHideMs={1000}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    expect(screen.getByTestId('masked-value').querySelector('code')!.textContent)
      .toBe('sk_live_abcdef1234')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('masked-value').querySelector('code')!.textContent)
      .toBe(`${BULLET.repeat(12)}1234`)
    expect(screen.getByRole('button', { name: 'Reveal value' })).toBeInTheDocument()
  })

  it('manual hide cancels the pending auto-hide timer', () => {
    render(
      <MaskedValue
        value="sk_live_abcdef1234"
        variant="token"
        ariaLabel="API token"
        autoHideMs={1000}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide value' }))
    // Even after the original timer would have fired, the state stays
    // hidden — the manual hide cleared it.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByRole('button', { name: 'Reveal value' })).toBeInTheDocument()
  })

  it('does NOT POST to /audit/reveal when auditOnReveal is false (default)', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'))
    render(<MaskedValue value="hello" variant="generic" ariaLabel="value" />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs to /audit/reveal exactly once when auditOnReveal is true', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'))
    render(
      <MaskedValue
        value="hello"
        variant="generic"
        ariaLabel="value"
        auditOnReveal
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost/api/v1/audit/reveal')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ kind: 'masked_reveal', variant: 'generic' }))
  })

  it('swallows audit POST failures silently and still reveals', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'))
    render(
      <MaskedValue
        value="hello"
        variant="generic"
        ariaLabel="value"
        auditOnReveal
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    // Reveal still completed even though the audit POST rejected.
    expect(screen.getByTestId('masked-value').querySelector('code')!.textContent).toBe('hello')
  })

  it('renders an em-dash with no toggle when value is empty', () => {
    render(<MaskedValue value="" variant="generic" ariaLabel="value" />)
    expect(screen.getByLabelText('value').textContent).toBe('—')
    expect(screen.queryByRole('button', { name: 'Reveal value' })).not.toBeInTheDocument()
  })

  it('renders an em-dash for null/undefined values', () => {
    render(<MaskedValue value={null} variant="token" ariaLabel="API token" />)
    expect(screen.getByLabelText('API token').textContent).toBe('—')
  })

  it('exposes a copy button that copies the raw value while masked', async () => {
    render(
      <MaskedValue
        value="raw-secret-value"
        variant="generic"
        ariaLabel="thing"
        copyable
      />,
    )
    const copyBtn = screen.getByRole('button', { name: 'Copy value' })
    fireEvent.click(copyBtn)
    // CopyButton invokes navigator.clipboard.writeText synchronously
    // on click; the awaited promise has resolved by the next microtask.
    await act(async () => {
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('raw-secret-value')
  })

  it('forwards the ariaLabel onto the wrapper for screen readers', () => {
    render(
      <MaskedValue
        value="abc"
        variant="generic"
        ariaLabel="Refresh token, click to reveal"
      />,
    )
    expect(screen.getByLabelText('Refresh token, click to reveal')).toBeInTheDocument()
  })

  it('honours the variant when computing the masked form', () => {
    render(<MaskedValue value="alice@example.com" variant="email" ariaLabel="email" />)
    const code = screen.getByTestId('masked-value').querySelector('code')
    expect(code!.textContent).toBe(`a${BULLET.repeat(4)}@example.com`)
  })

  it('honours an explicit showLast override', () => {
    render(
      <MaskedValue
        value="abcdefgh"
        variant="generic"
        showLast={3}
        ariaLabel="value"
      />,
    )
    expect(screen.getByTestId('masked-value').querySelector('code')!.textContent)
      .toBe(`${BULLET.repeat(5)}fgh`)
  })

  it('cleans up the auto-hide timer on unmount without leaking warnings', () => {
    const { unmount } = render(
      <MaskedValue
        value="abc"
        variant="generic"
        ariaLabel="value"
        autoHideMs={5000}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    unmount()
    // Advancing past the original auto-hide timer must not crash or
    // log a "state update on unmounted component" warning.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
    }).not.toThrow()
  })
})
