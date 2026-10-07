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

/** All-zero buckets — the render-safe fallback before an analysis exists. */
const EMPTY_BUCKETS: GapBuckets = { total: 0, active: 0, aging: 0, stale: 0, never: 0 };

export function SignalGapKpis({ buckets, freshnessPct, hasVehicle }: SignalGapKpisProps) {
  const { t } = useTranslation();

  // Null-safe reads: the page always derives a real buckets object, but a
  // caller mid-load (or a stubbed test) can hand us `undefined`. Collapse to a
  // zeroed shape so the band renders '—'/0 instead of throwing on `.total`.
  const b = buckets ?? EMPTY_BUCKETS;
  const num = (n: number): string | number => (hasVehicle ? (n ?? 0) : '—');
  // Guard NaN/undefined so the freshness chip never shows "NaN%".
  const freshnessLabel = hasVehicle
    ? `${Number.isFinite(freshnessPct) ? freshnessPct : 0}%`
    : '—';

  return (
    <FadeIn>
      <section
        aria-label={t('signalGap.kpis', 'Signal health summary')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
      >
        <MetricCard
          label={t('signalGap.totalSignals', 'Total Signals')}
          value={num(b.total)}
          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.active', 'Active (<30s)')}
          value={num(b.active)}
          color="green"
          icon={<Radio className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.aging', 'Aging (<5min)')}
          value={num(b.aging)}
          color="amber"
          icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.stale', 'Stale (>5min)')}
          value={num(b.stale)}
          color="red"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.neverReceived', 'Never Received')}
          value={num(b.never)}
          icon={<WifiOff className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label={t('signalGap.freshness', 'Freshness')}
          value={freshnessLabel}
          color="cyan"
          icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
        />
      </section>
    </FadeIn>
  );
}
