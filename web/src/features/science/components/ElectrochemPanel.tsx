import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceElectrochem
} from '@/api/hooks/useScience';
import type {
  ScienceElectrochem,
  ScienceIRPoint,
  ScienceOCVPoint,
} from '@/api/types';
import { AreaChartWrapper } from '@/components/charts';
import { EmptyState, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import {
  Caption,
  DataTable,
  SectionTitle,
  Text,
  type Column
} from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import { formatTemperatureDelta } from '@/lib/unitConversion';
import { asList, downsample, SCIENCE_ACCENT, unknown, useT } from './helpers';
import { MissingBadges } from './MissingBadges';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { ScienceSummaryBrief } from './operationalbrief-all/ScienceSummaryBrief';

export function ElectrochemPanel({ window }: { window: ScienceWindow }) {
  const { fmtNumber, fmtScientificNumber, fmtInt } = useNumberFormatting();
  const t = useT();
  const query = useScienceElectrochem(window);
  const state = useDataState(query, { provenance: 'historical' });
  const data = state.data;
  const { formatDuration, formatEnergy, formatTemperature, unitPrefs } = useUnits();
  const evidenceMetrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'rest-points',
      label: t('science.electrochem.restPoints', 'rest points'),
      rawValue: data ? asList(data.ocv_points).length : null,
      description: t('science.electrochem.restCaveat', 'Rest-end pack voltage is not proven equilibrium OCV. Compare SOC, temperature and dwell before interpreting a change.'),
      context: data ? `n=${fmtInt(asList(data.ocv_points).length)} ${t('science.electrochem.restPoints', 'rest points')}` : undefined,
    },
    {
      metricId: 'count', occurrenceId: 'resistance-steps',
      label: t('science.overview.resistance', 'Resistance steps'),
      rawValue: data ? asList(data.ir_points).length : null,
      description: t('science.overview.batteryMeaning', 'Rest voltage and pack resistance are proxies, not cell diagnostics.'),
      context: data ? `n=${fmtInt(asList(data.ir_points).length)} IR` : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'firmware',
      label: t('science.firmware', 'Firmware'),
      rawValue: data?.firmware_epoch || null,
      description: t('science.brief.firmwareContext', 'Source firmware epoch; observations are not a cell diagnostic.'),
      context: data?.truncated ? t('science.truncated', 'Sample cap hit') : undefined,
    },
  ];
  const arrheniusMetrics: StatMetric[] = [
    {
      metricId: 'number', occurrenceId: 'activation-energy',
      label: t('science.electrochem.activationEnergy', 'Ea'),
      rawValue: data?.arrhenius?.ea_j_per_mol,
      description: data?.arrhenius?.honesty ?? t('science.unknown', 'unknown'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: 'J/mol' }) },
      context: data?.arrhenius?.ea_ci95_low != null && data?.arrhenius?.ea_ci95_high != null
        ? `${t('science.electrochem.activationInterval', 'CI')}: ${fmtNumber(data.arrhenius.ea_ci95_low)}…${fmtNumber(data.arrhenius.ea_ci95_high)} J/mol`
        : t('science.brief.intervalUnknown', 'Confidence interval unknown'),
    },
    {
      metricId: 'count', occurrenceId: 'temperature-bins',
      label: t('science.electrochem.tempBins', 'Temp bins'),
      rawValue: data?.arrhenius?.temp_bins,
      description: t('science.brief.arrheniusContext', 'Inspect fit eligibility and temperature coverage before interpreting activation energy.'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '' }) },
    },
    {
      metricId: 'number', occurrenceId: 'temperature-span',
      label: t('science.electrochem.temperatureSpan', 'Temperature span'),
      rawValue: data?.arrhenius?.temp_span_c,
      description: t('science.brief.temperatureDelta', 'Temperature difference, not an absolute temperature.'),
      display: { formatter: (raw) => ({ value: formatTemperatureDelta(raw, unitPrefs), unit: '' }) },
    },
  ];
  const agingMetrics: StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'throughput',
      label: t('science.electrochem.throughput', 'Throughput'),
      rawValue: data?.aging?.throughput_wh,
      description: data?.aging?.honesty ?? t('science.unknown', 'unknown'),
      context: data?.aging?.throughput_wh == null
        ? `${t('science.electrochem.throughput', 'Throughput')}: ${t('common.unknown', 'Unknown')}` : undefined,
    },
    {
      metricId: 'duration', occurrenceId: 'rest-duration',
      label: t('science.electrochem.restHours', 'Rest'),
      rawValue: data?.aging?.rest_hours != null ? data.aging.rest_hours * 3600 : null,
      description: t('science.brief.restExposure', 'Reported rest exposure, not a measured aging split.'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw / 3600), unit: 'h' }) },
    },
    {
      metricId: 'rate', occurrenceId: 'proxy-slope',
      label: t('science.electrochem.proxySlope', 'Proxy slope'),
      rawValue: data?.aging?.proxy_slope_wh_per_day,
      description: data?.aging?.honesty ?? t('science.unknown', 'unknown'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: 'Wh/day' }) },
      context: data?.aging?.proxy_slope_wh_per_day != null
        ? `n=${fmtNumber(data.aging.proxy_n)}` : t('science.unknown', 'unknown'),
    },
    {
      metricId: 'energy', occurrenceId: 'capacity-proxy',
      label: t('science.electrochem.capacityProxy', 'Capacity proxy'),
      rawValue: data?.capacity_proxy_unknown ? null : data?.capacity_proxy_wh,
      description: t('science.brief.capacityContext', 'Energy-based capacity proxy, not a battery health score or cell diagnostic.'),
      missingReason: t('science.unknown', 'unknown'),
    },
    {
      metricId: 'energy', occurrenceId: 'assumed-reference-capacity',
      label: t('science.electrochem.assumedReference', 'Assumed reference capacity'),
      rawValue: data?.aging?.nominal_pack_wh,
      description: t('science.brief.assumedCapacity', 'Assumed reference, not measured vehicle capacity.'),
    },
    {
      metricId: 'energy', occurrenceId: 'holdout-rmse',
      label: t('science.holdoutRmse', 'holdout RMSE'),
      rawValue: data?.aging?.holdout_rmse_wh,
      description: t('science.brief.holdoutContext', 'Holdout error is unavailable unless the source reports it; it is not zero.'),
    },
  ];

  const restColumns: Column<ScienceOCVPoint>[] = [
    { key: 'at', header: t('science.electrochem.observedAt', 'Observed'), render: (r) => formatDateTime(r.at) },
    { key: 'soc', align: 'right', header: t('science.electrochem.soc', 'SOC'), render: (r) => `${fmtNumber(r.soc_pct)}%` },
    { key: 'voltage', align: 'right', header: t('science.electrochem.packVoltage', 'Pack voltage'), render: (r) => `${fmtNumber(r.ocv_pack_v)} V` },
    { key: 'dwell', align: 'right', header: t('science.electrochem.dwell', 'Rest dwell'), render: (r) => formatDuration(r.dwell_s) },
    { key: 'temperature', align: 'right', header: t('science.electrochem.temperature', 'Temperature'), render: (r) => r.temp_c != null ? formatTemperature(r.temp_c) : unknown(t) },
    { key: 'direction', header: t('science.electrochem.direction', 'Direction'), render: (r) => r.direction },
  ];
  const irColumns: Column<ScienceIRPoint>[] = [
    { key: 'at', header: t('science.electrochem.observedAt', 'Observed'), render: (r) => formatDateTime(r.at) },
    { key: 'resistance', align: 'right', header: t('science.electrochem.irMilliohm', 'Pack IR (mΩ)'), render: (r) => `${fmtNumber(r.ir_pack_ohm * 1000)} mΩ` },
    { key: 'current', align: 'right', header: t('science.electrochem.currentStep', 'Current step'), render: (r) => `${fmtNumber(r.delta_i_a)} A` },
    { key: 'temperature', align: 'right', header: t('science.electrochem.temperature', 'Temperature'), render: (r) => r.temp_c != null ? formatTemperature(r.temp_c) : unknown(t) },
    { key: 'context', header: t('science.electrochem.context', 'Context'), render: (r) => r.context },
  ];

  const binColumns: Column<ScienceElectrochem['ocv_bins'][number]>[] = [
    { key: 'soc', header: t('science.electrochem.socBin', 'SOC bin'), render: (r) => `${fmtNumber(r.soc_lo_pct)}–${fmtNumber(r.soc_hi_pct)} %` },
    { key: 'temp', header: t('science.electrochem.tempBin', 'Temp bin'), render: (r) => `${formatTemperature(r.temp_lo_c)}…${formatTemperature(r.temp_hi_c)}` },
    { key: 'n', align: 'right', header: 'n', render: (r) => fmtNumber(r.n) },
    { key: 'ocv', align: 'right', header: t('science.electrochem.meanOcv', 'Mean OCV (V)'), render: (r) => fmtNumber(r.mean_ocv_v) },
    {
      key: 'slope', align: 'right', header: t('science.electrochem.slope', 'Slope V/%'), render: (r) => (r.slope_v_per_pct != null ? fmtScientificNumber(r.slope_v_per_pct, 4) : unknown(t)),
    },
  ];
  const hystColumns: Column<ScienceElectrochem['hysteresis'][number]>[] = [
    { key: 'temp', header: t('science.electrochem.tempBin', 'Temp bin'), render: (r) => `${formatTemperature(r.temp_lo_c)}…${formatTemperature(r.temp_hi_c)}` },
    { key: 'soc', header: t('science.electrochem.socBin', 'SOC bin'), render: (r) => `${fmtNumber(r.soc_lo_pct)}–${fmtNumber(r.soc_hi_pct)} %` },
    { key: 'nc', align: 'right', header: t('science.electrochem.nCharge', 'n charge'), render: (r) => fmtNumber(r.n_charge) },
    { key: 'nd', align: 'right', header: t('science.electrochem.nDischarge', 'n discharge'), render: (r) => fmtNumber(r.n_discharge) },
    {
      key: 'dv', align: 'right', header: t('science.electrochem.deltaV', 'ΔV (V)'), render: (r) => (r.delta_v != null ? fmtScientificNumber(r.delta_v, 3) : unknown(t)),
    },
  ];

  return (
    <section data-testid="science-electrochem" className="min-w-0">
      <LayoutCard title={t('science.electrochem.title', 'Battery electrochemistry (pack-equivalent)')}>
      <StaleRefreshWarning state={state} />
      <ScienceSummaryBrief
        title={t('science.electrochem.title', 'Battery electrochemistry (pack-equivalent)')}
        description={data?.honesty ?? t('science.overview.batteryMeaning', 'Rest voltage and pack resistance are proxies, not cell diagnostics.')}
        metrics={evidenceMetrics} states={[state]} window={window} report={data}
        limited={!data || data.truncated || (asList(data.ocv_points).length === 0 && asList(data.ir_points).length === 0)}
        testId="science-electrochem-brief"
      />
      <SourceContent
        state={state.status === 'initial' ? 'loading' : state.fatalError ? 'error' : !data ? 'empty' : 'ready'}
        label={t('science.electrochem.title', 'Battery electrochemistry (pack-equivalent)')}
        emptyMessage={t('science.empty', 'No fit inputs in this window.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={state.fatalError}
        errorRecovery={{ onRetry: () => { void query.refetch(); } }}
        loadingContent={<Skeleton className="h-48" />}
        emptyContent={<EmptyState title={t('science.electrochem.title', 'Battery electrochemistry')} message={t('science.empty', 'No fit inputs in this window.')} action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }} />}
      >
      {data && (
        <>
          <Text as="p" size="sm" color="secondary">{data.honesty}</Text>
          <div className="space-y-2">
            <SectionTitle>{t('science.electrochem.restEvidence', 'Rest-voltage evidence')}</SectionTitle>
            <Text as="p" size="sm" color="secondary">
              {t('science.electrochem.restCaveat', 'Rest-end pack voltage is not proven equilibrium OCV. Compare SOC, temperature and dwell before interpreting a change.')}
            </Text>
            {asList(data.ocv_points).length > 1 && (
              <AreaChartWrapper
                data={downsample(data.ocv_points, 400).map((point) => ({ at: point.at, pack_v: point.ocv_pack_v }))}
                xKey="at"
                series={[{ key: 'pack_v', label: t('science.electrochem.packVoltage', 'Pack voltage'), color: SCIENCE_ACCENT }]}
                height={200}
                xFormatter={(value) => formatDateTime(value)}
                yFormatter={(value) => fmtNumber(value)}
                ariaLabel={t('science.electrochem.restChart', 'Rest-end pack voltage over the window')}
              />
            )}
            <DataTable
              tableId="science:rest-points"
              columns={restColumns}
              data={asList(data.ocv_points)}
              keyExtractor={(r) => `${r.at}-${r.direction}`}
              emptyMessage={t('science.electrochem.restEmpty', 'No qualified rest-voltage observations in this window.')}
              pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
              mobileColumns={['at', 'soc', 'voltage']}
            />
          </div>
          <SectionTitle>{t('science.electrochem.irEvidence', 'Pack resistance evidence')}</SectionTitle>
          {asList(data.ir_points).length > 1 ? (
            <AreaChartWrapper
              data={downsample(data.ir_points, 400).map((p) => ({ at: p.at, ir_mohm: p.ir_pack_ohm * 1000 }))}
              xKey="at"
              series={[{ key: 'ir_mohm', label: t('science.electrochem.irMilliohm', 'Pack IR (mΩ)'), color: SCIENCE_ACCENT }]}
              height={200}
              xFormatter={(v) => formatDateTime(v)}
              yFormatter={(v) => fmtNumber(v)}
              ariaLabel={t('science.electrochem.irChart', 'Pack resistance over the window')}
            />
          ) : null}
          <DataTable
            tableId="science:ir-steps"
            columns={irColumns}
            data={asList(data.ir_points)}
            keyExtractor={(r) => `${r.at}-${r.context}`}
            emptyMessage={t('science.electrochem.irEmpty', 'No current steps qualified for DCIR in this window.')}
            pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
            mobileColumns={['at', 'resistance', 'current']}
          />
          <Text as="p" size="sm" color="secondary">
            {t('science.electrochem.chargePulses', '{{count}} charging pulse steps recorded separately from drive current steps.', {
              count: fmtInt(asList(data.pulse_ir).length),
            })}
          </Text>
          {asList(data.pulse_ir).length > 0 && (
            <DataTable
              tableId="science:charge-pulses"
              columns={irColumns}
              data={asList(data.pulse_ir)}
              keyExtractor={(r) => `${r.at}-${r.context}`}
              emptyMessage={t('science.electrochem.irEmpty', 'No current steps qualified for DCIR in this window.')}
              pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
              mobileColumns={['at', 'resistance', 'current']}
            />
          )}
          <ScienceSummaryBrief
            title={t('science.electrochem.arrheniusTitle', 'Temperature dependence of pack resistance')}
            description={data.arrhenius?.honesty ?? t('science.brief.arrheniusContext', 'Inspect fit eligibility and temperature coverage before interpreting activation energy.')}
            metrics={arrheniusMetrics} states={[state]} window={window} report={data}
            limited={data.arrhenius == null || data.arrhenius.unknown}
            testId="science-arrhenius-brief"
          />
          <Text as="p" size="sm" color="secondary">{data.arrhenius?.honesty}</Text>
          <DataTable
            tableId="science:ocv-bins"
            columns={binColumns}
            data={asList(data.ocv_bins)}
            keyExtractor={(r) => `${r.soc_lo_pct}-${r.temp_lo_c}`}
            emptyMessage={t('science.empty', 'No fit inputs in this window.')}
            pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
          />
          <DataTable
            tableId="science:hysteresis"
            columns={hystColumns}
            data={asList(data.hysteresis)}
            keyExtractor={(r) => `${r.soc_lo_pct}-${r.temp_lo_c}`}
            emptyMessage={t('science.empty', 'No fit inputs in this window.')}
          />
          <div className="space-y-1 border-t border-[var(--border-default)] pt-2">
            <Text as="p" size="sm" className="font-semibold">{t('science.electrochem.aging', 'Aging exposure and capacity-proxy trend')}</Text>
            <Text as="p" size="sm" color="secondary">{data.aging?.honesty}</Text>
            <Caption>{t('science.electrochem.assumedReference', 'Assumed reference capacity')}: {data.aging?.nominal_pack_wh != null ? formatEnergy(data.aging.nominal_pack_wh) : unknown(t)}</Caption>
            <ScienceSummaryBrief
              title={t('science.electrochem.aging', 'Aging exposure and capacity-proxy trend')}
              description={data.aging?.honesty ?? t('science.brief.restExposure', 'Reported rest exposure, not a measured aging split.')}
              metrics={agingMetrics} states={[state]} window={window} report={data}
              limited={data.aging == null || data.aging.unknown || data.capacity_proxy_unknown}
              testId="science-aging-brief"
            />
            <Caption>
              {t('science.electrochem.capacityProxy', 'Capacity proxy')}:{' '}
              {data.capacity_proxy_unknown || data.capacity_proxy_wh == null ? unknown(t) : formatEnergy(data.capacity_proxy_wh)}
              {data.aging?.holdout_rmse_wh != null ? ` · ${t('science.holdoutRmse', 'holdout RMSE')}: ${formatEnergy(data.aging.holdout_rmse_wh)}` : ''}
            </Caption>
          </div>
          <MissingBadges missing={data.missing_signals} />
        </>
      )}
      </SourceContent>
      </LayoutCard>
    </section>
  );
}
