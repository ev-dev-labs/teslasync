import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';
import {
  convertDurationFromSI,
  convertTempFromSI,
  type DurationUnitPref,
  type TemperatureUnitPref,
} from '@/lib/unitConversion';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import {
  buildSoakCurve,
  minutesToReach,
} from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalPredictionScenarioProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  temperatureUnit: TemperatureUnitPref;
  durationUnit: DurationUnitPref;
  formatTemperature: UnitFormatter;
  formatDuration: UnitFormatter;
}

export function CabinThermalPredictionScenario({
  summary,
  state,
  temperatureUnit,
  durationUnit,
  formatTemperature,
  formatDuration,
}: CabinThermalPredictionScenarioProps) {
  const { t } = useTranslation();
  const scenario = summary.coolingTauMin != null
    ? { direction: 'cooling' as const, startC: 45, ambientC: 22, targetC: 25, tauMin: summary.coolingTauMin }
    : summary.warmingTauMin != null
      ? { direction: 'warming' as const, startC: 5, ambientC: 22, targetC: 19, tauMin: summary.warmingTauMin }
      : null;
  const curve = useMemo(() => {
    if (scenario == null) return [];
    const horizonMin = Math.min(720, Math.max(240, Math.ceil(scenario.tauMin * 3)));
    return buildSoakCurve(
      scenario.startC,
      scenario.ambientC,
      scenario.tauMin,
      horizonMin,
      15,
    ).map((point) => ({
      elapsed: convertDurationFromSI(point.minutes * 60, durationUnit),
      cabin: convertTempFromSI(point.cabinC, temperatureUnit),
      ambient: convertTempFromSI(scenario.ambientC, temperatureUnit),
    }));
  }, [durationUnit, scenario, temperatureUnit]);
  const targetMinutes = scenario == null
    ? null
    : minutesToReach(
        scenario.startC,
        scenario.ambientC,
        scenario.tauMin,
        scenario.targetC,
      );

  return (
    <section data-testid="cabin-thermal-prediction">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.prediction.title', 'Accepted-fit worked scenario')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'cabinThermal.prediction.subtitle',
            'A transparent passive-soak calculation, rendered only from an accepted direction-specific τ; it is not measured future weather.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="accepted">
          {scenario != null ? (
            <>
              <Text as="p" variant="bodySm" className="mb-3">
                {t(
                  'cabinThermal.prediction.assumptions',
                  '{{direction}} scenario: {{start}} cabin, {{ambient}} ambient, accepted τ {{tau}}, target {{target}}, reached in {{time}}.',
                  {
                    direction: scenario.direction === 'cooling'
                      ? t('cabinThermal.direction.cooling', 'Cooling')
                      : t('cabinThermal.direction.warming', 'Warming'),
                    start: formatTemperature(scenario.startC, { precision: 0 }),
                    ambient: formatTemperature(scenario.ambientC, { precision: 0 }),
                    tau: formatDuration(scenario.tauMin * 60, { precision: 1 }),
                    target: formatTemperature(scenario.targetC, { precision: 0 }),
                    time: targetMinutes != null
                      ? formatDuration(targetMinutes * 60, { precision: 1 })
                      : t('cabinThermal.prediction.unreachable', 'not passively reachable'),
                  },
                )}
              </Text>
              <ChartContainer
                className="border-0 bg-transparent p-0 shadow-none"
                title={t('cabinThermal.prediction.plotTitle', 'Passive-soak curve')}
                ariaLabel={t(
                  'cabinThermal.prediction.aria',
                  'Line chart of the accepted-fit worked cabin scenario approaching ambient temperature',
                )}
                chartKey="cabin-thermal-prediction"
                height={220}
                data={curve}
                dataColumns={[
                  { key: 'elapsed', label: t('cabinThermal.prediction.elapsedUnit', 'Elapsed ({{unit}})', { unit: durationUnit }) },
                  { key: 'cabin', label: t('cabinThermal.prediction.cabinUnit', 'Cabin ({{unit}})', { unit: temperatureUnit }) },
                  { key: 'ambient', label: t('cabinThermal.prediction.ambientUnit', 'Ambient ({{unit}})', { unit: temperatureUnit }) },
                ]}
              >
                {({ hiddenSeries }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="elapsed" unit={` ${durationUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis unit={temperatureUnit} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Line type="monotone" dataKey="cabin" name={t('cabinThermal.prediction.cabin', 'Cabin')} stroke={chartTokens.series[0]} strokeWidth={2} dot={false} hide={hiddenSeries?.isHidden('cabin')} />
                    <Line type="monotone" dataKey="ambient" name={t('cabinThermal.prediction.ambient', 'Ambient')} stroke={chartTokens.series[2]} strokeDasharray="4 4" dot={false} hide={hiddenSeries?.isHidden('ambient')} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>
            </>
          ) : null}
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
