import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceTires
} from '@/api/hooks/useScience';
import type {
  ScienceTires
} from '@/api/types';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  Badge,
  Caption,
  GlassPanel,
  PanelTitle,
  Text
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';

export function TiresPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceTires(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceTires | undefined = state.data;
  const { formatPressure, formatEnergy, formatDistance } = useUnits();

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-tires">
      <PanelTitle>{t('science.tires.title', 'Tire / contact mechanics')}</PanelTitle>
      <StaleRefreshWarning state={state} />
      {state.status === 'initial' ? (
        <Skeleton className="h-32" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <EmptyState title={t('science.tires.title', 'Tires')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />
      ) : (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          {data.unknown ? (
            <Text as="p" size="sm" color="secondary">{t('science.tires.empty', 'No TPMS corners reported in this window. Yaw, steer, and slip are not available from Tesla signals.')}</Text>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [t('science.tires.fl', 'Front left'), data.fl_kpa],
                  [t('science.tires.fr', 'Front right'), data.fr_kpa],
                  [t('science.tires.rl', 'Rear left'), data.rl_kpa],
                  [t('science.tires.rr', 'Rear right'), data.rr_kpa],
                ].map(([label, v]) => (
                  <div key={String(label)}>
                    <Caption>{label}</Caption>
                    <Text as="p" size="sm" className="tabular-nums">
                      {typeof v === 'number' ? formatPressure(v) : unknown(t)}
                    </Text>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral" size="sm">
                  {t('science.tires.imbalance', 'Imbalance')}:{' '}
                  {data.imbalance_kpa != null ? formatPressure(data.imbalance_kpa) : unknown(t)}
                </Badge>
                <Badge variant="neutral" size="sm">
                  {t('science.tires.underinflation', 'Underinflation')}:{' '}
                  {data.underinflation_frac != null ? `${fmtNumber(data.underinflation_frac * 100, 1)} %` : unknown(t)}
                </Badge>
                <Badge variant={data.extra_wh != null ? 'info' : 'neutral'} size="sm">
                  {t('science.tires.extra', 'Extra rolling')}:{' '}
                  {data.extra_wh != null ? formatEnergy(data.extra_wh) : unknown(t)}
                </Badge>
              </div>
              <Caption>
                {t('science.tires.modelBand', 'Model sensitivity, not a confidence interval')}:{' '}
                {formatEnergy(data.extra_model_low)}…{formatEnergy(data.extra_model_high)}
                {data.distance_m != null ? ` · ${formatDistance(data.distance_m)}` : ''}
                {data.recommended_kpa != null ? ` · ${t('science.tires.placard', 'placard')} ${formatPressure(data.recommended_kpa)}` : ''}
              </Caption>
            </>
          )}
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
    </GlassPanel>
  );
}
