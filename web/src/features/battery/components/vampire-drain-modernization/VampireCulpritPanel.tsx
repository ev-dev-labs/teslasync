import { useTranslation } from 'react-i18next';
import { Badge, Text } from '@/components/ui';
import { DataProvenanceBadge } from '@/components/data-display';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useParkTruth, useVampireSplit } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import type { StatPeriod } from '@/lib/metric-reference';
import { deriveVampireCulprits, type VampireCulpritId } from '../../lib/vampireCulprits';
import { SourceRecovery } from './SourceRecovery';

const ACTION: Record<VampireCulpritId, { key: string; fallback: string }> = {
  sentry: {
    key: 'vampireDrain.culprit.action.sentry',
    fallback: 'Turn Sentry off at home tonight. It is counted only because the car is in Park.',
  },
  cabin_overheat: {
    key: 'vampireDrain.culprit.action.overheat',
    fallback: 'Cabin Overheat is HVAC, not a pack leak. Turn it off if the car sits in shade.',
  },
  precondition: {
    key: 'vampireDrain.culprit.action.precondition',
    fallback: 'Preconditioning is warming the pack/cabin on purpose. Leave it on only before a drive.',
  },
  plugged_complete: {
    key: 'vampireDrain.culprit.action.plugged',
    fallback: 'Charge reached Complete and stayed plugged. Unplug after DC Complete to stop idle draw.',
  },
  unplugged_leak: {
    key: 'vampireDrain.culprit.action.leak',
    fallback: 'Unplugged parked drain remains after Sentry/HVAC. That is 12V upkeep or a genuine leak.',
  },
  unknown: {
    key: 'vampireDrain.culprit.action.unknown',
    fallback: 'No confirmed Park culprit yet. Missing is not zero watts.',
  },
};

/** Derivation remains byte-preserved in the existing private domain utility. */
export function VampireCulpritPanel({ vehicleId }: { vehicleId: string | undefined }) {
  const { t } = useTranslation();
  const parkQuery = useParkTruth(vehicleId);
  const splitQuery = useVampireSplit(vehicleId);
  const parkState = useDataState(parkQuery, { provenance: 'live' });
  const splitState = useDataState(splitQuery, { provenance: 'historical' });
  const report = deriveVampireCulprits(parkState.data, splitState.data);
  const loading = parkState.status === 'initial' && splitState.status === 'initial';
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('vampireDrain.modernization.culpritPeriod', 'Park evidence and parked windows'),
    reason: t('vampireDrain.modernization.culpritBounds', 'Current Park evidence and historical drain windows have independent source coverage.'),
  };
  const metrics: StatMetric[] = report.culprits.map(row => ({
    metricId: row.drainPct != null ? 'percent' : 'status',
    occurrenceId: `vampire-culprit-${row.id}`,
    rawValue: row.drainPct != null ? row.drainPct
      : row.evidence === 'missing' ? null
      : row.active ? t('vampireDrain.culprit.on', 'On') : t('vampireDrain.culprit.off', 'Off'),
    label: t(`vampireDrain.culprit.${row.id}`, row.id.replace(/_/g, ' ')),
    missingReason: t('vampireDrain.modernization.evidenceMissing', 'No confirmed measurement supplied by this source.'),
    context: row.evidence === 'missing'
      ? t('vampireDrain.modernization.evidenceMissing', 'No confirmed measurement supplied by this source.')
      : row.drainPct != null
        ? t('vampireDrain.modernization.historicalEvidence', 'Historical parked-window measurement')
        : t('vampireDrain.modernization.parkEvidence', 'Confirmed Park evidence'),
  }));
  return (
    <div data-testid="vampire-culprits" className="min-w-0">
      <LayoutCard
        title={t('vampireDrain.culprit.title', 'Vampire culprit')}
        actions={<DataProvenanceBadge provenance={parkState.provenance} status={parkState.status} />}
      >
        <Text as="p" variant="caption">
          {t('vampireDrain.culprit.subtitle', 'What to turn off tonight — Sentry, Cabin Overheat, precondition, plugged-Complete, or genuine leak. Not another 12 W tile.')}
        </Text>
        <SourceRecovery state={parkState} label={t('vampireDrain.modernization.parkSource', 'Confirmed Park evidence')} />
        <SourceRecovery state={splitState} label={t('vampireDrain.modernization.splitSource', 'Plugged and unplugged drain')} />
        {!vehicleId ? (
          <EmptyState
            message={t('vampireDrain.selectVehicle', 'Select a vehicle to view its vampire drain.')}
            actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
          />
        ) : loading ? (
          <Skeleton className="h-28" />
        ) : (
          <>
            <Text as="p" variant="bodySm">{t(ACTION[report.tonight].key, ACTION[report.tonight].fallback)}</Text>
            <BatteryEvidenceBrief title={t('vampireDrain.modernization.culpritSummary', 'Observed culprit evidence')} description={report.honesty} metrics={metrics} period={period}
              retained={(parkState.hasData && parkState.status !== 'ok') || (splitState.hasData && splitState.status !== 'ok')} />
            <div className="flex flex-wrap gap-2">
              <Badge variant={report.tonight === 'unknown' ? 'neutral' : 'warning'} size="sm">
                {t('vampireDrain.culprit.tonight', 'Tonight: {{id}}', { id: t(`vampireDrain.culprit.${report.tonight}`, report.tonight.replace(/_/g, ' ')) })}
              </Badge>
            </div>
            <Text as="p" variant="caption">{report.honesty}</Text>
          </>
        )}
      </LayoutCard>
    </div>
  );
}
