/**
 * LiveMonitorKpiBand — full-width responsive metric strip for the Live Signal
 * Monitor. Summarises the live SSE firehose (connection, throughput, buffer
 * fill, and the type mix of the buffered signals) using shared MetricCards.
 *
 * All figures are derived from the live tail buffer owned by
 * `useLiveSignalStream` — nothing here fetches or fabricates data.
 */

import { useTranslation } from 'react-i18next';
import { Activity, Boxes, Fingerprint, Hash, Layers, Wifi, WifiOff } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

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
}

export function LiveMonitorKpiBand({
  connected,
  rate,
  bufferCount,
  bufferMax,
  uniqueSignals,
  numericCount,
  categoricalCount,
}: LiveMonitorKpiBandProps) {
  const { t } = useTranslation();

  const safeMax = bufferMax > 0 ? bufferMax : 1;
  const fillPct = Math.min((bufferCount / safeMax) * 100, 100);

  return (
    <section
      aria-label={t('liveMonitor.kpis', 'Live stream summary')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-6"
    >
      <MetricCard
        label={t('liveMonitor.connection', 'Connection')}
        value={
          connected
            ? t('liveMonitor.connected', 'Connected')
            : t('liveMonitor.disconnected', 'Disconnected')
        }
        color={connected ? 'green' : 'red'}
        icon={
          connected ? (
            <Wifi className="h-5 w-5" aria-hidden="true" />
          ) : (
            <WifiOff className="h-5 w-5" aria-hidden="true" />
          )
        }
      />
      <MetricCard
        label={t('liveMonitor.sigPerSec', 'Signals / sec')}
        value={fmtInt(rate ?? 0)}
        color="cyan"
        icon={<Activity className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('liveMonitor.bufferSize', 'Buffer Size')}
        value={fmtInt(bufferCount ?? 0)}
        subtitle={`/ ${fmtInt(safeMax)} · ${fmtPercent(fillPct, 0)}`}
        color="blue"
        icon={<Boxes className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('liveMonitor.uniqueSignals', 'Unique Signals')}
        value={fmtInt(uniqueSignals ?? 0)}
        color="purple"
        icon={<Fingerprint className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('liveMonitor.numeric', 'Numeric')}
        value={fmtInt(numericCount ?? 0)}
        color="cyan"
        icon={<Hash className="h-5 w-5" aria-hidden="true" />}
      />
      <MetricCard
        label={t('liveMonitor.categorical', 'Categorical')}
        value={fmtInt(categoricalCount ?? 0)}
        color="amber"
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
      />
    </section>
  );
}
