import { BatteryMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';

import type {
  RegenEfficiencyModel,
  RegenSocBucketKey,
} from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import { RegenSectionBody } from './RegenSectionBody';
import type { RegenSectionState } from './types';

interface StartingSocContextProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function StartingSocContext({
  model,
  state,
}: StartingSocContextProps) {
  const { t } = useTranslation();
  const bucketLabel = (key: RegenSocBucketKey): string => {
    switch (key) {
      case 'below40':
        return t('regen.soc.below40', 'Below 40%');
      case 'from40To60':
        return t('regen.soc.from40To60', '40% to under 60%');
      case 'from60To80':
        return t('regen.soc.from60To80', '60% to under 80%');
      case 'from80To90':
        return t('regen.soc.from80To90', '80% to under 90%');
      case 'from90':
        return t('regen.soc.from90', '90% and above');
    }
  };
  const contextRows = model.startingSocBuckets.reduce(
    (sum, bucket) => sum + bucket.returnedCount,
    0,
  );
  const unavailable =
    model.accounting.missingFields.startBatteryPct +
    model.accounting.invalidFields.startBatteryPct;

  return (
    <section
      aria-label={t('regen.soc.sectionAria', 'Starting-state-of-charge context')}
      data-testid="regen-soc"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <BatteryMedium className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('regen.soc.title', 'Starting-SoC context')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'regen.soc.subtitle',
            'Descriptive energy-weighted recovery among drives with a measured starting state of charge.',
          )}
        </Text>
        <RegenSectionBody
          className="mt-4"
          state={state}
          hasData={state.isResolved && contextRows > 0}
          emptyIcon={<BatteryMedium className="h-8 w-8" aria-hidden="true" />}
          emptyMessage={t(
            'regen.soc.empty',
            'No returned drives include usable starting-SoC context.',
          )}
        >
          <div className="space-y-3">
            {model.startingSocBuckets.map((bucket, index) => (
              <div
                key={bucket.key}
                className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"
              >
                <MetricBar
                  label={bucketLabel(bucket.key)}
                  value={bucket.energyWeightedRatioPct ?? 0}
                  max={100}
                  color={CHART_COLORS[(index + 1) % CHART_COLORS.length]}
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
                'regen.soc.unavailable',
                'Starting SoC unavailable or invalid for {{count}} of {{observed}} returned drives.',
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
