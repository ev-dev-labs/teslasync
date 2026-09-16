import { useMemo } from 'react';
import type { PhysicsBlackBoxPoint } from '@/api/types';
import { AreaChartWrapper } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { downsample, LEDGER_ACCENT, LEDGER_SECONDARY, LEDGER_TERTIARY, useT } from './helpers';

export function MotionCharts({ points, force = false }: { points: PhysicsBlackBoxPoint[]; force?: boolean }) {
  const t = useT();
  const { formatSpeed, formatPower } = useUnits();
  const data = useMemo(() => downsample(points, 500).map(p => ({ ...p })), [points]);
  const series = [
    { key: 'power_pack_w', label: t('physicsLedger.dynamics.packKw', 'Pack power (kW)'), color: LEDGER_ACCENT, format: formatPower },
    { key: 'speed_mps', label: t('physicsLedger.dynamics.speed', 'Speed'), color: LEDGER_SECONDARY, format: formatSpeed },
    ...(force ? [{ key: 'force_long_n', label: t('physicsLedger.blackBox.force', 'Force (N)'), color: LEDGER_TERTIARY, format: (v: number) => `${fmtNumber(v, 1)} N` }] : []),
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
        <AreaChartWrapper
          key={s.key}
          data={data}
          xKey="at"
          series={[s]}
          height={200}
          xFormatter={formatDateTime}
          yFormatter={s.format}
          ariaLabel={s.label}
        />
      ))}
    </div>
  );
}
