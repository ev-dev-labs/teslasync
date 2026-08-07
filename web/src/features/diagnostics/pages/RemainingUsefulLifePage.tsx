import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HeartPulse, CalendarClock, TrendingDown, BatteryCharging, Battery,
  Circle, Disc, Wind, Gauge, type LucideIcon,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, StatusPill, SelectableCard } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricBar } from '@/components/data-display';
import {
  LinearGauge, ChartGradient, ChartTooltip, chartGrid, axisTick,
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useRUL, useComponentRUL, type ComponentRUL, type RULStatus } from '@/api/hooks/useRUL';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

const DASH = '—';

/* Chart colours — dynamic hex handed to Recharts (graphics, not text, so the
   brighter -400 shades are fine here; body text stays on toned -300 shades). */
const COLOR_CONFIDENCE = '#22d3ee'; // cyan-400
const COLOR_EOL = '#f43f5e'; // rose-500 — the end-of-life threshold marker

/* Per-status presentation. `dot` is a background class for the StatusPill's
   indicator; `text` is a toned-neon (-300) accent for the icon/label; `gauge`
   is the LinearGauge arc colour. */
interface StatusMeta {
  dot: string;
  text: string;
  gauge: string;
  key: string;
  fallback: string;
}
const STATUS_META: Record<RULStatus, StatusMeta> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-300', gauge: '#34d399', key: 'rul.status.healthy', fallback: 'Healthy' },
  watch: { dot: 'bg-amber-400', text: 'text-amber-300', gauge: '#fbbf24', key: 'rul.status.watch', fallback: 'Watch' },
  replace_soon: { dot: 'bg-rose-400', text: 'text-rose-300', gauge: '#fb7185', key: 'rul.status.replace_soon', fallback: 'Replace soon' },
  overdue: { dot: 'bg-red-500', text: 'text-red-300', gauge: '#f87171', key: 'rul.status.overdue', fallback: 'Overdue' },
};
function statusMeta(status: string): StatusMeta {
  return STATUS_META[status as RULStatus] ?? STATUS_META.healthy;
}

/* Component → icon. Falls back to a generic gauge for an unrecognised key. */
const COMPONENT_ICON: Record<string, LucideIcon> = {
  hv_battery: BatteryCharging,
  lv_battery: Battery,
  tires: Circle,
  brakes: Disc,
  cabin_filter: Wind,
};

export default function RemainingUsefulLifePage() {
  const { t } = useTranslation();
  usePageTitle(t('rul.title', 'Remaining Useful Life'));

  const { vehicleId } = useSelectedVehicle();
  const noVehicle = vehicleId === null;

  const boardQuery = useRUL(vehicleId);
  const { data: board, isLoading: boardLoading, error: boardError, refetch: refetchBoard } = boardQuery;

  const components = board?.components ?? [];
  const nextService = board?.next_service ?? null;

  /* Selected component drives the forecast panel. When the user hasn't picked
     one yet we default to the next-service component (most actionable), then
     the first card, so a forecast always renders once the board loads. */
  const [selected, setSelected] = useState<string | null>(null);
  const activeComponent = useMemo(
    () => selected ?? nextService?.component ?? components[0]?.component ?? null,
    [selected, nextService, components],
  );

  const detailQuery = useComponentRUL(vehicleId, activeComponent);
  const { data: detail, isLoading: detailLoading, error: detailError, refetch: refetchDetail } = detailQuery;

  const handleSelect = useCallback((component: string) => setSelected(component), []);
  const onRetryBoard = useCallback(() => { refetchBoard(); }, [refetchBoard]);
  const onRetryDetail = useCallback(() => { refetchDetail(); }, [refetchDetail]);

  /* ── null-safe display helpers ── */
  const remainingText = useCallback((c: ComponentRUL): string => {
    if (c.projected_eol_date != null) {
      if (c.remaining_days >= 365) {
        return `${fmtNumber(c.remaining_days / 365, 1)} ${t('rul.units.years', 'yr')}`;
      }
      return `${fmtInt(c.remaining_days)} ${t('rul.units.days', 'days')}`;
    }
    if (c.status === 'overdue') return t('rul.card.overdueNow', 'Overdue');
    return DASH; // indeterminate — not enough trend to project
  }, [t]);

  const kmText = useCallback((c: ComponentRUL): string => (
    c.remaining_km == null ? DASH : `${fmtInt(c.remaining_km)} ${t('rul.units.km', 'km')}`
  ), [t]);

  const confLabel = useCallback((conf: number): string => {
    if (conf >= 0.66) return t('rul.confidence.high', 'High');
    if (conf >= 0.33) return t('rul.confidence.medium', 'Medium');
    return t('rul.confidence.low', 'Low');
  }, [t]);

  const nextServiceLabel = useMemo(() => {
    if (!nextService) return null;
    const match = components.find((c) => c.component === nextService.component);
    return match?.label ?? nextService.component;
  }, [nextService, components]);

  /* ── forecast chart data: fold the projection band into a [low, high] tuple
     so a single Recharts range-Area shades the confidence interval. ── */
  const chartData = useMemo(
    () => (detail?.projection ?? []).map((p) => ({
      date: p.date,
      projected_health: p.projected_health,
      band: [p.confidence_low, p.confidence_high] as [number, number],
    })),
    [detail],
  );
  const eol = detail?.eol_threshold ?? null;
  const yMin = eol != null && eol > 0 ? Math.max(0, Math.floor(eol) - 10) : 0;
  const activeMeta = detail ? statusMeta(detail.status) : STATUS_META.healthy;

  const selectVehicleMsg = t('rul.selectVehicle', 'Select a vehicle to view its component prognostics.');

  return (
    <PageContainer
      title={t('rul.title', 'Remaining Useful Life')}
      subtitle={t('rul.subtitle', 'Predictive end-of-life forecasts for your wear components')}
      actions={<VehicleSelect />}
      query={boardQuery}
    >
      {/* ── 1. Next-service banner ─────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
            <div className="min-w-0">
              <Text as="p" variant="label">{t('rul.nextService.title', 'Next Service Due')}</Text>
              {noVehicle ? (
                <Text as="p" variant="body">{selectVehicleMsg}</Text>
              ) : boardLoading && !board ? (
                <Skeleton height={20} width="16rem" className="mt-1" />
              ) : boardError ? (
                <Text as="p" variant="body" className="text-rose-300">
                  {t('rul.nextService.error', 'Unable to load service projection.')}
                </Text>
              ) : nextService && nextService.date ? (
                <Text as="p" variant="body" weight="semibold">
                  <span className={statusMeta('replace_soon').text}>{nextServiceLabel}</span>
                  {' — '}
                  {t('rul.nextService.by', 'projected by')} {nextService.date}
                </Text>
              ) : (
                <Text as="p" variant="body" className="text-emerald-300">
                  {t('rul.nextService.none', 'No upcoming service projected — all components healthy.')}
                </Text>
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── 2. Component health board ──────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <section aria-label={t('rul.board.title', 'Component health')}>
          <PanelTitle className="mb-3 flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {t('rul.board.title', 'Component Health')}
          </PanelTitle>

          {noVehicle ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: selection-gated — a vehicle must be chosen first */
                icon={<Gauge className="h-8 w-8" />}
                message={selectVehicleMsg}
              />
            </GlassPanel>
          ) : boardLoading && !board ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={188} className="rounded-xl" />
              ))}
            </div>
          ) : boardError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={boardError} onRetry={onRetryBoard} />
            </GlassPanel>
          ) : components.length === 0 ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: transient — cards populate once telemetry is available */
                icon={<HeartPulse className="h-8 w-8" />}
                message={t('rul.board.empty', 'Component health will appear once telemetry is available.')}
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {components.map((c) => {
                const meta = statusMeta(c.status);
                const Icon = COMPONENT_ICON[c.component] ?? Gauge;
                const confPct = Math.round(c.confidence * 100);
                return (
                  <SelectableCard
                    key={c.component}
                    role="option"
                    selected={activeComponent === c.component}
                    onClick={() => handleSelect(c.component)}
                    aria-label={t('rul.card.aria', 'Show forecast for {{label}}', { label: c.label })}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={cn('h-4 w-4 shrink-0', meta.text)} aria-hidden="true" />
                        <Text as="span" variant="subhead" weight="semibold" className="truncate">
                          {c.label}
                        </Text>
                      </div>
                      <StatusPill color={meta.dot} pulse={c.status === 'overdue'}>
                        {t(meta.key, meta.fallback)}
                      </StatusPill>
                    </div>

                    <div className="flex items-center gap-4">
                      <LinearGauge
                        value={c.health_pct}
                        max={100}
                        unit="%"
                        label={t('rul.card.health', 'Health')}
                        color={meta.gauge}
                        size={104}
                        decimals={0}
                        className="w-32 shrink-0"
                      />
                      <dl className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Text as="dt" variant="caption">{t('rul.card.remaining', 'Remaining')}</Text>
                          <Text as="dd" variant="bodySm" weight="semibold" className="tabular-nums">
                            {remainingText(c)}
                          </Text>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Text as="dt" variant="caption">{t('rul.card.distanceLeft', 'Distance left')}</Text>
                          <Text as="dd" variant="bodySm" className="tabular-nums">{kmText(c)}</Text>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Text as="dt" variant="caption">{t('rul.card.replaceBy', 'Replace by')}</Text>
                          <Text as="dd" variant="bodySm" className="tabular-nums">
                            {c.projected_eol_date ?? DASH}
                          </Text>
                        </div>
                      </dl>
                    </div>

                    <MetricBar
                      value={confPct}
                      max={100}
                      color={COLOR_CONFIDENCE}
                      label={t('rul.card.confidence', 'Confidence')}
                      sublabel={`${confPct}% · ${confLabel(c.confidence)}`}
                    />
                  </SelectableCard>
                );
              })}
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── 3. Forecast — selected component's decline to EOL ───────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-1 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('rul.forecast.title', 'Health Forecast')}
            {detail ? <span className={cn('text-sm font-normal', activeMeta.text)}>· {detail.label}</span> : null}
          </PanelTitle>
          <Text as="p" variant="caption" className="mb-3">
            {t('rul.forecast.subtitle', 'Projected health decaying to the end-of-life threshold, with a confidence band.')}
          </Text>

          {noVehicle ? (
            <EmptyState /* no-action: selection-gated */
              icon={<TrendingDown className="h-8 w-8" />}
              message={selectVehicleMsg}
            />
          ) : !activeComponent ? (
            <EmptyState /* no-action: selection-gated — pick a card above */
              icon={<TrendingDown className="h-8 w-8" />}
              message={t('rul.forecast.select', 'Select a component above to see its forecast.')}
            />
          ) : detailLoading && !detail ? (
            <Skeleton height={340} className="rounded-xl" />
          ) : detailError ? (
            <QueryError error={detailError} onRetry={onRetryDetail} />
          ) : chartData.length === 0 ? (
            <EmptyState /* no-action: transient — forecast needs a projectable trend */
              icon={<TrendingDown className="h-8 w-8" />}
              message={t('rul.forecast.empty', 'No forecast available for this component yet.')}
            />
          ) : (
            <>
              <div
                role="img"
                aria-label={t('rul.forecast.aria', 'Area chart of projected component health declining to its end-of-life threshold, with a shaded confidence band')}
                className="h-72 sm:h-80"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                    <defs>
                      <ChartGradient id="rulBandGrad" color={activeMeta.gauge} opacity={0.25} />
                    </defs>
                    {chartGrid}
                    <XAxis
                      dataKey="date"
                      tick={axisTick}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      tickFormatter={(d: string) => (typeof d === 'string' ? d.slice(0, 7) : String(d))}
                    />
                    <YAxis
                      width={44}
                      domain={[yMin, 100]}
                      tick={axisTick}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => fmtInt(v)}
                    />
                    <Tooltip content={
                      <ChartTooltip
                        valueFormatter={(v) => (
                          Array.isArray(v)
                            ? `${fmtInt(v[0])}–${fmtInt(v[1])}%`
                            : `${fmtNumber(v as number, 1)}%`
                        )}
                      />
                    } />
                    {eol != null ? (
                      <ReferenceLine
                        y={eol}
                        stroke={COLOR_EOL}
                        strokeDasharray="4 3"
                        strokeOpacity={0.8}
                        label={{
                          value: t('rul.forecast.eol', 'End of life'),
                          position: 'insideTopRight',
                          fill: COLOR_EOL,
                          fontSize: 10,
                        }}
                      />
                    ) : null}
                    <Area
                      type="monotone"
                      dataKey="band"
                      stroke="none"
                      fill="url(#rulBandGrad)"
                      name={t('rul.forecast.band', 'Confidence band')}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="projected_health"
                      stroke={activeMeta.gauge}
                      strokeWidth={2}
                      dot={false}
                      name={t('rul.forecast.projected', 'Projected health')}
                      animationDuration={700}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {detail?.basis ? (
                <Text as="p" variant="caption" className="mt-3">
                  <span className="font-medium">{t('rul.forecast.basis', 'Basis')}:</span> {detail.basis}
                </Text>
              ) : null}
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
