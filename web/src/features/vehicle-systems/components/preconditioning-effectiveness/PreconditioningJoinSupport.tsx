import { GitMerge, Repeat2 } from 'lucide-react';
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
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type { PreconditioningQueryState } from './types';

interface PreconditioningJoinSupportProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDuration: UnitFormatter;
}

export function PreconditioningJoinSupport({
  summary,
  state,
  formatDuration,
}: PreconditioningJoinSupportProps) {
  const { t } = useTranslation();
  const support = summary.windowSupport;
  const items = [
    [t('preconditioningEffectiveness.join.overlap', 'Drive windows overlapping coverage'), fmtInt(summary.coverage.overlappingDriveWindows)],
    [t('preconditioningEffectiveness.join.withRows', 'Departures with window rows'), fmtInt(support.departuresWithWindowRows)],
    [t('preconditioningEffectiveness.join.withThermal', 'Departures with thermal support'), fmtInt(support.departuresWithThermalSupport)],
    [t('preconditioningEffectiveness.join.references', 'Window-row references'), fmtInt(support.windowRowReferences)],
    [t('preconditioningEffectiveness.join.uniqueUsed', 'Unique climate rows used'), fmtInt(support.climateRowsUsed)],
    [t('preconditioningEffectiveness.join.reused', 'Climate rows reused'), fmtInt(support.climateRowsReused)],
    [t('preconditioningEffectiveness.join.medianRows', 'Median window rows'), support.medianWindowRows != null ? fmtInt(support.medianWindowRows) : '—'],
    [t('preconditioningEffectiveness.join.medianThermal', 'Median thermal samples'), support.medianThermalSamples != null ? fmtInt(support.medianThermalSamples) : '—'],
    [t('preconditioningEffectiveness.join.medianSpan', 'Median observation span'), formatDuration(support.medianObservationSpanS, { precision: 2 })],
    [t('preconditioningEffectiveness.join.medianLead', 'Median final-sample lead'), formatDuration(support.medianLastSampleLeadS, { precision: 2 })],
    [t('preconditioningEffectiveness.join.p90Lead', 'P90 final-sample lead'), formatDuration(support.p90LastSampleLeadS, { precision: 2 })],
  ] as const;

  return (
    <section data-testid="preconditioning-join-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.join.title',
            'Join-window support and overlap disclosure',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.join.subtitle',
            'Support counts describe the bounded pre-drive join before classification gates are applied.',
          )}
        </Text>
        <PreconditioningSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 3, xl: 6 }} gap={3}>
            {items.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{value}</MetricValue>
              </div>
            ))}
          </Grid>
          <AlertBanner
            className="mt-4"
            variant={support.climateRowsReused > 0 ? 'warning' : 'info'}
            icon={<Repeat2 className="h-4 w-4" aria-hidden="true" />}
          >
            <Text as="p" variant="caption">
              {support.climateRowsReused > 0
                ? t(
                    'preconditioningEffectiveness.join.reuseObserved',
                    '{{count}} unique climate rows are referenced by more than one overlapping departure window; departures are therefore not row-independent.',
                    { count: support.climateRowsReused },
                  )
                : t(
                    'preconditioningEffectiveness.join.reuseNone',
                    'No climate-row reuse is observed in the returned windows, but the method permits reuse whenever departure windows overlap.',
                  )}
            </Text>
          </AlertBanner>
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
