import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, HeartPulse, BarChart3, ShieldCheck,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';

import { OperationalBrief } from '@/components/data-display';
import {
  ChartTooltip, CHART_COLORS,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  EmbeddedChart, type ChartDataColumn,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useAnomalies } from '@/api/hooks/useAnomalies';
import { AIAnomalyExplanations } from '@/components/ai';
import { AILearnedAnomalyBaselines } from '@/components/ai';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

import { AnomalyTimelineCard, SystemHealthCard } from '../components/anomaly-dashboard';
import { anomalySummary } from '../components/statstrip-anomaly/anomalySummary';

export default function AnomalyDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t('anomaly.title', 'Anomaly detection'));

  const { vehicleId: selectedId } = useSelectedVehicle();
  const activeIdStr = selectedId != null ? String(selectedId) : null;
  const noVehicle = activeIdStr === null;

  const anomaliesQuery = useAnomalies(activeIdStr);
  const { data, isLoading: queryLoading, refetch } = anomaliesQuery;
  const state = useDataState(anomaliesQuery, { provenance: 'inferred' });
  const error = state.fatalError;
  const isLoading = queryLoading && !state.hasData;

  /* Stable retry handler shared by all three error panels (frequency, health,
     timeline) so we don't allocate three fresh closures on every render. */
  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  /* Anomaly frequency by signal — top 10 offenders, for the bar chart. */
  const signalFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const a of data?.anomalies ?? []) {
      freq[a.signal] = (freq[a.signal] ?? 0) + 1;
    }
    return Object.entries(freq)
      .map(([signal, count]) => ({ signal, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data]);

  const anomalies = data?.anomalies ?? [];
  const healthEntries = Object.entries(data?.health_summary ?? {});
  const summary = anomalySummary(data, t);
  const briefMetrics = useOperationalMetrics(summary.metrics);

  const signalFrequencyColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'signal', label: t('anomaly.colSignal', 'Signal') },
      { key: 'count', label: t('anomaly.count', 'Anomalies'), format: (v) => String(v ?? 0) },
    ],
    [t],
  );

  const emptyMessage = noVehicle
    ? t('anomaly.selectVehicle', 'Select a vehicle to view its anomaly analysis.')
    : t('anomaly.noData', 'No data available yet.');

  return (
    <PageLayout
      title={t('anomaly.title', 'Anomaly detection')}
      subtitle={t('anomaly.subtitle', 'Automatic health monitoring and signal anomaly detection')}
      query={anomaliesQuery}
    >
      <StaleRefreshWarning state={state} />
      {/* ── 1. Summary — independently scoped source metrics ───────── */}
      <FadeIn>
        <section aria-label={t('anomaly.kpis', 'Summary metrics')}>
          <OperationalBrief
            compact
            testId="anomaly-summary"
            eyebrow={t('anomaly.title', 'Anomaly detection')}
            title={t('anomaly.summary.title', 'Coverage and anomaly windows')}
            description={summary.period.kind === 'unknown' ? summary.period.reason ?? summary.period.label : summary.period.label}
            metrics={briefMetrics}
            scope={summary.period.label}
            statusLabel={isLoading ? t('common.loading', 'Loading')
              : error ? t('error.loadFailed', 'Failed to load data')
                : state.refreshError || state.isRefreshBlocked ? t('developerReference.stats.state.retained', 'Showing retained measurements')
                  : data ? t('anomaly.summary.available', 'Detector snapshot available')
                    : t('anomaly.summary.unavailable', 'Detector snapshot unavailable')}
            statusTone={error ? 'danger' : state.refreshError || state.isRefreshBlocked ? 'warning' : 'neutral'}
            loading={isLoading}
          />
        </section>
      </FadeIn>

      {/* ── 2. Opt-in AI narration — self-hiding when ai_mode='off' ──── */}
      {/* Both cards render only when ai_mode != 'off' AND their feature   */}
      {/* toggle is on (withAiFeature HOC enforces the gate). The          */}
      {/* deterministic detector + safe-range logic below remains the     */}
      {/* canonical baseline in off mode (ADR-015 §I3).                    */}
      <FadeIn delay={0.04}>
        <section
          aria-label={t('anomaly.aiInsights', 'AI insights')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <AIAnomalyExplanations vehicleId={selectedId ?? undefined} />
          <AILearnedAnomalyBaselines vehicleId={selectedId ?? undefined} />
        </section>
      </FadeIn>

      {/* ── 3. Overview bento — frequency chart (hero) + system health ─ */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('anomaly.overview', 'Anomaly overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          {/* Frequency chart — spans two columns on wide screens. */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('anomaly.frequency', 'Most frequent anomalies')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={300} />
            ) : error ? (
              <QueryError error={error} onRetry={handleRetry} />
            ) : signalFrequency.length === 0 ? (
              <EmptyState /* no-action: transient — appears until the detector has produced results */
                icon={<BarChart3 className="h-8 w-8" />}
                message={noVehicle ? emptyMessage : t('anomaly.noFrequency', 'Anomaly frequency data will appear after detection runs.')}
              />
            ) : (
              <div className="h-72 sm:h-80">
                <EmbeddedChart
                  title={t('anomaly.frequency', 'Most frequent anomalies')}
                  ariaLabel={t('anomaly.frequencyAria', 'Bar chart of the most frequently anomalous signals')}
                  data={signalFrequency}
                  dataColumns={signalFrequencyColumns}
                  fluid
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={signalFrequency} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis dataKey="signal" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} width={140} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="count" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} name={t('anomaly.count', 'Anomalies')} />
                    </BarChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
              </div>
            )}
          </GlassPanel>

          {/* System health — compact side panel of category statuses. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('anomaly.healthSummary', 'System health')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : error ? (
              <QueryError error={error} onRetry={handleRetry} />
            ) : healthEntries.length === 0 ? (
              <EmptyState /* no-action: transient — health grid populates once telemetry is available */
                icon={<HeartPulse className="h-8 w-8" />}
                message={noVehicle ? emptyMessage : t('anomaly.noHealth', 'Health data will appear once telemetry is available.')}
              />
            ) : (
              <ul className="space-y-2">
                {healthEntries.map(([category, status]) => (
                  <SystemHealthCard key={category} category={category} status={status} />
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 4. Anomaly timeline — full-width detail band, reflows wide ─ */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {t('anomaly.timeline', 'Anomaly timeline')}
          </PanelTitle>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={148} className="rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <QueryError error={error} onRetry={handleRetry} />
          ) : anomalies.length === 0 ? (
            <EmptyState /* no-action: healthy state — no anomalies detected, nothing to recover */
              icon={<ShieldCheck className="h-8 w-8" />}
              message={noVehicle ? emptyMessage : t('anomaly.noAnomalies', 'No anomalies detected — all systems normal.')}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {anomalies.map((a, i) => (
                <AnomalyTimelineCard key={`${a.signal}-${a.type}-${i}`} anomaly={a} />
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}
