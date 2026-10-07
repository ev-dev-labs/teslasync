import {
  BatteryMedium,
  CalendarClock,
  Database,
  Gauge,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { GlassPanel, PanelTitle, Select } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import {
  RANGE_BUFFER_THRESHOLDS,
  type RangeBufferResult,
} from '../../lib/rangeBuffer';
import {
  rangeBufferBandLabel,
  rangeBufferNumber,
  rangeBufferPercent,
  rangeBufferShare,
} from './labels';
import { RangeBufferQueryStatus } from './RangeBufferQueryStatus';
import type { RangeBufferQueryState } from './types';

interface RangeBufferKpiBandProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
  thresholdPct: number;
  onThresholdChange: (thresholdPct: number) => void;
}

export function RangeBufferKpiBand({
  result,
  state,
  locale,
  thresholdPct,
  onThresholdChange,
}: RangeBufferKpiBandProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t(
        'rangeBuffer.states.selectVehicleKpi',
        'Select a vehicle above to load arrival evidence.',
      )
    : state.isLoading
      ? t(
          'rangeBuffer.states.loadingKpi',
          'Waiting for returned drive history...',
        )
      : state.error
        ? t(
            'rangeBuffer.states.errorKpi',
            'Drive history is unavailable; use the status below to retry.',
          )
        : !state.isResolved
          ? t(
              'rangeBuffer.states.pendingKpi',
              'Drive-history availability has not resolved.',
            )
          : null;
  const thresholdOptions = RANGE_BUFFER_THRESHOLDS.map((value) => ({
    value: String(value),
    label: t(
      'rangeBuffer.threshold.option',
      'Below {{value}}%',
      { value },
    ),
  }));

  return (
    <section
      data-testid="range-buffer-kpis"
      aria-label={t(
        'rangeBuffer.kpis.aria',
        'Observed arrival buffer evidence summary',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <Gauge
                className="h-4 w-4 text-cyan-300"
                aria-hidden="true"
              />
              {t(
                'rangeBuffer.kpis.title',
                'Observed arrival-buffer evidence',
              )}
            </PanelTitle>
          </div>
          <Select
            id="range-buffer-threshold"
            size="sm"
            className="min-w-36"
            label={t(
              'rangeBuffer.threshold.label',
              'Planning threshold',
            )}
            aria-label={t(
              'rangeBuffer.threshold.aria',
              'Arrival battery planning threshold',
            )}
            options={thresholdOptions}
            value={String(thresholdPct)}
            onChange={(event) =>
              onThresholdChange(Number(event.target.value))
            }
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label={t('rangeBuffer.kpis.included', 'Included arrivals')}
            value={
              resolved ? fmtInt(result.accounting.includedRows) : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'rangeBuffer.kpis.returned',
                '{{count}} rows returned',
                { count: result.accounting.returnedRows },
              )
            }
            icon={<Database className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('rangeBuffer.kpis.median', 'Median arrival')}
            value={
              resolved
                ? rangeBufferPercent(
                    result.summary.medianPct,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'rangeBuffer.kpis.driveWeighted',
                'drive-weighted observed p50',
              )
            }
            icon={<BatteryMedium className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('rangeBuffer.kpis.p10', 'Observed p10 arrival')}
            value={
              resolved
                ? rangeBufferPercent(result.summary.p10Pct, locale)
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'rangeBuffer.kpis.downside',
                'lower-tail historical percentile',
              )
            }
            icon={<TriangleAlert className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t(
              'rangeBuffer.kpis.below',
              'Below {{value}}%',
              { value: thresholdPct },
            )}
            value={
              resolved
                ? rangeBufferShare(
                    result.summary.belowThresholdShare,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'rangeBuffer.kpis.belowCount',
                '{{count}} included arrivals',
                { count: result.summary.belowThresholdCount },
              )
            }
            icon={<TriangleAlert className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('rangeBuffer.kpis.latest', 'Latest arrival')}
            value={
              resolved
                ? rangeBufferPercent(
                    result.summary.latestArrivalPct,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? t(
                'rangeBuffer.kpis.latestHint',
                'newest included completion',
              )
            }
            icon={<CalendarClock className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('rangeBuffer.kpis.support', 'Evidence support')}
            value={
              resolved
                ? `${rangeBufferNumber(result.coverage.support.index, locale, 1)}/100`
                : '—'
            }
            subtitle={
              unresolvedSubtitle
              ?? rangeBufferBandLabel(
                t,
                result.coverage.support.band,
              )
            }
            icon={<ShieldCheck className="h-5 w-5" />}
            color="purple"
          />
        </div>
        <RangeBufferQueryStatus result={result} state={state} />
      </GlassPanel>
    </section>
  );
}
