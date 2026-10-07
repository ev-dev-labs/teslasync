import {
  Activity,
  BatteryCharging,
  Gauge,
  GitCompareArrows,
  Layers3,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import {
  GlassPanel,
  PanelTitle,
  Select,
  Text,
} from '@/components/ui';
import {
  CYCLE_DEPTH_THRESHOLDS,
  CYCLE_STRESS_EXPONENTS,
  type CycleStressResult,
} from '../../lib/cycleStress';
import {
  cycleStressBandLabel,
  cycleStressNumber,
  cycleStressPercent,
  cycleStressShare,
} from './labels';
import { CycleStressQueryStatus } from './CycleStressQueryStatus';
import type { CycleStressQueryState } from './types';

interface CycleStressKpiBandProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
  deepThresholdPct: number;
  exponent: number;
  onDeepThresholdChange: (value: number) => void;
  onExponentChange: (value: number) => void;
}

export function CycleStressKpiBand({
  result,
  state,
  locale,
  deepThresholdPct,
  exponent,
  onDeepThresholdChange,
  onExponentChange,
}: CycleStressKpiBandProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t(
        'cycleStress.states.selectVehicleKpi',
        'Select a vehicle above to load cycle evidence.',
      )
    : state.isLoading
      ? t(
          'cycleStress.states.loadingKpi',
          'Waiting for returned source histories...',
        )
      : state.error
        ? t(
            'cycleStress.states.errorKpi',
            'Source histories are unavailable; use the status below to retry.',
          )
        : !state.isResolved
          ? t(
              'cycleStress.states.pendingKpi',
              'Source availability has not resolved.',
            )
          : null;

  return (
    <section
      data-testid="cycle-stress-kpis"
      aria-label={t(
        'cycleStress.kpis.aria',
        'Reconstructed Cycle Stress evidence summary',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <Activity
                className="h-4 w-4 text-cyan-300"
                aria-hidden="true"
              />
              {t(
                'cycleStress.kpis.title',
                'Reconstructed cycle evidence',
              )}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'cycleStress.kpis.subtitle',
                'Descriptive rainflow ranges from continuity-bounded SoC endpoints; not a battery-health or remaining-life estimate.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              id="cycle-stress-threshold"
              size="sm"
              className="min-w-36"
              label={t(
                'cycleStress.controls.deepThreshold',
                'Deep-cycle lens',
              )}
              options={CYCLE_DEPTH_THRESHOLDS.map((value) => ({
                value: String(value),
                label: t(
                  'cycleStress.controls.thresholdOption',
                  '{{value}}% or deeper',
                  { value },
                ),
              }))}
              value={String(deepThresholdPct)}
              onChange={(event) =>
                onDeepThresholdChange(Number(event.target.value))
              }
            />
            <Select
              id="cycle-stress-exponent"
              size="sm"
              className="min-w-36"
              label={t(
                'cycleStress.controls.exponent',
                'Depth exponent',
              )}
              options={CYCLE_STRESS_EXPONENTS.map((value) => ({
                value: String(value),
                label: t(
                  'cycleStress.controls.exponentOption',
                  'Exponent {{value}}',
                  { value },
                ),
              }))}
              value={String(exponent)}
              onChange={(event) =>
                onExponentChange(Number(event.target.value))
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label={t('cycleStress.kpis.intervals', 'Accepted intervals')}
            value={
              resolved
                ? cycleStressNumber(
                    result.continuity.acceptedIntervals,
                    locale,
                    0,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'cycleStress.kpis.returned',
                '{{count}} total rows returned',
                {
                  count:
                    result.driveAccounting.returnedRows
                    + result.chargingAccounting.returnedRows,
                },
              )
            }
            icon={<Layers3 className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('cycleStress.kpis.efc', 'Equivalent full cycles')}
            value={
              resolved
                ? cycleStressNumber(
                    result.summary.equivalentFullCycles,
                    locale,
                    2,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'cycleStress.kpis.efcHint',
                'sum of count x depth fraction',
              )
            }
            icon={<BatteryCharging className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t(
              'cycleStress.kpis.depthIndex',
              'Depth-weighted index',
            )}
            value={
              resolved
                ? cycleStressNumber(
                    result.summary.depthWeightedIndex,
                    locale,
                    2,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'cycleStress.kpis.indexHint',
                'illustrative exponent {{value}}',
                { value: result.config.exponent },
              )
            }
            icon={<Gauge className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('cycleStress.kpis.medianDepth', 'Median depth')}
            value={
              resolved
                ? cycleStressPercent(
                    result.summary.medianDepthPct,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'cycleStress.kpis.weightedMedian',
                'cycle-count-weighted nearest rank',
              )
            }
            icon={<GitCompareArrows className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t(
              'cycleStress.kpis.deepShare',
              '{{value}}%+ cycle share',
              { value: deepThresholdPct },
            )}
            value={
              resolved
                ? cycleStressShare(
                    result.summary.deepCycleShare,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'cycleStress.kpis.descriptiveThreshold',
                'descriptive threshold sensitivity',
              )
            }
            icon={<Activity className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('cycleStress.kpis.support', 'Evidence support')}
            value={
              resolved
                ? `${cycleStressNumber(
                    result.coverage.support.index,
                    locale,
                    1,
                  )}/100`
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? cycleStressBandLabel(
                t,
                result.coverage.support.band,
              )
            }
            icon={<ShieldCheck className="h-5 w-5" />}
            color="red"
          />
        </div>
        <CycleStressQueryStatus result={result} state={state} />
      </GlassPanel>
    </section>
  );
}
