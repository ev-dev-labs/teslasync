import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AlertTriangle, Clock, HeartPulse, BarChart3, ShieldCheck,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip, CHART_COLORS,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, StatGridSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useAnomalies } from '@/api/hooks/useAnomalies';
import { AIAnomalyExplanations } from '@/components/ai/AIAnomalyExplanations';
import { AILearnedAnomalyBaselines } from '@/components/ai/AILearnedAnomalyBaselines';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';

import { AnomalyTimelineCard, SystemHealthCard } from '../components/anomaly-dashboard';

export default function AnomalyDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t('anomaly.title', 'Anomaly Detection'));

  const { vehicleId: selectedId } = useSelectedVehicle();
  const activeIdStr = selectedId != null ? String(selectedId) : null;
  const noVehicle = activeIdStr === null;

  const anomaliesQuery = useAnomalies(activeIdStr);
  const { data, isLoading, error, refetch } = anomaliesQuery;

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

  const emptyMessage = noVehicle
    ? t('anomaly.selectVehicle', 'Select a vehicle to view its anomaly analysis.')
    : t('anomaly.noData', 'No data available yet.');

  return (
    <PageContainer
      title={t('anomaly.title', 'Anomaly Detection')}
      subtitle={t('anomaly.subtitle', 'Automatic health monitoring and signal anomaly detection')}
      actions={<VehicleSelect />}
      query={anomaliesQuery}
    >
      {/* ── 1. KPI band — full-width responsive metric grid ─────────── */}
      <FadeIn>
        <section aria-label={t('anomaly.kpis', 'Summary metrics')}>
          {isLoading && !data ? (
            <StatGridSkeleton cards={4} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <MetricCard
                label={t('anomaly.monitored', 'Signals Monitored')}
                value={data?.signals_monitored ?? 0}
                icon={<Activity className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('anomaly.last7d', 'Anomalies (7d)')}
                value={data?.anomalies_last_7d ?? 0}
                icon={<AlertTriangle className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('anomaly.last24h', 'Anomalies (24h)')}
                value={data?.anomalies_last_24h ?? 0}
                icon={<Clock className="h-5 w-5" />}
                color="red"
              />
              <MetricCard
                label={t('anomaly.categories', 'Health Categories')}
                value={healthEntries.length}
                icon={<HeartPulse className="h-5 w-5" />}
                color="green"
              />
            </div>
          )}
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
              {t('anomaly.frequency', 'Most Frequent Anomalies')}
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
              <div
                role="img"
                aria-label={t('anomaly.frequencyAria', 'Bar chart of the most frequently anomalous signals')}
                className="h-72 sm:h-80"
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
              </div>
            )}
          </GlassPanel>

          {/* System health — compact side panel of category statuses. */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('anomaly.healthSummary', 'System Health')}
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
            {t('anomaly.timeline', 'Anomaly Timeline')}
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
    </PageContainer>
  );
}
