// Behaviour + hardening coverage for the shared AI feature scaffold
// (AIFeatureCard) and its co-exported AIBadge pill.
//
// AIFeatureCard is the primitive 38 per-feature AI cards render
// through, so its contract is load-bearing. This suite exercises every
// facet of both exports rather than a smoke render:
//
//   - AIBadge: default "Helix" label + brand tooltip + accessible
//     name + aria-hidden icon; custom label override.
//   - Header content: title heading, description, badge, custom badge.
//   - Empty-hint branch: shown only when !canStart AND a hint exists.
//   - Action button: universal "Ask Helix" CTA, per-feature aria-label
//     + tooltip, buttonTitle override, buttonTestId, the computed
//     disabled/aria-disabled/aria-busy state machine, and the
//     streaming "Helix is thinking…" label.
//   - Interactions: click routes to stream.start() or onAction, and
//     the disabled/streaming states swallow the click (no double
//     submit).
//   - Placement + slots: inputSlot coerces the button below (even from
//     an explicit inline placement), children slot in between the
//     button and the output panel, inline vs below button nesting.
//   - AiOutputPanel wiring: hidden when idle+empty, renders text on
//     done, surfaces an error, and shows the thinking indicator while
//     streaming with no text yet.
//
// Conventions mirror AICostForecastNarration.test.tsx: react-i18next is
// NOT mounted, so t(key, default) returns the English default (2nd
// arg) — assertions match that copy. @testing-library/user-event is
// intentionally not a dependency of this repo, so interactions are
// driven with fireEvent. No network is touched: the stream handle is a
// plain stub with a vi.fn() start().

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import {
  AIBadge,
  AIFeatureCard,
  type AIFeatureStream,
} from '@/components/ai/AIFeatureCard'

// Node.DOCUMENT_POSITION_FOLLOWING — `a.compareDocumentPosition(b) &
// FOLLOWING` is truthy when b comes after a in document order. Used to
// assert relative placement of the slots without depending on the
// card's internal class names.
const FOLLOWING = 4

// makeStream builds the narrow AIFeatureStream slice the card reads.
// Defaults to an idle, empty, error-free stream with a spy start();
// tests override individual fields (state/text/error/start) as needed.
function makeStream(overrides: Partial<AIFeatureStream> = {}): AIFeatureStream {
  return {
    state: 'idle',
    text: '',
    error: null,
    start: vi.fn(),
    ...overrides,
  }
}

describe('AIBadge', () => {
  it('renders the default Helix label with the brand tooltip, accessible name, and a decorative icon', () => {
    render(<AIBadge />)

    const badge = screen.getByText('Helix')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', 'Helix')
    expect(badge).toHaveAttribute(
      'title',
      'Helix grounds responses in redacted TeslaSync data, application knowledge, and explicit tool evidence.',
    )
    // The mark is purely decorative — the pill text carries the meaning.
    const icon = badge.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('honours a custom label override while keeping the Helix accessible name', () => {
    render(<AIBadge label="Beta" />)

    const badge = screen.getByText('Beta')
    expect(badge).toBeInTheDocument()
    // The visible label changed but the pill still means "Helix".
    expect(badge).toHaveAttribute('aria-label', 'Helix')
    expect(screen.queryByText('Helix')).not.toBeInTheDocument()
  })
})

describe('AIFeatureCard — header content', () => {
  it('renders the title as a level-3 heading, the description, and the Helix badge', () => {
    render(
      <AIFeatureCard
        title="Battery Health"
        description="Explain the deterministic battery-health forecast."
        buttonLabel="Summarize"
        canStart
        stream={makeStream()}
      />,
    )

    expect(
      screen.getByRole('heading', { level: 3, name: 'Battery Health' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Explain the deterministic battery-health forecast.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
  })

  it('applies a custom badge label inside the card header', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        badgeLabel="Beta"
        canStart
        stream={makeStream()}
      />,
    )

    expect(screen.getByText('Beta')).toBeInTheDocument()
  })
})

describe('AIFeatureCard — evidence wiring', () => {
  it('passes shared stream activity into the Helix evidence trail', () => {
    render(
      <AIFeatureCard
        title="Battery Health"
        description="Explain the forecast."
        buttonLabel="Explain"
        canStart
        stream={makeStream({
          state: 'done',
          text: 'Battery is stable.',
          activity: [
            { id: 'one', name: 'query_battery_status', status: 'succeeded' },
          ],
          usage: { in: 18, out: 6 },
        })}
      />,
    )

    expect(screen.getByTestId('helix-evidence-trail')).toHaveTextContent(
      'Battery status',
    )
    expect(screen.getByTestId('helix-evidence-trail')).toHaveTextContent(
      '24 tokens',
    )
  })
})

describe('AIFeatureCard — empty hint', () => {
  it('shows the empty hint when canStart is false and a hint is supplied', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart={false}
        emptyHint="Select a feedback row first."
        stream={makeStream()}
      />,
    )

    expect(screen.getByText('Select a feedback row first.')).toBeInTheDocument()
  })

  it('hides the empty hint once canStart flips to true', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        emptyHint="Select a feedback row first."
        stream={makeStream()}
      />,
    )

    expect(
      screen.queryByText('Select a feedback row first.'),
    ).not.toBeInTheDocument()
  })
})

describe('AIFeatureCard — action button (idle)', () => {
  it('renders the universal Ask Helix CTA with a per-feature accessible name and tooltip', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream()}
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Ask Helix')
    // Visible label is brand-consistent; the per-feature verb rides in
    // the accessible name and the tooltip.
    expect(button).toHaveAttribute('aria-label', 'Ask Helix · Summarize')
    expect(button).toHaveAttribute('title', 'Summarize')
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // Idle: no busy state announced.
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('lets buttonTitle override the tooltip while keeping the aria-label verb', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        buttonTitle="Generate a plain-language summary"
        canStart
        stream={makeStream()}
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Generate a plain-language summary')
    expect(button).toHaveAttribute('aria-label', 'Ask Helix · Summarize')
  })

  it('exposes the action button through buttonTestId when supplied', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        buttonTestId="summarize-btn"
        canStart
        stream={makeStream()}
      />,
    )

    expect(screen.getByTestId('summarize-btn')).toBe(screen.getByRole('button'))
  })
})

describe('AIFeatureCard — disabled + streaming state machine', () => {
  it('disables the button and mirrors aria-disabled when canStart is false', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart={false}
        stream={makeStream()}
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('shows the thinking label, disables, and announces aria-busy while streaming', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'streaming' })}
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Helix is thinking…')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe('AIFeatureCard — interactions', () => {
  it('calls stream.start() on click when no onAction override is supplied', () => {
    const start = vi.fn()
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ start })}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('calls onAction instead of stream.start() when an override is supplied', () => {
    const start = vi.fn()
    const onAction = vi.fn()
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Detect conflicts"
        canStart
        onAction={onAction}
        stream={makeStream({ start })}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('swallows the click while disabled (canStart false) so no stream fires', () => {
    const start = vi.fn()
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart={false}
        stream={makeStream({ start })}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(start).not.toHaveBeenCalled()
  })

  it('swallows the click while streaming (double-submit guard via disabled)', () => {
    const start = vi.fn()
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'streaming', start })}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(start).not.toHaveBeenCalled()
  })
})

describe('AIFeatureCard — placement + slots', () => {
  it('coerces the button below and after the inputSlot even when placement is inline', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Search"
        canStart
        buttonPlacement="inline"
        inputSlot={<div data-testid="prompt-slot">prompt</div>}
        stream={makeStream()}
      />,
    )

    const slot = screen.getByTestId('prompt-slot')
    const button = screen.getByRole('button')
    expect(slot).toBeInTheDocument()
    // inputSlot implies button-below: the button must follow the input.
    expect(slot.compareDocumentPosition(button) & FOLLOWING).toBeTruthy()
  })

  it('renders children between the action button and the output panel', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Detect conflicts"
        canStart
        buttonPlacement="below"
        stream={makeStream({ state: 'done', text: 'No conflicts detected.' })}
      >
        <div data-testid="conflicts">conflict list</div>
      </AIFeatureCard>,
    )

    const button = screen.getByRole('button')
    const children = screen.getByTestId('conflicts')
    const panel = screen.getByTestId('ai-output-panel')
    expect(button.compareDocumentPosition(children) & FOLLOWING).toBeTruthy()
    expect(children.compareDocumentPosition(panel) & FOLLOWING).toBeTruthy()
  })

  it('nests the button in the header row when placement is inline (default)', () => {
    render(
      <AIFeatureCard
        title="Head"
        description="D"
        buttonLabel="Go"
        canStart
        stream={makeStream()}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Head' })
    const button = screen.getByRole('button')
    // Inline: the button shares the header flex row that also wraps the
    // title/description block.
    expect(button.parentElement).toContainElement(heading)
  })

  it('lifts the button into its own row when placement is below', () => {
    render(
      <AIFeatureCard
        title="Head"
        description="D"
        buttonLabel="Go"
        canStart
        buttonPlacement="below"
        stream={makeStream()}
      />,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Head' })
    const button = screen.getByRole('button')
    // Below: the button's row is a separate container from the header.
    expect(button.parentElement).not.toContainElement(heading)
    expect(heading).toBeInTheDocument()
  })
})

describe('AIFeatureCard — output panel wiring', () => {
  it('renders no output panel while idle with no accumulated text', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'idle', text: '' })}
      />,
    )

    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })

  it('renders the accumulated stream text in the output panel when done', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'done', text: 'The battery is healthy.' })}
      />,
    )

    const panel = screen.getByTestId('ai-output-panel')
    expect(panel).toHaveTextContent('The battery is healthy.')
  })

  it('surfaces a stream error inside the output panel', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'error', error: 'stream_http_404' })}
      />,
    )

    const panel = screen.getByTestId('ai-output-panel')
    expect(panel).toHaveTextContent('Helix error:')
    expect(panel).toHaveTextContent('stream_http_404')
  })

  it('shows the thinking indicator while streaming before any text arrives', () => {
    render(
      <AIFeatureCard
        title="T"
        description="D"
        buttonLabel="Summarize"
        canStart
        stream={makeStream({ state: 'streaming', text: '' })}
      />,
    )

    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
  })
})
