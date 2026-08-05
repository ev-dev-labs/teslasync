import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, BellOff, EyeOff, Waves } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useNotificationLogs } from '@/api/hooks/useNotifications';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';

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

export default function AlertFatiguePage() {
  const { t } = useTranslation();
  usePageTitle(t('alertFatigue.title', 'Alert Fatigue'));

  const logsQuery = useNotificationLogs();

  const summary = useMemo(
    () => analyzeAlertFatigue(logsQuery.data ?? []),
    [logsQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.groups.slice(0, 12).map((g) => ({
        rule: g.title.length > 26 ? `${g.title.slice(0, 25)}…` : g.title,
        score: Math.round(g.noiseScore),
        perDay: Math.round(g.perDay * 10) / 10,
        ignored: g.ignoredRate != null ? Math.round(g.ignoredRate * 100) : null,
        verdict: g.verdict,
      })),
    [summary.groups],
  );

  const exportData = useMemo(
    () => chartData.map(({ verdict, ...rest }) => ({ ...rest, verdict: String(verdict) })),
    [chartData],
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

  const isLoading = logsQuery.isLoading;
  const isError = logsQuery.isError;

  return (
    <PageContainer
      title={t('alertFatigue.title', 'Alert Fatigue')}
      subtitle={t(
        'alertFatigue.subtitle',
        'Which of your notification rules have stopped being useful — scored on volume, burstiness and how often you actually read them',
      )}
      query={logsQuery}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('alertFatigue.kpis', 'Alert fatigue metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={logsQuery.error} onRetry={() => logsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('alertFatigue.fatiguing', 'Fatiguing Rules')}
                value={summary.fatiguingCount}
                subtitle={t('alertFatigue.ofTotal', 'of {{n}} rules', {
                  n: summary.groups.length,
                })}
                icon={<BellOff className="h-5 w-5" />}
                color={summary.fatiguingCount > 0 ? 'red' : 'green'}
                help={{
                  i18nKey: 'help.alertFatigue.fatiguing',
                  defaultValue:
                    'The noise score blends three things that make a rule tiring rather than helpful: how many times a day it fires, what share of those firings arrive in bursts on the heels of another, and how often a delivered notification is never read. A rule can be low-volume and still fatiguing if every firing comes in a cluster of six.',
                }}
              />
              <MetricCard
                label={t('alertFatigue.perDay', 'Notifications per Day')}
                value={Math.round(summary.overallPerDay * 10) / 10}
                subtitle={t('alertFatigue.overDays', 'across {{n}} days', {
                  n: summary.analyzedDays,
                })}
                icon={<BellRing className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('alertFatigue.ignored', 'Never Read')}
                value={
                  summary.overallIgnoredRate != null
                    ? `${Math.round(summary.overallIgnoredRate * 100)}%`
                    : '—'
                }
                subtitle={t('alertFatigue.ignoredHint', 'of notifications with read tracking')}
                icon={<EyeOff className="h-5 w-5" />}
                color={(summary.overallIgnoredRate ?? 0) > 0.6 ? 'amber' : 'purple'}
              />
              <MetricCard
                label={t('alertFatigue.burst', 'Arrived in Bursts')}
                value={`${Math.round(summary.overallBurstRate * 100)}%`}
                subtitle={t('alertFatigue.burstHint', 'firings that piled onto another')}
                icon={<Waves className="h-5 w-5" />}
                color={summary.overallBurstRate > 0.4 ? 'amber' : 'blue'}
              />
            </>
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
            title={t('alertFatigue.chart', 'Noise Score by Rule')}
            subtitle={t(
              'alertFatigue.chartHint',
              'Anything past the line is firing more than it is earning',
            )}
            ariaLabel={t(
              'alertFatigue.chart.aria',
              'Bar chart of notification rules ranked by their computed noise score',
            )}
            loading={isLoading}
            empty={chartData.length === 0}
            height={360}
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
                  width={150}
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
          title={t('alertFatigue.hours', 'When Notifications Arrive')}
          subtitle={t(
            'alertFatigue.hoursHint',
            'Firings by hour of day across every rule — the small hours are what really cost goodwill',
          )}
          ariaLabel={t(
            'alertFatigue.hours.aria',
            'Bar chart of notification volume by hour of day',
          )}
          loading={isLoading}
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
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BellOff className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('alertFatigue.detail', 'Rule Breakdown')}
            <HelpTooltip
              size="sm"
              i18nKey="help.alertFatigue.detail"
              defaultValue="Rules are identified by their normalised title — numbers, timestamps and vehicle names are stripped — so a hundred firings of the same alert with different values are correctly recognised as one rule rather than a hundred unique ones."
              ariaLabel={t('help.alertFatigue.iconLabel', 'More info about rule grouping')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.groups.length === 0 ? (
            <EmptyState /* no-action: rules appear here as notifications are delivered. */
              icon={<BellOff className="h-8 w-8" />}
              message={t('alertFatigue.noRules', 'No notification rules have fired yet.')}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.groups.map((g) => (
                <li
                  key={g.key}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{g.title}</Text>
                    <Badge variant={VERDICT_BADGE[g.verdict]}>
                      {t(`alertFatigue.verdict.${g.verdict}`, VERDICT_DEFAULT[g.verdict])}
                    </Badge>
                    {g.severity != null ? (
                      <Badge variant="neutral" size="sm">
                        {g.severity}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('alertFatigue.firings', 'Firings')}
                    </Text>
                    <Text variant="bodySm">
                      {t('alertFatigue.firingsValue', '{{n}} · {{perDay}}/day', {
                        n: g.total,
                        perDay: Math.round(g.perDay * 10) / 10,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('alertFatigue.burstRate', 'In bursts')}
                    </Text>
                    <Text variant="bodySm">
                      {t('alertFatigue.burstValue', '{{pct}}% · max {{max}}', {
                        pct: Math.round(g.burstRate * 100),
                        max: g.maxBurst,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('alertFatigue.ignoredRate', 'Never read')}
                    </Text>
                    <Text variant="bodySm">
                      {g.ignoredRate != null
                        ? `${Math.round(g.ignoredRate * 100)}%`
                        : t('alertFatigue.untracked', 'Not tracked')}
                    </Text>
                    <Text variant="caption">
                      {t('alertFatigue.delivery', 'Delivery')}
                    </Text>
                    <Text variant="bodySm">
                      {t('alertFatigue.deliveryValue', '{{ok}} sent · {{bad}} failed', {
                        ok: g.delivered,
                        bad: g.failed,
                      })}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
