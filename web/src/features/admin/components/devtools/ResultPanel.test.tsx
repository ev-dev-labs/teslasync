/**
 * ResultPanel contract tests.
 *
 * ResultPanel is the single export of this module — a presentational panel that
 * renders one of three mutually-exclusive states (error / data / idle) for the
 * devtools "run an endpoint" flows. These tests drive every branch a caller can
 * reach plus the null-safety / crash-hardening edges:
 *
 *   - idle: default fallback + custom idleMessage, no copy affordance.
 *   - data: pretty-printed JSON, copy affordance, clipboard write.
 *   - error: role="alert" surface, no copy affordance.
 *   - falsy-but-present data (0 / false / ''): treated as data, not idle.
 *   - circular-reference / unserialisable data: never throws.
 *   - error + data together: error wins, copy affordance suppressed.
 *   - background colour cues per state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

import { ResultPanel } from './ResultPanel'

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

describe('ResultPanel', () => {
  it('renders the idle fallback and no copy button when there is neither data nor error', () => {
    const { container } = render(<ResultPanel title="Ping" />)

    expect(screen.getByText('Ping')).toBeInTheDocument()
    expect(screen.getByText('No result yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // idle background cue
    expect(container.firstChild).toHaveClass('bg-white/[0.02]')
  })

  it('prefers a caller-supplied idleMessage over the default', () => {
    render(<ResultPanel title="Ping" idleMessage="Run a request to see output" />)

    expect(screen.getByText('Run a request to see output')).toBeInTheDocument()
    expect(screen.queryByText('No result yet')).not.toBeInTheDocument()
  })

  it('pretty-prints object data as JSON and shows a copy button (success cue)', () => {
    const { container } = render(
      <ResultPanel title="Vehicle" data={{ id: 7, name: 'Model 3' }} />,
    )

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    // 2-space indentation proves the JSON.stringify(_, null, 2) formatting path
    expect(pre?.textContent).toContain('"id": 7')
    expect(pre?.textContent).toContain('"name": "Model 3"')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('bg-neon-green/5')
  })

  it('copies the exact stringified payload to the clipboard on click', async () => {
    const data = { hello: 'world' }
    render(<ResultPanel title="Copy me" data={data} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('renders an error as an assertive alert with no copy button (failure cue)', () => {
    const { container } = render(
      <ResultPanel title="Broken" error="Upstream 500: boom" />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Upstream 500: boom')
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.firstChild).toHaveClass('bg-neon-red/5')
  })

  it('treats falsy-but-present data (0 / false) as data, not idle', () => {
    const zero = render(<ResultPanel title="Zero" data={0} />)
    expect(zero.container.querySelector('pre')?.textContent).toBe('0')
    expect(screen.queryByText('No result yet')).not.toBeInTheDocument()
    zero.unmount()

    render(<ResultPanel title="False" data={false} />)
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('does not crash on circular / unserialisable data and still shows the panel', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    // Would throw "Converting circular structure to JSON" without safeStringify.
    expect(() =>
      render(<ResultPanel title="Circular" data={circular} />),
    ).not.toThrow()

    expect(screen.getByText('Circular')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByText('[object Object]')).toBeInTheDocument()
  })

  it('shows the error and suppresses the copy button when both data and error are supplied', () => {
    const { container } = render(
      <ResultPanel title="Both" data={{ a: 1 }} error="something failed" />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('something failed')
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('treats an empty-string error as no error', () => {
    const { container } = render(<ResultPanel title="Empty" data={{ ok: true }} error="" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(container.querySelector('pre')?.textContent).toContain('"ok": true')
    expect(container.firstChild).toHaveClass('bg-neon-green/5')
  })
})
