import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Leaf, Zap, Fuel, Gauge, CalendarRange, Clock, TrendingDown, Sparkles, Sun, Factory,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricCard, DataFreshnessAuto } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect, RangePicker } from '@/components/forms';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, RadialGauge, ChartContainer, ChartTooltip, ChartGradient,
  chartGrid, axisTick,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import {
  useCarbonIntensity, useCarbonSummary, useCarbonRecommendation,
} from '@/api/hooks/useCarbon';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

/* Chart series colours — dynamic hex handed to Recharts. Emerald/teal palette:
   teal for the neutral grid curve, emerald for "green" (cleanest / savings),
   rose for the dirty peak, amber for the range-scoped "this period" metric. */
const COLOR_TEAL = '#2dd4bf';
const COLOR_GREEN = '#10b981';
const COLOR_DIRTY = '#f43f5e';
const COLOR_AMBER = '#f59e0b';

/* ── Formatting helpers (null-safe; the API models every figure as a plain
   number, but a disabled/in-flight query yields `undefined`). ── */
const pad2 = (n: number) => String(n).padStart(2, '0');
const hourLabel = (h: number) => `${pad2(h)}:00`;

function kg(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${fmtNumber(v, 1)} kg`;
}
function gPerKwh(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${fmtInt(v)} g/kWh`;
}

/** Gauge colour ramp: emerald → teal → amber → rose as timing worsens. */
function scoreColor(score: number): string {
  if (score >= 75) return COLOR_GREEN;
  if (score >= 50) return COLOR_TEAL;
  if (score >= 25) return COLOR_AMBER;
  return COLOR_DIRTY;
}

/* ── Component ── */

export default function CarbonIntelligencePage() {
  const { t } = useTranslation();
  usePageTitle(t('carbon.title', 'Carbon Intelligence'));

  const { vehicleId } = useSelectedVehicle();
  const { start, end, setRange } = useRangeState({
    persistKey: 'carbon.range',
    defaultPresetId: '90d',
  });

  // The shared 24-hour grid model (vehicle-independent).
  const intensityQuery = useCarbonIntensity();
  const {
    data: intensity, isLoading: intensityLoading, isError: intensityIsError,
    error: intensityErr, refetch: refetchIntensity,
  } = intensityQuery;

  // Lifetime footprint (no window) drives the score, hero totals and trend.
  const lifetimeQuery = useCarbonSummary(vehicleId);
  const {
    data: lifetime, isLoading: lifetimeLoading, isError: lifetimeIsError,
    error: lifetimeErr, refetch: refetchLifetime,
  } = lifetimeQuery;

  // Range-scoped footprint powers only the "this period" hero card.
  const { data: period } = useCarbonSummary(vehicleId, start, end);

  // Greenest-window recommendation.
  const recQuery = useCarbonRecommendation(vehicleId);
  const {
    data: rec, isLoading: recLoading, isError: recIsError,
    error: recErr, refetch: refetchRec,
  } = recQuery;

  const onRetryIntensity = useCallback(() => { void refetchIntensity(); }, [refetchIntensity]);
  const onRetryLifetime = useCallback(() => { void refetchLifetime(); }, [refetchLifetime]);
  const onRetryRec = useCallback(() => { void refetchRec(); }, [refetchRec]);

  // Sorted { hour, intensity } points for the area curve (numeric x-axis so the
  // greenest/dirtiest ReferenceLines land exactly on their hour).
  const intensityData = useMemo(
    () => [...(intensity?.curve ?? [])]
      .sort((a, b) => a.hour_of_day - b.hour_of_day)
      .map((h) => ({ hour: h.hour_of_day, intensity: h.g_co2_per_kwh })),
    [intensity],
  );
  const greenestHours = intensity?.greenest_hours ?? [];
  const dirtiestHours = intensity?.dirtiest_hours ?? [];

  const monthly = lifetime?.monthly ?? [];
  const noVehicle = vehicleId == null;
  const emptyMsg = noVehicle
    ? t('carbon.selectVehicle', 'Select a vehicle to see its carbon footprint.')
    : t('carbon.noData', 'No charging data yet — charge a session to see your CO₂ footprint.');

  const score = lifetime?.green_score ?? 0;
  const windowLabel = rec
    ? `${hourLabel(rec.greenest_window.start_hour)} – ${hourLabel(rec.greenest_window.end_hour)}`
    : '—';
  const hasSaving = (rec?.potential_saving_pct ?? 0) > 0.1;

  return (
    <PageContainer
      title={t('carbon.title', 'Carbon Intelligence')}
      subtitle={t('carbon.subtitle', 'Grid-aware CO₂ accounting for every charge — and when to charge greener')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            presetIds={['30d', '90d', '1y', 'all']}
            align="end"
            triggerTestId="carbon-range"
          />
          {/* Cagg-driven; force amber after 6h to surface stale aggregates. */}
          <DataFreshnessAuto query={lifetimeQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* 1 — KPI band: lifetime saved / total CO₂ / this-period CO₂ / gas-equiv */}
      <FadeIn>
        <section
          aria-label={t('carbon.kpis', 'Carbon summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {lifetimeIsError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={lifetimeErr} onRetry={onRetryLifetime} />
            </GlassPanel>
          ) : lifetimeLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={104} className="rounded-xl" />
            ))
          ) : lifetime ? (
            <>
              <MetricCard
                label={t('carbon.saved', 'CO₂ Saved vs Gas')}
                value={kg(lifetime.co2_saved_kg)}
                icon={<Leaf className="h-5 w-5" />}
                color="green"
                subtitle={t('carbon.savedSubtitle', 'Lifetime, vs an equivalent gas car')}
              />
              <MetricCard
                label={t('carbon.totalCo2', 'Charging CO₂')}
                value={kg(lifetime.total_co2_kg)}
                icon={<Zap className="h-5 w-5" />}
                color="cyan"
                subtitle={t('carbon.totalCo2Subtitle', '{{kwh}} kWh over {{n}} sessions', {
                  kwh: fmtNumber(lifetime.total_energy_kwh ?? 0, 0),
                  n: fmtInt(lifetime.sessions_scored ?? 0),
                })}
              />
              <MetricCard
                label={t('carbon.periodCo2', 'This Period CO₂')}
                value={kg(period?.total_co2_kg)}
                icon={<CalendarRange className="h-5 w-5" />}
                color="amber"
                subtitle={`${start} → ${end}`}
              />
              <MetricCard
                label={t('carbon.gasEquiv', 'Gas-Car Equivalent')}
                value={kg(lifetime.gas_equiv_co2_kg)}
                icon={<Fuel className="h-5 w-5" />}
                color="red"
                subtitle={t('carbon.gasEquivSubtitle', 'ICE baseline @ 0.192 kg CO₂/km')}
              />
            </>
          ) : (
            <GlassPanel className="col-span-full p-8">
              <EmptyState /* no-action: transient — no carbon figures until a vehicle + charging exist */
                icon={<Leaf className="h-10 w-10" />}
                message={emptyMsg}
              />
            </GlassPanel>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: green-timing score gauge (1) + 24h grid curve (2) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('carbon.greenScore', 'Green Charging Score')}
            </PanelTitle>
            {lifetimeIsError ? (
              <QueryError error={lifetimeErr} onRetry={onRetryLifetime} />
            ) : lifetimeLoading ? (
              <Skeleton height={220} className="rounded-xl" />
            ) : lifetime && (lifetime.sessions_scored ?? 0) > 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <RadialGauge
                  value={score}
                  max={100}
                  label={t('carbon.gaugeLabel', 'Green score')}
                  color={scoreColor(score)}
                  size={168}
                  decimals={0}
                />
                <div>
                  <Text as="p" weight="bold" className="text-emerald-300">
                    {score >= 75
                      ? t('carbon.score.excellent', 'Excellent timing')
                      : score >= 50
                        ? t('carbon.score.good', 'Good timing')
                        : score >= 25
                          ? t('carbon.score.fair', 'Room to improve')
                          : t('carbon.score.poor', 'Mostly peak-hour charging')}
                  </Text>
                  <Text as="p" variant="caption" className="mt-1">
                    {t('carbon.scoreHelp', '100 = you always charge at the greenest hour; 0 = the dirtiest.')}
                  </Text>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient — score needs at least one scored session */
                icon={<Gauge className="h-10 w-10" />}
                message={emptyMsg}
              />
            )}
          </GlassPanel>

          {/* chart-a11y:no-table diurnal grid model; greenest/dirtiest hours are
              restated as chips + the recommendation card below */}
          <ChartContainer
            title={t('carbon.curve.title', 'Grid Carbon Intensity by Hour')}
            subtitle={t('carbon.curve.subtitle', 'When the grid is cleanest to charge (gCO₂/kWh)')}
            ariaLabel={t('carbon.curve.aria', '24-hour grid carbon intensity area chart with greenest and peak hours marked')}
            exportable
            exportFilename="grid-carbon-intensity"
            height={340}
            className="xl:col-span-2"
          >
            {intensityIsError ? (
              <QueryError error={intensityErr} onRetry={onRetryIntensity} />
            ) : intensityLoading ? (
              <Skeleton height="100%" className="rounded-xl" />
            ) : intensityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={intensityData} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                  <defs>
                    <ChartGradient id="carbonIntensityGrad" color={COLOR_TEAL} opacity={0.4} />
                  </defs>
                  {chartGrid}
                  <XAxis
                    dataKey="hour"
                    type="number"
                    domain={[0, 23]}
                    ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
                    allowDecimals={false}
                    tickFormatter={(h: number) => hourLabel(h)}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    width={44}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => fmtInt(v)}
                  />
                  <Tooltip content={
                    <ChartTooltip
                      labelFormatter={(l) => hourLabel(Number(l))}
                      valueFormatter={(v) => gPerKwh(Number(v))}
                    />
                  } />
                  {greenestHours.map((h, i) => (
                    <ReferenceLine
                      key={`green-${h}`}
                      x={h}
                      stroke={COLOR_GREEN}
                      strokeDasharray="4 3"
                      strokeOpacity={0.75}
                      label={i === 0 ? {
                        value: t('carbon.curve.greenest', 'Greenest'),
                        position: 'insideTopLeft',
                        fill: COLOR_GREEN,
                        fontSize: 10,
                      } : undefined}
                    />
                  ))}
                  {dirtiestHours.map((h, i) => (
                    <ReferenceLine
                      key={`dirty-${h}`}
                      x={h}
                      stroke={COLOR_DIRTY}
                      strokeDasharray="4 3"
                      strokeOpacity={0.75}
                      label={i === 0 ? {
                        value: t('carbon.curve.peak', 'Peak'),
                        position: 'insideTopRight',
                        fill: COLOR_DIRTY,
                        fontSize: 10,
                      } : undefined}
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="intensity"
                    stroke={COLOR_TEAL}
                    fill="url(#carbonIntensityGrad)"
                    strokeWidth={2}
                    name={t('carbon.curve.series', 'Grid intensity')}
                    animationDuration={800}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient — grid model unavailable */
                message={t('carbon.curve.empty', 'Grid intensity model unavailable.')}
              />
            )}
          </ChartContainer>
        </section>
      </FadeIn>

      {/* 3 — Secondary bento: monthly CO₂ trend (2) + greenest-window card (1) */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* chart-a11y:no-table month-by-month rollup; totals are restated in the
              hero KPI band above */}
          <ChartContainer
            title={t('carbon.monthly.title', 'Monthly CO₂ Trend')}
            subtitle={t('carbon.monthly.subtitle', 'Attributed charging emissions per month (kg)')}
            ariaLabel={t('carbon.monthly.aria', 'Monthly attributed charging CO₂ bar chart')}
            exportable
            exportFilename="monthly-carbon"
            height={300}
            className="xl:col-span-2"
          >
            {lifetimeIsError ? (
              <QueryError error={lifetimeErr} onRetry={onRetryLifetime} />
            ) : lifetimeLoading ? (
              <Skeleton height="100%" className="rounded-xl" />
            ) : monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                  {chartGrid}
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis
                    width={44}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => fmtInt(v)}
                  />
                  <Tooltip content={
                    <ChartTooltip valueFormatter={(v) => kg(Number(v))} />
                  } />
                  <Bar
                    dataKey="co2_kg"
                    name={t('carbon.monthly.series', 'CO₂ emitted')}
                    fill={COLOR_GREEN}
                    radius={[6, 6, 0, 0]}
                    animationDuration={800}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient — no monthly rollups yet */
                message={emptyMsg}
              />
            )}
          </ChartContainer>

          {/* Greenest charging window recommendation */}
          <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('carbon.rec.title', 'Greenest Charging Window')}
            </PanelTitle>
            {recIsError ? (
              <QueryError error={recErr} onRetry={onRetryRec} />
            ) : recLoading ? (
              <Skeleton height={220} className="rounded-xl" />
            ) : rec && (rec.current_avg_intensity ?? 0) > 0 ? (
              <div className="flex flex-1 flex-col gap-3">
                <div className="rounded-xl border border-neon-green/20 bg-neon-green/10 p-4">
                  <Text as="p" variant="metricLabel" className="mb-1 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                    {t('carbon.rec.charge', 'Charge')}
                  </Text>
                  <Text as="p" size="xl" weight="bold" className="tabular-nums text-emerald-300">
                    {windowLabel}
                  </Text>
                  <Text as="p" variant="caption" className="mt-1">
                    {hasSaving
                      ? t('carbon.rec.cut', 'Cut ~{{pct}}% ({{kg}}) vs your current timing', {
                        pct: fmtNumber(rec.potential_saving_pct, 0),
                        kg: kg(rec.potential_co2_saving_kg),
                      })
                      : t('carbon.rec.already', "You're already charging in the greenest window — nice!")}
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <Text as="p" size="lg" weight="bold" className="tabular-nums text-rose-300">
                      {gPerKwh(rec.current_avg_intensity)}
                    </Text>
                    <Text as="p" variant="caption">{t('carbon.rec.current', 'Your avg intensity')}</Text>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <Text as="p" size="lg" weight="bold" className="tabular-nums text-emerald-300">
                      {gPerKwh(rec.greenest_window.avg_intensity)}
                    </Text>
                    <Text as="p" variant="caption">{t('carbon.rec.window', 'Window avg intensity')}</Text>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-2 pt-1">
                  <TrendingDown className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  <Text as="p" variant="caption">
                    {t('carbon.rec.footnote', 'Estimated over your observed charging energy.')}
                  </Text>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient — recommendation needs charging history */
                icon={<Sparkles className="h-10 w-10" />}
                message={emptyMsg}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Legend footnote: what the markers on the curve mean */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <Sun className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              <Text as="span" variant="caption">
                {t('carbon.legend.green', 'Greenest hours — cleanest grid, best time to charge')}
              </Text>
            </span>
            <span className="inline-flex items-center gap-2">
              <Factory className="h-4 w-4 text-rose-300" aria-hidden="true" />
              <Text as="span" variant="caption">
                {t('carbon.legend.peak', 'Peak hours — dirtiest grid, avoid if you can')}
              </Text>
            </span>
            <span className="inline-flex items-center gap-2">
              <Leaf className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              <Text as="span" variant="caption">
                {t('carbon.legend.model', 'Built-in diurnal grid model — no external API required')}
              </Text>
            </span>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
