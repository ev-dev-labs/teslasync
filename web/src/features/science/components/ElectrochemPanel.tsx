import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceElectrochem
} from '@/api/hooks/useScience';
import type {
  ScienceElectrochem
} from '@/api/types';
import { AreaChartWrapper } from '@/components/charts';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  Badge,
  Caption,
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
import { downsample, SCIENCE_ACCENT, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';

export function ElectrochemPanel({ window }: { window: ScienceWindow }) {
  const t = useT();
  const query = useScienceElectrochem(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data = state.data;
  const { formatEnergy, formatTemperature, unitPrefs } = useUnits();

  const binColumns: Column<ScienceElectrochem['ocv_bins'][number]>[] = [
    { key: 'soc', header: t('science.electrochem.socBin', 'SOC bin'), render: (r) => `${fmtNumber(r.soc_lo_pct, 0)}–${fmtNumber(r.soc_hi_pct, 0)} %` },
    { key: 'temp', header: t('science.electrochem.tempBin', 'Temp bin'), render: (r) => `${formatTemperature(r.temp_lo_c)}…${formatTemperature(r.temp_hi_c)}` },
    { key: 'n', header: 'n', render: (r) => fmtNumber(r.n, 0) },
    { key: 'ocv', header: t('science.electrochem.meanOcv', 'Mean OCV (V)'), render: (r) => fmtNumber(r.mean_ocv_v, 2) },
    {
      key: 'slope', header: t('science.electrochem.slope', 'Slope V/%'), render: (r) => (r.slope_v_per_pct != null ? fmtNumber(r.slope_v_per_pct, 4) : unknown(t)),
    },
  ];
  const hystColumns: Column<ScienceElectrochem['hysteresis'][number]>[] = [
    { key: 'temp', header: t('science.electrochem.tempBin', 'Temp bin'), render: (r) => `${formatTemperature(r.temp_lo_c)}…${formatTemperature(r.temp_hi_c)}` },
    { key: 'soc', header: t('science.electrochem.socBin', 'SOC bin'), render: (r) => `${fmtNumber(r.soc_lo_pct, 0)}–${fmtNumber(r.soc_hi_pct, 0)} %` },
    { key: 'nc', header: t('science.electrochem.nCharge', 'n charge'), render: (r) => fmtNumber(r.n_charge, 0) },
    { key: 'nd', header: t('science.electrochem.nDischarge', 'n discharge'), render: (r) => fmtNumber(r.n_discharge, 0) },
    {
      key: 'dv', header: t('science.electrochem.deltaV', 'ΔV (V)'), render: (r) => (r.delta_v != null ? fmtNumber(r.delta_v, 3) : unknown(t)),
    },
  ];

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-electrochem">
      <PanelTitle>{t('science.electrochem.title', 'Battery electrochemistry (pack-equivalent)')}</PanelTitle>
      <StaleRefreshWarning state={state} />
      {state.status === 'initial' ? (
        <Skeleton className="h-48" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <EmptyState title={t('science.electrochem.title', 'Battery electrochemistry')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />
      ) : (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral" size="sm">n={fmtNumber(data.ocv_points.length, 0)} {t('science.electrochem.restPoints', 'rest points')}</Badge>
            <Badge variant="neutral" size="sm">n={fmtNumber(data.ir_points.length, 0)} IR</Badge>
            <Badge variant="neutral" size="sm">{t('science.firmware', 'Firmware')}: {data.firmware_epoch || unknown(t)}</Badge>
            {data.truncated ? <Badge variant="danger" size="sm">{t('science.truncated', 'Sample cap hit')}</Badge> : null}
          </div>
          {data.ir_points.length > 1 ? (
            <AreaChartWrapper
              data={downsample(data.ir_points, 400).map((p) => ({ at: p.at, ir_mohm: p.ir_pack_ohm * 1000 }))}
              xKey="at"
              series={[{ key: 'ir_mohm', label: t('science.electrochem.irMilliohm', 'Pack IR (mΩ)'), color: SCIENCE_ACCENT }]}
              height={200}
              xFormatter={(v) => formatDateTime(v)}
              yFormatter={(v) => fmtNumber(v, 2)}
              ariaLabel={t('science.electrochem.irChart', 'Pack resistance over the window')}
            />
          ) : (
            <Text as="p" size="sm" color="secondary">{t('science.electrochem.irEmpty', 'No current steps qualified for DCIR in this window.')}</Text>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.arrhenius.unknown ? 'warning' : 'success'} size="sm">
              Ea: {data.arrhenius.ea_j_per_mol != null ? `${fmtNumber(data.arrhenius.ea_j_per_mol, 0)} J/mol` : unknown(t)}
            </Badge>
            {data.arrhenius.ea_ci95_low != null && data.arrhenius.ea_ci95_high != null ? (
              <Badge variant="neutral" size="sm">
                CI: {fmtNumber(data.arrhenius.ea_ci95_low, 0)}…{fmtNumber(data.arrhenius.ea_ci95_high, 0)}
              </Badge>
            ) : null}
            <Badge variant="neutral" size="sm">
              {t('science.electrochem.tempBins', 'Temp bins')}: {fmtNumber(data.arrhenius.temp_bins, 0)} / {formatTemperatureDelta(data.arrhenius.temp_span_c, unitPrefs)}
            </Badge>
          </div>
          <Text as="p" size="sm" color="secondary">{data.arrhenius.honesty}</Text>
          <DataTable
            tableId="science:ocv-bins"
            columns={binColumns}
            data={data.ocv_bins}
            keyExtractor={(r) => `${r.soc_lo_pct}-${r.temp_lo_c}`}
            emptyMessage={t('science.empty', 'No fit inputs in this window.')}
            pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
          />
          <DataTable
            tableId="science:hysteresis"
            columns={hystColumns}
            data={data.hysteresis}
            keyExtractor={(r) => `${r.soc_lo_pct}-${r.temp_lo_c}`}
            emptyMessage={t('science.empty', 'No fit inputs in this window.')}
          />
          <div className="space-y-1 border-t border-[var(--border-default)] pt-2">
            <Text as="p" size="sm" className="font-semibold">{t('science.electrochem.aging', 'Aging exposure and capacity-proxy trend')}</Text>
            <Text as="p" size="sm" color="secondary">{data.aging.honesty}</Text>
            <Caption>{t('science.electrochem.assumedReference', 'Assumed reference capacity')}: {formatEnergy(data.aging.nominal_pack_wh)}</Caption>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral" size="sm">
                {t('science.electrochem.throughput', 'Throughput')}: {data.aging.throughput_wh == null ? t('common.unknown', 'Unknown') : formatEnergy(data.aging.throughput_wh)}
              </Badge>
              <Badge variant="neutral" size="sm">
                {t('science.electrochem.restHours', 'Rest')}: {fmtNumber(data.aging.rest_hours, 1)} h
              </Badge>
              <Badge variant={data.aging.unknown ? 'warning' : 'neutral'} size="sm">
                {t('science.electrochem.proxySlope', 'Proxy slope')}:{' '}
                {data.aging.proxy_slope_wh_per_day != null
                  ? `${fmtNumber(data.aging.proxy_slope_wh_per_day, 1)} Wh/day (n=${fmtNumber(data.aging.proxy_n, 0)})`
                  : unknown(t)}
              </Badge>
            </div>
            <Caption>
              {t('science.electrochem.capacityProxy', 'Capacity proxy')}:{' '}
              {data.capacity_proxy_unknown || data.capacity_proxy_wh == null ? unknown(t) : formatEnergy(data.capacity_proxy_wh)}
              {data.aging.holdout_rmse_wh != null ? ` · ${t('science.holdoutRmse', 'holdout RMSE')}: ${formatEnergy(data.aging.holdout_rmse_wh)}` : ''}
            </Caption>
          </div>
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
    </GlassPanel>
  );
}
