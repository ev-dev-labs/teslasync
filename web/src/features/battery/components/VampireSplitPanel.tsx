import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';

import { Badge, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { useVampireSplit } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { VampireWindow } from '@/types/teslaPhysics';

export function VampireSplitPanel({ vehicleId }: { vehicleId: string | undefined }) {
  const { t } = useTranslation();
  const query = useVampireSplit(vehicleId);
  const state = useDataState(query, { provenance: 'historical' });
  const split = state.data;
  const rows = [...(split?.complete_plugged ?? []), ...(split?.unplugged ?? [])];

  const columns: Column<VampireWindow>[] = [
    {
      key: 'kind',
      header: t('vampireDrain.split.kind', 'Kind'),
      render: (row) => (
        <Badge variant={row.kind === 'complete_plugged' ? 'success' : 'neutral'} size="sm">
          {row.kind === 'complete_plugged'
            ? t('vampireDrain.split.complete', 'Complete, still plugged')
            : t('vampireDrain.split.unplugged', 'Unplugged')}
        </Badge>
      ),
    },
    { key: 'started_at', header: t('vampireDrain.split.started', 'Started'), render: (row) => formatDateTime(row.started_at) },
    {
      key: 'drain_pct',
      header: t('vampireDrain.split.drain', 'Drain'),
      render: (row) => (row.drain_pct == null ? '—' : `${fmtNumber(row.drain_pct, 2)}%`),
    },
  ];

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="vampire-split">
      <PanelTitle className="flex items-center gap-2">
        <Moon className="h-4 w-4 text-indigo-300" aria-hidden="true" />
        {t('vampireDrain.split.title', 'Complete-plugged vs unplugged drain')}
      </PanelTitle>
      {state.status === 'initial' ? (
        <Skeleton className="h-32" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : split ? (
        <>
          <Text as="p" variant="caption">{split.honesty}</Text>
          <Grid cols={{ default: 1, sm: 2 }} gap={4}>
            <MetricCard
              label={t('vampireDrain.split.completePct', 'At-limit plugged')}
              value={split.complete_plugged_drain_pct == null ? '—' : `${fmtNumber(split.complete_plugged_drain_pct, 2)}%`}
              color="amber"
            />
            <MetricCard
              label={t('vampireDrain.split.unpluggedPct', 'After unplug')}
              value={split.unplugged_drain_pct == null ? '—' : `${fmtNumber(split.unplugged_drain_pct, 2)}%`}
              color="purple"
            />
          </Grid>
          {rows.length > 0 && (
            <DataTable
              tableId="vampire-split"
              name="VampireSplit"
              columns={columns}
              data={rows}
              keyExtractor={(row) => `${row.kind}-${row.started_at}`}
              mobileColumns={['kind', 'drain_pct']}
            />
          )}
        </>
      ) : null}
    </GlassPanel>
  );
}
