import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { Badge, Text } from '@/components/ui';

import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ArchetypeSourceDisposition({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const source = summary.source;
  const dispositions = [
    [t('archetypes.source.invalidRow', 'Invalid row'), source.invalidRowRows],
    [t('archetypes.source.invalidId', 'Invalid drive ID'), source.invalidIdRows],
    [t('archetypes.source.duplicate', 'Duplicate drive ID'), source.duplicateDriveRows],
    [t('archetypes.source.missingStart', 'Missing start time'), source.missingStartRows],
    [t('archetypes.source.invalidStart', 'Invalid start time'), source.invalidStartRows],
    [t('archetypes.source.invalidDistance', 'Invalid distance'), source.invalidDistanceRows],
    [t('archetypes.source.shortDistance', 'Below distance floor'), source.shortDistanceRows],
    [t('archetypes.source.missingEnergy', 'Missing energy'), source.missingEnergyRows],
    [t('archetypes.source.invalidEnergy', 'Invalid energy'), source.invalidEnergyRows],
    [t('archetypes.source.missingSpeed', 'Missing average speed'), source.missingSpeedRows],
    [t('archetypes.source.invalidSpeed', 'Invalid average speed'), source.invalidSpeedRows],
    [t('archetypes.source.observedTemp', 'Eligible · measured temperature'), source.eligibleObservedTempRows],
    [t('archetypes.source.imputedTemp', 'Eligible · imputed temperature'), source.eligibleImputedTempRows],
  ] as const;

  return (
    <section data-testid="drive-archetypes-source">
      <LayoutCard
        title={t('archetypes.source.title', 'Source eligibility disposition')}
        actions={(
          <>
            <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Badge variant="info">
              {state.isResolved && !state.error
                ? t('archetypes.source.returnedBadge', '{{count}} returned', { count: source.returnedRows })
                : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            </Badge>
          </>
        )}
      >
        <Text as="p" variant="caption" className="mt-1">
          {t('archetypes.source.subtitle', 'Every returned row receives exactly one terminal disposition.')}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
          <StatStrip
            id="archetype-source-disposition-metrics"
            variant="embedded"
            period={{
              kind: 'unknown',
              label: t('archetypes.coverage.sourcePeriod', 'Returned drive-history window'),
            }}
            metrics={dispositions.map(([label, count], index) => ({
              metricId: 'text',
              occurrenceId: `archetype-disposition-${index}`,
              label,
              rawValue: fmtInt(count),
              description: t('archetypes.source.subtitle', 'Every returned row receives exactly one terminal disposition.'),
              context: (
                  <Badge variant={index >= dispositions.length - 2 ? 'success' : 'neutral'}>
                    {index >= dispositions.length - 2
                      ? t('archetypes.source.eligible', 'Eligible')
                      : t('archetypes.source.excluded', 'Excluded')}
                  </Badge>
              ),
            }))}
          />
        </ArchetypeSectionBody>
      </LayoutCard>
    </section>
  );
}
