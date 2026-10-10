import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, BellOff, EyeOff, Waves } from 'lucide-react';

import { GlassPanel, PanelTitle, SectionTitle, Table, Text, Badge, HelpTooltip } from '@/components/ui';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useNotificationAnalysisLogs } from '@/api/hooks/useNotifications';
import { chartTokens } from '@/lib/tokens';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

import { analyzeAlertFatigue, type FatigueVerdict } from '../lib/alertFatigue';

const VERDICT_BADGE: Record<FatigueVerdict, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  chatty: 'neutral',
  noisy: 'warning',
  fatiguing: 'danger',
};

const VERDICT_DEFAULT: Record<FatigueVerdict, string> = {
  healthy: 'Healthy',
  chatty: 'Chatty',
  noisy: 'Noisy',
  fatiguing: 'Fatiguing',
};

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}`);

export function AlertFatiguePanel() {
  const { t } = useTranslation();
  const detailTitleId = useId();

  const logsQuery = useNotificationAnalysisLogs();
  const source = useDataState(logsQuery);

  const summary = useMemo(
    () => analyzeAlertFatigue(logsQuery.data ?? []),
    [logsQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.groups.slice(0, 12).map((g) => ({
        rule: g.title.length > 16 ? `${g.title.slice(0, 15)}…` : g.title,
        score: Math.round(g.noiseScore),
        perDay: Math.round(g.perDay * 10) / 10,
        ignored: g.ignoredRate != null ? Math.round(g.ignoredRate * 100) : null,
        verdict: g.verdict,
      })),
    [summary.groups],
  );

  const exportData = useMemo(
    () => chartData.map(({ verdict, ...rest }, index) => ({
      ...rest,
      rule: summary.groups[index]?.title ?? rest.rule,
      verdict: String(verdict),
    })),
    [chartData, summary.groups],
  );

  // A rule that fires all day is background hum; one that fires at 03:00 is
  // what actually wakes people up, so the hour histogram is worth its own view.
  const hourData = useMemo(() => {
    const totals = new Array<number>(24).fill(0);
    for (const g of summary.groups) {
      for (let h = 0; h < 24; h++) totals[h]! += g.hourCounts[h] ?? 0;
    }
    return totals.map((count, h) => ({ hour: HOUR_LABELS[h]!, count }));
  }, [summary.groups]);

  const isLoading = !source.hasData && !source.fatalError;
  const isError = Boolean(source.fatalError);
  const fatigueHelp = t('help.alertFatigue.fatiguing',
    'The noise score blends three things that make a rule tiring rather than helpful: how many times a day it fires, what share of those firings arrive in bursts on the heels of another, and how often a delivered notification is never read. A rule can be low-volume and still fatiguing if every firing comes in a cluster of six.');
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'fatigue-rules', rawValue: summary.fatiguingCount,
      label: t('alertFatigue.fatiguing', 'Fatiguing rules'), description: fatigueHelp,
      context: <>
        <BellOff className="h-5 w-5" aria-hidden="true" />
        {t('alertFatigue.ofTotal', 'of {{n}} rules', { n: summary.groups.length })}
        <HelpTooltip size="sm" i18nKey="help.alertFatigue.fatiguing" defaultValue={fatigueHelp}
          ariaLabel={t('help.alertFatigue.fatiguingIconLabel', 'More info about fatiguing rules')} />
      </>,
    },
    {
      metricId: 'number', occurrenceId: 'fatigue-per-day',
      rawValue: Math.round(summary.overallPerDay * 10) / 10, display: { precision: 1 },
      label: t('alertFatigue.perDay', 'Notifications per day'),
      context: <><BellRing className="h-5 w-5" aria-hidden="true" />{t('alertFatigue.overDays', 'across {{n}} days', { n: summary.analyzedDays })}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'fatigue-ignored',
      rawValue: summary.overallIgnoredRate == null ? null : summary.overallIgnoredRate * 100,
      display: { precision: 0 }, missingReason: t('alertFatigue.untracked', 'Not tracked'),
      label: t('alertFatigue.ignored', 'Never read'),
      context: <><EyeOff className="h-5 w-5" aria-hidden="true" />{t('alertFatigue.ignoredHint', 'of notifications with read tracking')}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'fatigue-bursts',
      rawValue: summary.overallBurstRate * 100, display: { precision: 0 },
      label: t('alertFatigue.burst', 'Arrived in bursts'),
      context: <><Waves className="h-5 w-5" aria-hidden="true" />{t('alertFatigue.burstHint', 'firings that piled onto another')}</>,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);

  return (
    <section id="fatigue" aria-label={t('alertFatigue.title', 'Alert fatigue')} className="min-w-0 space-y-5 scroll-mt-24">
      <div className="max-w-3xl">
        <SectionTitle>{t('alertFatigue.title', 'Alert fatigue')}</SectionTitle>
        <Text as="p" color="secondary">
          {t('alertFatigue.subtitle', 'Which of your notification rules have stopped being useful — scored on volume, burstiness and how often you actually read them')}
        </Text>
      </div>
      <StaleRefreshWarning state={source} label={t('alertFatigue.title', 'Alert fatigue')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('alertFatigue.kpis', 'Alert fatigue metrics')}
          className={isLoading ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4' : 'min-w-0'}
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={source.fatalError} onRetry={() => logsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <OperationalBrief
              compact
              testId="alert-fatigue-brief"
              eyebrow={t('alertFatigue.summary.brief.eyebrow', 'Alert fatigue')}
              title={t('alertFatigue.summary.brief.title', 'Rule noise and engagement')}
              description={t('alertFatigue.summary.periodReason', 'Rates use the recorded firing span, not a complete requested analysis period; read tracking includes delivered notifications only.')}
              statusLabel={source.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
                : summary.groups.length === 0 ? t('alertFatigue.summary.brief.empty', 'No recorded rules')
                  : summary.fatiguingCount > 0 ? t('alertFatigue.summary.brief.fatiguing', 'Fatiguing rules detected')
                    : t('alertFatigue.summary.brief.available', 'Rules scored')}
              statusTone={source.status === 'stale' || summary.fatiguingCount > 0 ? 'warning' : 'neutral'}
              metrics={operationalMetrics}
              scope={t('alertFatigue.summary.period', 'Recorded notification history')}
              freshness={<DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />}
              provenance={t('alertFatigue.summary.periodReason', 'Rates use the recorded firing span, not a complete requested analysis period; read tracking includes delivered notifications only.')}
            />
          )}
        </section>
      </FadeIn>

      {/* 2 — Noise score per rule */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.groups.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: scores appear once notification history exists. */
              icon={<BellRing className="h-8 w-8" />}
              message={t(
                'alertFatigue.noData',
                'No notifications have been delivered yet, so there is nothing to score.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('alertFatigue.chart', 'Noise score by rule')}
            subtitle={t(
              'alertFatigue.chartHint',
              'Anything past the line is firing more than it is earning',
            )}
            ariaLabel={t(
              'alertFatigue.chartAria',
              'Bar chart of notification rules ranked by their computed noise score',
            )}
            loading={isLoading}
            error={source.fatalError}
            onRetry={() => { void logsQuery.refetch(); }}
            empty={chartData.length === 0}
            height={360}
            mobileHeight={360}
            data={exportData}
            dataColumns={[
              { key: 'rule', label: t('alertFatigue.col.rule', 'Rule') },
              { key: 'score', label: t('alertFatigue.col.score', 'Noise score') },
              { key: 'perDay', label: t('alertFatigue.col.perDay', 'Per day') },
              { key: 'ignored', label: t('alertFatigue.col.ignored', 'Ignored (%)') },
              { key: 'verdict', label: t('alertFatigue.col.verdict', 'Verdict') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} />
                <YAxis
                  type="category"
                  dataKey="rule"
                  width={110}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine x={70} stroke={chartTokens.series[5]} strokeDasharray="4 4" />
                <Bar
                  dataKey="score"
                  name={t('alertFatigue.col.score', 'Noise score')}
                  radius={[0, 3, 3, 0]}
                >
                  {chartData.map((d) => (
                    <Cell
                      key={d.rule}
                      fill={
                        d.verdict === 'fatiguing'
                          ? chartTokens.series[5]
                          : d.verdict === 'noisy'
                            ? chartTokens.series[3]
                            : d.verdict === 'chatty'
                              ? chartTokens.series[7]
                              : chartTokens.series[2]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — When they fire */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('alertFatigue.hours', 'When notifications arrive')}
          subtitle={t(
            'alertFatigue.hoursHint',
            'Firings by hour of day across every rule — the small hours are what really cost goodwill',
          )}
          ariaLabel={t(
            'alertFatigue.hoursAria',
            'Bar chart of notification volume by hour of day',
          )}
          loading={isLoading}
          error={source.fatalError}
          onRetry={() => { void logsQuery.refetch(); }}
          empty={summary.totalNotifications === 0}
          height={280}
          data={hourData}
          dataColumns={[
            { key: 'hour', label: t('alertFatigue.col.hour', 'Hour') },
            { key: 'count', label: t('alertFatigue.col.count', 'Notifications') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                name={t('alertFatigue.col.count', 'Notifications')}
                radius={[3, 3, 0, 0]}
              >
                {hourData.map((d, i) => (
                  <Cell
                    key={d.hour}
                    fill={i >= 23 || i < 7 ? chartTokens.series[3] : chartTokens.series[0]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>

      {/* 4 — Rule detail */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle aria-labelledby={detailTitleId} className="mb-3 flex items-center gap-2">
            <BellOff className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <span id={detailTitleId}>{t('alertFatigue.detail', 'Rule breakdown')}</span>
            <HelpTooltip
              size="sm"
              i18nKey="help.alertFatigue.detail"
              defaultValue="Rules are identified by their normalised title — numbers, timestamps and vehicle names are stripped — so a hundred firings of the same alert with different values are correctly recognised as one rule rather than a hundred unique ones."
              ariaLabel={t('help.alertFatigue.iconLabel', 'More info about rule grouping')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={source.fatalError} onRetry={() => { void logsQuery.refetch(); }} />
          ) : isLoading ? (
            <Skeleton height={180} />
          ) : summary.groups.length === 0 ? (
            <EmptyState /* no-action: rules appear here as notifications are delivered. */
              icon={<BellOff className="h-8 w-8" />}
              message={t('alertFatigue.noRules', 'No notification rules have fired yet.')}
            />
          ) : (
            <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
              {summary.groups.map((g) => (
                <li
                  key={g.key}
                  className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="min-w-0 break-words font-medium">{g.title}</Text>
                    <Badge variant={VERDICT_BADGE[g.verdict]}>
                      {t(`alertFatigue.verdict.${g.verdict}`, VERDICT_DEFAULT[g.verdict])}
                    </Badge>
                    {g.severity != null ? (
                      <Badge variant="neutral" size="sm">
                        {g.severity}
                      </Badge>
                    ) : null}
                  </div>
                  <Table aria-label={g.title}>
                    <tbody>
                      <tr>
                        <th scope="row"><Text variant="caption">{t('alertFatigue.firings', 'Firings')}</Text></th>
                        <td className="text-right tabular-nums">
                          <Text variant="bodySm">
                            {t('alertFatigue.firingsValue', '{{n}} · {{perDay}}/day', {
                              n: g.total,
                              perDay: Math.round(g.perDay * 10) / 10,
                            })}
                          </Text>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row"><Text variant="caption">{t('alertFatigue.burstRate', 'In bursts')}</Text></th>
                        <td className="text-right tabular-nums">
                          <Text variant="bodySm">
                            {t('alertFatigue.burstValue', '{{pct}}% · max {{max}}', {
                              pct: Math.round(g.burstRate * 100),
                              max: g.maxBurst,
                            })}
                          </Text>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row"><Text variant="caption">{t('alertFatigue.ignoredRate', 'Never read')}</Text></th>
                        <td className="text-right tabular-nums">
                          <Text variant="bodySm">
                            {g.ignoredRate != null
                              ? `${Math.round(g.ignoredRate * 100)}%`
                              : t('alertFatigue.untracked', 'Not tracked')}
                          </Text>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row"><Text variant="caption">{t('alertFatigue.delivery', 'Delivery')}</Text></th>
                        <td className="text-right tabular-nums">
                          <Text variant="bodySm">
                            {t('alertFatigue.deliveryValue', '{{ok}} sent · {{bad}} failed', {
                              ok: g.delivered,
                              bad: g.failed,
                            })}
                          </Text>
                        </td>
                      </tr>
                    </tbody>
                  </Table>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </section>
  );
}
