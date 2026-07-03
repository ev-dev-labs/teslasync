/**
 * SignalGapKpis — the full-width KPI band for the Signal Gap Detector.
 *
 * Six metric cards summarise the vehicle's live signal health: the total
 * catalog size, the three staleness buckets, the never-received count, and an
 * overall freshness score. Values collapse to "—" until a vehicle is chosen.
 */

import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Gauge, Radio, Timer, WifiOff } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';

import type { GapBuckets } from '../signalGapUtils';

interface SignalGapKpisProps {
  buckets: GapBuckets;
  freshnessPct: number;
  hasVehicle: boolean;
}

export function SignalGapKpis({ buckets, freshnessPct, hasVehicle }: SignalGapKpisProps) {
  const { t } = useTranslation();
  const num = (n: number): string | number => (hasVehicle ? n : '—');

  return (
    <FadeIn>
      <section
        aria-label={t('signalGap.kpis', 'Signal health summary')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
      >
        <MetricCard
          label={t('signalGap.totalSignals', 'Total Signals')}
          value={num(buckets.total)}
          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.active', 'Active (<30s)')}
          value={num(buckets.active)}
          color="green"
          icon={<Radio className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.aging', 'Aging (<5min)')}
          value={num(buckets.aging)}
          color="amber"
          icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.stale', 'Stale (>5min)')}
          value={num(buckets.stale)}
          color="red"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.neverReceived', 'Never Received')}
          value={num(buckets.never)}
          icon={<WifiOff className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.freshness', 'Freshness')}
          value={hasVehicle ? `${freshnessPct}%` : '—'}
          color="cyan"
          icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
        />
      </section>
    </FadeIn>
  );
}
