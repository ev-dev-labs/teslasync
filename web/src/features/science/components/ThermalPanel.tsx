import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceThermal
} from '@/api/hooks/useScience';
import type {
  ScienceThermal,
  ScienceThermalFit
} from '@/api/types';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
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
  const columns: Column<ScienceThermalFit>[] = [
    { key: 'start', header: t('science.thermal.start', 'Park start'), render: (r) => formatDateTime(r.start) },
    { key: 'kind', header: t('science.thermal.kind', 'Fit'), render: (r) => r.kind },
    { key: 'samples', header: t('science.thermal.samples', 'Samples'), render: (r) => fmtNumber(r.n, 0) },
    { key: 'tau', header: t('science.thermal.tau', 'Cooldown τ'), render: (r) => r.tau_s != null ? formatDuration(r.tau_s) : unknown(t) },
    { key: 'interval', header: t('science.thermal.interval', '95% CI for τ'), render: (r) =>
      r.tau_ci95_low != null && r.tau_ci95_high != null
        ? `${formatDuration(r.tau_ci95_low)}…${formatDuration(r.tau_ci95_high)}`
        : unknown(t) },
    { key: 'r2', header: t('science.thermal.r2', 'R²'), render: (r) => r.r2 != null ? fmtNumber(r.r2, 2) : unknown(t) },
    { key: 'rmse', header: t('science.thermal.rmse', 'Residual RMSE'), render: (r) =>
      r.residual_rmse_c != null ? formatTemperatureDelta(r.residual_rmse_c, unitPrefs, { precision: 2 }) : unknown(t) },
    { key: 'ambient', header: t('science.thermal.ambient', 'Fitted ambient'), render: (r) =>
      r.t_inf_c != null ? formatTemperature(r.t_inf_c) : unknown(t) },
    { key: 'solar', header: t('science.thermal.solar', 'Solar input'), render: (r) =>
      r.solar_unknown ? unknown(t) : t('science.thermal.solarKnown', 'Available') },
  ];

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
          <Text as="p" size="sm" color="secondary">
            {t('science.thermal.fitGuide', 'Compare the fitted cooldown time with its interval, sample count and residual error. An unknown value is not a zero-minute cooldown.')}
          </Text>
          <DataTable
            tableId="science:thermal-fits"
            columns={columns}
            data={asList(data.fits)}
            keyExtractor={(r) => `${r.kind}-${r.start}`}
            emptyMessage={t('science.thermal.empty', 'No Park cooldown transients with ambient reference in this window.')}
            pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
            mobileColumns={['kind', 'tau', 'samples']}
          />
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
    </GlassPanel>
  );
}
