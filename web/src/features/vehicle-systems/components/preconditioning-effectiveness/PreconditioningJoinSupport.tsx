import { Repeat2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type { PreconditioningQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const support = summary.windowSupport;
  const items = [
    [t('preconditioningEffectiveness.join.overlap', 'Drive windows overlapping coverage'), summary.coverage.overlappingDriveWindows, 'count'],
    [t('preconditioningEffectiveness.join.withRows', 'Departures with window rows'), support.departuresWithWindowRows, 'count'],
    [t('preconditioningEffectiveness.join.withThermal', 'Departures with distinct-state support'), support.departuresWithThermalSupport, 'count'],
    [t('preconditioningEffectiveness.join.references', 'Window-row references'), support.windowRowReferences, 'count'],
    [t('preconditioningEffectiveness.join.uniqueUsed', 'Unique climate rows used'), support.climateRowsUsed, 'count'],
    [t('preconditioningEffectiveness.join.reused', 'Climate rows reused'), support.climateRowsReused, 'count'],
    [t('preconditioningEffectiveness.join.medianRows', 'Median window rows'), support.medianWindowRows, 'number'],
    [t('preconditioningEffectiveness.join.medianThermal', 'Median distinct cabin states'), support.medianThermalSamples, 'number'],
    [t('preconditioningEffectiveness.join.medianSpan', 'Median observation span'), support.medianObservationSpanS, 'duration'],
    [t('preconditioningEffectiveness.join.medianLead', 'Median final-state lead'), support.medianLastSampleLeadS, 'duration'],
    [t('preconditioningEffectiveness.join.p90Lead', 'P90 final-state lead'), support.p90LastSampleLeadS, 'duration'],
  ] as const;

  return (
    <section data-testid="preconditioning-join-support">
      <LayoutCard title={t('preconditioningEffectiveness.join.title', 'Join-window support and overlap disclosure')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.join.subtitle',
            'Support counts describe the bounded pre-drive join before classification gates are applied.',
          )}
        </Text>
        <PreconditioningSectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="preconditioning-join-summary"
            title={t('preconditioningEffectiveness.join.title', 'Join-window support and overlap disclosure')}
            retained={Boolean(state.climate.refreshError) || Boolean(state.drives.refreshError)
              || state.climate.isPaused || state.drives.isPaused}
            period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.title', 'Source and temporal coverage'),
              reason: t('preconditioningEffectiveness.join.subtitle', 'Support counts describe the bounded pre-drive join before classification gates are applied.') }}
            metrics={items.map(([label, rawValue, metricId], index) => ({
              occurrenceId: `join-${index}`, label, metricId, rawValue,
              display: { formatter: (raw: number) => ({ value: metricId === 'duration' ? formatDuration(raw) : fmtInt(raw), unit: '' }) },
            }))}
          />
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
      </LayoutCard>
    </section>
  );
}
