import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, AlertTriangle, Activity, Zap,
  Thermometer, Car, Battery, Wind,
  ChevronRight,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import {
  ChartTooltip, axisTickSm, CHART_COLORS,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { useAnomalies, type AnomalyEntry } from '@/api/hooks/useAnomalies';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ── Helpers ──────────────────────────────────────────────── */

const HEALTH_ICONS: Record<string, typeof Battery> = {
  battery: Battery,
  tires: Car,
  motors: Zap,
  hvac: Wind,
  charging: Activity,
};

function severityVariant(s: string): 'success' | 'warning' | 'danger' {
  if (s === 'critical') return 'danger';
  if (s === 'warning') return 'warning';
  return 'success';
}

function statusColor(s: string): string {
  if (s === 'critical') return 'text-red-400';
  if (s === 'warning') return 'text-neon-amber';
  return 'text-neon-green';
}

function statusBg(s: string): string {
  if (s === 'critical') return 'bg-red-500/10 border-red-500/20';
  if (s === 'warning') return 'bg-neon-amber/10 border-neon-amber/20';
  return 'bg-neon-green/10 border-neon-green/20';
}

function typeLabel(type: string): string {
  switch (type) {
    case 'z_score': return 'Statistical';
    case 'range': return 'Range';
    case 'trend': return 'Trend';
    default: return type;
  }
}

/* ── Page ─────────────────────────────────────────────────── */

export default function AnomalyDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t('anomaly.title', 'Anomaly Detection'));

  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;
  const activeIdStr = activeId != null ? String(activeId) : null;

  const { data, isLoading, error } = useAnomalies(activeIdStr);

  /* Anomaly frequency by signal (for bar chart) */
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

  const healthEntries = Object.entries(data?.health_summary ?? {});

  return (
    <PageContainer
      title={t('anomaly.title', 'Anomaly Detection')}
      subtitle={t('anomaly.subtitle', 'Automatic health monitoring and signal anomaly detection')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(Number(e.target.value))}
          />
        ) : undefined
      }
    >
      {/* ── Summary Stats ──────────────────────────────── */}
      <FadeIn>
        <StaggerContainer className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StaggerItem>
            <StatCard
              label={t('anomaly.monitored', 'Signals Monitored')}
              value={data?.signals_monitored ?? 0}
              icon={<Activity className="h-4 w-4" />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.last7d', 'Anomalies (7d)')}
              value={data?.anomalies_last_7d ?? 0}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.last24h', 'Anomalies (24h)')}
              value={data?.anomalies_last_24h ?? 0}
              icon={<Shield className="h-4 w-4" />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.categories', 'Health Categories')}
              value={healthEntries.length}
              icon={<Thermometer className="h-4 w-4" />}
            />
          </StaggerItem>
        </StaggerContainer>
      </FadeIn>

      {/* ── Health Summary Cards ───────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold">
            {t('anomaly.healthSummary', 'System Health')}
          </h3>
          {healthEntries.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {healthEntries.map(([category, status]) => {
                const Icon = HEALTH_ICONS[category] ?? Shield;
                return (
                  <div
                    key={category}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl p-4 border',
                      statusBg(status),
                    )}
                  >
                    <Icon className={cn('h-6 w-6', statusColor(status))} />
                    <span className="text-xs font-medium capitalize text-white/80">{category}</span>
                    <Badge variant={severityVariant(status)} size="sm">
                      {status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message={t('anomaly.noHealth', 'Health data will appear once telemetry is available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Anomaly Timeline ──────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-neon-amber" />
            {t('anomaly.timeline', 'Anomaly Timeline')}
          </h3>
          {(data?.anomalies ?? []).length > 0 ? (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {(data?.anomalies ?? []).map((a: AnomalyEntry, i: number) => (
                <div
                  key={`${a.signal}-${a.type}-${i}`}
                  className={cn(
                    'flex items-start gap-3 rounded-xl p-4 border',
                    a.severity === 'critical' ? 'bg-red-500/[0.05] border-red-500/15' :
                    a.severity === 'warning' ? 'bg-neon-amber/[0.05] border-neon-amber/15' :
                    'bg-white/[0.02] border-white/[0.06]',
                  )}
                >
                  <div className="shrink-0 mt-0.5">
                    <Badge variant={severityVariant(a.severity)} size="sm">
                      {a.severity}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{a.signal}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/50">
                        {typeLabel(a.type)}
                      </span>
                      {a.z_score > 0 && (
                        <span className="text-[10px] text-white/40">
                          {fmtNumber(a.z_score, 1)}σ
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/60 mt-1">{a.message}</p>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-white/30">
                      <span>{t('anomaly.value', 'Value')}: {fmtNumber(a.value, 2)}</span>
                      <span>{t('anomaly.baseline', 'Baseline')}: {fmtNumber(a.baseline, 2)}</span>
                      <span>{new Date(a.detected_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/20" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Shield className="h-8 w-8" />}
              message={t('anomaly.noAnomalies', 'No anomalies detected — all systems normal.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Anomaly Frequency by Signal ───────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold">
            {t('anomaly.frequency', 'Most Frequent Anomalies')}
          </h3>
          {signalFrequency.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, signalFrequency.length * 35)}>
              <BarChart data={signalFrequency} layout="vertical">
                <XAxis type="number" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis dataKey="signal" type="category" tick={axisTickSm} tickLine={false} axisLine={false} width={140} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} name={t('anomaly.count', 'Anomalies')} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('anomaly.noFrequency', 'Anomaly frequency data will appear after detection runs.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
