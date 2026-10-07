import {
  Activity,
  BatteryMedium,
  CalendarRange,
  Gauge,
  ShieldCheck,
  Sigma,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import {
  GlassPanel,
  PanelTitle,
  Select,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import {
  CAPACITY_PROCESS_NOISE_OPTIONS,
  CAPACITY_SOC_WINDOW_OPTIONS,
  type PackCapacityResult,
} from '../../lib/packCapacity';
import {
  packCapacityBandLabel,
  packCapacityFitLabel,
  packCapacityNumber,
  packCapacityPercent,
} from './labels';
import { PackCapacityQueryStatus } from './PackCapacityQueryStatus';
import type { PackCapacityQueryState } from './types';

interface PackCapacityKpiBandProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  formatEnergy: UnitFormatter;
  minSocWindowPct: number;
  processNoiseWhPerSqrtDay: number;
  onMinSocWindowChange: (value: number) => void;
  onProcessNoiseChange: (value: number) => void;
}

export function PackCapacityKpiBand({
  result,
  state,
  locale,
  formatEnergy,
  minSocWindowPct,
  processNoiseWhPerSqrtDay,
  onMinSocWindowChange,
  onProcessNoiseChange,
}: PackCapacityKpiBandProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t(
        'packCapacity.states.selectVehicleKpi',
        'Select a vehicle above to load charging evidence.',
      )
    : state.isLoading
      ? t(
          'packCapacity.states.loadingKpi',
          'Waiting for returned charging history...',
        )
      : state.error
        ? t(
            'packCapacity.states.errorKpi',
            'Charging history is unavailable; use the status below to retry.',
          )
        : !state.isResolved
          ? t(
              'packCapacity.states.pendingKpi',
              'Charging-history availability has not resolved.',
            )
          : null;
  const fit = result.summary.fit;
  const annualChange =
    fit.status === 'available' ? fit.annualChangeWh : null;

  return (
    <section
      data-testid="pack-capacity-kpis"
      aria-label={t(
        'packCapacity.kpis.aria',
        'Pack capacity charging evidence summary',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <BatteryMedium
                className="h-4 w-4 text-cyan-300"
                aria-hidden="true"
              />
              {t(
                'packCapacity.kpis.title',
                'Capacity evidence under filter assumptions',
              )}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'packCapacity.kpis.subtitle',
                'Implied full-pack energy from completed charging windows; not a battery-health, degradation, or remaining-life measurement.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              id="pack-capacity-soc-window"
              size="sm"
              className="min-w-40"
              label={t(
                'packCapacity.controls.socWindow',
                'Minimum SoC window',
              )}
              options={CAPACITY_SOC_WINDOW_OPTIONS.map((value) => ({
                value: String(value),
                label: t(
                  'packCapacity.controls.socWindowOption',
                  '{{value}} percentage points',
                  { value },
                ),
              }))}
              value={String(minSocWindowPct)}
              onChange={(event) =>
                onMinSocWindowChange(Number(event.target.value))
              }
            />
            <Select
              id="pack-capacity-process-noise"
              size="sm"
              className="min-w-44"
              label={t(
                'packCapacity.controls.processNoise',
                'Process uncertainty',
              )}
              options={CAPACITY_PROCESS_NOISE_OPTIONS.map((value) => ({
                value: String(value),
                label: t(
                  'packCapacity.controls.processNoiseOption',
                  '{{value}} Wh / square-root day',
                  { value },
                ),
              }))}
              value={String(processNoiseWhPerSqrtDay)}
              onChange={(event) =>
                onProcessNoiseChange(Number(event.target.value))
              }
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label={t('packCapacity.kpis.current', 'Current estimate')}
            value={
              resolved
                ? formatEnergy(result.summary.currentWh, { precision: 1 })
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'packCapacity.kpis.posterior',
                'latest filtered posterior',
              )
            }
            icon={<BatteryMedium className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t(
              'packCapacity.kpis.uncertainty',
              'Filter uncertainty',
            )}
            value={
              resolved && result.summary.currentSigmaWh != null
                ? `±${formatEnergy(result.summary.currentSigmaWh, {
                    precision: 1,
                  })}`
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'packCapacity.kpis.oneSigma',
                'one sigma under selected assumptions',
              )
            }
            icon={<Sigma className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t(
              'packCapacity.kpis.ratio',
              'Current / filtered maximum',
            )}
            value={
              resolved
                ? packCapacityPercent(
                    result.summary.currentToMaxRatio,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'packCapacity.kpis.ratioHint',
                'descriptive ratio, not state of health',
              )
            }
            icon={<Gauge className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('packCapacity.kpis.rawMedian', 'Raw median')}
            value={
              resolved
                ? formatEnergy(result.summary.rawMedianWh, {
                    precision: 1,
                  })
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'packCapacity.kpis.rawRange',
                'qualified unfiltered measurements',
              )
            }
            icon={<Activity className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t(
              'packCapacity.kpis.annualChange',
              'Annualized linear change',
            )}
            value={
              resolved && annualChange != null
                ? formatEnergy(annualChange, { precision: 1 })
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? packCapacityFitLabel(t, fit.status)
            }
            icon={<CalendarRange className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('packCapacity.kpis.support', 'Evidence support')}
            value={
              resolved
                ? `${packCapacityNumber(
                    result.coverage.support.index,
                    locale,
                    1,
                  )}/100`
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? packCapacityBandLabel(
                t,
                result.coverage.support.band,
              )
            }
            icon={<ShieldCheck className="h-5 w-5" />}
            color="red"
          />
        </div>
        <PackCapacityQueryStatus result={result} state={state} />
      </GlassPanel>
    </section>
  );
}
