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
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Package,
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
                    'ring-2 ring-offset-2 ring-offset-transparent transition-shadow duration-700',
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
                  <div className="flex flex-wrap gap-4 text-xs text-white/40">
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
        </StaggerContainer>
      </div>
    </PageContainer>
  );
}
