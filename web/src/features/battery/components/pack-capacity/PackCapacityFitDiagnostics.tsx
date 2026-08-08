import { useMemo } from 'react';
import { TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartTooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import {
  convertEnergyFromSI,
  type EnergyUnitPref,
} from '@/lib/unitConversion';
import type { PackCapacityResult } from '../../lib/packCapacity';
import {
  packCapacityFitLabel,
  packCapacityNumber,
  packCapacityPercent,
} from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityFitDiagnosticsProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  energyUnit: EnergyUnitPref;
  formatEnergy: UnitFormatter;
}

const DAY_MS = 86_400_000;

export function PackCapacityFitDiagnostics({
  result,
  state,
  locale,
  energyUnit,
  formatEnergy,
}: PackCapacityFitDiagnosticsProps) {
  const { t } = useTranslation();
  const fit = result.summary.fit;
  const rows = useMemo(
    () =>
      result.timeline.map((point) => {
        const fittedWh =
          fit.status === 'available'
          && fit.interceptWh != null
          && fit.slopeWhPerDay != null
          && fit.originMs != null
            ? fit.interceptWh
              + fit.slopeWhPerDay
                * ((point.tsMs - fit.originMs) / DAY_MS)
            : null;
        return {
          date: new Intl.DateTimeFormat(locale, {
            month: 'short',
            year: '2-digit',
            timeZone: result.timeZone,
          }).format(new Date(point.tsMs)),
          filtered: convertEnergyFromSI(point.capacityWh, energyUnit),
          fit:
            fittedWh == null
              ? null
              : convertEnergyFromSI(fittedWh, energyUnit),
        };
      }),
    [
      energyUnit,
      fit.interceptWh,
      fit.originMs,
      fit.slopeWhPerDay,
      fit.status,
      locale,
      result.timeZone,
      result.timeline,
    ],
  );
  const resolved = state.isResolved && !state.error;

  return (
    <section data-testid="pack-capacity-fit-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <TrendingDown
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.fitDiagnostics.title',
            'Descriptive linear-fit diagnostics',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.fitDiagnostics.subtitle',
            'A gated least-squares description of filtered observations, not a degradation forecast or causal estimate.',
          )}
        </Text>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label={t('packCapacity.fitDiagnostics.status', 'Fit status')}
            value={resolved ? packCapacityFitLabel(t, fit.status) : '—'}
            subtitle={t(
              'packCapacity.fitDiagnostics.gates',
              '12 samples, 180 days, 6 active months',
            )}
            color="cyan"
          />
          <MetricCard
            label={t(
              'packCapacity.fitDiagnostics.annual',
              'Annualized change',
            )}
            value={
              resolved
                ? formatEnergy(fit.annualChangeWh, { precision: 1 })
                : '—'
            }
            subtitle={
              resolved
                ? packCapacityPercent(
                    fit.annualChangeShare,
                    locale,
                    2,
                  )
                : '—'
            }
            color="amber"
          />
          <MetricCard
            label={t('packCapacity.fitDiagnostics.r2', 'R-squared')}
            value={
              resolved
                ? packCapacityNumber(fit.rSquared, locale, 3)
                : '—'
            }
            subtitle={t(
              'packCapacity.fitDiagnostics.descriptive',
              'descriptive fit only',
            )}
            color="purple"
          />
          <MetricCard
            label={t(
              'packCapacity.fitDiagnostics.span',
              'Evidence span',
            )}
            value={
              resolved
                ? t(
                    'packCapacity.fitDiagnostics.daysValue',
                    '{{value}} days',
                    {
                      value: packCapacityNumber(
                        fit.spanDays,
                        locale,
                        0,
                      ),
                    },
                  )
                : '—'
            }
            subtitle={t(
              'packCapacity.fitDiagnostics.spanGate',
              'minimum 180 days',
            )}
            color="blue"
          />
          <MetricCard
            label={t(
              'packCapacity.fitDiagnostics.activeMonths',
              'Active months',
            )}
            value={
              resolved
                ? packCapacityNumber(fit.activeMonths, locale, 0)
                : '—'
            }
            subtitle={t(
              'packCapacity.fitDiagnostics.monthGate',
              'minimum 6 months',
            )}
            color="green"
          />
        </div>
        <AlertBanner className="mb-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'packCapacity.fitDiagnostics.notice',
              'Status: {{status}}. A displayed slope summarizes this returned window only and should not be extrapolated.',
              { status: packCapacityFitLabel(t, fit.status) },
            )}
          </Text>
        </AlertBanner>
        <PackCapacitySectionBody
          result={result}
          state={state}
          requirement="fit"
          className="h-72"
          skeletonHeight={288}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit={` ${energyUnit}`}
                width={72}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                dataKey="filtered"
                name={t(
                  'packCapacity.series.filtered',
                  'Filtered estimate',
                )}
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                dataKey="fit"
                name={t(
                  'packCapacity.series.linearFit',
                  'Descriptive linear fit',
                )}
                stroke="var(--chart-4)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </GlassPanel>
    </section>
  );
}
