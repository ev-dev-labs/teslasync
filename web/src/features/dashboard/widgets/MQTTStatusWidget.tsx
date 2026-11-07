import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { HelperText } from '@/components/ui';
import { Sparkline } from '@/components/charts';
import { useMQTTStatus } from '@/api/hooks/useTelemetry';

import { deriveDataState } from '@/api/dataState';
import { deriveMqttStats } from '@/types/telemetry';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';

export { deriveMqttStats } from '@/types/telemetry';
export type { MqttWidgetStats } from '@/types/telemetry';

export default function MQTTStatusWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatRelative } = useDateFormat();
  const query = useMQTTStatus();
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = deriveDataState({ ...query, data: data ?? (isLoading || query.isError || query.error ? undefined : null) });

  const isCompact = size.cols <= 1;

  const stats = useMemo(() => deriveMqttStats(data?.vehicles), [data]);

  const connected = typeof data?.connected === 'boolean' ? data.connected : null;
  const statusLabel = connected == null ? t('widget.mqtt.unknown', 'Unknown')
      : connected ? t('widget.mqtt.online', 'Online') : t('widget.mqtt.offline', 'Offline');
  // Broker userinfo must not leak into either the reading or its tooltip.
  const broker = data?.broker?.replace(/(^|\/\/)[^/\s]*@/, '$1') || '—';
  const headline = (
    <WidgetBigNumber
      label={isCompact ? undefined : t('widget.mqtt.msgRate', 'Messages/sec')}
      value={stats.messagesPerSec == null ? null : fmtNumber(stats.messagesPerSec)}
      unit={t('widget.mqtt.msgSec', 'msg/s')}
      badge={{ text: statusLabel, variant: connected == null ? 'neutral' : connected ? 'success' : 'error' }}
    />
  );
  const messageCount = (
    <WidgetStatGrid
      stats={[{
        label: t('widget.mqtt.totalToday', 'Total messages'),
        value: stats.totalMessages == null ? null : fmtInt(stats.totalMessages),
      }]}
      cols={2}
      maxPerRow={2}
    />
  );
  const metadata = (
    <div className="mt-auto pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
      <KVList layout="responsive" wrap items={[
        {
          id: 'last-message',
          label: t('widget.mqtt.lastMessage', 'Last message'),
          value: stats.lastMessage ? formatRelative(stats.lastMessage) : '—',
        },
        {
          id: 'broker',
          label: t('widget.mqtt.broker', 'Broker'),
          value: <span title={broker}>{broker}</span>,
        },
      ]} />
    </div>
  );
  const empty = !data && (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Radio className="h-5 w-5" />}
      message={t('widget.mqtt.noData', 'No MQTT status data')}
      className="py-4"
    />
  );

  return (
    <WidgetShell
      title={t('widget.mqtt.title', 'MQTT status')}
      icon={<Radio className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={state}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <InstrumentPresentation
        family="line"
        compact={isCompact}
        headline={headline}
        icon={<Radio />}
        details={!isCompact && <div className="flex min-w-0 flex-col gap-3">{messageCount}{metadata}</div>}
        context={empty}
        instrument={!isCompact && (
          <div className="min-w-0 space-y-2">
            {data?.sessionSamples?.some(point => point.value != null) && <Sparkline
              samples={data.sessionSamples} width={360} height={80}
              ariaLabel={t('dashboardWidgets.system.mqtt.sessionTrend', 'Message rates fetched in this browser session')} />}
            <HelperText>
              {t('dashboardWidgets.system.mqtt.historyUnavailable', 'This source provides the current message rate, not a throughput history.')}
            </HelperText>
            {data?.sessionSamples?.length ? <HelperText>
              {t('dashboardWidgets.system.mqtt.sessionScope', 'Session samples use fetch times, not signal timestamps; missing rates are gaps.')}
            </HelperText> : null}
          </div>
        )}
      >
        {isCompact ? (
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            {headline}
          </div>
        ) : (
          <div className="flex flex-col gap-3 h-full">
            {headline}
            {messageCount}
            {metadata}
          </div>
        )}
        {empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
