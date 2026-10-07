import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import {
  ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, EmbeddedChart,
} from '@/components/charts';
import type { StartLevelBucket } from './helpers';

interface BatteryLevelChartProps {
  data: StartLevelBucket[];
}

// Hoisted so the recharts <Bar> never receives a fresh literal each render.
const BAR_COLOR = '#f59e0b';
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

export function BatteryLevelChart({ data }: BatteryLevelChartProps) {
  const { t } = useTranslation();

  // Null-safe: callers may hand us `undefined`/`[]` despite the non-optional
  // prop type (e.g. before sessions have loaded). Guard once, then derive the
  // grand total so an all-zero distribution surfaces an empty state instead of
  // rendering a blank set of axes.
  const buckets = useMemo(() => data ?? [], [data]);
  const totalSessions = useMemo(
    () => buckets.reduce((sum, b) => sum + (b?.count ?? 0), 0),
    [buckets],
  );
  const isEmpty = totalSessions === 0;

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <BatteryCharging className="h-4 w-4 text-neon-amber" aria-hidden="true" />
        {t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
        <Text as="span" variant="caption" className="ml-2">
          {t('charging.charts.batteryLevelHint', 'How low do you typically go before charging?')}
        </Text>
      </PanelTitle>
      <EmbeddedChart
        title={t('charging.charts.batteryLevelAtStart', 'Battery Level at Charge Start')}
        ariaLabel={t(
          'charging.charts.batteryLevelAria',
          'Charging sessions by starting battery level',
        )}
        data={buckets.map(({ range, count }) => ({ range, count }))}
        dataColumns={[
          { key: 'range', label: t('charging.charts.batteryRange', 'Battery level') },
          { key: 'count', label: t('charging.charts.sessions', 'Sessions') },
        ]}
        empty={isEmpty}
        emptyMessage={t(
          'charging.charts.batteryLevelEmpty',
          'No charge-start levels to chart yet.',
        )}
        fluid={false}
        mobileHeight={144}
        height={176}
      >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTickSm} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                name={t('charging.charts.sessions', 'Sessions')}
                fill={BAR_COLOR}
                fillOpacity={0.6}
                radius={BAR_RADIUS}
              />
            </BarChart>
          </ResponsiveContainer>
      </EmbeddedChart>
    </GlassPanel>
  );
}
