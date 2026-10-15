/**
 * StatusApiEndpointCard — single documented-endpoint card contract.
 *
 * Exercises the card's full surface rather than a smoke render:
 *   - the method badge, monospace path, and prose description,
 *   - the icon-only copy affordance (writes the path to the clipboard and
 *     exposes an aria-label instead of visible text),
 *   - the optional `query` and `icon` branches (present vs. absent),
 *   - the collapsible example: default-collapsed state, click-to-reveal
 *     pretty-printed JSON, the empty-example placeholder (never a bare "{}"),
 *     and the hardening guard that keeps an unserializable (circular) example
 *     from throwing during render and crashing the whole reference grid.
 *
 * Conventions mirror the sibling suites (CommandSelectDialog.test.tsx,
 * GDPRArtifactDetails.test.tsx): react-i18next is stubbed to echo the inline
 * English fallback so accessible names stay stable, the clipboard is mocked
 * (jsdom ships none), and the original interactions use `fireEvent`.
 * Additive keyboard coverage uses the installed user-event runner.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { typography } from '@/lib/tokens'

import {
  StatusApiEndpointCard,
  type StatusApiEndpointCardProps,
} from './StatusApiEndpointCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
            options?.[name] == null ? placeholder : String(options[name]),
          )
        : key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}))

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  // jsdom has no real clipboard; the shared CopyButton reaches for it.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

function makeProps(
  overrides: Partial<StatusApiEndpointCardProps> = {},
): StatusApiEndpointCardProps {
  return {
    method: 'GET',
    path: '/api/v1/status',
    description: 'Overall health snapshot in a single round-trip.',
    example: { status: 'operational', counts: { total: 8, healthy: 8 } },
    ...overrides,
  }
}

function renderCard(overrides: Partial<StatusApiEndpointCardProps> = {}) {
  return render(<StatusApiEndpointCard {...makeProps(overrides)} />)
}

// The example accordion is collapsed by default; open it so the JSON /
// placeholder body is mounted. Asserting the aria-expanded flip proves the
// disclosure wiring; the additive user-event case covers keyboard activation.
async function openExample() {
  const toggle = screen.getByRole('button', { name: /Example response/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
}

describe('StatusApiEndpointCard', () => {
  it('renders the HTTP method badge, the monospace path, and the description', () => {
    renderCard()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('/api/v1/status')).toBeInTheDocument()
    expect(
      screen.getByText('Overall health snapshot in a single round-trip.'),
    ).toBeInTheDocument()
  })

  it('copies the endpoint path to the clipboard via the icon-only copy control', async () => {
    renderCard({ path: '/api/v1/status/components' })

    const copy = screen.getByRole('button', { name: /Copy endpoint path/ })
    // Icon-only: the accessible name comes from aria-label, not visible text.
    expect(copy).not.toHaveTextContent('Copy endpoint path')

    fireEvent.click(copy)

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('/api/v1/status/components'),
    )
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('renders the query row only when a query string is supplied', () => {
    const { rerender } = renderCard({ query: undefined })
    expect(screen.queryByText('Query')).not.toBeInTheDocument()

    rerender(<StatusApiEndpointCard {...makeProps({ query: 'window=24h' })} />)
    expect(screen.getByText('Query')).toBeInTheDocument()
    expect(screen.getByText('?window=24h')).toBeInTheDocument()
  })

  it('wraps a supplied icon in a decorative (aria-hidden) container', () => {
    const { container } = renderCard({
      icon: <span data-testid="ep-icon">★</span>,
    })
    const icon = screen.getByTestId('ep-icon')
    expect(icon).toBeInTheDocument()
    // The glyph is purely visual, so it must be hidden from assistive tech.
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('omits the icon wrapper entirely when no icon is provided', () => {
    const { container } = renderCard({ icon: undefined })
    // The endpoint glyph is the only aria-hidden <span> the card ever emits.
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull()
    expect(screen.queryByTestId('ep-icon')).toBeNull()
  })

  it('keeps the example response collapsed until the user opens it', () => {
    const { container } = renderCard()
    expect(container.querySelector('pre')).toBeNull()
    expect(
      screen.getByRole('button', { name: /Example response/ }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals the pretty-printed JSON example when the accordion is opened', async () => {
    const { container } = renderCard({
      example: { status: 'operational', version: '1.4.2' },
    })

    await openExample()

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    // Indented, real field/value pairs — not the collapsed source object.
    expect(pre?.textContent).toContain('"status": "operational"')
    expect(pre?.textContent).toContain('"version": "1.4.2"')
  })

  it('renders an empty-state placeholder (never a bare "{}") for an empty example', async () => {
    const { container } = renderCard({ example: {} })

    await openExample()

    expect(
      await screen.findByText('No example response available.'),
    ).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('does not throw on an unserializable (circular) example and shows the fallback', async () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular // JSON.stringify(circular) would throw

    // Rendering must succeed even though serialization cannot.
    const { container } = renderCard({ example: circular })

    await openExample()

    expect(
      await screen.findByText('Example response is unavailable.'),
    ).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })

  it('tolerates a missing example by falling back to the empty placeholder', async () => {
    // `example` is typed as required, but a runtime caller can still pass
    // undefined; the `?? {}` guard must degrade to the empty state.
    renderCard({ example: undefined as unknown as object })

    await openExample()

    expect(
      await screen.findByText('No example response available.'),
    ).toBeInTheDocument()
  })
})

describe('StatusApiEndpointCard — theme ink and logical alignment', () => {
  it('uses neutral theme-aware secondary ink for the endpoint path and decorative icon', () => {
    renderCard({
      icon: <span data-testid="endpoint-glyph">★</span>,
    })

    const path = screen.getByText('/api/v1/status')
    const icon = screen.getByTestId('endpoint-glyph').parentElement
    expect(path.tagName).toBe('CODE')
    expect(path).toHaveClass(typography.family.mono, typography.color.secondary)
    expect(icon).toHaveClass(typography.color.secondary)
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(path).not.toHaveClass('text-cyan-300')
    expect(icon).not.toHaveClass('text-cyan-300')
  })

  it.each(['ltr', 'rtl'] as const)(
    'keeps logical copy spacing and wrapping hooks with complete long content in %s',
    async direction => {
      const path = `/api/v1/status/${'component-identifier-'.repeat(12)}`
      const query = `component=${'identifier-'.repeat(12)}&window=24h`
      const description = 'تفاصيل نقطة النهاية الطويلة '.repeat(15)
      const { container } = render(
        <div dir={direction}>
          <StatusApiEndpointCard {...makeProps({ path, query, description })} />
        </div>,
      )

      const code = screen.getByText(path)
      const copy = screen.getByRole('button', { name: `Copy endpoint path ${path}` })
      expect(code).toHaveClass('min-w-0', 'break-all')
      expect(code.parentElement).toHaveClass('flex', 'flex-wrap')
      expect(copy).toHaveClass('ms-auto', 'shrink-0')
      expect(copy).not.toHaveClass('ml-auto')
      expect(copy).toHaveAttribute('type', 'button')
      expect(screen.getByText(`?${query}`)).toHaveClass('break-all')
      expect(screen.getByText(`?${query}`).parentElement).toHaveClass('flex-wrap')
      expect(screen.getByText(description.trim())).toHaveTextContent(description.trim())
      expect(screen.getByText('GET')).toBeInTheDocument()
      expect(container.querySelector('[data-print-card]')).toHaveClass('h-full', 'flex-col')

      fireEvent.click(copy)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(path))
      expect(copy).toHaveAccessibleName(`Copy endpoint path ${path}`)
      expect(await screen.findByText('Copied')).toHaveAttribute('aria-live', 'polite')
    },
  )

  it('preserves keyboard copy, disclosure focus and every serialized response field', async () => {
    const user = userEvent.setup({ writeToClipboard: false })
    const clipboardWrite = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    })
    const example = {
      status: 'operational',
      resources: { uptime_seconds: 0, goroutines: 999999 },
      healthy: false,
      absent: null,
      signed: -2,
      components: [{ name: 'mqtt', state: 'unknown' }],
      incidents: [],
    }
    const { container } = renderCard({ example })
    const copy = screen.getByRole('button', { name: 'Copy endpoint path /api/v1/status' })
    const toggle = screen.getByRole('button', { name: 'Example response' })

    await user.tab()
    expect(copy).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('/api/v1/status'))
    expect(clipboardWrite).toHaveBeenCalledTimes(1)

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const region = await screen.findByRole('region', { name: 'Example response' })
    expect(region.id).toBe(toggle.getAttribute('aria-controls'))
    expect(toggle).toHaveFocus()
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe(JSON.stringify(example, null, 2))
    expect(pre).toHaveClass('max-h-72', 'overflow-auto', typography.color.secondary)

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    await waitFor(() => expect(container.querySelector('pre')).toBeNull())
  })
})
