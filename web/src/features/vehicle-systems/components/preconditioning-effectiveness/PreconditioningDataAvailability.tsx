import { ClipboardCheck, DatabaseZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import type {
  PreconditioningQueryState,
  PreconditioningSourceQueryState,
} from './types';

interface PreconditioningDataAvailabilityProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
}

interface AvailabilityItem {
  key: string;
  label: string;
  available: boolean;
  support: string;
}

export function PreconditioningDataAvailability({
  summary,
  state,
}: PreconditioningDataAvailabilityProps) {
  const { t } = useTranslation();
  const result = (
    label: string,
    variant: 'success' | 'info' | 'warning' | 'neutral',
  ) => ({ label, variant });
  const queryStatus = (
    source: PreconditioningSourceQueryState,
  ): { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' } => {
    if (!state.vehicleSelected) {
      return result(t('preconditioningEffectiveness.availability.notRequested', 'Not requested'), 'neutral');
    }
    if (source.isLoading) {
      return result(t('preconditioningEffectiveness.availability.loading', 'Initial load'), 'info');
    }
    if (source.error) {
      return result(t('preconditioningEffectiveness.availability.failed', 'Query failed'), 'warning');
    }
    if (source.refreshError) {
      return result(t('preconditioningEffectiveness.availability.refreshFailed', 'Refresh failed; cached data retained'), 'warning');
    }
    if (source.isFetching) {
      return result(t('preconditioningEffectiveness.availability.refreshing', 'Refreshing'), 'info');
    }
    if (source.isResolved) {
      return result(t('preconditioningEffectiveness.availability.resolved', 'Resolved'), 'success');
    }
    return result(t('preconditioningEffectiveness.availability.pending', 'Pending'), 'neutral');
  };
  const climateStatus = queryStatus(state.climate);
  const driveStatus = queryStatus(state.drives);
  const items: AvailabilityItem[] = [
    {
      key: 'climate',
      label: t('preconditioningEffectiveness.availability.climateRows', 'Climate endpoint rows'),
      available: summary.climateRows.returnedRows > 0,
      support: fmtInt(summary.climateRows.returnedRows),
    },
    {
      key: 'drives',
      label: t('preconditioningEffectiveness.availability.driveRows', 'Drive endpoint rows'),
      available: summary.driveRows.returnedRows > 0,
      support: fmtInt(summary.driveRows.returnedRows),
    },
    {
      key: 'timestamps',
      label: t('preconditioningEffectiveness.availability.timeline', 'Unique climate timeline'),
      available: summary.climateRows.uniqueTimestampRows > 0,
      support: fmtInt(summary.climateRows.uniqueTimestampRows),
    },
    {
      key: 'overlap',
      label: t('preconditioningEffectiveness.availability.overlap', 'Temporal window overlap'),
      available: summary.coverage.overlappingDriveWindows > 0,
      support: fmtInt(summary.coverage.overlappingDriveWindows),
    },
    {
      key: 'window',
      label: t('preconditioningEffectiveness.availability.windowRows', 'Pre-drive window rows'),
      available: summary.windowSupport.departuresWithWindowRows > 0,
      support: fmtInt(summary.windowSupport.departuresWithWindowRows),
    },
    {
      key: 'thermal',
      label: t('preconditioningEffectiveness.availability.thermal', 'Thermal join support'),
      available: summary.windowSupport.departuresWithThermalSupport > 0,
      support: fmtInt(summary.windowSupport.departuresWithThermalSupport),
    },
    {
      key: 'classified',
      label: t('preconditioningEffectiveness.availability.classified', 'Classified departures'),
      available: summary.joinedDepartures > 0,
      support: fmtInt(summary.joinedDepartures),
    },
    {
      key: 'active',
      label: t('preconditioningEffectiveness.availability.active', 'Observed HVAC-active group'),
      available: summary.conditionedDepartures > 0,
      support: fmtInt(summary.conditionedDepartures),
    },
    {
      key: 'control',
      label: t('preconditioningEffectiveness.availability.control', 'Explicitly HVAC-off control group'),
      available: summary.unconditionedDepartures > 0,
      support: fmtInt(summary.unconditionedDepartures),
    },
    {
      key: 'comparison',
      label: t('preconditioningEffectiveness.availability.comparison', 'Published comparison'),
      available: summary.overall.evidence !== 'none',
      support: summary.overall.evidence !== 'none'
        ? t('preconditioningEffectiveness.availability.bothGroups', 'Both groups present')
        : t('preconditioningEffectiveness.availability.requiresBoth', 'Requires both groups'),
    },
  ];

  return (
    <section data-testid="preconditioning-availability">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.availability.title',
            'Data availability and query state',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.availability.subtitle',
            'Query transport state is separate from analytical availability, and cached evidence remains visible after a refresh failure.',
          )}
        </Text>
        <Grid cols={{ default: 1, lg: 2 }} gap={3}>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-3">
              <MetricLabel>{t('preconditioningEffectiveness.availability.climateQuery', 'Climate query')}</MetricLabel>
              <Badge variant={climateStatus.variant}>{climateStatus.label}</Badge>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-3">
              <MetricLabel>{t('preconditioningEffectiveness.availability.driveQuery', 'Drive query')}</MetricLabel>
              <Badge variant={driveStatus.variant}>{driveStatus.label}</Badge>
            </div>
          </div>
        </Grid>
        <Grid cols={{ default: 1, sm: 2, xl: 5 }} gap={3} className="mt-3">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <MetricLabel>{item.label}</MetricLabel>
                <Badge variant={item.available ? 'success' : 'neutral'}>
                  {item.available
                    ? t('preconditioningEffectiveness.availability.available', 'Available')
                    : t('preconditioningEffectiveness.availability.withheld', 'Withheld')}
                </Badge>
              </div>
              <Text as="p" variant="caption" className="mt-2">
                {item.support}
              </Text>
            </div>
          ))}
        </Grid>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
          <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <Text as="p" variant="caption">
            {t(
              'preconditioningEffectiveness.availability.note',
              'A successful empty response is valid evidence of no returned rows; it is not treated as a transport failure.',
            )}
          </Text>
        </div>
      </GlassPanel>
    </section>
  );
}
