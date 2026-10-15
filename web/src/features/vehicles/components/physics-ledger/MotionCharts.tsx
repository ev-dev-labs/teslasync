import { useMemo } from 'react';
import type { PhysicsBlackBoxPoint, PhysicsDynamicsPoint } from '@/api/types';
import { AreaChartWrapper, EmbeddedChart } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

import { downsample, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function MotionCharts({ points, force = false }: { points: (PhysicsBlackBoxPoint | PhysicsDynamicsPoint)[]; force?: boolean }) {
  const { fmtNumber } = useNumberFormatting();
  const t = useT();
  const { formatSpeed, formatPower } = useUnits();
  const data = useMemo(() => downsample(points, 500).map(p => ({ ...p })), [points]);
  const rawData = useMemo(() => points.map(point => ({
    ...point,
    unknown: 'unknown' in point ? String(point.unknown) : undefined,
  })), [points]);
  const rawColumns = useMemo(() => {
    const keys = new Set<string>(['at']);
    for (const point of points) {
      for (const key of Object.keys(point)) {
        keys.add(key);
      }
    }
    return [...keys].map(key => ({ key, label: key }));
  }, [points]);
  const series = [
    { key: 'power_pack_w', label: t('physicsLedger.dynamics.packKw', 'Pack power (kW)'), color: chartTokens.series[0], format: formatPower },
    { key: 'speed_mps', label: t('physicsLedger.dynamics.speed', 'Speed'), color: chartTokens.series[1], format: formatSpeed },
    ...(force ? [{ key: 'force_long_n', label: t('physicsLedger.blackBox.force', 'Force (N)'), color: chartTokens.series[2], format: (v: number) => `${fmtNumber(v)} N` }] : []),
  ];
  return (
    <div
      className="grid min-w-0 gap-4 lg:grid-cols-2"
      role="group"
      aria-label={force
        ? t('physicsLedger.blackBox.chartLabel', 'Force, power, and speed in the last 90 seconds')
        : t('physicsLedger.dynamics.chartLabel', 'Pack power and speed over the window')}
    >
      {series.map(s => (
        <EmbeddedChart
          key={s.key}
          title={s.label}
          ariaLabel={s.label}
          data={rawData}
          metadata={{
            sampling: {
              sampled: data.length < points.length,
              sourceCount: points.length,
              renderedCount: data.length,
              strategy: data.length < points.length ? 'stride' : 'none',
            },
          }}
          dataColumns={[
            { key: 'at', label: t('common.time', 'Time'), format: value => `${String(value)} (${formatDateTime(String(value))})` },
            ...rawColumns.filter(column => column.key !== 'at').map(column => ({
              ...column,
              ...(column.key === s.key ? { label: `${s.label} (${s.key})`, format: (value: unknown) => typeof value === 'number' ? `${value} (${s.format(value)})` : '—' } : {}),
            })),
          ]}
          height={200}
          empty={data.length === 0}
        >
          <AreaChartWrapper
            data={data}
            xKey="at"
            series={[s]}
            height={200}
            xFormatter={formatDateTime}
            yFormatter={s.format}
          />
        </EmbeddedChart>
      ))}
    </div>
  );
}
