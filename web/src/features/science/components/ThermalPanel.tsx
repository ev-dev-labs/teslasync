import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceThermal
} from '@/api/hooks/useScience';
import type {
  ScienceThermal
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
import { formatTemperatureDelta } from '@/lib/unitConversion';
import { asList, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';

export function ThermalPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceThermal(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceThermal | undefined = state.data;
  const { formatTemperature, formatDuration, unitPrefs } = useUnits();

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-thermal">
      <PanelTitle>{t('science.thermal.title', 'Thermal science (τ, residual)')}</PanelTitle>
      <StaleRefreshWarning state={state} />
      {state.status === 'initial' ? (
        <Skeleton className="h-32" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <EmptyState title={t('science.thermal.title', 'Thermal science')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />
      ) : (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          {asList(data.fits).length === 0 ? (
            <Text as="p" size="sm" color="secondary">{t('science.thermal.empty', 'No Park cooldown transients with ambient reference in this window.')}</Text>
          ) : (
            <div className="space-y-2">
              {asList(data.fits).map((f) => (
                <div key={`${f.kind}-${f.start}`} className="flex flex-wrap items-center gap-2">
                  <Badge variant={f.unknown ? 'warning' : 'success'} size="sm">{f.kind}</Badge>
                  <Text as="span" size="sm" className="tabular-nums">
                    τ = {f.tau_s != null ? formatDuration(f.tau_s) : unknown(t)}
                    {f.tau_ci95_low != null && f.tau_ci95_high != null
                      ? ` (CI ${formatDuration(f.tau_ci95_low)}…${formatDuration(f.tau_ci95_high)})`
                      : ''}
                  </Text>
                  <Caption>
                    n={fmtNumber(f.n, 0)}
                    {f.residual_rmse_c != null ? ` · RMSE ${formatTemperatureDelta(f.residual_rmse_c, unitPrefs, { precision: 2 })}` : ''}
                    {f.t_inf_c != null ? ` · T∞ ${formatTemperature(f.t_inf_c)}` : ''}
                    {f.solar_unknown ? ` · ${t('science.thermal.solarUnknown', 'solar unknown')}` : ''}
                  </Caption>
                </div>
              ))}
            </div>
          )}
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
    </GlassPanel>
  );
}
