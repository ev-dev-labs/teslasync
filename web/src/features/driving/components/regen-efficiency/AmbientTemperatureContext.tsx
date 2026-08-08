import { Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import type {
  RegenEfficiencyModel,
  RegenTemperatureBucketKey,
} from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import { RegenSectionBody } from './RegenSectionBody';
import type { RegenSectionState } from './types';

interface AmbientTemperatureContextProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function AmbientTemperatureContext({
  model,
  state,
}: AmbientTemperatureContextProps) {
  const { t } = useTranslation();
  const { formatTemperature } = useUnits();
  const bucketLabel = (key: RegenTemperatureBucketKey): string => {
    switch (key) {
      case 'below0':
        return t('regen.temperature.below', 'Below {{value}}', {
          value: formatTemperature(0, { precision: 0 }),
        });
      case 'from0To10':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(0, { precision: 0 }),
          high: formatTemperature(10, { precision: 0 }),
        });
      case 'from10To20':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(10, { precision: 0 }),
          high: formatTemperature(20, { precision: 0 }),
        });
      case 'from20To30':
        return t('regen.temperature.range', '{{low}} to under {{high}}', {
          low: formatTemperature(20, { precision: 0 }),
          high: formatTemperature(30, { precision: 0 }),
        });
      case 'from30':
        return t('regen.temperature.andAbove', '{{value}} and above', {
          value: formatTemperature(30, { precision: 0 }),
        });
    }
  };
  const contextRows = model.temperatureBuckets.reduce(
    (sum, bucket) => sum + bucket.returnedCount,
    0,
  );
  const unavailable =
    model.accounting.missingFields.outsideTempAvgC +
    model.accounting.invalidFields.outsideTempAvgC;

  return (
    <section
      aria-label={t(
        'regen.temperature.sectionAria',
        'Ambient-temperature recovery context',
      )}
      data-testid="regen-temperature"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('regen.temperature.title', 'Ambient-temperature context')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'regen.temperature.subtitle',
            'Descriptive energy-weighted recovery among drives with measured outside temperature.',
          )}
        </Text>
        <RegenSectionBody
          className="mt-4"
          state={state}
          hasData={state.isResolved && contextRows > 0}
          emptyIcon={<Thermometer className="h-8 w-8" aria-hidden="true" />}
          emptyMessage={t(
            'regen.temperature.empty',
            'No returned drives include usable ambient-temperature context.',
          )}
        >
          <div className="space-y-3">
            {model.temperatureBuckets.map((bucket, index) => (
              <div
                key={bucket.key}
                className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"
              >
                <MetricBar
                  label={bucketLabel(bucket.key)}
                  value={bucket.energyWeightedRatioPct ?? 0}
                  max={100}
                  color={CHART_COLORS[index % CHART_COLORS.length]}
                  sublabel={
                    bucket.energyWeightedRatioPct != null
                      ? fmtPercent(bucket.energyWeightedRatioPct, 1)
                      : '—'
                  }
                />
                <Text as="p" variant="caption" className="mt-2">
                  {t(
                    'regen.context.accounting',
                    '{{eligible}} eligible of {{returned}} returned drives',
                    {
                      eligible: fmtInt(bucket.eligibleCount),
                      returned: fmtInt(bucket.returnedCount),
                    },
                  )}
                </Text>
              </div>
            ))}
            <Text as="p" variant="caption">
              {t(
                'regen.temperature.unavailable',
                'Temperature unavailable or invalid for {{count}} of {{observed}} returned drives.',
                {
                  count: unavailable,
                  observed: model.accounting.observedCount,
                },
              )}
            </Text>
          </div>
        </RegenSectionBody>
        {state.isResolved ? (
          <DetailScopeNotice
            className="mt-3"
            capReached={model.accounting.historyCapReached}
            historyLimit={model.accounting.historyLimit}
          />
        ) : null}
      </GlassPanel>
    </section>
  );
}
