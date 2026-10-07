import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeHistoryCoverageProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeHistoryCoverage({
  summary,
  state,
  display,
}: ArchetypeHistoryCoverageProps) {
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const metrics = [
    [t('archetypes.coverage.returned', 'Rows in observed window'), fmtInt(summary.source.returnedRows)],
    [t('archetypes.coverage.timestamped', 'Timestamp-valid rows'), fmtInt(coverage.timestampedRows)],
    [t('archetypes.coverage.earliest', 'Earliest observed start'), display.formatDateTime(coverage.earliestMs)],
    [t('archetypes.coverage.latest', 'Latest observed start'), display.formatDateTime(coverage.latestMs)],
    [t('archetypes.coverage.span', 'Observed time span'), display.formatDuration(coverage.spanS, { precision: 1 })],
    [t('archetypes.coverage.limit', 'Request row limit'), fmtInt(coverage.historyLimit)],
  ] as const;

  return (
    <section data-testid="drive-archetypes-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.coverage.title', 'History coverage and bounded-window disclosure')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.coverage.subtitle',
            'Coverage describes the returned history window, never lifetime driving behavior.',
          )}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
          <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
            {metrics.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1 text-base">{value}</MetricValue>
              </div>
            ))}
          </Grid>
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
      </GlassPanel>
    </section>
  );
}
