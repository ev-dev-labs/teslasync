/**
 * LiveMonitorKpiBand — full-width responsive metric strip for the Live Signal
 * Monitor. Summarises the live SSE firehose (connection, throughput, buffer
 * fill, and the type mix of the buffered signals) using OperationalBrief.
 *
 * All figures are derived from the live tail buffer owned by
 * `useLiveSignalStream` — nothing here fetches or fabricates data.
 */

import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface LiveMonitorKpiBandProps {
  connected: boolean;
  /** Signals per second (1 Hz averaged). */
  rate: number;
  /** Current buffered entry count. */
  bufferCount: number;
  /** Buffer capacity. */
  bufferMax: number;
  /** Distinct signal names in the buffer. */
  uniqueSignals: number;
  /** Count of numeric-typed entries in the buffer. */
  numericCount: number;
  /** Count of non-numeric (boolean + string) entries in the buffer. */
  categoricalCount: number;
  scope?: ReactNode;
}

export function LiveMonitorKpiBand({
  connected,
  rate,
  bufferCount,
  bufferMax,
  uniqueSignals,
  numericCount,
  categoricalCount,
  scope,
}: LiveMonitorKpiBandProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();

  const safeBufferCount = bufferCount ?? 0;
  const safeMax = bufferMax > 0 ? bufferMax : 1;
  // Buffer fill is semantically bounded to [0, 100]. Clamp both ends so a
  // malformed count (negative, NaN, or > capacity) can never surface a
  // nonsensical "-25%" / "137%" subtitle.
  const fillPct = Math.max(0, Math.min((safeBufferCount / safeMax) * 100, 100));
  const countDisplay = { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) };
  const metrics: readonly StatMetric[] = [
    { metricId: 'status', occurrenceId: 'connection',
      rawValue: connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected'),
      label: t('liveMonitor.connection', 'Connection'),
      description: t('telemetryBrief.sseConnection', 'SSE transport connection only; not a vehicle-health or signal-freshness verdict.') },
    { metricId: 'rate', occurrenceId: 'rate', rawValue: rate,
      label: t('liveMonitor.sigPerSec', 'Signals / sec'), display: countDisplay,
      description: t('telemetryBrief.sseRate', 'Signals per second from the live tail, averaged at 1 Hz; not an all-time ingestion rate.') },
    { metricId: 'count', occurrenceId: 'buffer', rawValue: bufferCount,
      label: t('liveMonitor.bufferSize', 'Buffer size'), display: countDisplay,
      description: `/ ${fmtInt(safeMax)} · ${fmtPercent(fillPct)}` },
    { metricId: 'count', occurrenceId: 'unique', rawValue: uniqueSignals,
      label: t('liveMonitor.uniqueSignals', 'Unique signals'), display: countDisplay,
      description: t('telemetryBrief.bufferScope', 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.') },
    { metricId: 'count', occurrenceId: 'numeric', rawValue: numericCount,
      label: t('liveMonitor.numeric', 'Numeric'), display: countDisplay,
      description: t('telemetryBrief.bufferScope', 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.') },
    { metricId: 'count', occurrenceId: 'categorical', rawValue: categoricalCount,
      label: t('liveMonitor.categorical', 'Categorical'), display: countDisplay,
      description: t('telemetryBrief.categorical', 'Boolean and string entries in the current buffer; not distinct catalog fields.') },
  ];

  return (
    <div className="min-w-0 max-w-full">
      <TelemetrySummaryBrief title={t('liveMonitor.kpis', 'Live stream summary')}
        metrics={metrics} testId="live-monitor-summary"
        statusLabel={connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}
        retained={!connected && safeBufferCount > 0}
        scope={scope ?? t('telemetryBrief.sseScope', 'Current SSE session · bounded tail buffer')}
        provenance={t('telemetryBrief.sseProvenance', 'Client SSE tail and locally sampled throughput')}
        description={t('telemetryBrief.bufferScope', 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.')} />
    </div>
  );
}
