import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { fmtNumber } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { isDcSession, avg } from './helpers';
import type { TimeToChargeMetrics } from './types';
import YearlyTrendChart from './YearlyTrendChart';

function TimeToChargeCard({
  label,
  value,
  unit,
  subtitle,
}: {
  label: string;
  value: string | null;
  unit?: string;
  subtitle?: string;
}) {
  return (
    <GlassPanel className="p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">
        {value ?? '—'}
        {unit && value && <span className="ml-1 text-sm text-[var(--text-secondary)]">{unit}</span>}
      </p>
      {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
    </GlassPanel>
  );
}

interface TimeToChargeSectionProps {
  sessions: ChargingSession[];
}

export default function TimeToChargeSection({ sessions }: TimeToChargeSectionProps) {
  const { t } = useTranslation();

  const timeToCharge = useMemo((): TimeToChargeMetrics => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };
    if (!sessions.length) return empty;

    const dcSessions = sessions.filter(isDcSession);
    if (!dcSessions.length) return empty;

    const cross10to80 = dcSessions.filter(
      (s) => s.start_battery_pct <= 10 && (s.end_battery_pct ?? 0) >= 80,
    );
    const cross20to80 = dcSessions.filter(
      (s) => s.start_battery_pct <= 20 && (s.end_battery_pct ?? 0) >= 80,
    );

    const avg10to80 = cross10to80.length ? avg(cross10to80.map((s) => s.duration_min)) : null;
    const avg20to80 = cross20to80.length ? avg(cross20to80.map((s) => s.duration_min)) : null;

    const withRate = dcSessions
      .filter((s) => s.duration_min > 0 && s.energy_added_kwh > 0)
      .map((s) => ({
        id: s.id,
        rate: (s.energy_added_kwh / s.duration_min) * 60,
      }));

    const fastest = withRate.length
      ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b))
      : null;
    const slowest = withRate.length
      ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b))
      : null;

    const byYear = new Map<string, { d10: number[]; d20: number[]; count: number }>();
    dcSessions.forEach((s) => {
      const year = (s.start_ts ?? '').slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { d10: [], d20: [], count: 0 });
      const g = byYear.get(year)!;
      g.count++;
      if (s.start_battery_pct <= 10 && (s.end_battery_pct ?? 0) >= 80)
        g.d10.push(s.duration_min);
      if (s.start_battery_pct <= 20 && (s.end_battery_pct ?? 0) >= 80)
        g.d20.push(s.duration_min);
    });

    const yearlyTrend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, { d10, d20, count }]) => ({
        year,
        avg10to80: Math.round(avg(d10) * 10) / 10,
        avg20to80: Math.round(avg(d20) * 10) / 10,
        count,
      }));

    return { avg10to80, avg20to80, fastest, slowest, yearlyTrend };
  }, [sessions]);

  return (
    <FadeIn delay={0.25}>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">
          {t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t(
            'charging.curve.timeToChargeDesc',
            'How long DC sessions take to reach key SOC thresholds',
          )}
        </p>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <TimeToChargeCard
            label={t('charging.curve.avg10to80', '10% → 80%')}
            value={
              timeToCharge.avg10to80 != null ? fmtNumber(timeToCharge.avg10to80) : null
            }
            unit="min"
            subtitle={t('charging.curve.avgDuration', 'Avg duration')}
          />
          <TimeToChargeCard
            label={t('charging.curve.avg20to80', '20% → 80%')}
            value={
              timeToCharge.avg20to80 != null ? fmtNumber(timeToCharge.avg20to80) : null
            }
            unit="min"
            subtitle={t('charging.curve.avgDuration', 'Avg duration')}
          />
          <TimeToChargeCard
            label={t('charging.curve.fastest', 'Fastest Session')}
            value={
              timeToCharge.fastest
                ? fmtNumber(timeToCharge.fastest.rate)
                : null
            }
            unit="kWh/h"
            subtitle={
              timeToCharge.fastest
                ? t('charging.curve.sessionId', 'Session #{{id}}', {
                    id: timeToCharge.fastest.id,
                  })
                : undefined
            }
          />
          <TimeToChargeCard
            label={t('charging.curve.slowest', 'Slowest Session')}
            value={
              timeToCharge.slowest
                ? fmtNumber(timeToCharge.slowest.rate)
                : null
            }
            unit="kWh/h"
            subtitle={
              timeToCharge.slowest
                ? t('charging.curve.sessionId', 'Session #{{id}}', {
                    id: timeToCharge.slowest.id,
                  })
                : undefined
            }
          />
        </div>

        <YearlyTrendChart yearlyTrend={timeToCharge.yearlyTrend} />
      </div>
    </FadeIn>
  );
}
