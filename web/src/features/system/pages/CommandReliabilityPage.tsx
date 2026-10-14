import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, Radio } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { OperationalBrief } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Bar, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';

import { useCommandReliabilityHistory } from '@/api/hooks/useCommands';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens, typography } from '@/lib/tokens';
import { formatDateShort, formatDateTime } from '@/lib/dateFormat';
import { useTimezone } from '@/lib/timezone';

import { analyzeCommandReliability, type ReliabilityGrade } from '../lib/commandReliability';
import { commandReliabilityMetrics } from '../components/statstrip-command-summaries/commandSummaryMetrics';

const GRADE_BADGE: Record<ReliabilityGrade, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  excellent: 'success',
  good: 'info',
  flaky: 'warning',
  unreliable: 'danger',
  unproven: 'neutral',
};

const GRADE_DEFAULT: Record<ReliabilityGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  flaky: 'Flaky',
  unreliable: 'Unreliable',
  unproven: 'Not enough attempts',
};

export default function CommandReliabilityPage() {
  const { t, i18n } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const [chartWidth, setChartWidth] = useState(0);
  usePageTitle(t('commandReliability.title', 'Command reliability'));

  const { vehicleId } = useSelectedVehicle();
  const { preferences } = useProductPreferences();
  const timeZone = useTimezone('vehicle');
  const { startInstant, endInstantExclusive } = useRangeState({
    defaultPresetId: preferences.defaultAnalysisRange,
    timezone: timeZone,
  });
  const historyQuery = useCommandReliabilityHistory(vehicleId ?? undefined, startInstant, endInstantExclusive);
  const state = useDataState(historyQuery, { provenance: 'historical' });

  const summary = useMemo(
    () => analyzeCommandReliability(historyQuery.data ?? []),
    [historyQuery.data],
  );

  // The bar is the lower bound of the Wilson interval — the pessimistic,
  // evidence-weighted floor — with the naive rate overlaid as a marker so the
  // gap between "what happened" and "what we can actually claim" is visible.
  const chartData = useMemo(
    () =>
      summary.commands.map((c) => ({
        command: c.label,
        command_id: c.command,
        lower: c.success + c.failure > 0 ? Math.round(c.interval.lower * 1000) / 10 : null,
        naive: c.success + c.failure > 0 ? Math.round(c.successRate * 1000) / 10 : null,
        upper: c.success + c.failure > 0 ? Math.round(c.interval.upper * 1000) / 10 : null,
        attempts: c.total,
        grade: c.grade,
      })),
    [summary.commands],
  );

  const exportData = useMemo(
    () => chartData.map(({ grade, ...rest }) => ({ ...rest, grade: String(grade) })),
    [chartData],
  );
  const displayData = useMemo(
    () => chartData.map((row) => ({
      ...row,
      grade: t(`commandReliability.grade.${row.grade}`, GRADE_DEFAULT[row.grade]),
    })),
    [chartData, t],
  );
  const operationalMetrics = useOperationalMetrics(
    commandReliabilityMetrics(historyQuery.data != null ? summary : null, t),
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('commandReliability.title', 'Command reliability')} />;
  }

  const isLoading = historyQuery.isLoading || (state.status === 'initial' && !state.isRefreshBlocked);
  const isError = !!state.fatalError;
  const unavailable = !state.hasData && state.isRefreshBlocked;
  const dateOptions = { tz: timeZone, locale: i18n.language };
  const chartHeight = Math.max(380, chartData.length * 32 + 64);
  const mobileChartHeight = Math.max(320, chartData.length * 32 + 64);
  const formatRate = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? fmtNumber(value, Number.isInteger(value) ? 0 : 1) : '—';

  return (
    <PageLayout
      title={t('commandReliability.title', 'Command reliability')}
      subtitle={t(
        'commandReliability.subtitle',
        'Which remote commands you can actually trust, graded on wilson confidence bounds rather than a raw success percentage',
      )}
      query={historyQuery}
    >
      <StaleRefreshWarning state={state} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('commandReliability.kpis', 'Command reliability metrics')}
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={state.fatalError} onRetry={() => historyQuery.refetch()} />
            </GlassPanel>
          ) : (
            <OperationalBrief
              compact
              testId="command-reliability-summary"
              eyebrow={t('commandReliability.kpis', 'Command reliability metrics')}
              title={t('commandReliability.brief.title', 'Command reliability summary')}
              description={t('commandReliability.summary.scope', 'Selected vehicle command history, with existing success and retry-intent definitions.')}
              metrics={operationalMetrics}
              loading={isLoading}
              scope={`${formatDateTime(startInstant, dateOptions)} → ${formatDateTime(endInstantExclusive, dateOptions)}`}
              provenance={t('commandReliability.summary.scope', 'Selected vehicle command history, with existing success and retry-intent definitions.')}
              statusLabel={isLoading ? t('commandReliability.brief.loading', 'Loading command outcomes')
                : state.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                  : historyQuery.data == null ? t('commandReliability.brief.unavailable', 'Command outcomes unavailable')
                    : summary.totalAttempts === 0 ? t('commandReliability.brief.empty', 'No attempts recorded')
                      : t('commandReliability.brief.recorded', 'Recorded command outcomes')}
              statusTone={state.status === 'stale' ? 'warning' : 'neutral'}
              freshness={state.updatedAt != null
                ? formatDateTime(new Date(state.updatedAt).toISOString(), dateOptions) : undefined}
            />
          )}
        </section>
      </FadeIn>

      {/* 2 — Confidence chart */}
      <FadeIn delay={0.1}>
          <ChartContainer
            title={t('commandReliability.chart.title', 'Confidence-weighted success')}
            subtitle={t(
              'commandReliability.chartHint',
              'Bars are the pessimistic lower bound; the dot is the raw success rate the log shows',
            )}
            ariaLabel={t(
              'commandReliability.chart.aria',
              'Bar chart of the wilson lower confidence bound for each command with the naive success rate overlaid',
            )}
            loading={isLoading}
            error={state.fatalError}
            onRetry={state.retry ?? undefined}
            empty={chartData.length === 0}
            emptyIcon={<Radio className="h-8 w-8" aria-hidden="true" />}
            emptyMessage={unavailable
              ? t('commandReliability.brief.unavailable', 'Command outcomes unavailable')
              : t('commandReliability.noData', 'No remote commands have been issued yet, so there is no reliability record to grade.')}
            emptyDescription={unavailable
              ? t('common.unknown', 'Unknown') : undefined}
            height={chartHeight}
            mobileHeight={mobileChartHeight}
            data={displayData}
            exportData={exportData}
            dataColumns={[
              { key: 'command', label: t('commandReliability.col.command', 'Command') },
              { key: 'lower', label: t('commandReliability.col.lower', 'Lower bound (%)'), format: formatRate },
              { key: 'naive', label: t('commandReliability.col.naive', 'Raw rate (%)'), format: formatRate },
              { key: 'upper', label: t('commandReliability.col.upper', 'Upper bound (%)'), format: formatRate },
              { key: 'attempts', label: t('commandReliability.col.attempts', 'Attempts'), kind: 'count' },
              { key: 'grade', label: t('commandReliability.col.grade', 'Grade') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%" onResize={setChartWidth}>
              <ComposedChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tickFormatter={(value: number) => fmtInt(value)}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="command"
                  width={chartWidth >= 640 ? 150 : 80}
                  interval={0}
                  tickFormatter={(label: string) => {
                    const limit = chartWidth >= 640 ? 24 : 10;
                    return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
                  }}
                  tick={{ fill: chartTokens.axisStroke, fontSize: 12 }}
                />
                <Tooltip content={<ChartTooltip valueFormatter={formatRate} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine x={95} stroke={chartTokens.axisStroke} strokeDasharray="4 4" />
                <Bar
                  dataKey="lower"
                  name={t('commandReliability.lowerBound', 'Lower bound')}
                  radius={[0, 3, 3, 0]}
                  fill={chartTokens.axisStroke}
                />
                <Scatter
                  dataKey="naive"
                  name={t('commandReliability.rawRate', 'Raw rate')}
                  fill={chartTokens.tooltipText}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
      </FadeIn>

      {/* 3 — Command detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <CheckCheck className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
            {t('commandReliability.detail', 'Command breakdown')}
            <HelpTooltip
              size="sm"
              i18nKey="help.commandReliability.detail"
              defaultValue="Repeats of the same command within a few minutes are collapsed into a single intent, because pressing unlock four times is one thing you wanted, not four. Attempts per intent is therefore the honest measure of how much fighting the car makes you do."
              ariaLabel={t('help.commandReliability.iconLabel', 'More info about intents')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : isError ? (
            <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
          ) : unavailable ? (
            <EmptyState /* no-action: a paused initial read is not an empty history. */
              icon={<Radio className="h-8 w-8" aria-hidden="true" />}
              message={t('commandReliability.brief.unavailable', 'Command outcomes unavailable')}
            />
          ) : summary.commands.length === 0 ? (
            <EmptyState /* no-action: the breakdown is derived from command history. */
              icon={<CheckCheck className="h-8 w-8" />}
              message={t('commandReliability.noCommands', 'No commands recorded yet.')}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.commands.map((c) => (
                <li
                  key={c.command}
                  className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className={`min-w-0 break-words ${typography.weight.medium}`}>{c.label}</Text>
                    <Badge variant={GRADE_BADGE[c.grade]}>
                      {t(`commandReliability.grade.${c.grade}`, GRADE_DEFAULT[c.grade])}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text as="dt" variant="caption">
                      {t('commandReliability.outcome', 'Outcome')}
                    </Text>
                    <Text as="dd" variant="bodySm" className="min-w-0 break-words">
                      {t('commandReliability.outcomeValue', '{{ok}} ok · {{bad}} failed', {
                        ok: fmtInt(c.success),
                        bad: fmtInt(c.failure),
                      })}
                    </Text>
                    <Text as="dt" variant="caption">
                      {t('commandReliability.interval', '95 % interval')}
                    </Text>
                    <Text as="dd" variant="bodySm" className="min-w-0 break-words">
                      {c.success + c.failure > 0
                        ? `${fmtInt(Math.round(c.interval.lower * 100))}–${fmtInt(Math.round(c.interval.upper * 100))}%`
                        : t('common.unknown', 'Unknown')}
                    </Text>
                    <Text as="dt" variant="caption">
                      {t('commandReliability.effort', 'Attempts per intent')}
                    </Text>
                    <Text as="dd" variant="bodySm" className="min-w-0 break-words">
                      {t('commandReliability.effortValue', '{{n}} · {{retried}} retried', {
                        n: fmtNumber(c.attemptsPerIntent, Math.min(2, String(c.attemptsPerIntent).split('.')[1]?.length ?? 0)),
                        retried: fmtInt(c.retriedIntents),
                      })}
                    </Text>
                    <Text as="dt" variant="caption">
                      {t('commandReliability.lastUsed', 'Last used')}
                    </Text>
                    <Text as="dd" variant="bodySm" className="min-w-0 break-words">
                      {formatDateShort(new Date(c.lastMs).toISOString(), dateOptions)}
                    </Text>
                    {c.topError != null ? (
                      <>
                        <Text as="dt" variant="caption">
                          {t('commandReliability.topError', 'Usual failure')}
                        </Text>
                        <Text as="dd" variant="bodySm" className="min-w-0 break-words text-[var(--semantic-danger)] sm:col-span-3">
                          {t('commandReliability.topErrorValue', '{{msg}} (×{{n}})', {
                            msg: c.topError,
                            n: fmtInt(c.topErrorCount),
                          })}
                        </Text>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
