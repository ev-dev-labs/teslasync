import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CarbonSourceRow } from './CarbonSourceRow';
import type { CarbonQueryStates, CarbonSectionProps } from './types';

export function CarbonSourceScopeLedger({
  analysis,
  states,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const sources: Array<{
    id: keyof CarbonQueryStates;
    name: string;
    scope: string;
  }> = [
    {
      id: 'intensity',
      name: t('carbon.source.intensity', 'Grid intensity model'),
      scope: t(
        'carbon.source.intensityScope',
        'Built-in, admin-editable static 24-hour model',
      ),
    },
    {
      id: 'period',
      name: t('carbon.source.period', 'Selected-period summary'),
      scope: t(
        'carbon.source.periodScope',
        '{{start}} through {{end}} calendar labels',
        {
          start: analysis.window.startLabel,
          end: analysis.window.endLabel,
        },
      ),
    },
    {
      id: 'lifetime',
      name: t('carbon.source.lifetime', 'Lifetime summary'),
      scope: t('carbon.source.lifetimeScope', 'Full vehicle history'),
    },
    {
      id: 'recommendation',
      name: t('carbon.source.recommendation', 'Green-window scenario'),
      scope: t(
        'carbon.source.recommendationScope',
        'Full vehicle history; independent of the selected range',
      ),
    },
  ];

  return (
    <section
      data-testid="carbon-source-scope"
      aria-label={t('carbon.source.aria', 'Carbon source and query scope ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Database
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.source.title', 'Source, query status, and scope ledger')}
        </PanelTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          {sources.map((source) => (
            <CarbonSourceRow
              key={source.id}
              {...source}
              state={states[source.id]}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          <Text as="p" variant="caption">
            {t(
              'carbon.source.requestWindow',
              'API window: {{from}} ≤ timestamp < {{to}}',
              {
                from: analysis.window.startInstant,
                to: analysis.window.endInstantExclusive,
              },
            )}
          </Text>
          <Text as="p" variant="caption">
            {t(
              'carbon.source.timezone',
              'Calendar timezone: {{timezone}} · {{days}} calendar days',
              {
                timezone: analysis.window.timezone,
                days: analysis.window.calendarDays ?? '—',
              },
            )}
          </Text>
        </div>
        {analysis.window.availability === 'invalid' ? (
          <AlertBanner className="mt-4" variant="warning">
            {t(
              'carbon.source.invalidWindow',
              'The date-window labels or RFC3339 boundaries are invalid; period interpretation is withheld.',
            )}
          </AlertBanner>
        ) : null}
      </GlassPanel>
    </section>
  );
}
