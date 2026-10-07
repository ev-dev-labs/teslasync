import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Bar, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
  axisTick, chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge, DataTable, type Column } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CareScore } from '../../lib/batteryCare';
import { CareSourceNotices } from './CareSourceNotices';
import type { CareSectionState } from './state';

interface MonthlyRow {
  month: string;
  score: number | null;
  sessions: number;
  drives: number;
}

// The readonly UI barrel does not export the mobile type; infer the real public prop.
type MonthlyMobilePresentation = NonNullable<
  Parameters<typeof DataTable<MonthlyRow>>[0]['mobilePresentation']
>;

const CHART_MARGIN = { top: 12, right: 4, left: -12, bottom: 0 };

/** Real ChartContainer is retained: EmbeddedChart would remove export behavior. */
export function CareMonthlyTrend({ care, state }: { care: CareScore; state: CareSectionState }) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const rows = useMemo(
    () => care.monthly.map(month => ({
      month: month.month,
      score: month.score,
      sessions: month.sessionsAnalyzed,
      drives: month.drivesAnalyzed,
    })),
    [care.monthly],
  );
  const hasData = rows.some(row => row.sessions > 0 || row.drives > 0);
  const calibratedMonths = care.monthly.filter(month => month.scoreReady).length;
  const scoreName = t('batteryCare.trend.score', 'Care index');
  const sessionName = t('batteryCare.trend.sessions', 'Eligible sessions');
  const driveName = t('batteryCare.trend.drives', 'Eligible drives');
  const monthName = t('batteryCare.trend.month', 'Month');
  const columns = useMemo(
    () => [
      { key: 'month', label: monthName },
      {
        key: 'score',
        label: scoreName,
        format: (value: unknown) => typeof value === 'number'
          ? t('batteryCare.trend.scoreValue', '{{score}} / 100', { score: fmtInt(value) })
          : '—',
      },
      { key: 'sessions', label: sessionName, format: (value: unknown) => fmtInt(value) },
      { key: 'drives', label: driveName, format: (value: unknown) => fmtInt(value) },
    ],
    [driveName, scoreName, sessionName, monthName, t, fmtInt],
  );
  const tableColumns = useMemo<Column<MonthlyRow>[]>(
    () => columns.map(column => ({
      key: column.key,
      header: column.label,
      render: row => {
        const value = row[column.key as keyof MonthlyRow];
        return column.format ? column.format(value) : value;
      },
      exportValue: row => row[column.key as keyof MonthlyRow],
    })),
    [columns],
  );
  const mobilePresentation = useMemo<MonthlyMobilePresentation>(
    () => ({
      variant: 'cards',
      roles: { month: 'title', score: 'primary', sessions: 'meta', drives: 'meta' },
      displayValue: (row, key) => {
        const column = columns.find(item => item.key === key);
        const value = row[key as keyof MonthlyRow];
        return column?.format ? column.format(value) : value;
      },
    }),
    [columns],
  );
  const initialLoading = !state.trust.hasData && !state.trust.fatalError;

  return (
    <section
      aria-label={t('batteryCare.trend.region', 'Monthly Battery Care trend')}
      data-testid="battery-care-trend"
      className="w-full min-w-0 space-y-3"
    >
      <CareSourceNotices state={state} />
      <ChartContainer
        title={t('batteryCare.trend.title', 'Monthly care trend')}
        subtitle={t(
          'batteryCare.trend.description',
          'Monthly scores require at least 3 eligible sessions, 3 eligible drives, and 2 classified-energy sessions',
        )}
        ariaLabel={t(
          'batteryCare.trend.aria',
          'Monthly descriptive care index with eligible charging-session and drive sample counts',
        )}
        loading={initialLoading}
        height={340}
        chartKey="battery-care-monthly"
        exportable={!state.trust.fatalError && !initialLoading && hasData}
        exportFilename="battery-care-monthly"
        data={state.trust.fatalError ? [] : rows}
        dataColumns={columns}
        action={
          <Badge variant={calibratedMonths > 0 ? 'success' : 'warning'} dot>
            {t('batteryCare.trend.calibrated', '{{count}} calibrated months', { count: calibratedMonths })}
          </Badge>
        }
      >
        {({ hiddenSeries }) => state.trust.fatalError ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.trust.fatalError} onRetry={state.trust.retry ?? undefined} />
          </div>
        ) : !hasData ? (
          <EmptyState /* no-action: observed monthly telemetry determines this read-only result */
            className="h-full"
            icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'batteryCare.trend.empty',
              'No eligible charging or drive observations fall inside the displayed monthly window.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={CHART_MARGIN}>
              {chartGrid}
              <XAxis
                dataKey="month"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="score"
                domain={[0, 100]}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <YAxis
                yAxisId="samples"
                orientation="right"
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value, name) => name === scoreName
                      ? t('batteryCare.trend.scoreValue', '{{score}} / 100', { score: fmtNumber(value) })
                      : t('batteryCare.trend.sampleValue', '{{count}} samples', {
                          count: typeof value === 'number' ? value : undefined,
                          replace: { count: typeof value === 'number' ? value : '—' },
                        })}
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                yAxisId="samples"
                dataKey="sessions"
                name={sessionName}
                fill={CHART_COLORS[1]}
                fillOpacity={0.18}
                maxBarSize={18}
                hide={hiddenSeries?.isHidden('sessions') ?? false}
              />
              <Bar
                yAxisId="samples"
                dataKey="drives"
                name={driveName}
                fill={CHART_COLORS[5]}
                fillOpacity={0.18}
                maxBarSize={18}
                hide={hiddenSeries?.isHidden('drives') ?? false}
              />
              <Line
                yAxisId="score"
                type="monotone"
                dataKey="score"
                name={scoreName}
                stroke={CHART_COLORS[2]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
                hide={hiddenSeries?.isHidden('score') ?? false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
      {/* Additive, real table pipeline: no separate mobile data/filter/export owner. */}
      {hasData && state.trust.hasData ? (
        <div data-testid="battery-care-monthly-table" className="min-w-0">
          <DataTable
          tableId="battery-care-monthly-evidence"
          caption={t('batteryCare.trend.aria', 'Monthly descriptive care index with eligible charging-session and drive sample counts')}
          columns={tableColumns}
          data={rows}
          keyExtractor={row => row.month}
          mobilePresentation={mobilePresentation}
          variant="embedded"
          />
        </div>
      ) : null}
    </section>
  );
}
