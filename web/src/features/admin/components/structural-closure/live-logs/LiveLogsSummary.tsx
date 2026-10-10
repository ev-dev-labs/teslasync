import { Activity, AlertTriangle, ArrowDownToLine, Database, Filter, ScrollText } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { LOG_STREAM_MAX_EVENTS } from '@/api/hooks/useLogStream';
import { LogConnectionBadge } from '../../continuation-admin-1/LogConnectionBadge';
import { LogConnectionCard } from '../../continuation-admin-1/LogConnectionCard';
import type { useLiveLogsPage } from '../../../hooks/useLiveLogsPage';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsSummary({ controller }: Props) {
  const { fmtInt, t, levelLabel, level, paused, enabled, stream, filteredEvents, statusColor } = controller;

  return (
<section
      aria-label={t('liveLogs.kpi.aria', 'Live stream metrics')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
    >
      <LogConnectionCard
        label={t('liveLogs.kpi.connection', 'Connection')}
        icon={<Activity className="h-4 w-4" aria-hidden />}
        color={statusColor}
      >
        <LogConnectionBadge
          isConnected={stream.isConnected}
          paused={paused}
          hasError={stream.error !== null}
          enabled={enabled}
        />
      </LogConnectionCard>
      <MetricCard
        label={t('liveLogs.kpi.visible', 'Visible')}
        value={fmtInt(filteredEvents.length)}
        icon={<ScrollText className="h-5 w-5" aria-hidden />}
        color="cyan"
        subtitle={t('liveLogs.kpi.visibleSub', 'After filters')}
      />
      <MetricCard
        label={t('liveLogs.kpi.buffered', 'Buffered')}
        value={fmtInt(stream.events.length)}
        icon={<Database className="h-5 w-5" aria-hidden />}
        color="blue"
        subtitle={t('liveLogs.kpi.capacity', {
          max: fmtInt(LOG_STREAM_MAX_EVENTS),
          defaultValue: '{{max}} max',
        })}
      />
      <MetricCard
        label={t('liveLogs.kpi.received', 'Received')}
        value={fmtInt(stream.totalReceived)}
        icon={<ArrowDownToLine className="h-5 w-5" aria-hidden />}
        color="green"
        subtitle={t('liveLogs.kpi.receivedSub', 'Since mount')}
      />
      <MetricCard
        label={t('liveLogs.kpi.drops', 'Server drops')}
        value={fmtInt(stream.drops)}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
        color={stream.drops > 0 ? 'red' : 'amber'}
        subtitle={t('liveLogs.kpi.dropsSub', 'Buffer overflow')}
      />
      <MetricCard
        label={t('liveLogs.kpi.minLevel', 'Min level')}
        value={levelLabel(level ?? 'info')}
        icon={<Filter className="h-5 w-5" aria-hidden />}
        color="purple"
        subtitle={t('liveLogs.kpi.minLevelSub', 'Server filter')}
      />
    </section>
  );
}
