import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { GlassPanel, Logo, Text } from '@/components/ui';
import { ChartCard, LayoutCard, PageHeader } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import {
  ChartGradient, chartGrid, axisTick,
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { PublicSessionBrief } from '../components/operationalbrief-public';

import type { SharedSessionData } from '@/types/sharing';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  SharedSessionReport — public, chrome-less charging-session report  */
/* ------------------------------------------------------------------ */

/**
 * Renders a `charging_session` share payload. Mirrors SharedDrivePage's
 * structure (compact branded header → measurement brief → vehicle badge → curve
 * chart → footer) so both link kinds read as one product. All quantities
 * convert to display units at this render boundary.
 */
export function SharedSessionReport({ data }: { data: SharedSessionData }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy, formatPower } = useUnits();
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

        {/* Owner-shared measurements */}
        <FadeIn delay={0.05}>
          <PublicSessionBrief
            session={session}
            preferences={{ units: unitPrefs, currency: { kind: 'symbol', value: session.cost_currency ?? '' } }}
            formatEnergy={formatEnergy}
            formatPower={formatPower}
            fmtNumber={fmtNumber}
          />
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
