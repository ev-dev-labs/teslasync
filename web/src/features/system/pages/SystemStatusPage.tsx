/**
 * SystemStatusPage — health monitoring dashboard for all backend services.
 *
 * Thin orchestrator that renders:
 * - Overall status hero with component badges and version info
 * - 7 accordion sections, each independently fetching their own data
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Package, Activity, ExternalLink,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Grid } from '@/components/layout';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { InlineMetric } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSystemHealth } from '@/api/hooks/useAdmin';
import { getVersionInfo } from '@/api/devtools';
import { cn } from '@/lib/cn';

import {
  getStatusColor, statusTextClass, statusToBadgeVariant, formatUptime,
} from '../components/status/helpers';
import {
  HealthProbesSection,
  BackendStatusSection,
  ServiceHealthSection,
  InfrastructureSection,
  DataPipelineSection,
  OperationsSection,
  DiagnosticsSection,
} from '../components/status';

export default function SystemStatusPage() {
  const { t } = useTranslation();
  usePageTitle(t('System Status'));

  const queryClient = useQueryClient();

  const {
    data: health,
    isLoading,
    error,
    refetch: refetchHealth,
  } = useSystemHealth();

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const handleRefreshAll = useCallback(() => {
    refetchHealth();
    queryClient.invalidateQueries({ queryKey: ['system-status'] });
  }, [refetchHealth, queryClient]);

  const components = health ? Object.entries(health.components) : [];
  const okCount = components.filter(([, c]) => c.status === 'ok').length;
  const degradedCount = components.filter(([, c]) => c.status === 'degraded').length;
  const unhealthyCount = components.filter(([, c]) => c.status === 'unhealthy').length;

  const overallStatus = health?.status ?? 'unknown';
  const glowColor: 'cyan' | 'green' | 'purple' | 'none' =
    overallStatus === 'healthy' ? 'green'
    : overallStatus === 'degraded' ? 'cyan'
    : 'none';

  return (
    <PageContainer
      title={t('System Status')}
      subtitle={t('Health monitoring for all backend services')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <Button variant="ghost" size="sm" onClick={handleRefreshAll} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t('Refresh')}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Overall Status Hero */}
        <FadeIn>
          <GlassPanel glow={glowColor} className="p-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex flex-col items-center gap-3">
                <div
                  className={cn(
                    'h-20 w-20 rounded-full flex items-center justify-center',
                    'ring-2 ring-offset-2 ring-offset-transparent transition-shadow duration-slow',
                    overallStatus === 'healthy' && 'bg-green-500/20 ring-green-500/40',
                    overallStatus === 'degraded' && 'bg-yellow-500/20 ring-yellow-500/40',
                    overallStatus === 'unhealthy' && 'bg-red-500/20 ring-red-500/40',
                    overallStatus === 'unknown' && 'bg-gray-500/20 ring-gray-500/40',
                  )}
                  style={{ boxShadow: `0 0 40px ${getStatusColor(overallStatus)}44` }}
                >
                  <div className={statusTextClass(overallStatus)}>
                    {overallStatus === 'healthy' ? (
                      <CheckCircle className="h-10 w-10" />
                    ) : overallStatus === 'degraded' ? (
                      <AlertTriangle className="h-10 w-10" />
                    ) : (
                      <XCircle className="h-10 w-10" />
                    )}
                  </div>
                </div>
                <span className={cn('text-lg font-bold uppercase tracking-wider', statusTextClass(overallStatus))}>
                  {overallStatus}
                </span>
              </div>

              <div className="flex-1 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {components.map(([name, comp]) => (
                    <Badge key={name} variant={statusToBadgeVariant(comp.status)} size="sm" dot>
                      {name}
                    </Badge>
                  ))}
                </div>

                <Grid cols={{ default: 2, lg: 4 }} gap={3}>
                  <InlineMetric icon={<CheckCircle className="h-4 w-4 text-green-400" />} value={okCount} label={t('Healthy')} />
                  <InlineMetric icon={<AlertTriangle className="h-4 w-4 text-yellow-400" />} value={degradedCount} label={t('Degraded')} />
                  <InlineMetric icon={<XCircle className="h-4 w-4 text-red-400" />} value={unhealthyCount} label={t('Unhealthy')} />
                  {version && (
                    <InlineMetric icon={<Package className="h-4 w-4 text-cyan-400" />} value={version.app_version} label={t('Version')} />
                  )}
                </Grid>

                {version && (
                  <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                    <span>{t('Chart')}: {version.chart_version}</span>
                    <span>{t('Go')}: {version.go_version}</span>
                    <span>{t('Uptime')}: {formatUptime(version.uptime_seconds)}</span>
                  </div>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Accordion Sections */}
        <StaggerContainer className="space-y-4">
          <StaggerItem><HealthProbesSection /></StaggerItem>
          <StaggerItem><BackendStatusSection /></StaggerItem>
          <StaggerItem><ServiceHealthSection /></StaggerItem>
          <StaggerItem><InfrastructureSection /></StaggerItem>
          <StaggerItem><DataPipelineSection /></StaggerItem>
          <StaggerItem><OperationsSection /></StaggerItem>
          <StaggerItem><DiagnosticsSection /></StaggerItem>
          <StaggerItem><ClientPerformancePanel /></StaggerItem>
        </StaggerContainer>
      </div>
    </PageContainer>
  );
}

// ── Client Performance (Phase 45 / Prompt 12) ───────────────────────────────
// Surfaces the fact that real-world Web Vitals are now collected and points
// engineers at the Grafana dashboard for the per-route p75 view. The in-app
// chart is deliberately deferred to a follow-up — Prometheus is the canonical
// metrics store and we don't want to duplicate query logic here.
function ClientPerformancePanel() {
  const { t } = useTranslation();
  const grafanaUrl =
    (import.meta.env.VITE_GRAFANA_URL as string | undefined) ?? '';

  return (
    <GlassPanel className="p-5">
      <div className="flex items-start gap-3">
        <div className="text-cyan-400 shrink-0 mt-0.5">
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {t('admin.systemStatus.clientPerformance.title', 'Client Performance')}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t(
              'admin.systemStatus.clientPerformance.description',
              'Web Vitals (LCP, INP, CLS, FCP, TTFB) are collected from real browser sessions and exported as Prometheus histograms (teslasync_web_vitals_value).',
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="success" size="sm" dot>
              {t('admin.systemStatus.clientPerformance.collecting', 'Collecting')}
            </Badge>
            <span className="text-xs text-[var(--text-muted)]">
              {t(
                'admin.systemStatus.clientPerformance.metricsList',
                'LCP · INP · CLS · FCP · TTFB',
              )}
            </span>
          </div>
          {grafanaUrl ? (
            <div className="pt-2">
              <a
                href={grafanaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-300 hover:text-cyan-200 transition-colors"
              >
                {t(
                  'admin.systemStatus.clientPerformance.viewDashboard',
                  'View dashboard',
                )}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <div className="pt-2 text-xs text-[var(--text-muted)]">
              {t(
                'admin.systemStatus.clientPerformance.noDashboard',
                'Set VITE_GRAFANA_URL at build time to surface a link to the Web Vitals dashboard.',
              )}
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
