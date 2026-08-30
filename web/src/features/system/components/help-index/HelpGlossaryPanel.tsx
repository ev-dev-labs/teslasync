import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { GLOSSARY } from '@/lib/helpGlossary'

/**
 * The glossary as a deterministic baseline surface (HELP-03).
 *
 * `<GlossaryTerm>` attaches definitions in context, but it self-gates on the
 * user's "contextual help" preference and on hover/focus. This panel is the
 * always-available fallback: every definition, plus its provenance, readable
 * without pointing at anything and without any preference being enabled.
 *
 * Rendered as a `<dl>` because that is what it is — a description list. Screen
 * readers announce term/definition pairing for free.
 */
export function HelpGlossaryPanel() {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="help-glossary">
      <PanelTitle>{t('glossary.panelTitle', 'What the numbers mean')}</PanelTitle>
      <Text as="p" variant="bodySm" className="mt-1">
        {t(
          'glossary.panelSubtitle',
          'Definitions for the terms that are easiest to misread, and where each number actually comes from.',
        )}
      </Text>

      <dl className="mt-4 space-y-4">
        {GLOSSARY.map((term) => (
          <div key={term.id} data-glossary-entry={term.id} className="space-y-1">
            <dt>
              <Text as="span" size="sm" weight="medium" color="primary">
                {t(term.termKey, term.termFallback)}
              </Text>
            </dt>
            <dd className="space-y-1">
              <Text as="p" variant="bodySm">
                {t(term.definitionKey, term.definitionFallback)}
              </Text>
              <Text as="p" variant="bodySm" color="muted">
                <span className="font-medium">
                  {t('glossary.howMeasured', 'How we measure it')}:{' '}
                </span>
                {t(term.howMeasuredKey, term.howMeasuredFallback)}
              </Text>
              {term.learnMoreTo && (
                <Link
                  to={term.learnMoreTo}
                  className="inline-flex text-xs font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
                >
                  {t('glossary.seeInContext', 'See it in context')}
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  )
}
