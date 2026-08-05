/**
 * ChatWelcome — empty-conversation hero for the Helix chatbot.
 *
 * ChatWelcome is purely presentational: the Helix brand mark, an i18n
 * headline + description, and the suggested-prompt chip strip
 * (`SuggestedPrompts`). Its single prop is `onPick(text)`, forwarded to
 * every chip; the page uses it to fill the composer (it does NOT
 * auto-submit) so the user can edit before sending.
 *
 * These tests exercise multiple facets rather than a smoke render:
 *   1. The headline renders as a level-2 heading driven by i18n.
 *   2. The description renders as a paragraph driven by i18n.
 *   3. The brand mark is a decorative (aria-hidden) graphic that never
 *      leaks to assistive tech as an unlabelled image.
 *   4. All four suggestion chips render inside a labelled list, in order.
 *   5. Every visible string is wired through i18n with an English fallback.
 *   6. Clicking a chip forwards its exact text to `onPick` exactly once.
 *   7. `onPick` is not called on render, and successive picks forward the
 *      right text in order (no auto-submit side effects).
 *   8. Chips are native, focusable buttons (keyboard operable).
 *   9. Copy is genuinely i18n-indirected, not hardcoded English.
 *
 * react-i18next is stubbed with a passthrough `t(key, fallback)` spy (the
 * same convention as the sibling QuickNav / StateTimeline tests) so the
 * component renders English defaults without the full i18n bootstrap AND
 * we can assert on the exact (key, fallback) pairs. No network is touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const { tSpy } = vi.hoisted(() => ({ tSpy: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tSpy }),
}))

import { ChatWelcome } from './ChatWelcome'

// Declared order of getChatSuggestions() — the rendered chip order is
// deterministic, so index-based assertions below are stable.
const SUGGESTIONS = [
  {
    key: 'chatbot.suggestion.readiness',
    text: 'Give me a fleet readiness briefing using battery, alerts, and recent charging.',
  },
  {
    key: 'chatbot.suggestion.attention',
    text: 'Which vehicle needs attention first, and what evidence supports it?',
  },
  {
    key: 'chatbot.suggestion.crossDomain',
    text: 'Compare recent driving efficiency and charging patterns across my vehicles.',
  },
  {
    key: 'chatbot.suggestion.knowledge',
    text: 'How do I configure alerts in TeslaSync? Cite the relevant documentation.',
  },
] as const

beforeEach(() => {
  // Passthrough: return the English fallback so the DOM shows real copy,
  // while still letting us assert on the (key, fallback) pairs.
  tSpy.mockReset()
  tSpy.mockImplementation((_key: string, fallback?: string) => fallback ?? _key)
})

describe('ChatWelcome — hero copy', () => {
  it('renders the headline as a level-2 heading wired through i18n', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    const heading = screen.getByRole('heading', { level: 2, name: 'How can Helix help you?' })
    expect(heading).toBeInTheDocument()
    expect(heading.tagName).toBe('H2')
    expect(tSpy).toHaveBeenCalledWith('chatbot.howCanIHelp', 'How can Helix help you?')
  })

  it('renders the supporting description as a paragraph wired through i18n', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    const desc = screen.getByText(
      'Investigate live fleet evidence, compare domains, or ask for cited TeslaSync guidance',
    )
    expect(desc).toBeInTheDocument()
    expect(desc.tagName).toBe('P')
    expect(tSpy).toHaveBeenCalledWith(
      'chatbot.askAbout',
      'Investigate live fleet evidence, compare domains, or ask for cited TeslaSync guidance',
    )
  })
})

describe('ChatWelcome — brand mark accessibility', () => {
  it('renders the Helix mark as a decorative (aria-hidden) graphic', () => {
    const { container } = render(<ChatWelcome onPick={vi.fn()} />)
    const helix = container.querySelector('svg.text-purple-300')
    expect(helix).not.toBeNull()
    expect(helix).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes no unlabelled image role to screen readers', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    // The brand glyph + chip sparkles are decorative — none surface as `img`.
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })
})

describe('ChatWelcome — suggested prompts', () => {
  it('renders exactly the four suggestion chips inside a labelled list, in order', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'Suggested prompts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(SUGGESTIONS.length)

    const buttons = within(list).getAllByRole('button')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(SUGGESTIONS.map((s) => s.text))
  })

  it('wires every string (chips + list label) through i18n with an English fallback', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    for (const s of SUGGESTIONS) {
      expect(tSpy).toHaveBeenCalledWith(s.key, s.text)
    }
    expect(tSpy).toHaveBeenCalledWith('chatbot.aria.suggestions', 'Suggested prompts')
  })
})

describe('ChatWelcome — onPick interaction', () => {
  it('forwards the exact chip text to onPick exactly once when clicked', () => {
    const onPick = vi.fn()
    render(<ChatWelcome onPick={onPick} />)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Which vehicle needs attention first, and what evidence supports it?',
      }),
    )
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(
      'Which vehicle needs attention first, and what evidence supports it?',
    )
  })

  it('does not call onPick on render and forwards successive picks in order', () => {
    const onPick = vi.fn()
    render(<ChatWelcome onPick={onPick} />)
    expect(onPick).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Give me a fleet readiness briefing using battery, alerts, and recent charging.',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'How do I configure alerts in TeslaSync? Cite the relevant documentation.',
      }),
    )

    expect(onPick).toHaveBeenCalledTimes(2)
    expect(onPick).toHaveBeenNthCalledWith(
      1,
      'Give me a fleet readiness briefing using battery, alerts, and recent charging.',
    )
    expect(onPick).toHaveBeenNthCalledWith(
      2,
      'How do I configure alerts in TeslaSync? Cite the relevant documentation.',
    )
  })

  it('exposes each chip as a native, focusable button (keyboard operable)', () => {
    render(<ChatWelcome onPick={vi.fn()} />)
    const first = screen.getByRole('button', {
      name: 'Give me a fleet readiness briefing using battery, alerts, and recent charging.',
    })
    expect(first.tagName).toBe('BUTTON')
    first.focus()
    expect(first).toHaveFocus()
  })
})

describe('ChatWelcome — i18n indirection', () => {
  it('renders resolved translations rather than hardcoded English', () => {
    tSpy.mockImplementation((key: string) => {
      const de: Record<string, string> = {
        'chatbot.howCanIHelp': 'Wie kann Helix dir helfen?',
        'chatbot.suggestion.readiness': 'Wie steht es um die Einsatzbereitschaft meiner Flotte?',
      }
      return de[key] ?? key
    })
    render(<ChatWelcome onPick={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Wie kann Helix dir helfen?')
    expect(
      screen.getByRole('button', {
        name: 'Wie steht es um die Einsatzbereitschaft meiner Flotte?',
      }),
    ).toBeInTheDocument()
  })
})
