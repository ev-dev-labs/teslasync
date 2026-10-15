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
import { deriveVampireCulprits } from '../../lib/vampireCulprits';
import { SourceRecovery } from './SourceRecovery';

export function VampireCulpritPanel({ vehicleId }: { vehicleId: string | undefined }) {
  const { t } = useTranslation();
  const parkQuery = useParkTruth(vehicleId);
  const splitQuery = useVampireSplit(vehicleId);
  const parkState = useDataState(parkQuery, { provenance: 'live' });
  const splitState = useDataState(splitQuery, { provenance: 'historical' });
  const report = deriveVampireCulprits(parkState.data, splitState.data);
  const limitation = t('vampireDrain.observed.causeLimit',
    'Cause unconfirmed. Current Park truth is independent of historical SOC-loss windows; correlation does not establish a cause or a residual after Sentry/HVAC.');
  const description = [parkState.data?.honesty, splitState.data?.honesty, limitation].filter(Boolean).join(' ');
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
    label: row.id === 'unplugged_leak'
      ? t('vampireDrain.observed.unpluggedSocLoss', 'Observed unplugged SOC loss')
      : t(`vampireDrain.culprit.${row.id}`, row.id.replace(/_/g, ' ')),
    missingReason: t('vampireDrain.modernization.evidenceMissing', 'No confirmed measurement supplied by this source.'),
    context: row.evidence === 'missing'
      ? t('vampireDrain.modernization.evidenceMissing', 'No confirmed measurement supplied by this source.')
      : row.drainPct != null
        ? t('vampireDrain.modernization.historicalEvidence', 'Historical parked-window measurement')
        : t('vampireDrain.observed.currentParkTruth', 'Current Park truth; not historical cause attribution'),
  }));
  return (
    <div data-testid="vampire-culprits" className="min-w-0">
      <LayoutCard
        title={t('vampireDrain.observed.title', 'Observed parked SOC loss')}
        actions={<DataProvenanceBadge provenance={parkState.provenance} status={parkState.status} />}
      >
        <Text as="p" variant="caption">
          {limitation}
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
            <BatteryEvidenceBrief title={t('vampireDrain.observed.summary', 'Independent Park and historical SOC-loss evidence')} description={description} metrics={metrics} period={period}
              retained={(parkState.hasData && parkState.status !== 'ok') || (splitState.hasData && splitState.status !== 'ok')} />
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral" size="sm">
                {t('vampireDrain.observed.causeUnconfirmed', 'Cause unconfirmed')}
              </Badge>
            </div>
          </>
        )}
      </LayoutCard>
    </div>
  );
}
