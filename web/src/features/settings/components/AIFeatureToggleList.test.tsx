/**
 * AIFeatureToggleList contract.
 *
 * The list is a controlled, presentation-only surface: it maps the AI
 * feature registry to one labelled switch per feature and delegates
 * every flip to the `onToggle` callback the host supplies. These tests
 * pin the behaviour that matters:
 *
 *   1. Generation   — one row / switch per `AI_FEATURE_IDS`, never
 *                     hand-listed; the legend + panel testid render.
 *   2. i18n         — per-feature `label`/`description` keys win when a
 *                     translation exists, else fall back to the registry
 *                     `name`/`description`.
 *   3. Value binding— each switch's `aria-checked` mirrors `values[id]`,
 *                     and a missing/undefined `values` map degrades to
 *                     "all off" instead of throwing.
 *   4. a11y         — every icon-only switch is NAMED by its label (the
 *                     regression this file guards: the name must land on
 *                     the `role="switch"` button, not the wrapper div) and
 *                     DESCRIBED by its help text via `aria-describedby`
 *                     when copy exists. The control is a real, focusable
 *                     `<button>` so Space/Enter activation comes for free.
 *   5. Interaction  — clicking a switch fires `onToggle(id, next)` with the
 *                     correct id and the flipped value, exactly once.
 *   6. Empty state  — an empty registry renders a placeholder, never a
 *                     blank panel.
 *
 * The `@/ai/features` registry is mocked with a small deterministic
 * fixture (so the unit isn't coupled to the 50+ live features and the
 * empty branch is reachable) and `react-i18next` is stubbed with a
 * configurable dictionary that otherwise returns each call site's
 * defaultValue. No network is touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { AiFeatureId } from '@/ai/features'

// Configurable i18n dictionary — empty by default so every `t(key, fb)`
// returns its string fallback (the registry name/description).
const i18nState = vi.hoisted(() => ({ dict: {} as Record<string, string> }))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  )
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (key in i18nState.dict) return i18nState.dict[key]
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Deterministic registry fixture. `digest-narration` intentionally has an
// empty description to exercise the "no help text → no aria-describedby"
// branch. The `empty` flag flips the whole registry off for the empty-state
// test. Getters are read at render time, so toggling `empty` before a render
// takes effect.
const featuresState = vi.hoisted(() => {
  const meta = (id: string, name: string, description: string) => ({
    id,
    name,
    description,
  })
  const list = [
    meta('chatbot-llm', 'LLM Chatbot', 'Conversational fleet assistant.'),
    meta('nl-search', 'Natural-language search', 'Ask questions in plain English.'),
    meta('digest-narration', 'Weekly digest narration', ''),
  ]
  const byId: Record<string, { id: string; name: string; description: string }> = {}
  for (const m of list) byId[m.id] = m
  return { ids: list.map((m) => m.id), byId, empty: false }
})

vi.mock('@/ai/features', () => ({
  get AI_FEATURE_IDS() {
    return featuresState.empty ? [] : featuresState.ids
  },
  get AI_FEATURES() {
    return featuresState.empty ? {} : featuresState.byId
  },
}))

import { AIFeatureToggleList } from './AIFeatureToggleList'

const LEGEND = 'Per-feature opt-in (all default off)'

function renderList(
  values: Partial<Record<AiFeatureId, boolean>> = {},
  onToggle: (id: AiFeatureId, value: boolean) => void = vi.fn(),
) {
  render(
    <AIFeatureToggleList
      values={values as Record<AiFeatureId, boolean>}
      onToggle={onToggle}
    />,
  )
  return { onToggle }
}

beforeEach(() => {
  i18nState.dict = {}
  featuresState.empty = false
})

describe('AIFeatureToggleList — registry generation', () => {
  it('renders the legend panel and one switch per registry id', () => {
    renderList()
    expect(screen.getByTestId('ai-feature-toggle-list')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: LEGEND }),
    ).toBeInTheDocument()
    // Three fixture features -> three rows and three switches.
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByTestId('ai-feature-row-chatbot-llm')).toBeInTheDocument()
    expect(screen.getByTestId('ai-feature-row-nl-search')).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-feature-row-digest-narration'),
    ).toBeInTheDocument()
  })
})

describe('AIFeatureToggleList — a11y naming + value binding', () => {
  it('names each switch by its label and mirrors values[id] in aria-checked', () => {
    renderList({ 'chatbot-llm': true } as Record<AiFeatureId, boolean>)

    // Regression guard: the accessible name must resolve on the
    // role="switch" button itself (via forwarded aria-label), not the
    // wrapper div — otherwise the control is anonymous to a screen reader.
    const on = screen.getByRole('switch', { name: 'LLM Chatbot' })
    expect(on).toHaveAttribute('aria-checked', 'true')

    // A feature absent from `values` is unchecked (Boolean(undefined)).
    const off = screen.getByRole('switch', { name: 'Natural-language search' })
    expect(off).toHaveAttribute('aria-checked', 'false')
  })

  it('exposes a focusable native button so keyboard activation works', () => {
    renderList()
    const sw = screen.getByRole('switch', { name: 'LLM Chatbot' })
    expect(sw.tagName).toBe('BUTTON')
    expect(sw).toHaveAttribute('type', 'button')
    sw.focus()
    expect(sw).toHaveFocus()
  })

  it('describes a switch via aria-describedby only when help text exists', () => {
    renderList()

    const described = screen.getByRole('switch', { name: 'LLM Chatbot' })
    const descId = described.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId as string)?.textContent).toContain(
      'Conversational fleet assistant',
    )

    // Empty description -> no Caption node, no dangling aria-describedby.
    const undescribed = screen.getByRole('switch', {
      name: 'Weekly digest narration',
    })
    expect(undescribed).not.toHaveAttribute('aria-describedby')
  })
})

describe('AIFeatureToggleList — i18n', () => {
  it('prefers translated copy but falls back to the registry name', () => {
    i18nState.dict = {
      'ai.settings.feature.chatbot-llm.label': 'Chat Assistant',
      'ai.settings.feature.chatbot-llm.description': 'Translated helper copy.',
    }
    renderList()

    // Translated label wins for the switch name...
    expect(
      screen.getByRole('switch', { name: 'Chat Assistant' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'LLM Chatbot' })).toBeNull()
    expect(screen.getByText('Translated helper copy.')).toBeInTheDocument()

    // ...while an untranslated feature still shows its registry name.
    expect(
      screen.getByRole('switch', { name: 'Natural-language search' }),
    ).toBeInTheDocument()
  })
})

describe('AIFeatureToggleList — interaction', () => {
  it('fires onToggle(id, true) when flipping an off switch on', () => {
    const { onToggle } = renderList()
    fireEvent.click(screen.getByRole('switch', { name: 'LLM Chatbot' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('chatbot-llm', true)
  })

  it('fires onToggle(id, false) when flipping an on switch off', () => {
    const { onToggle } = renderList({
      'nl-search': true,
    } as Record<AiFeatureId, boolean>)
    fireEvent.click(
      screen.getByRole('switch', { name: 'Natural-language search' }),
    )
    expect(onToggle).toHaveBeenCalledWith('nl-search', false)
  })
})

describe('AIFeatureToggleList — resilience', () => {
  it('renders an empty-state placeholder instead of a blank panel', () => {
    featuresState.empty = true
    renderList()

    // The panel + legend still render — only the body swaps to a placeholder.
    expect(screen.getByTestId('ai-feature-toggle-list')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: LEGEND })).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(
      screen.getByText('No AI features are available yet.'),
    ).toBeInTheDocument()
  })

  it('degrades to all-off when values is undefined instead of throwing', () => {
    render(
      <AIFeatureToggleList
        values={undefined as unknown as Record<AiFeatureId, boolean>}
        onToggle={vi.fn()}
      />,
    )
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(3)
    for (const sw of switches) {
      expect(sw).toHaveAttribute('aria-checked', 'false')
    }
  })
})
