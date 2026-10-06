import { useTranslation } from 'react-i18next';
import { Badge, DataTable, Text, type Column } from '@/components/ui';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useVampireSplit } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import type { VampireWindow } from '@/types/teslaPhysics';
import type { StatPeriod } from '@/lib/metric-reference';
import { SourceRecovery } from './SourceRecovery';

/** The original split source, ordering, identity and three table columns are retained. */
export function VampireSplitPanel({ vehicleId }: { vehicleId: string | undefined }) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const query = useVampireSplit(vehicleId);
  const state = useDataState(query, { provenance: 'historical' });
  const split = state.data;
  const rows = [...(split?.complete_plugged ?? []), ...(split?.unplugged ?? [])];
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('vampireDrain.modernization.splitPeriod', 'Returned parked windows'),
    reason: t('vampireDrain.modernization.splitBounds', 'Exact interval bounds are not supplied by this source.'),
  };
  const kindLabel = (row: VampireWindow) => row.kind === 'complete_plugged'
    ? t('vampireDrain.split.complete', 'Complete, still plugged')
    : t('vampireDrain.split.unplugged', 'Unplugged');
  const columns: Column<VampireWindow>[] = [
    {
      key: 'kind', header: t('vampireDrain.split.kind', 'Kind'),
      render: row => <Badge variant={row.kind === 'complete_plugged' ? 'success' : 'neutral'} size="sm">{kindLabel(row)}</Badge>,
    },
    { key: 'started_at', header: t('vampireDrain.split.started', 'Started'), render: row => formatDateTime(row.started_at) },
    { key: 'drain_pct', header: t('vampireDrain.split.drain', 'Drain'), render: row => row.drain_pct != null ? `${fmtNumber(row.drain_pct)}%` : '—' },
  ];
  return (
    <div data-testid="vampire-split" className="min-w-0">
      <LayoutCard title={t('vampireDrain.split.title', 'Complete-plugged vs unplugged drain')}>
        <SourceRecovery state={state} label={t('vampireDrain.modernization.splitSource', 'Plugged and unplugged drain')} />
        {!vehicleId ? (
          <EmptyState
            message={t('vampireDrain.selectVehicle', 'Select a vehicle to view its vampire drain.')}
            actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
          />
        ) : state.status === 'initial' ? (
          <Skeleton className="h-32" />
        ) : split ? (
          <>
            <Text as="p" variant="caption">{split.honesty}</Text>
            <BatteryEvidenceBrief title={t('vampireDrain.modernization.splitSummary', 'Observed drain split')} description={split.honesty} period={period} retained={state.status !== 'ok'} metrics={[
              { metricId: 'percent', occurrenceId: 'vampire-plugged', rawValue: split.complete_plugged_drain_pct, label: t('vampireDrain.split.completePct', 'At-limit plugged') },
              { metricId: 'percent', occurrenceId: 'vampire-unplugged', rawValue: split.unplugged_drain_pct, label: t('vampireDrain.split.unpluggedPct', 'After unplug') },
            ]} />
            <DataTable
              tableId="vampire-split"
              name="VampireSplit"
              caption={t('vampireDrain.split.title', 'Complete-plugged vs unplugged drain')}
              columns={columns}
              data={rows}
              keyExtractor={row => `${row.kind}-${row.started_at}`}
              mobilePresentation={{
                roles: { kind: 'meta', started_at: 'title', drain_pct: 'primary' },
                displayValue: (row, key) => key === 'kind' ? kindLabel(row)
                  : key === 'started_at' ? formatDateTime(row.started_at)
                  : row.drain_pct != null ? `${fmtNumber(row.drain_pct)}%` : '—',
                allDetails: row => [
                  { key: 'ended_at', label: t('vampireDrain.modernization.ended', 'Ended'), value: formatDateTime(row.ended_at) },
                  { key: 'duration_s', label: t('vampireDrain.columns.duration', 'Duration'), value: row.duration_s != null ? `${fmtNumber(row.duration_s / 3600)}h` : '—' },
                  { key: 'start_soc_pct', label: t('vampireDrain.columns.startPct', 'Start %'), value: row.start_soc_pct != null ? `${fmtNumber(row.start_soc_pct)}%` : '—' },
                  { key: 'end_soc_pct', label: t('vampireDrain.columns.endPct', 'End %'), value: row.end_soc_pct != null ? `${fmtNumber(row.end_soc_pct)}%` : '—' },
                  { key: 'park_confirmed', label: t('vampireDrain.modernization.parkConfirmed', 'Park confirmed'), value: row.park_confirmed == null ? '—' : row.park_confirmed ? t('common.yes', 'Yes') : t('common.no', 'No') },
                ],
              }}
              emptyMessage={t('vampireDrain.noEvents', 'No parked-drain sessions recorded in this window yet.')}
            />
          </>
        ) : (
          <EmptyState
            // no-action: source failures have a retry directly above; successful empty results need recorded parked windows.
            message={t('vampireDrain.modernization.splitMissing', 'No plugged or unplugged drain measurements are available.')}
          />
        )}
      </LayoutCard>
    </div>
  );
}
