import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type { PreconditioningQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningClimateDispositionProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
}

export function PreconditioningClimateDisposition({
  summary,
  state,
}: PreconditioningClimateDispositionProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const rows = summary.climateRows;
  const outcomes = [
    [t('preconditioningEffectiveness.climateRows.invalid', 'Invalid row'), rows.invalidRowRows],
    [t('preconditioningEffectiveness.climateRows.missingTime', 'Missing timestamp'), rows.missingTimestampRows],
    [t('preconditioningEffectiveness.climateRows.invalidTime', 'Invalid timestamp'), rows.invalidTimestampRows],
    [t('preconditioningEffectiveness.climateRows.duplicate', 'Duplicate timestamp'), rows.duplicateTimestampRows],
    [t('preconditioningEffectiveness.climateRows.noCabin', 'Missing cabin temperature'), rows.missingInsideTempRows],
    [t('preconditioningEffectiveness.climateRows.noTarget', 'Missing front-row target'), rows.missingSetpointRows],
    [t('preconditioningEffectiveness.climateRows.unknownHvac', 'Complete thermal row; HVAC unknown'), rows.completeUnknownHvacRows],
    [t('preconditioningEffectiveness.climateRows.hvacOff', 'Complete thermal row; HVAC off'), rows.completeHvacOffRows],
    [t('preconditioningEffectiveness.climateRows.hvacOn', 'Complete thermal row; HVAC active'), rows.completeHvacOnRows],
  ] as const;

  return (
    <section data-testid="preconditioning-climate-disposition">
      <LayoutCard title={t('preconditioningEffectiveness.climateRows.title', 'Climate-row disposition')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.climateRows.subtitle',
            'Every returned row receives one terminal outcome; incomplete and unknown-HVAC rows remain visible rather than disappearing.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="climate"
        >
          <VehicleOperationalBrief embedded id="preconditioning-climate-disposition-summary"
            title={t('preconditioningEffectiveness.climateRows.title', 'Climate-row disposition')}
            retained={Boolean(state.climate.refreshError) || state.climate.isPaused}
            period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.climateSource', 'Climate history source'),
              reason: t('preconditioningEffectiveness.climateRows.subtitle', 'Every returned row receives one terminal outcome; incomplete and unknown-HVAC rows remain visible rather than disappearing.') }}
            metrics={outcomes.map(([label, rawValue], index) => ({
              metricId: 'count', occurrenceId: `outcome-${index}`, label, rawValue,
              display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
            }))}
          />
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'preconditioningEffectiveness.climateRows.intermediate',
              '{{valid}} timestamp-valid rows become {{unique}} unique timestamps plus {{duplicates}} duplicates.',
              {
                valid: fmtInt(rows.timestampValidRows),
                unique: fmtInt(rows.uniqueTimestampRows),
                duplicates: fmtInt(rows.duplicateTimestampRows),
              },
            )}
          </Text>
        </PreconditioningSectionBody>
      </LayoutCard>
    </section>
  );
}
