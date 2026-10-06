import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { StatStrip } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';

import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ArchetypeHistoryCoverageProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeHistoryCoverage({
  summary,
  state,
  display,
}: ArchetypeHistoryCoverageProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const metrics = [
    [t('archetypes.coverage.returned', 'Rows in observed window'), fmtInt(summary.source.returnedRows)],
    [t('archetypes.coverage.timestamped', 'Timestamp-valid rows'), fmtInt(coverage.timestampedRows)],
    [t('archetypes.coverage.earliest', 'Earliest observed start'), display.formatDateTime(coverage.earliestMs)],
    [t('archetypes.coverage.latest', 'Latest observed start'), display.formatDateTime(coverage.latestMs)],
    [t('archetypes.coverage.span', 'Observed time span'), display.formatDuration(coverage.spanS)],
    [t('archetypes.coverage.limit', 'Request row limit'), fmtInt(coverage.historyLimit)],
  ] as const;

  return (
    <section data-testid="drive-archetypes-coverage">
      <LayoutCard
        title={t('archetypes.coverage.title', 'History coverage and bounded-window disclosure')}
        actions={<CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.coverage.subtitle',
            'Coverage describes the returned history window, never lifetime driving behavior.',
          )}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
          <StatStrip
            id="archetype-history-coverage-metrics"
            variant="embedded"
            period={{
              kind: 'unknown',
              label: t('archetypes.coverage.sourcePeriod', 'Returned drive-history window'),
            }}
            metrics={metrics.map(([label, value], index) => ({
              metricId: 'text',
              occurrenceId: `archetype-history-${index}`,
              label,
              rawValue: value,
              description: t('archetypes.coverage.subtitle', 'Coverage describes the returned history window, never lifetime driving behavior.'),
            }))}
          />
          <AlertBanner
            className="mt-4"
            variant={coverage.historyCapReached ? 'warning' : 'info'}
          >
            {coverage.historyCapReached
              ? t(
                  'archetypes.coverage.capWarning',
                  'Exactly {{limit}} rows were returned, so older history may exist beyond this observed bounded window.',
                  { limit: fmtInt(coverage.historyLimit) },
                )
              : t(
                  'archetypes.coverage.boundedNotice',
                  'The endpoint returned fewer than {{limit}} rows, but this workspace still describes observed records rather than guaranteed lifetime behavior.',
                  { limit: fmtInt(coverage.historyLimit) },
                )}
          </AlertBanner>
        </ArchetypeSectionBody>
      </LayoutCard>
    </section>
  );
}
