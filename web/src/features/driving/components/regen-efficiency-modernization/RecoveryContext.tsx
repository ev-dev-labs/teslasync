import { useTranslation } from 'react-i18next';
import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { LayoutCard } from '@/components/layout/layout-reference';
import { MetricLabel, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type {
  RegenEfficiencyModel,
  RegenSocBucketKey,
  RegenTemperatureBucketKey,
} from '../../lib/regenEfficiency';
import { DetailScopeNotice, RegenSectionBody, type RegenSectionState } from '../regen-efficiency';
import { isKnownNumber } from './presentation';

interface RecoveryContextProps {
  kind: 'temperature' | 'soc';
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

/** Same descriptive buckets and operands; only finite known ratios draw bars.
 * Temperature conversion stays here at the render boundary, including edges.
 */
export function RecoveryContext({ kind, model, state }: RecoveryContextProps) {
  const { t } = useTranslation();
  const { formatTemperature } = useUnits();
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const temperatureLabel = (key: RegenTemperatureBucketKey): string => {
    switch (key) {
      case 'below0':
        return t('regen.temperature.below', 'Below {{value}}', { value: formatTemperature(0) });
      case 'from0To10':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(0), high: formatTemperature(10),
        });
      case 'from10To20':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(10), high: formatTemperature(20),
        });
      case 'from20To30':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(20), high: formatTemperature(30),
        });
      case 'from30':
        return t('regen.temperature.andAbove', '{{value}} and above', { value: formatTemperature(30) });
    }
  };
  const socLabel = (key: RegenSocBucketKey): string => {
    switch (key) {
      case 'below40': return t('regen.soc.below40', 'Below 40%');
      case 'from40To60': return t('regen.soc.from40To60', '40% to under 60%');
      case 'from60To80': return t('regen.soc.from60To80', '60% to under 80%');
      case 'from80To90': return t('regen.soc.from80To90', '80% to under 90%');
      case 'from90': return t('regen.soc.from90', '90% and above');
    }
  };
  const rows = kind === 'temperature'
    ? model.temperatureBuckets.map((bucket, index) => ({
        ...bucket, label: temperatureLabel(bucket.key),
        color: CHART_COLORS[index % CHART_COLORS.length],
      }))
    : model.startingSocBuckets.map((bucket, index) => ({
        ...bucket, label: socLabel(bucket.key),
        color: CHART_COLORS[(index + 1) % CHART_COLORS.length],
      }));
  const contextRows = rows.reduce((sum, bucket) => sum + bucket.returnedCount, 0);
  const unavailable = kind === 'temperature'
    ? model.accounting.missingFields.outsideTempAvgC + model.accounting.invalidFields.outsideTempAvgC
    : model.accounting.missingFields.startBatteryPct + model.accounting.invalidFields.startBatteryPct;
  const title = kind === 'temperature'
    ? t('regen.temperature.title', 'Ambient-temperature context')
    : t('regen.soc.title', 'Starting-SoC context');
  const subtitle = kind === 'temperature'
    ? t('regen.temperature.subtitle', 'Descriptive energy-weighted recovery among drives with measured outside temperature.')
    : t('regen.soc.subtitle', 'Descriptive energy-weighted recovery among drives with a measured starting state of charge.');
  const ariaLabel = kind === 'temperature'
    ? t('regen.temperature.sectionAria', 'Ambient-temperature recovery context')
    : t('regen.soc.sectionAria', 'Starting-state-of-charge context');
  const emptyMessage = kind === 'temperature'
    ? t('regen.temperature.empty', 'No returned drives include usable ambient-temperature context.')
    : t('regen.soc.empty', 'No returned drives include usable starting-SoC context.');

  return (
    <section className="h-full min-w-0" data-testid={kind === 'temperature' ? 'regen-temperature' : 'regen-soc'} aria-label={ariaLabel}>
      <LayoutCard
        title={title}
        description={subtitle}
        footer={state.isResolved ? <DetailScopeNotice
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        /> : undefined}
      >
        <RegenSectionBody state={state} hasData={state.isResolved && contextRows > 0} emptyMessage={emptyMessage}>
          <div className="space-y-3">
            {rows.map(bucket => (
              <div key={bucket.key} className="min-w-0 rounded-xl border border-[var(--border-default)] p-3">
                {isKnownNumber(bucket.energyWeightedRatioPct) ? <MetricBar
                  label={bucket.label}
                  value={bucket.energyWeightedRatioPct}
                  max={100}
                  color={bucket.color}
                  sublabel={fmtPercent(bucket.energyWeightedRatioPct)}
                /> : (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <MetricLabel>{bucket.label}</MetricLabel>
                    <Text mono aria-label={t('regen.modernization.ratioUnavailable', 'Recovery share is unavailable; no zero value is inferred.')}>—</Text>
                  </div>
                )}
                <Text as="p" variant="caption" className="mt-2">
                  {t('regen.context.accounting', '{{eligible}} eligible of {{returned}} returned drives', {
                    eligible: fmtInt(bucket.eligibleCount), returned: fmtInt(bucket.returnedCount),
                  })}
                </Text>
              </div>
            ))}
            <Text as="p" variant="caption">
              {kind === 'temperature'
                ? t('regen.temperature.unavailable', 'Temperature unavailable or invalid for {{count}} of {{observed}} returned drives.', {
                    count: unavailable, observed: model.accounting.observedCount,
                  })
                : t('regen.soc.unavailable', 'Starting SoC unavailable or invalid for {{count}} of {{observed}} returned drives.', {
                    count: unavailable, observed: model.accounting.observedCount,
                  })}
            </Text>
          </div>
        </RegenSectionBody>
      </LayoutCard>
    </section>
  );
}
