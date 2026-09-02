import { useTranslation } from 'react-i18next';
import { ArrowLeftRight } from 'lucide-react';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { useGearTheater } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';

export function GearTheaterPanel({ driveId }: { driveId: string | undefined }) {
  const { t } = useTranslation();
  const query = useGearTheater(driveId);
  const state = useDataState(query, { provenance: 'historical' });
  const theater = state.data;

  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5" data-testid="gear-theater">
      <PanelTitle className="flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4 text-violet-300" aria-hidden="true" />
        {t('driveDetail.theater.title', 'Gear theater')}
      </PanelTitle>
      {state.status === 'initial' ? (
        <Skeleton className="h-24" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : theater ? (
        <>
          <Text as="p" variant="caption">{theater.honesty}</Text>
          {theater.events.length === 0 ? (
            <Text as="p" variant="caption">
              {t('driveDetail.theater.empty', 'No P/R/N/D or charge-port changes were recorded for this drive.')}
            </Text>
          ) : (
            <ol className="space-y-2">
              {theater.events.map((event) => (
                <li key={event.at} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[var(--text-muted)]">{formatDateTime(event.at)}</span>
                  {event.gear ? <Badge variant="neutral" size="sm">{event.gear}</Badge> : null}
                  {event.charge_port_latch ? (
                    <Badge variant="info" size="sm">{event.charge_port_latch}</Badge>
                  ) : null}
                  {event.charge_port_door_open != null ? (
                    <Badge variant="neutral" size="sm">
                      {event.charge_port_door_open
                        ? t('driveDetail.theater.portOpen', 'Port open')
                        : t('driveDetail.theater.portClosed', 'Port closed')}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </GlassPanel>
  );
}
