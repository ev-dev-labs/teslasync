import { useTranslation } from 'react-i18next';
import { ArrowLeftRight } from 'lucide-react';

import { Badge, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useGearTheater } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';

export function GearTheaterPanel({ driveId }: { driveId: string | undefined }) {
  const { t } = useTranslation();
  const query = useGearTheater(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const theater = state.data;
  const events = theater?.events ?? [];

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="gear-theater">
      <PanelTitle className="flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4 text-violet-300" aria-hidden="true" />
        {t('driveDetail.theater.title', 'Gear theater')}
      </PanelTitle>
      <StaleRefreshWarning state={state} label={t('driveDetail.theater.title', 'Gear theater')} />
      {state.status === 'initial' ? (
        <Skeleton className="h-24" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : theater ? (
        <>
          <Text as="p" variant="caption">{theater.honesty}</Text>
          {events.length === 0 ? (
            <Text as="p" variant="caption">
              {t('driveDetail.theater.empty', 'No P/R/N/D or charge-port changes were recorded for this drive.')}
            </Text>
          ) : (
            <DataTable
              variant="embedded"
              tableId="drive-detail:gear-events" name="drive-gear-events"
              data={events.map((event, index) => ({ ...event, index }))}
              keyExtractor={(event) => `${event.at}-${event.index}`}
              enableValueFilters
              columns={[
                { key: 'at', header: t('driveDetail.whyEnded.signal.cols.ts', 'Timestamp'), render: (event) => formatDateTime(event.at), visibleOnMobile: true },
                { key: 'gear', header: t('driveDetail.report.gear', 'Gear'), filterValue: (event) => event.gear ?? null, render: (event) => event.gear ? <Badge variant="neutral" size="sm">{event.gear}</Badge> : '—', visibleOnMobile: true },
                { key: 'latch', header: t('driveDetail.report.latch', 'Charge-port latch'), filterValue: (event) => event.charge_port_latch ?? null, render: (event) => event.charge_port_latch ?? '—', visibleOnMobile: true },
                { key: 'door', header: t('driveDetail.report.port', 'Charge port'), filterValue: (event) => event.charge_port_door_open ?? null, filterValueLabel: (raw) => raw == null ? '—' : raw ? t('driveDetail.theater.portOpen', 'Port open') : t('driveDetail.theater.portClosed', 'Port closed'), render: (event) => event.charge_port_door_open == null ? '—' : event.charge_port_door_open ? t('driveDetail.theater.portOpen', 'Port open') : t('driveDetail.theater.portClosed', 'Port closed'), visibleOnMobile: true },
              ]}
              pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
            />
          )}
        </>
      ) : (
        // no-action: An absence of recorded transitions is historical evidence, not an editable list.
        <EmptyState message={t('driveDetail.theater.empty', 'No P/R/N/D or charge-port changes were recorded for this drive.')} />
      )}
    </GlassPanel>
  );
}
