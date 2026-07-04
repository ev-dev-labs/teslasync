import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import type { ChargingSession } from '@/api/types';
import { fmtNumber } from '@/lib/numberFormat';
import { SectionTitle, HelperText } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { isDcSession, avg, durationMinutes } from './helpers';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import type { NeonColor } from '@/lib/tokens';
import type { TimeToChargeMetrics } from './types';
import YearlyTrendChart from './YearlyTrendChart';

interface TimeToChargeSectionProps {
  sessions: ChargingSession[];
}

interface TtcCard {
  key: string;
  label: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
  color: NeonColor;
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
      (s) => s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80,
    );
    const cross20to80 = dcSessions.filter(
      (s) => s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80,
    );

    const avg10to80 = cross10to80.length ? avg(cross10to80.map((s) => durationMinutes(s.started_at, s.ended_at))) : null;
    const avg20to80 = cross20to80.length ? avg(cross20to80.map((s) => durationMinutes(s.started_at, s.ended_at))) : null;

    const withRate = dcSessions
      .filter((s) => durationMinutes(s.started_at, s.ended_at) > 0 && s.total_energy_added_wh > 0)
      .map((s) => ({
        id: s.id,
        rate: (convertEnergyFromSI(s.total_energy_added_wh, 'kWh') / durationMinutes(s.started_at, s.ended_at)) * 60,
      }));

    const fastest = withRate.length ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b)) : null;
    const slowest = withRate.length ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b)) : null;

    const byYear = new Map<string, { d10: number[]; d20: number[]; count: number }>();
    dcSessions.forEach((s) => {
      const year = (s.started_at ?? '').slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { d10: [], d20: [], count: 0 });
      const g = byYear.get(year)!;
      g.count++;
      if (s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80)
        g.d10.push(durationMinutes(s.started_at, s.ended_at));
      if (s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80)
        g.d20.push(durationMinutes(s.started_at, s.ended_at));
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

  const cards = useMemo<TtcCard[]>(() => {
    const dash = '—';
    return [
      {
        key: 'avg10to80',
        label: t('charging.curve.avg10to80', '10% → 80%'),
        value: timeToCharge.avg10to80 != null ? `${fmtNumber(timeToCharge.avg10to80)} min` : dash,
        subtitle: t('charging.curve.avgDuration', 'Avg duration'),
        icon: <Timer className="h-5 w-5" aria-hidden="true" />,
        color: 'cyan',
      },
      {
        key: 'avg20to80',
        label: t('charging.curve.avg20to80', '20% → 80%'),
        value: timeToCharge.avg20to80 != null ? `${fmtNumber(timeToCharge.avg20to80)} min` : dash,
        subtitle: t('charging.curve.avgDuration', 'Avg duration'),
        icon: <Clock className="h-5 w-5" aria-hidden="true" />,
        color: 'blue',
      },
      {
        key: 'fastest',
        label: t('charging.curve.fastest', 'Fastest Session'),
        value: timeToCharge.fastest ? `${fmtNumber(timeToCharge.fastest.rate)} kWh/h` : dash,
        subtitle: timeToCharge.fastest
          ? t('charging.curve.sessionId', 'Session #{{id}}', { id: timeToCharge.fastest.id })
          : undefined,
        icon: <TrendingUp className="h-5 w-5" aria-hidden="true" />,
        color: 'green',
      },
      {
        key: 'slowest',
        label: t('charging.curve.slowest', 'Slowest Session'),
        value: timeToCharge.slowest ? `${fmtNumber(timeToCharge.slowest.rate)} kWh/h` : dash,
        subtitle: timeToCharge.slowest
          ? t('charging.curve.sessionId', 'Session #{{id}}', { id: timeToCharge.slowest.id })
          : undefined,
        icon: <TrendingDown className="h-5 w-5" aria-hidden="true" />,
        color: 'amber',
      },
    ];
  }, [t, timeToCharge]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SectionTitle>{t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}</SectionTitle>
        <HelperText>
          {t(
            'charging.curve.timeToChargeDesc',
            'How long DC sessions take to reach key SOC thresholds',
          )}
        </HelperText>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <MetricCard
            key={c.key}
            label={c.label}
            value={c.value}
            subtitle={c.subtitle}
            icon={c.icon}
            color={c.color}
          />
        ))}
      </div>

      <YearlyTrendChart yearlyTrend={timeToCharge.yearlyTrend} />
    </div>
  );
}
