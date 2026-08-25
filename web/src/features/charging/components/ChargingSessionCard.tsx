import { useMemo } from 'react';
import {
  Clock, Zap, DollarSign, TrendingUp, Plug, Sun, AlertTriangle,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { Checkbox } from '@/components/ui/Checkbox';
import {
  HistoryListRow,
  ScoreBadge,
  RouteDisplay,
  BatteryDelta,
  InlineMetric,
  TimeStamp,
} from '@/components/data-display';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { fmtNumber, fmtWithUnit, fmtInt } from '@/lib/numberFormat';
import type { ChargingSession } from '@/api/types';
import { distanceAddedM } from './charging-curve/helpers';
import {
  durationMinutes,
  avgPowerW,
  costPerKwh,
  getChargerCategory,
  type ChargerCategory,
  type ChargingAnomaly,
} from '@/lib/chargingAggregation';
import { Icons } from '@/lib/icons';

export { getChargerCategory };
export { formatDurationMinutes as formatDuration };

interface ChargingSessionCardProps {
  session: ChargingSession;
  toDistanceDisplay: (meters: number) => number;
  distanceUnit: string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  onPreview?: (session: ChargingSession) => void;
  /** When set, render an inline `⚠ {message}` badge to mark this session
   *  as the one called out in the page-level anomaly summary. */
  anomaly?: ChargingAnomaly;
  /** Show density-aware variant. Compact hides metrics secondary lines. */
  density?: 'comfortable' | 'compact';
}

const ACCENT: Record<ChargerCategory, 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue'> = {
  home: 'green',
  supercharger: 'red',
  dc: 'amber',
  unknown: 'cyan',
};

export function ChargingSessionCard({
  session,
  toDistanceDisplay,
  distanceUnit,
  selected,
  onToggleSelect,
  onPreview,
  anomaly,
  density = 'comfortable',
}: ChargingSessionCardProps) {
  const { t } = useTranslation('charging');
  const { formatCurrency } = useFormatting();
  const cat = getChargerCategory(session.charger_type);
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
    unknown: t('chargerTypes.unknown', 'Charger'),
  };

  const durationMin = durationMinutes(session);
  // `durationMinutes` returns 0 for in-progress / malformed sessions, which
  // would otherwise render a misleading "0m". Show the universal placeholder
  // instead so an open session reads as unknown rather than zero-length.
  const durationLabel = durationMin > 0 ? formatDurationMinutes(durationMin) : '—';
  const avgRateKw = useMemo(() => {
    const w = avgPowerW(session);
    return w > 0 ? w / 1000 : null;
  }, [session]);
  const cpk = costPerKwh(session);
  const addedM = distanceAddedM(session);
  const rangeAddedDisplay = addedM != null ? toDistanceDisplay(addedM) : null;
  const energyKwh = (session.total_energy_added_wh ?? 0) / 1000;
  const isFree = session.cost_decimal == null || session.cost_decimal === 0;

  const showCheckbox = typeof onToggleSelect === 'function';

  // Battery-friendly score for the leading badge — derived per session
  // so each row's badge reflects whether the charge stayed in the
  // healthy 30→80 % sweet spot.
  const sessionScore = useMemo(() => {
    const start = session.start_soc_pct;
    const end = session.end_soc_pct;
    if (start == null || end == null) return null;
    let s = 50;
    if (start <= 30) s += 30;
    else if (start <= 50) s += 15;
    else if (start <= 70) s += 0;
    else s -= 10;
    if (end <= 80) s += 20;
    else if (end <= 90) s += 0;
    else if (end < 100) s -= 10;
    else s -= 25;
    return Math.max(0, Math.min(100, s));
  }, [session.start_soc_pct, session.end_soc_pct]);

  const checkbox = showCheckbox ? (
    <Checkbox
      checked={!!selected}
      onChange={(next) => onToggleSelect?.(session.id, next)}
      aria-label={t('selectSession', 'Select charging session')}
    />
  ) : undefined;

  const primary = (
    <>
      <TimeStamp value={session.started_at} className="text-sm font-semibold text-[var(--text-primary)]" />
      <span className="text-2xs text-[var(--text-muted)]">·</span>
      <span className="text-2xs text-[var(--text-muted)] tabular-nums">
        {durationLabel}
      </span>
      <Badge variant={cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'} size="sm">
        {chargerLabels[cat]}
      </Badge>
      {energyKwh > 0 && (
        <Badge variant="info" size="sm">{fmtWithUnit(energyKwh, 'kWh')}</Badge>
      )}
      {isFree && energyKwh > 0 && (
        <Badge variant="success" size="sm">
          <Sun className="h-3 w-3" aria-hidden /> {t('free', 'Free')}
        </Badge>
      )}
      {anomaly && (
        <Badge variant="danger" size="sm">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {anomaly.message}
        </Badge>
      )}
    </>
  );

  // Single endpoint — chargers don't move, so RouteDisplay's
  // explicit-single mode renders just `📍 location`.
  const route = (
    <RouteDisplay
      start={{
        address: session.start_place,
        lat: session.start_lat,
        lon: session.start_lng,
      }}
    />
  );

  const metrics = density === 'compact' ? null : (
    <>
      <BatteryDelta startPct={session.start_soc_pct} endPct={session.end_soc_pct} />
      {session.peak_power_w != null && (
        <InlineMetric
          icon={<TrendingUp className="h-3 w-3" aria-hidden />}
          value={t('metrics.peakPower', '{{value}} kW peak', {
            value: fmtNumber((session.peak_power_w ?? 0) / 1000),
          })}
        />
      )}
      {avgRateKw != null && (
        <InlineMetric
          icon={<Plug className="h-3 w-3" aria-hidden />}
          value={t('metrics.avgPower', '~{{value}} kW avg', { value: fmtNumber(avgRateKw) })}
        />
      )}
      {durationMin > 0 && (
        <InlineMetric
          icon={<Clock className="h-3 w-3" aria-hidden />}
          value={formatDurationMinutes(durationMin)}
        />
      )}
      {typeof session.cost_decimal === 'number' && session.cost_decimal > 0 && (
        <InlineMetric
          icon={<DollarSign className="h-3 w-3" aria-hidden />}
          value={formatCurrency(session.cost_decimal)}
          className="text-emerald-300"
        />
      )}
      {cpk != null && (
        <span className="text-[var(--text-muted)]">({formatCurrency(cpk, 2)}/kWh)</span>
      )}
      {typeof rangeAddedDisplay === 'number' && rangeAddedDisplay > 0 && (
        <span className="flex items-center gap-1 text-purple-300">
          <Zap className="h-3 w-3" aria-hidden /> +{fmtInt(rangeAddedDisplay)} {distanceUnit}
        </span>
      )}
    </>
  );

  return (
    <HistoryListRow
      checkbox={checkbox}
      leading={
        sessionScore != null ? (
          <ScoreBadge
            score={sessionScore}
            ariaLabel={t('scoreAria', 'Battery-friendly score: {{value}}', { value: sessionScore })}
          />
        ) : undefined
      }
      primary={primary}
      route={route}
      metrics={metrics}
      actions={
        onPreview
          ? [
              <Button
                key="preview"
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label={t('quickView', 'Quick view charging session')}
                title={t('quickView', 'Quick view charging session')}
                onClick={() => onPreview(session)}
              >
                <Icons.show className="h-4 w-4" aria-hidden="true" />
              </Button>,
            ]
          : undefined
      }
      href={`/charging/${session.id}`}
      selected={selected}
      glow={ACCENT[cat] === 'red' ? 'cyan' : 'green'}
    />
  );
}
