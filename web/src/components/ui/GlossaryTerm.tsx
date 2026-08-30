import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/cn'
import { getGlossaryTerm, resolveGlossaryTerm, type GlossaryTerm as Term } from '@/lib/helpGlossary'
import { HelpTooltip } from './HelpTooltip'

/**
 * A defined term with its definition attached (HELP-03).
 *
 * Wraps the term in a semantic `<dfn>` and hangs the shared `<HelpTooltip>`
 * off it, so the definition is reachable by pointer, keyboard (Tab → focus)
 * and touch, and is announced via the tooltip's existing `aria-describedby`
 * wiring rather than a bespoke pattern.
 *
 * Two deliberate behaviours:
 *
 *  - **The term always renders.** `<HelpTooltip>` self-gates on the user's
 *    "contextual help" preference and returns null when it is off. If the
 *    label depended on the tooltip, turning help off would delete the word
 *    from the page. It does not — only the affordance disappears, and the
 *    same definition remains available in the Help page glossary, which is
 *    the deterministic baseline.
 *  - **Unknown terms degrade to plain text.** A typo in `term` renders the
 *    children unchanged rather than throwing or showing an empty tooltip.
 */
export interface GlossaryTermProps {
  /** Glossary id (`soc`) or any declared alias (`state of charge`). */
  term: string
  /** Visible label. Defaults to the glossary's canonical term. */
  children?: React.ReactNode
  /** Include the provenance sentence in the tooltip. Default true. */
  showProvenance?: boolean
  className?: string
}

function lookup(term: string): Term | null {
  return getGlossaryTerm(term) ?? resolveGlossaryTerm(term)
}

export function GlossaryTerm({
  term,
  children,
  showProvenance = true,
  className,
}: GlossaryTermProps) {
  const { t } = useTranslation()
  const entry = lookup(term)

  if (!entry) {
    return <span className={className}>{children ?? term}</span>
  }

  const label = children ?? t(entry.termKey, entry.termFallback)
  const definition = t(entry.definitionKey, entry.definitionFallback)
  const provenance = t(entry.howMeasuredKey, entry.howMeasuredFallback)
  const body = showProvenance ? `${definition} ${provenance}` : definition

  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <dfn
        data-glossary-term={entry.id}
        className="not-italic underline decoration-dotted decoration-[var(--text-muted)] underline-offset-4"
      >
        {label}
      </dfn>
      <HelpTooltip
        text={body}
        size="xs"
        ariaLabel={t('glossary.tooltipLabel', 'What is {{term}}?', {
          term: t(entry.termKey, entry.termFallback),
        })}
      />
    </span>
  )
}
