import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceTires
} from '@/api/hooks/useScience';
import type {
  ScienceTires
} from '@/api/types';
import { EmptyState, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import {
  Caption,
  Text
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { ScienceSummaryBrief } from './operationalbrief-all/ScienceSummaryBrief';

export function TiresPanel({ window }: { window: ScienceWindow }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const query = useScienceTires(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceTires | undefined = state.data;
  const { formatPressure, formatEnergy, formatDistance } = useUnits();
  const reported = data && !data.unknown ? data : undefined;
  const sensitivity = (
    <>
      {t('science.tires.modelBand', 'Model sensitivity, not a confidence interval')}:{' '}
      {data?.extra_model_low != null ? formatEnergy(data.extra_model_low) : unknown(t)}…
      {data?.extra_model_high != null ? formatEnergy(data.extra_model_high) : unknown(t)}
      {data?.distance_m != null ? ` · ${formatDistance(data.distance_m)}` : ''}
      {data?.recommended_kpa != null ? ` · ${t('science.tires.placard', 'placard')} ${formatPressure(data.recommended_kpa)}` : ''}
    </>
  );
  const metrics: StatMetric[] = [
    { metricId: 'pressure', occurrenceId: 'front-left', label: t('science.tires.fl', 'Front left'), rawValue: reported?.fl_kpa, description: data?.honesty ?? t('science.unknown', 'unknown') },
    { metricId: 'pressure', occurrenceId: 'front-right', label: t('science.tires.fr', 'Front right'), rawValue: reported?.fr_kpa, description: data?.honesty ?? t('science.unknown', 'unknown') },
    { metricId: 'pressure', occurrenceId: 'rear-left', label: t('science.tires.rl', 'Rear left'), rawValue: reported?.rl_kpa, description: data?.honesty ?? t('science.unknown', 'unknown') },
    { metricId: 'pressure', occurrenceId: 'rear-right', label: t('science.tires.rr', 'Rear right'), rawValue: reported?.rr_kpa, description: data?.honesty ?? t('science.unknown', 'unknown') },
    {
      metricId: 'pressure', occurrenceId: 'imbalance',
      label: t('science.tires.imbalance', 'Imbalance'), rawValue: reported?.imbalance_kpa,
      description: t('science.brief.pressureImbalance', 'Reported corner-pressure imbalance in the selected source window.'),
    },
    {
      metricId: 'percent', occurrenceId: 'underinflation',
      label: t('science.tires.underinflation', 'Underinflation'),
      rawValue: reported?.underinflation_frac != null ? reported.underinflation_frac * 100 : null,
      description: t('science.brief.underinflation', 'Source underinflation fraction relative to the assumed placard pressure.'),
      display: { formatter: (raw) => ({ value: `${fmtNumber(raw)} %`, unit: '' }) },
    },
    {
      metricId: 'energy', occurrenceId: 'extra-rolling',
      label: t('science.tires.extra', 'Extra rolling'), rawValue: reported?.extra_wh,
      description: t('science.overview.tiresMeaning', 'Extra rolling energy is model sensitivity, not measured loss.'),
      context: data && !data.unknown ? sensitivity : t('science.tires.empty', 'No TPMS corners reported in this window. Yaw, steer, and slip are not available from Tesla signals.'),
    },
  ];

  return (
    <section data-testid="science-tires" className="min-w-0">
      <LayoutCard title={t('science.tires.title', 'Tire / contact mechanics')}>
      <StaleRefreshWarning state={state} />
      <ScienceSummaryBrief
        title={t('science.tires.title', 'Tire / contact mechanics')}
        description={data?.honesty ?? t('science.overview.tiresMeaning', 'Extra rolling energy is model sensitivity, not measured loss.')}
        metrics={metrics} states={[state]} window={window} report={data}
        limited={!data || data.unknown}
        testId="science-tires-brief"
      />
      <SourceContent
        state={state.status === 'initial' ? 'loading' : state.fatalError ? 'error' : !data ? 'empty' : 'ready'}
        label={t('science.tires.title', 'Tire / contact mechanics')}
        emptyMessage={t('science.empty', 'No fit inputs in this window.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={state.fatalError}
        errorRecovery={{ onRetry: () => { void query.refetch(); } }}
        loadingContent={<Skeleton className="h-32" />}
        emptyContent={<EmptyState title={t('science.tires.title', 'Tires')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />}
      >
      {data && (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          {data.unknown ? (
            <Text as="p" size="sm" color="secondary">{t('science.tires.empty', 'No TPMS corners reported in this window. Yaw, steer, and slip are not available from Tesla signals.')}</Text>
          ) : (
            <>
              <Caption>
                {sensitivity}
              </Caption>
            </>
          )}
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
      </SourceContent>
      </LayoutCard>
    </section>
  );
}
