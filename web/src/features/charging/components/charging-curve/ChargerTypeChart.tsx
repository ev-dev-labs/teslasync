import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { Text } from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  CHART_COLORS,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from '@/components/charts';
import { avg, durationMinutes, getChargerLabel } from './helpers';
import type { ChargerTypeStats } from './types';

interface ChargerTypeChartProps {
  sessions: ChargingSession[];
}

export default function ChargerTypeChart({ sessions }: ChargerTypeChartProps) {
  const { t } = useTranslation();

  const chargerTypeStats = useMemo((): ChargerTypeStats[] => {
    const list = sessions ?? [];
    if (!list.length) return [];
    const groups = new Map<string, ChargingSession[]>();
    list.forEach((s) => {
      const label = getChargerLabel(s);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(s);
    });
    return Array.from(groups.entries()).map(
      ([label, items]): ChargerTypeStats => ({
        label,
        count: items.length,
        avgKw: avg(items.map((s) => (s.peak_power_w ?? 0) / 1000)),
        avgKwh: avg(items.map((s) => (s.total_energy_added_wh ?? 0) / 1000)),
        avgDuration: avg(items.map((s) => durationMinutes(s.started_at, s.ended_at))),
      }),
    );
  }, [sessions]);

  const isEmpty = chargerTypeStats.length === 0;

  const tableData = useMemo(
    () =>
      chargerTypeStats.map((s) => ({
        label: s.label,
        count: s.count,
        avgKw: fmtNumber(s.avgKw, 1),
        avgKwh: fmtNumber(s.avgKwh, 1),
        avgDuration: fmtInt(s.avgDuration),
      })),
    [chargerTypeStats],
  );

  const tableColumns = useMemo(
    () => [
      { key: 'label', label: t('charging.curve.col.charger', 'Charger Type') },
      { key: 'count', label: t('charging.curve.col.sessions', 'Sessions') },
      { key: 'avgKw', label: t('charging.curve.col.avgKw', 'Avg kW') },
      { key: 'avgKwh', label: t('charging.curve.col.avgKwh', 'Avg kWh') },
      { key: 'avgDuration', label: t('charging.curve.col.avgMin', 'Avg minutes') },
    ],
    [t],
  );

  return (
    <ChartContainer
      title={t('charging.curve.chargerType', 'Charge Rate by Charger Type')}
      subtitle={t(
        'charging.curve.chargerTypeDesc',
        'Average kW and kWh per charger category',
      )}
      ariaLabel={t(
        'charging.curve.chargerType.aria',
        'Composed bar/line chart of average power and energy per charger type',
      )}
      empty={isEmpty}
      data={tableData}
      dataColumns={tableColumns}
      height={280}
      exportable
      exportFilename="charge-rate-by-type"
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={chargerTypeStats}
          margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="label" tick={axisTickSm} />
          <YAxis yAxisId="kw" tick={axisTickSm} orientation="left" />
          <YAxis yAxisId="kwh" tick={axisTickSm} orientation="right" />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            yAxisId="kw"
            dataKey="avgKw"
            name={t('charging.curve.avgPower', 'Avg Power')}
            unit=" kW"
            radius={[4, 4, 0, 0]}
          >
            {chargerTypeStats.map((entry) => (
              <Cell
                key={entry.label}
                fill={CHARGER_COLORS[entry.label] ?? CHART_COLORS[3]}
              />
            ))}
          </Bar>
          <Bar
            yAxisId="kwh"
            dataKey="avgKwh"
            name={t('charging.curve.avgEnergy', 'Avg Energy')}
            unit=" kWh"
            radius={[4, 4, 0, 0]}
            opacity={0.6}
          >
            {chargerTypeStats.map((entry) => (
              <Cell
                key={entry.label}
                fill={CHARGER_COLORS[entry.label] ?? CHART_COLORS[4]}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 space-y-1 px-2">
        {chargerTypeStats.map((ct) => (
          <div
            key={ct.label}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: CHARGER_COLORS[ct.label] ?? CHART_COLORS[3] }}
              />
              <Text variant="bodySm">{ct.label}</Text>
            </div>
            <Text variant="bodySm">
              {fmtInt(ct.count)} {t('charging.curve.sessions', 'sessions')} ·{' '}
              {fmtNumber(ct.avgDuration)} {t('charging.curve.minAvg', 'min avg')}
            </Text>
          </div>
        ))}
      </div>
    </ChartContainer>
  );
}
