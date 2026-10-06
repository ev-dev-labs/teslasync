import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Clock, Battery, Gauge, DollarSign, MapPin } from 'lucide-react';
import { GlassPanel, Logo, Text } from '@/components/ui';
import { ChartCard, Grid, LayoutCard, PageHeader } from '@/components/layout';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  ChartGradient, chartGrid, axisTick,
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';

import type { SharedSessionData } from '@/types/sharing';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  SharedSessionReport — public, chrome-less charging-session report  */
/* ------------------------------------------------------------------ */

/**
 * Renders a `charging_session` share payload. Mirrors SharedDrivePage's
 * structure (compact branded header → stat grid → vehicle badge → curve
 * chart → footer) so both link kinds read as one product. All quantities
 * convert to display units at this render boundary.
 */
export function SharedSessionReport({ data }: { data: SharedSessionData }) {
  const { fmtNumber } = useNumberFormatting();
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
      {/* Content */}
      <div className="w-full min-w-0 px-4 py-8 space-y-6">
        <div>
          <PageHeader
            title={data.title}
            icon={<Logo />}
            metadataActions={<Text variant="caption">{t('share.sessionHeader', 'Shared charging report')}</Text>}
            contextActions={
              <>
                <Text variant="caption">{session.date}</Text>
                {session.place && <Text variant="caption">{session.place}</Text>}
                {session.charger_type && <Text variant="caption">{session.charger_type}</Text>}
              </>
            }
          />
          {data.description && (
            <Text as="p" variant="bodySm" color="secondary">{data.description}</Text>
          )}
        </div>

        {/* Stats grid */}
        <FadeIn delay={0.05}>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            {session.energy_added_wh != null && (
              <StatCard
                label={t('share.energyAdded', 'Energy added')}
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
                label={t('share.peakPower', 'Peak power')}
                value={formatPower(session.peak_power_w)}
                icon={<Gauge className="h-4 w-4" />}
              />
            )}
            {socDelta != null && socDelta > 0 && session.energy_added_wh != null && (
              <StatCard
                label={t('share.efficiency', 'Efficiency')}
                value={`${fmtNumber(session.energy_added_wh / 1000 / (socDelta / 100))} kWh/%`}
                icon={<Zap className="h-4 w-4" />}
              />
            )}
            {session.cost != null && (
              <StatCard
                label={t('share.cost', 'Cost')}
                value={`${session.cost_currency ?? ''} ${fmtNumber(session.cost)}`.trim()}
                icon={<DollarSign className="h-4 w-4" />}
              />
            )}
          </Grid>
        </FadeIn>

        {/* Vehicle badge */}
        {data.vehicle && (
          <FadeIn delay={0.1}>
            <LayoutCard title={`Tesla ${data.vehicle.model}`}>
              <Text as="p" variant="caption">{data.vehicle.color}</Text>
            </LayoutCard>
          </FadeIn>
        )}

        {/* Charge curve */}
        {curveData.length > 0 && (
          <FadeIn delay={0.15}>
            {/* chart-a11y:no-table dense per-sample shared-session trace */}
            {/* chart-legend-audit:skip public share-link report has no URL state; power+SoC stay visible together */}
            <ChartCard
              size="standard"
              toolbar
              exportable
              title={t('share.curve', 'Charge curve')}
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
                    labelFormatter={(v: number) => `${fmtNumber(v)} min`}
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
            </ChartCard>
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
          <div className="mt-8 pt-4 border-t border-[var(--border-subtle)] text-center space-y-1">
            <Text as="p" variant="caption">{t('share.footer', 'Shared via TeslaSync — self-hosted Tesla fleet intelligence')}</Text>
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
