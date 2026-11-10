import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { Caption } from '@/components/ui';
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ChartTooltip, EmbeddedChart, axisTickSm, chartAnimation, chartGrid, chartMargin,
  Cell, useMeasuredAxisWidth,
} from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDashboardChargingHistory } from '@/api/hooks/useCharging';
import { deriveDataState, knownNumber, sumKnown } from '@/api/dataState';
import { WidgetBigNumber, WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';
import { EXPERIMENTAL_BAR_RADII } from './designPacks/experimentalLayouts';
import type { WidgetProps } from './types';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { classifyChargingSource, type ChargerKind } from '@/lib/chargerKind';
import { CHARGER_COLORS } from '@/lib/colors';

const barRadii: Record<PackId, [number, number, number, number]> = {
  ...EXPERIMENTAL_BAR_RADII,
  classic: [4, 4, 0, 0], v1: [7, 7, 3, 3], v2: [8, 8, 4, 4],
  v3: [6, 6, 2, 2], v4: [8, 8, 4, 4], v5: [4, 4, 0, 0],
  v6: [16, 16, 5, 5], v7: [2, 2, 0, 0],
};

export default function ChargeHistoryWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const packId = usePackPresentation();
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatDateShort } = useDateFormat();

  const query = useDashboardChargingHistory(id, { kind: 'recent', range: config?.timeRange });
  const { data: charges, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;

  const chartData = useMemo(
    () =>
      // The API returns newest-first; copy before reversing the cached rows.
      (charges ?? [])
        .slice()
        .reverse()
        .map((s) => ({
          started_at: s.started_at,
          energy: knownNumber(s.total_energy_added_wh) == null ? null : convertEnergyFromSI(s.total_energy_added_wh, unitPrefs.energy),
          type: classifyChargingSource(s),
        })),
    [charges, unitPrefs.energy],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const sourceState = deriveDataState({
    ...query,
    data: charges ?? (isLoading || isError || error ? undefined : null),
  }, { provenance: 'historical', unavailable: !hasData, partial: chartData.some(d => d.energy == null) });
  const dataState = id > 0 ? sourceState : deriveDataState(vehiclesQuery);
  const handleRefresh = () => { if (id > 0) void refetch(); else void vehiclesQuery.refetch(); };
  const shellProps = {
    title: t('widget.chargeHistory.title', 'Charge history'),
    loading: isLoading && !charges,
    error: !charges && error ? String(error) : null,
    dataState, updatedAt: dataUpdatedAt,
    isFetching, isStale, isError, onRefresh: handleRefresh,
  };
  const axisWidth = useMeasuredAxisWidth({
    labels: chartData.map(d => (d.energy == null ? '—' : `${fmt(d.energy)} ${unitPrefs.energy}`)),
    fontSize: 10, minWidth: 40, padding: 32, enabled: !isCompact,
  });

  // Summary totals only known readings: measured zero remains zero and
  // missing readings do not become zero or inflate the average.
  const stats: ChartSummaryStat[] = useMemo(() => {
    if (!hasData) return [];
    const total = sumKnown(chartData.map(d => d.energy));
    return [{
      label: t('widget.chargeHistory.lastSessions', 'Last {{count}} sessions', { count: chartData.length }),
      value: total == null ? null : fmt(total),
      unit: unitPrefs.energy,
    }];
  }, [chartData, hasData, t, unitPrefs.energy, fmt]);

  const latest = chartData[chartData.length - 1];
  const chargerLabels = {
    supercharger: t('widget.chargeHistory.supercharger', 'Supercharger'),
    dcFast: t('widget.chargeHistory.dcFast', 'DC fast'),
    acHome: t('widget.chargeHistory.home', 'Home'),
    ac: t('dashboard.chargerAc', 'AC'),
    unknown: t('common.unknown', 'Unknown'),
  };

  if (isCompact) {
    const compactBody = hasData ? (
      <WidgetBigNumber
        value={stats[0]?.value == null ? null : String(stats[0].value)}
        unit={unitPrefs.energy}
        label={t('widget.chargeHistory.total', 'Total')}
        animated={false}
        align="center"
      />
    ) : (
      <WidgetChartSummary compact isEmpty emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')} emptyIcon={<BarChart3 className="h-5 w-5" />} stats={[]} chart={null} />
    );
    return (
      <WidgetShell {...shellProps}>
        <InstrumentPresentation family="bars" compact headline={compactBody} icon={<BarChart3 />}>
          {compactBody}
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  const history = (
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
        emptyIcon={<BarChart3 className="h-5 w-5" />}
        stats={stats}
        yAxisLabel={undefined}
        legend={[
          { label: t('widget.chargeHistory.home', 'Home'), color: CHARGER_COLORS.home },
          { label: t('dashboard.chargerAc', 'AC'), color: CHARGER_COLORS.ac },
          { label: t('widget.chargeHistory.supercharger', 'Supercharger'), color: CHARGER_COLORS.supercharger },
          { label: t('widget.chargeHistory.dcFast', 'DC fast'), color: CHARGER_COLORS.dc },
        ]}
        chart={
          <EmbeddedChart
            title={t('widget.chargeHistory.title', 'Charge history')}
            ariaLabel={t(
              'dashboardWidgets.charging.chargeHistory.chartLabelInUnit',
              'Energy added per recent charge session, in {{unit}}',
              { unit: unitPrefs.energy },
            )}
            data={chartData}
            dataColumns={[
              { key: 'started_at', label: t('widget.chargeHistory.title', 'Charge history'), format: (v) => formatDateShort(typeof v === 'string' ? v : null) },
              { key: 'energy', label: unitPrefs.energy, format: (v) => (knownNumber(v) == null ? '—' : `${fmt(knownNumber(v) as number)} ${unitPrefs.energy}`) },
            ]}
            className="h-full w-full"
            empty={!hasData}
            emptyMessage={t('widget.noChargeHistory', 'No charge sessions yet')}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="started_at" tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={(v: string) => formatDateShort(v)} />
                <YAxis tick={{ ...axisTickSm, width: undefined }} tickLine={false} axisLine={false} width={axisWidth} tickFormatter={(v: number) => `${fmt(v)} ${unitPrefs.energy}`} />
                <Tooltip content={<ChartTooltip />} formatter={(value: number, _name: string, props: { payload?: { type?: ChargerKind } }) => [
                  knownNumber(value) == null ? '—' : `${fmt(value)} ${unitPrefs.energy}`,
                  chargerLabels[props.payload?.type ?? 'unknown'],
                ]} cursor={{ fill: 'var(--border-subtle)', fillOpacity: 0.08 }} />
                <Bar dataKey="energy" name={unitPrefs.energy} radius={barRadii[packId]} maxBarSize={32}>
                  {chartData.map((datum, index) => {
                    const color = datum.type === 'supercharger' ? CHARGER_COLORS.supercharger
                      : datum.type === 'dcFast' ? CHARGER_COLORS.dc
                      : datum.type === 'acHome' ? CHARGER_COLORS.home
                      : datum.type === 'ac' ? CHARGER_COLORS.ac
                      : CHARGER_COLORS.Other;
                    return <Cell key={index} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
      />
  );

  return (
    <WidgetShell {...shellProps} icon={<BarChart3 className="h-3.5 w-3.5" />}>
      <InstrumentPresentation family="bars" icon={<BarChart3 />}
        headline={<WidgetBigNumber
          value={latest?.energy == null ? null : fmt(latest.energy)}
          unit={unitPrefs.energy}
          label={t('dashboardWidgets.charging.chargeHistory.energyAdded', 'Energy added')}
          badge={{ text: t('dashboardWidgets.charging.chargeHistory.lastSession', 'Last session'), variant: 'neutral' }}
          subtitle={latest ? formatDateShort(latest.started_at) : undefined}
          animated={false}
        />}
        instrument={history}
        details={<div className="min-w-0 space-y-3">
          <WidgetChartSummary compact chart={null} stats={[
            { label: t('dashboardWidgets.charging.chargeHistory.sessions', 'Sessions'), value: fmt(chartData.length, 0) },
            { label: t('dashboardWidgets.charging.chargeHistory.charger', 'Charger'), value: latest ? chargerLabels[latest.type] : null },
          ]} />
          <Caption as="p">{t('dashboardWidgets.charging.chargeHistory.historicalNote', 'Session energy is historical, not live power.')}</Caption>
        </div>}>
        {history}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
