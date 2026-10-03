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

import { formatTemperatureDelta } from '@/lib/unitConversion';
import { asList, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ThermalPanel({ window }: { window: ScienceWindow }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const query = useScienceThermal(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data: ScienceThermal | undefined = state.data;
  const { formatTemperature, formatDuration, unitPrefs } = useUnits();
  const columns: Column<ScienceThermalFit>[] = [
    { key: 'start', header: t('science.thermal.start', 'Park start'), render: (r) => formatDateTime(r.start) },
    { key: 'kind', header: t('science.thermal.kind', 'Fit'), render: (r) => r.kind },
    { key: 'samples', align: 'right', header: t('science.thermal.samples', 'Samples'), render: (r) => fmtNumber(r.n) },
    { key: 'tau', align: 'right', header: t('science.thermal.tau', 'Cooldown τ'), render: (r) => r.tau_s != null ? formatDuration(r.tau_s) : unknown(t) },
    { key: 'interval', align: 'right', header: t('science.thermal.interval', '95% CI for τ'), render: (r) =>
      r.tau_ci95_low != null && r.tau_ci95_high != null
        ? `${formatDuration(r.tau_ci95_low)}…${formatDuration(r.tau_ci95_high)}`
        : unknown(t) },
    { key: 'r2', align: 'right', header: t('science.thermal.r2', 'R²'), render: (r) => r.r2 != null ? fmtNumber(r.r2) : unknown(t) },
    { key: 'rmse', align: 'right', header: t('science.thermal.rmse', 'Residual RMSE'), render: (r) =>
      r.residual_rmse_c != null ? formatTemperatureDelta(r.residual_rmse_c, unitPrefs, { precision: 2 }) : unknown(t) },
    { key: 'ambient', align: 'right', header: t('science.thermal.ambient', 'Fitted ambient'), render: (r) =>
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
            emptyMessage={t('science.thermal.empty', 'No park cooldown transients with ambient reference in this window.')}
            pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
            mobileColumns={['kind', 'tau', 'samples']}
          />
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
    </GlassPanel>
  );
}
