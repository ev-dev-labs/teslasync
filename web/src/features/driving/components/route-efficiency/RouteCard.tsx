import { useTranslation } from 'react-i18next';
import { MapPin, ArrowRight } from 'lucide-react';
import { GlassPanel, Badge, IconBox, Text, Caption } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { RouteSummary } from '@/types/driving';
import { efficiencyVariant, type UnitDisplay } from './helpers';
import { ROUTE_EFF_COLORS } from './constants';

interface RangeStatProps {
  label: string;
  value: number;
  unit: string;
  colorClass: string;
}

/** One labelled figure in the best/avg/worst readout under the range bar. */
function RangeStat({ label, value, unit, colorClass }: RangeStatProps) {
  return (
    <div className="min-w-0">
      <Caption className="block truncate">{label}</Caption>
      <Text as="p" size="sm" weight="semibold" className={cn('block', colorClass)}>
        <span className="tabular-nums">{fmtInt(value)}</span>{' '}
        <Text as="span" color="muted">{unit}</Text>
      </Text>
    </div>
  );
}

export interface RouteCardProps {
  route: RouteSummary;
  unit: UnitDisplay;
}

/**
 * Single most-driven route summary: endpoints, trip count, average distance,
 * an efficiency badge, and a best→avg→worst range bar with a labelled readout.
 * All colour is paired with text so status never relies on hue alone.
 */
export function RouteCard({ route, unit }: RouteCardProps) {
  const { t } = useTranslation();

  const start = route.startLocation ?? '—';
  const end = route.endLocation ?? '—';
  const trips = route.tripCount ?? 0;
  const avgDistance = unit.toDistance((route.avgDistanceKm ?? 0) * 1000);

  const avgEff = unit.toEfficiency(route.avgEfficiency);
  const bestEff = unit.toEfficiency(route.bestEfficiency);
  const worstEff = unit.toEfficiency(route.worstEfficiency);

  const denom = Math.max(worstEff, 1);
  const bestPct = Math.min((bestEff / denom) * 100, 100);
  const avgPct = Math.min((avgEff / denom) * 100, 100);
  const rangeGradient =
    `linear-gradient(to right, ${ROUTE_EFF_COLORS.best} 0%, ${ROUTE_EFF_COLORS.best} ${bestPct}%,` +
    ` ${ROUTE_EFF_COLORS.avg} ${bestPct}%, ${ROUTE_EFF_COLORS.avg} ${avgPct}%,` +
    ` ${ROUTE_EFF_COLORS.worst} ${avgPct}%, ${ROUTE_EFF_COLORS.worst} 100%)`;

  return (
    <GlassPanel hover glow="cyan" className="h-full p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <IconBox color="cyan" size="sm">
            <MapPin className="h-4 w-4" aria-hidden="true" />
          </IconBox>
          <div className="min-w-0">
            <Text
              as="h3"
              size="sm"
              weight="semibold"
              color="primary"
              className="flex items-center gap-1"
            >
              <span className="truncate">{start}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
              <span className="truncate">{end}</span>
            </Text>
            <Caption className="mt-0.5 block truncate">
              {fmtInt(trips)} {t('routeEfficiency.trips', 'trips')} · {fmtNumber(avgDistance)}{' '}
              {unit.distanceUnit} {t('routeEfficiency.avg', 'avg')}
            </Caption>
          </div>
        </div>
        <Badge variant={efficiencyVariant(route.avgEfficiency ?? 0)} className="shrink-0">
          {fmtInt(avgEff)} {unit.efficiencyUnit}
        </Badge>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full" style={{ background: rangeGradient }} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <RangeStat
          label={t('routeEfficiency.best', 'Best')}
          value={bestEff}
          unit={unit.efficiencyUnit}
          colorClass="text-emerald-300"
        />
        <RangeStat
          label={t('routeEfficiency.avgLabel', 'Avg')}
          value={avgEff}
          unit={unit.efficiencyUnit}
          colorClass="text-cyan-300"
        />
        <RangeStat
          label={t('routeEfficiency.worst', 'Worst')}
          value={worstEff}
          unit={unit.efficiencyUnit}
          colorClass="text-rose-300"
        />
      </div>
    </GlassPanel>
  );
}
