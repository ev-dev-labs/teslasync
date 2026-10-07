import { CalendarRange, Cloud, Database, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import type {
  PreconditioningQueryState,
  PreconditioningSourceQueryState,
} from './types';

interface PreconditioningSourceCoverageProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDuration: UnitFormatter;
  locale: string;
}

function sourceReady(source: PreconditioningSourceQueryState): boolean {
  return source.isResolved && !source.error;
}

function SourceMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <MetricValue>{value}</MetricValue>
    </div>
  );
}

export function PreconditioningSourceCoverage({
  summary,
  state,
  formatDuration,
  locale,
}: PreconditioningSourceCoverageProps) {
  const { t } = useTranslation();
  const climateReady = sourceReady(state.climate);
  const drivesReady = sourceReady(state.drives);
  const result = (
    label: string,
    variant: 'success' | 'info' | 'warning' | 'neutral',
  ) => ({ label, variant });
  const status = (
    source: PreconditioningSourceQueryState,
  ): { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' } => {
    if (!state.vehicleSelected) {
      return result(t('preconditioningEffectiveness.coverage.notRequested', 'Not requested'), 'neutral');
    }
    if (source.isLoading) {
      return result(t('preconditioningEffectiveness.coverage.loading', 'Loading'), 'info');
    }
    if (source.error) {
      return result(t('preconditioningEffectiveness.coverage.failed', 'Unavailable'), 'warning');
    }
    if (source.refreshError) {
      return result(t('preconditioningEffectiveness.coverage.cached', 'Cached; refresh failed'), 'warning');
    }
    if (source.isFetching) {
      return result(t('preconditioningEffectiveness.coverage.refreshing', 'Refreshing'), 'info');
    }
    if (source.isResolved) {
      return result(t('preconditioningEffectiveness.coverage.loaded', 'Loaded'), 'success');
    }
    return result(t('preconditioningEffectiveness.coverage.pending', 'Pending'), 'neutral');
  };
  const climateStatus = status(state.climate);
  const driveStatus = status(state.drives);

  return (
    <section data-testid="preconditioning-source-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.coverage.title',
            'Source and temporal coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.coverage.subtitle',
            'The climate endpoint defaults to seven days; drive history is separately bounded at 1,000 rows, so their spans need not align.',
          )}
        </Text>
        <Grid cols={{ default: 1, lg: 2 }} gap={3}>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <Text as="h3" variant="label">
                  {t(
                    'preconditioningEffectiveness.coverage.climateSource',
                    'Climate history source',
                  )}
                </Text>
              </div>
              <Badge variant={climateStatus.variant}>{climateStatus.label}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <SourceMetric label={t('preconditioningEffectiveness.coverage.returned', 'Returned rows')} value={climateReady ? fmtInt(summary.climateRows.returnedRows) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.uniqueTimes', 'Unique timestamps')} value={climateReady ? fmtInt(summary.climateRows.uniqueTimestampRows) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.thermal', 'Thermally complete')} value={climateReady ? fmtInt(summary.climateSources.thermallyCompleteRows) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.knownHvac', 'Known HVAC state')} value={climateReady ? fmtInt(summary.climateSources.knownHvacRows) : '—'} />
            </div>
            <Text as="p" variant="caption" className="mt-4">
              {t(
                'preconditioningEffectiveness.coverage.climateRange',
                '{{earliest}} to {{latest}} · span {{span}} · median gap {{gap}}',
                {
                  earliest: climateReady && summary.coverage.climateEarliestMs != null
                    ? formatDateTime(new Date(summary.coverage.climateEarliestMs), { locale })
                    : '—',
                  latest: climateReady && summary.coverage.climateLatestMs != null
                    ? formatDateTime(new Date(summary.coverage.climateLatestMs), { locale })
                    : '—',
                  span: climateReady
                    ? formatDuration(summary.coverage.climateSpanS, { precision: 2 })
                    : '—',
                  gap: climateReady
                    ? formatDuration(summary.coverage.climateMedianGapS, { precision: 2 })
                    : '—',
                },
              )}
            </Text>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-purple-300" aria-hidden="true" />
                <Text as="h3" variant="label">
                  {t(
                    'preconditioningEffectiveness.coverage.driveSource',
                    'Drive history source',
                  )}
                </Text>
              </div>
              <Badge variant={driveStatus.variant}>{driveStatus.label}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <SourceMetric label={t('preconditioningEffectiveness.coverage.returned', 'Returned rows')} value={drivesReady ? fmtInt(summary.driveRows.returnedRows) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.validDrives', 'Unique valid drives')} value={drivesReady ? fmtInt(summary.driveRows.uniqueValidDrives) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.overlap', 'Windows overlapping coverage')} value={climateReady && drivesReady ? fmtInt(summary.coverage.overlappingDriveWindows) : '—'} />
              <SourceMetric label={t('preconditioningEffectiveness.coverage.driveSpan', 'Drive span')} value={drivesReady ? formatDuration(summary.coverage.driveSpanS, { precision: 2 }) : '—'} />
            </div>
            <Text as="p" variant="caption" className="mt-4">
              {t(
                'preconditioningEffectiveness.coverage.driveRange',
                '{{earliest}} to {{latest}} · endpoint limit 1,000 rows',
                {
                  earliest: drivesReady && summary.coverage.driveEarliestMs != null
                    ? formatDateTime(new Date(summary.coverage.driveEarliestMs), { locale })
                    : '—',
                  latest: drivesReady && summary.coverage.driveLatestMs != null
                    ? formatDateTime(new Date(summary.coverage.driveLatestMs), { locale })
                    : '—',
                },
              )}
            </Text>
          </div>
        </Grid>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <Text as="p" variant="caption">
            {t(
              'preconditioningEffectiveness.coverage.contract',
              'Coverage reports returned telemetry only. A longer drive span does not imply climate evidence exists around every departure.',
            )}
          </Text>
        </div>
      </GlassPanel>
    </section>
  );
}
