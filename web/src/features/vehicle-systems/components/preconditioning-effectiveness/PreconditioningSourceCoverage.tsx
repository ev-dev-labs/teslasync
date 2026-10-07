import { Cloud, Database, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import type {
  PreconditioningQueryState,
  PreconditioningSourceQueryState,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningSourceCoverageProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDuration: UnitFormatter;
  locale: string;
}

function sourceReady(source: PreconditioningSourceQueryState): boolean {
  return source.isResolved && !source.error;
}

export function PreconditioningSourceCoverage({
  summary,
  state,
  formatDuration,
  locale,
}: PreconditioningSourceCoverageProps) {
  const { fmtInt } = useNumberFormatting();
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
      <LayoutCard title={t('preconditioningEffectiveness.coverage.title', 'Source and temporal coverage')}>
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
            <VehicleOperationalBrief embedded id="preconditioning-climate-source-summary"
              title={t('preconditioningEffectiveness.coverage.climateSource', 'Climate history source')}
              available={climateReady} loading={state.climate.isLoading}
              retained={Boolean(state.climate.refreshError) || (climateReady && state.climate.isPaused)}
              period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.climateSource', 'Climate history source'),
                reason: t('preconditioningEffectiveness.coverage.subtitle', 'The climate endpoint defaults to seven days; drive history is separately bounded at 1,000 rows, so their spans need not align.') }}
              metrics={[
                { key: 'returned', label: t('preconditioningEffectiveness.coverage.returned', 'Returned rows'), value: summary.climateRows.returnedRows },
                { key: 'unique', label: t('preconditioningEffectiveness.coverage.uniqueTimes', 'Unique timestamps'), value: summary.climateRows.uniqueTimestampRows },
                { key: 'thermal', label: t('preconditioningEffectiveness.coverage.thermal', 'Thermally complete'), value: summary.climateSources.thermallyCompleteRows },
                { key: 'known-hvac', label: t('preconditioningEffectiveness.coverage.knownHvac', 'Known HVAC state'), value: summary.climateSources.knownHvacRows },
              ].map(fact => ({
                metricId: 'count' as const, occurrenceId: fact.key, label: fact.label, rawValue: climateReady ? fact.value : null,
                display: { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) },
              }))}
            />
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
                    ? formatDuration(summary.coverage.climateSpanS)
                    : '—',
                  gap: climateReady
                    ? formatDuration(summary.coverage.climateMedianGapS)
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
            <VehicleOperationalBrief embedded id="preconditioning-drive-source-summary"
              title={t('preconditioningEffectiveness.coverage.driveSource', 'Drive history source')}
              available={drivesReady} loading={state.drives.isLoading}
              retained={Boolean(state.drives.refreshError) || (drivesReady && state.drives.isPaused)}
              period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.driveSource', 'Drive history source'),
                reason: t('preconditioningEffectiveness.coverage.contract', 'Coverage reports returned telemetry only. A longer drive span does not imply climate evidence exists around every departure.') }}
              metrics={[
                { metricId: 'count', occurrenceId: 'returned', label: t('preconditioningEffectiveness.coverage.returned', 'Returned rows'), rawValue: drivesReady ? summary.driveRows.returnedRows : null, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
                { metricId: 'count', occurrenceId: 'valid', label: t('preconditioningEffectiveness.coverage.validDrives', 'Unique valid drives'), rawValue: drivesReady ? summary.driveRows.uniqueValidDrives : null, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
                { metricId: 'count', occurrenceId: 'overlap', label: t('preconditioningEffectiveness.coverage.overlap', 'Windows overlapping coverage'), rawValue: climateReady && drivesReady ? summary.coverage.overlappingDriveWindows : null, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
                { metricId: 'duration', occurrenceId: 'span', label: t('preconditioningEffectiveness.coverage.driveSpan', 'Drive span'), rawValue: drivesReady ? summary.coverage.driveSpanS : null, display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
              ]}
            />
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
      </LayoutCard>
    </section>
  );
}
