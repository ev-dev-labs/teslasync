import { useMemo } from 'react';
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
  ComposedChart, Bar, Cell, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';

import { useCommandReliabilityHistory } from '@/api/hooks/useCommands';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useProductPreferences } from '@/hooks/useProductPreferences';
import { chartTokens } from '@/lib/tokens';
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

const GRADE_COLOR: Record<ReliabilityGrade, number> = {
  excellent: 2,
  good: 0,
  flaky: 3,
  unreliable: 5,
  unproven: 7,
};

export default function CommandReliabilityPage() {
  const { t } = useTranslation();
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
        command: c.label.length > 24 ? `${c.label.slice(0, 23)}…` : c.label,
        lower: Math.round(c.interval.lower * 1000) / 10,
        naive: Math.round(c.successRate * 1000) / 10,
        upper: Math.round(c.interval.upper * 1000) / 10,
        attempts: c.total,
        grade: c.grade,
      })),
    [summary.commands],
  );

  const exportData = useMemo(
    () => chartData.map(({ grade, ...rest }) => ({ ...rest, grade: String(grade) })),
    [chartData],
  );
  const operationalMetrics = useOperationalMetrics(
    commandReliabilityMetrics(historyQuery.data != null ? summary : null, t),
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('commandReliability.title', 'Command reliability')} />;
  }

  const isLoading = historyQuery.isLoading;
  const isError = !!state.fatalError;

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
              scope={`${formatDateTime(startInstant, { tz: timeZone })} → ${formatDateTime(endInstantExclusive, { tz: timeZone })}`}
              provenance={t('commandReliability.summary.scope', 'Selected vehicle command history, with existing success and retry-intent definitions.')}
              statusLabel={isLoading ? t('commandReliability.brief.loading', 'Loading command outcomes')
                : state.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                  : historyQuery.data == null ? t('commandReliability.brief.unavailable', 'Command outcomes unavailable')
                    : summary.totalAttempts === 0 ? t('commandReliability.brief.empty', 'No attempts recorded')
                      : t('commandReliability.brief.recorded', 'Recorded command outcomes')}
              statusTone={state.status === 'stale' ? 'warning' : 'neutral'}
              freshness={state.updatedAt != null
                ? formatDateTime(new Date(state.updatedAt).toISOString()) : undefined}
            />
          )}
        </section>
      </FadeIn>

      {/* 2 — Confidence chart */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.commands.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: grades appear as remote commands are issued and logged. */
              icon={<Radio className="h-8 w-8" />}
              message={t(
                'commandReliability.noData',
                'No remote commands have been issued yet, so there is no reliability record to grade.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('commandReliability.chart', 'Confidence-weighted success')}
            subtitle={t(
              'commandReliability.chartHint',
              'Bars are the pessimistic lower bound; the dot is the raw success rate the log shows',
            )}
            ariaLabel={t(
              'commandReliability.chart.aria',
              'Bar chart of the wilson lower confidence bound for each command with the naive success rate overlaid',
            )}
            loading={isLoading}
            empty={chartData.length === 0}
            height={380}
            data={exportData}
            dataColumns={[
              { key: 'command', label: t('commandReliability.col.command', 'Command') },
              { key: 'lower', label: t('commandReliability.col.lower', 'Lower bound (%)') },
              { key: 'naive', label: t('commandReliability.col.naive', 'Raw rate (%)') },
              { key: 'upper', label: t('commandReliability.col.upper', 'Upper bound (%)') },
              { key: 'attempts', label: t('commandReliability.col.attempts', 'Attempts') },
              { key: 'grade', label: t('commandReliability.col.grade', 'Grade') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="command"
                  width={150}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={95} stroke={chartTokens.series[2]} strokeDasharray="4 4" />
                <Bar
                  dataKey="lower"
                  name={t('commandReliability.lowerBound', 'Lower bound')}
                  radius={[0, 3, 3, 0]}
                >
                  {chartData.map((d) => (
                    <Cell key={d.command} fill={chartTokens.series[GRADE_COLOR[d.grade]]} />
                  ))}
                </Bar>
                <Scatter
                  dataKey="naive"
                  name={t('commandReliability.rawRate', 'Raw rate')}
                  fill={chartTokens.series[7]}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Command detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
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
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{c.label}</Text>
                    <Badge variant={GRADE_BADGE[c.grade]}>
                      {t(`commandReliability.grade.${c.grade}`, GRADE_DEFAULT[c.grade])}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('commandReliability.outcome', 'Outcome')}
                    </Text>
                    <Text variant="bodySm">
                      {t('commandReliability.outcomeValue', '{{ok}} ok · {{bad}} failed', {
                        ok: c.success,
                        bad: c.failure,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('commandReliability.interval', '95 % interval')}
                    </Text>
                    <Text variant="bodySm">
                      {`${Math.round(c.interval.lower * 100)}–${Math.round(c.interval.upper * 100)}%`}
                    </Text>
                    <Text variant="caption">
                      {t('commandReliability.effort', 'Attempts per intent')}
                    </Text>
                    <Text variant="bodySm">
                      {t('commandReliability.effortValue', '{{n}} · {{retried}} retried', {
                        n: Math.round(c.attemptsPerIntent * 100) / 100,
                        retried: c.retriedIntents,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('commandReliability.lastUsed', 'Last used')}
                    </Text>
                    <Text variant="bodySm">
                      {formatDateShort(new Date(c.lastMs).toISOString())}
                    </Text>
                    {c.topError != null ? (
                      <>
                        <Text variant="caption">
                          {t('commandReliability.topError', 'Usual failure')}
                        </Text>
                        <Text variant="bodySm" className="text-rose-300 sm:col-span-3">
                          {t('commandReliability.topErrorValue', '{{msg}} (×{{n}})', {
                            msg: c.topError,
                            n: c.topErrorCount,
                          })}
                        </Text>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
