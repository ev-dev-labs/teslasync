import { useTranslation } from 'react-i18next';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  useThemeChartPalette,
} from '@/components/charts';
import { ChartCard, thinTickIndices, useContainerWidth } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';
import { formatDateShort, formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { dailyFixture, plotFixture } from './fixtures';

export function ReferenceDailyChart({ title, empty = false }: { title: string; empty?: boolean }) {
  const { t, i18n } = useTranslation();
  const { ref, width } = useContainerWidth();
  const palette = useThemeChartPalette();
  const rows = empty ? [] : dailyFixture;
  const plotted = plotFixture(width);
  const ticks = thinTickIndices(plotted.length, Math.max(0, width - 64)).map(index => plotted[index].index);
  const sampleLabel = t('developerReference.layout.chart.sample', 'Synthetic sample');
  const columns = [
    { key: 'date', label: t('developerReference.layout.chart.date', 'Fixture date'), format: (value: unknown) => formatDate(typeof value === 'string' ? value : null, { tz: 'UTC', locale: i18n.language }) },
    { key: 'sample', label: sampleLabel, format: (value: unknown) => typeof value === 'number' ? fmtNumber(value) : '—' },
  ];
  return (
    <ChartCard
      title={title}
      subtitle={t('developerReference.layout.chart.subtitle', 'Sixty invented daily observations; dates are shown in UTC.')}
      ariaLabel={title}
      ariaDescription={t('developerReference.layout.chart.description', 'Presentation fixture only. The accessible data table retains every original observation.')}
      data={rows}
      dataColumns={columns}
      empty={empty}
      emptyMessage={t('developerReference.layout.chart.empty', 'This synthetic chart has no observations.')}
      emptyDescription={t('developerReference.layout.chart.emptyDescription', 'The plot space is retained without drawing misleading axes.')}
      footer={!empty ? <div className="space-y-1 text-center">
        <Text as="p" variant="bodySm">{t('developerReference.layout.chart.legend', 'Legend: Synthetic sample · August–September 2026 (UTC)')}</Text>
        <Text as="p" variant="bodySm">{t('developerReference.layout.chart.samplingCount', 'Plot shows {{shown}} of {{total}} fixture observations; the data table retains all.', { shown: plotted.length, total: dailyFixture.length })}</Text>
      </div> : undefined}
    >
      <div ref={ref} className="h-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={plotted} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="index" type="number" domain={[0, 59]} ticks={ticks}
              tickFormatter={(value: number) => {
                const row = dailyFixture[value];
                if (!row) return '—';
                return width < 640
                  ? String(new Date(row.date).getUTCDate())
                  : formatDateShort(row.date, { tz: 'UTC', locale: i18n.language });
              }}
            />
            <YAxis width={40} tickCount={4} tickFormatter={(value: number) => fmtNumber(value)} />
            <Tooltip
              labelFormatter={(value) => formatDate(dailyFixture[Number(value)]?.date, { tz: 'UTC', locale: i18n.language })}
              formatter={(value) => [typeof value === 'number' ? fmtNumber(value) : '—', sampleLabel]}
            />
            <Line dataKey="sample" name={sampleLabel} stroke={palette.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
