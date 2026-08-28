import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/i18n'

import { GlossaryTerm } from '../GlossaryTerm'
import { resetProductPreferences, updateProductPreferences } from '@/lib/productPreferences'
import { getGlossaryTerm } from '@/lib/helpGlossary'

/**
 * HELP-03 — the inline definition affordance.
 *
 * The load-bearing behaviour is the failure mode: when contextual help is
 * switched off, or the term is unknown, the WORD must still render. A help
 * affordance that can delete the label it annotates is worse than no
 * affordance at all.
 */

describe('GlossaryTerm', () => {
  it('renders the canonical term with a <dfn> and an explanatory trigger', () => {
    resetProductPreferences()
    render(<GlossaryTerm term="soc" />)

    const dfn = document.querySelector('dfn[data-glossary-term="soc"]')
    expect(dfn).not.toBeNull()
    expect(dfn).toHaveTextContent('State of charge (SOC)')
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('resolves a term through an alias', () => {
    resetProductPreferences()
    render(<GlossaryTerm term="vampire drain" />)
    expect(document.querySelector('dfn[data-glossary-term="phantom_drain"]')).not.toBeNull()
  })

  it('renders a custom label instead of the canonical term when given children', () => {
    resetProductPreferences()
    render(<GlossaryTerm term="soc">Charge</GlossaryTerm>)
    expect(screen.getByText('Charge')).toBeInTheDocument()
  })

  it('includes the provenance sentence in the tooltip body by default', () => {
    resetProductPreferences()
    const term = getGlossaryTerm('rated_range')!
    render(<GlossaryTerm term="rated_range" />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(term.definitionFallback)
    expect(screen.getByRole('tooltip')).toHaveTextContent(term.howMeasuredFallback)
  })

  it('can omit the provenance sentence', () => {
    resetProductPreferences()
    const term = getGlossaryTerm('rated_range')!
    render(<GlossaryTerm term="rated_range" showProvenance={false} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(term.definitionFallback)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(term.howMeasuredFallback)
  })

  it('still renders the term when contextual help is switched off', () => {
    updateProductPreferences({ contextualHelp: false })
    render(<GlossaryTerm term="soc" />)

    expect(document.querySelector('dfn[data-glossary-term="soc"]')).not.toBeNull()
    // Only the affordance disappears — the definition remains reachable from
    // the always-available glossary panel on /help.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    resetProductPreferences()
  })

  it('degrades to plain text for an unknown term rather than throwing', () => {
    resetProductPreferences()
    render(<GlossaryTerm term="not-a-real-term">Widget score</GlossaryTerm>)
    expect(screen.getByText('Widget score')).toBeInTheDocument()
    expect(document.querySelector('dfn')).toBeNull()
  })

  it('falls back to the raw term string when an unknown term has no children', () => {
    resetProductPreferences()
    render(<GlossaryTerm term="not-a-real-term" />)
    expect(screen.getByText('not-a-real-term')).toBeInTheDocument()
  })
})
