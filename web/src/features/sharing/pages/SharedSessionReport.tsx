import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Clock, Battery, Gauge, DollarSign, MapPin } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  ChartContainer, ChartGradient, chartGrid, axisTick,
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import Logo from '@/components/ui/Logo';
import { FadeIn } from '@/components/motion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import type { SharedSessionData } from '@/types/sharing';

/* ------------------------------------------------------------------ */
/*  SharedSessionReport — public, chrome-less charging-session report  */
/* ------------------------------------------------------------------ */

/**
 * Renders a `charging_session` share payload. Mirrors SharedDrivePage's
 * structure (branded header → title → stat grid → vehicle badge → curve
 * chart → footer) so both link kinds read as one product. All quantities
 * convert to display units at this render boundary.
 */
export function SharedSessionReport({ data }: { data: SharedSessionData }) {
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();
  const session = data.session;

  /* ---- Curve data: wire is already kW/kWh; x in minutes ---- */
  const curveData = useMemo(
    () =>
      (session.curve ?? []).map((p) => ({
        minutes: Math.round((p.t_s / 60) * 10) / 10,
        power: p.power_kw,
        soc: p.battery_pct,
      })),
    [session.curve],
  );

  const socDelta =
    session.start_soc_pct != null && session.end_soc_pct != null
      ? Math.round((session.end_soc_pct - session.start_soc_pct) * 10) / 10
      : null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="p-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[var(--text-muted)] text-sm">
            {t('share.sessionHeader', 'Shared Charging Report')}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <FadeIn>
          <div className="space-y-1">
            {/* a11y-landmark-ok: the "share link unavailable" heading lives
                in a mutually-exclusive early-return branch, so only one <h1>
                can ever be rendered. */}
            <h1
              className="text-2xl font-bold text-[var(--text-primary)] outline-none"
              tabIndex={-1}
              data-route-focus-target="true"
            >
              {data.title}
            </h1>
            {data.description && (
              <p className="text-[var(--text-secondary)]">{data.description}</p>
            )}
            <div className="flex items-center gap-3 text-sm text-[var(--text-muted)] mt-2">
              <span>{session.date}</span>
              {session.place && <span>{session.place}</span>}
              {session.charger_type && <span>{session.charger_type}</span>}
            </div>
          </div>
        </FadeIn>

        {/* Stats grid */}
        <FadeIn delay={0.05}>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            {session.energy_added_wh != null && (
              <StatCard
                label={t('share.energyAdded', 'Energy Added')}
                value={formatEnergy(session.energy_added_wh)}
                icon={<Zap className="h-4 w-4" />}
              />
            )}
            <StatCard
              label={t('share.duration', 'Duration')}
              value={formatDurationSecondsAsMinutes(session.duration_s)}
              icon={<Clock className="h-4 w-4" />}
            />
            {session.start_soc_pct != null && session.end_soc_pct != null && (
              <StatCard
                label={t('share.battery', 'Battery')}
                value={`${Math.round(session.start_soc_pct)}% → ${Math.round(session.end_soc_pct)}%`}
                icon={<Battery className="h-4 w-4" />}
              />
            )}
            {session.peak_power_w != null && (
              <StatCard
                label={t('share.peakPower', 'Peak Power')}
                value={formatPower(session.peak_power_w)}
                icon={<Gauge className="h-4 w-4" />}
              />
            )}
            {socDelta != null && socDelta > 0 && session.energy_added_wh != null && (
              <StatCard
                label={t('share.efficiency', 'Efficiency')}
                value={`${fmtNumber(session.energy_added_wh / 1000 / (socDelta / 100), 1)} kWh/%`}
                icon={<Zap className="h-4 w-4" />}
              />
            )}
            {session.cost != null && (
              <StatCard
                label={t('share.cost', 'Cost')}
                value={`${session.cost_currency ?? ''} ${fmtNumber(session.cost, 2)}`.trim()}
                icon={<DollarSign className="h-4 w-4" />}
              />
            )}
          </Grid>
        </FadeIn>

        {/* Vehicle badge */}
        {data.vehicle && (
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center">
                <Zap className="h-4 w-4 text-[var(--theme-primary)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Tesla {data.vehicle.model}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{data.vehicle.color}</p>
              </div>
            </GlassPanel>
          </FadeIn>
        )}

        {/* Charge curve */}
        {curveData.length > 0 && (
          <FadeIn delay={0.15}>
            {/* chart-a11y:no-table dense per-sample shared-session trace */}
            <ChartContainer
              title={t('share.curve', 'Charge Curve')}
              ariaLabel={t('share.curve.aria', 'Shared session power and battery chart by minute')}
              height={220}
            >
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={curveData}>
                  <defs>
                    <ChartGradient id="sharePowerGrad" color="var(--theme-primary)" />
                  </defs>
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="minutes"
                    {...axisTick}
                    tickFormatter={(v: number) => `${Math.round(v)} min`}
                  />
                  <YAxis
                    yAxisId="power"
                    {...axisTick}
                    tickFormatter={(v: number) => `${Math.round(v)} kW`}
                  />
                  <YAxis
                    yAxisId="soc"
                    orientation="right"
                    {...axisTick}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${Math.round(v)}%`}
                  />
                  <Tooltip
                    contentStyle={{ background: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: 8 }}
                    labelFormatter={(v: number) => `${fmtNumber(v, 1)} min`}
                  />
                  <Area
                    {...AREA_DEFAULTS}
                    yAxisId="power"
                    dataKey="power"
                    name={t('share.powerTooltipLabel', 'Power (kW)')}
                    stroke="var(--theme-primary)"
                    fill="url(#sharePowerGrad)"
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    yAxisId="soc"
                    type="monotone"
                    dataKey="soc"
                    name={t('share.socTooltipLabel', 'Battery (%)')}
                    stroke="#00f0ff"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>
        )}

        {/* No curve fallback */}
        {curveData.length === 0 && (
          <GlassPanel className="p-8">
            <EmptyState /* no-action: the owner shared a summary without the charge curve */
              icon={<MapPin className="h-8 w-8" />}
              message={t('share.noCurveData', 'The charge curve was not included in this share.')}
            />
          </GlassPanel>
        )}

        {/* Footer */}
        <FadeIn delay={0.25}>
          <div className="mt-8 pt-4 border-t border-[var(--border-subtle)] text-center text-[var(--text-muted)] text-xs space-y-1">
            <p>{t('share.footer', 'Shared via TeslaSync — Self-hosted Tesla Fleet Intelligence')}</p>
            <a
              href="https://github.com/ev-dev-labs/teslasync"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--theme-primary)]/60 hover:text-[var(--theme-primary)] transition-colors"
            >
              {t('share.learnMore', 'Learn more →')}
            </a>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
