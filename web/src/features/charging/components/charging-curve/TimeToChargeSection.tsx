import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import type { ChargingSession } from '@/api/types';

import { type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { isDcSession, availableAverage, crossesSocWindow, durationMinutes } from './helpers';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import type { TimeToChargeMetrics } from './types';
import YearlyTrendChart from './YearlyTrendChart';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface TimeToChargeSectionProps {
  sessions: ChargingSession[];
}

interface TtcCard {
  key: string;
  label: string;
  metricId: 'duration' | 'power';
  rawValue: number | null;
  subtitle?: string;
  icon: ReactNode;
}

export default function TimeToChargeSection({ sessions }: TimeToChargeSectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();

  const timeToCharge = useMemo((): TimeToChargeMetrics => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };
    const list = sessions ?? [];
    if (!list.length) return empty;

    const dcSessions = list.filter(isDcSession);
    if (!dcSessions.length) return empty;

    // Only sessions with a real, positive elapsed time can contribute a
    // duration to the SOC-window averages. A live/incomplete session that
    // already reports end_soc >= 80 (ended_at still null) otherwise folds a
    // spurious 0-minute reading in and drags the average toward zero.
    const crossedDurations = (predicate: (s: ChargingSession) => boolean): number[] =>
      dcSessions
        .filter(predicate)
        .map((s) => durationMinutes(s.started_at, s.ended_at))
        .filter((d) => d > 0);

    const d10to80 = crossedDurations((s) => crossesSocWindow(s, 10));
    const d20to80 = crossedDurations((s) => crossesSocWindow(s, 20));

    const avg10to80 = availableAverage(d10to80);
    const avg20to80 = availableAverage(d20to80);

    const withRate = dcSessions
      .filter((s) => durationMinutes(s.started_at, s.ended_at) > 0
        && Number.isFinite(s.total_energy_added_wh) && s.total_energy_added_wh > 0)
      .map((s) => ({
        id: s.id,
        rate: (convertEnergyFromSI(s.total_energy_added_wh, 'kWh') / durationMinutes(s.started_at, s.ended_at)) * 60,
      }));

    const fastest = withRate.length ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b)) : null;
    const slowest = withRate.length ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b)) : null;

    const byYear = new Map<string, { d10: number[]; d20: number[]; count: number }>();
    dcSessions.forEach((s) => {
      const year = (s.started_at ?? '').slice(0, 4);
      if (!/^\d{4}$/.test(year) || !Number.isFinite(Date.parse(s.started_at))) return;
      if (!byYear.has(year)) byYear.set(year, { d10: [], d20: [], count: 0 });
      const g = byYear.get(year)!;
      const dur = durationMinutes(s.started_at, s.ended_at);
      const qualifies10 = dur > 0 && crossesSocWindow(s, 10);
      const qualifies20 = dur > 0 && crossesSocWindow(s, 20);
      if (qualifies10) g.d10.push(dur);
      if (qualifies20) g.d20.push(dur);
      if (qualifies10 || qualifies20) g.count++;
    });

    const yearlyTrend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, { d10, d20, count }]) => {
        const avg10 = availableAverage(d10);
        const avg20 = availableAverage(d20);
        return {
          year,
          avg10to80: avg10 == null ? null : Math.round(avg10 * 10) / 10,
          avg20to80: avg20 == null ? null : Math.round(avg20 * 10) / 10,
          count,
        };
      });

    return { avg10to80, avg20to80, fastest, slowest, yearlyTrend };
  }, [sessions]);

  const cards = useMemo<TtcCard[]>(() => {
    return [
      {
        key: 'avg10to80',
        label: t('charging.curve.avg10to80', '10% → 80%'),
        metricId: 'duration',
        rawValue: timeToCharge.avg10to80 != null ? timeToCharge.avg10to80 * 60 : null,
        subtitle: t('charging.curve.avgDuration', 'Avg duration'),
        icon: <Timer className="h-5 w-5" aria-hidden="true" />,
      },
      {
        key: 'avg20to80',
        label: t('charging.curve.avg20to80', '20% → 80%'),
        metricId: 'duration',
        rawValue: timeToCharge.avg20to80 != null ? timeToCharge.avg20to80 * 60 : null,
        subtitle: t('charging.curve.avgDuration', 'Avg duration'),
        icon: <Clock className="h-5 w-5" aria-hidden="true" />,
      },
      {
        key: 'fastest',
        label: t('charging.curve.fastest', 'Fastest Session'),
        metricId: 'power',
        rawValue: timeToCharge.fastest ? timeToCharge.fastest.rate * 1000 : null,
        subtitle: timeToCharge.fastest
          ? t('charging.curve.sessionId', 'Session #{{id}}', { id: timeToCharge.fastest.id })
          : undefined,
        icon: <TrendingUp className="h-5 w-5" aria-hidden="true" />,
      },
      {
        key: 'slowest',
        label: t('charging.curve.slowest', 'Slowest Session'),
        metricId: 'power',
        rawValue: timeToCharge.slowest ? timeToCharge.slowest.rate * 1000 : null,
        subtitle: timeToCharge.slowest
          ? t('charging.curve.sessionId', 'Session #{{id}}', { id: timeToCharge.slowest.id })
          : undefined,
        icon: <TrendingDown className="h-5 w-5" aria-hidden="true" />,
      },
    ];
  }, [t, timeToCharge]);
  const metrics: StatMetric[] = cards.map(card => ({
    metricId: card.metricId, occurrenceId: card.key, rawValue: card.rawValue, label: card.label,
    display: { formatter: raw => ({
      value: fmtNumber(card.metricId === 'duration' ? raw / 60 : raw / 1000),
      unit: card.metricId === 'duration' ? 'min' : 'kWh/h',
    }) },
    context: <span className="inline-flex items-center gap-1">{card.icon}{card.subtitle}</span>,
  }));

  return (
    <div className="space-y-4">
      <ChargingSummaryBrief metrics={metrics}
        title={t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}
        description={t('charging.curve.timeToChargeDesc', 'How long DC sessions take to reach key SOC thresholds')}
        period={{ kind: 'unknown', label: t('charging.curve.modernization.returnedSessions', 'Returned sessions in the workspace range'),
          reason: t('charging.curve.brief.dcThresholdScope',
            'Completed DC sessions from the returned history only. Threshold means exclude unfinished sessions; fastest and slowest use recorded energy divided by positive elapsed time.') }} />

      <YearlyTrendChart yearlyTrend={timeToCharge.yearlyTrend} />
    </div>
  );
}
