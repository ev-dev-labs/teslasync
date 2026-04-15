/**
 * AdminPage — system admin panel with health, quick actions, polling config,
 * database stats, audit log, and API key management.
 */

import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import {
  useSystemHealth, useAuditLogs, useApiKeys, useApiLogStats,
} from '@/api/hooks/useAdmin';
import { useRefreshAuth } from '@/api/hooks/useSettings';
import type { AuditLogEntry, APIKey, SystemHealth } from '@/types/admin';
import {
  Shield, Clock, Activity, Database, RefreshCw, Download, Trash2,
  Search, BarChart3, Key, Server, HardDrive, AlertTriangle,
} from 'lucide-react';

// ─── Page component ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const { t } = useTranslation();
  usePageTitle(t('Admin'));
  const toast = useToast();
  const queryClient = useQueryClient();

  // Queries
  const { data: health, isLoading: healthLoading, error: healthError } = useSystemHealth();
  const { data: apiLogStats, isLoading: usageLoading, error: usageError } = useApiLogStats();
  const { data: auditLogs, isLoading: auditLoading, error: auditError } = useAuditLogs();
  const { data: apiKeys, isLoading: keysLoading, error: keysError } = useApiKeys();
  const refreshMut = useRefreshAuth();

  const typedHealth = health as SystemHealth | undefined;
  const healthStatus = typedHealth?.status ?? 'unknown';
  const components = typedHealth?.components;
  const componentCount = components ? Object.keys(components).length : 0;
  const dbSize = typedHealth?.databaseSize ?? '—';
  const tableCount = typedHealth?.tableCount ?? 0;

  const anyError = healthError || usageError;

  // Audit columns
  const auditColumns: Column<AuditLogEntry>[] = [
    { key: 'time', header: t('Time'), render: (log) => <span className="text-xs font-mono whitespace-nowrap text-[var(--text-muted)]">{formatDateTime(log.createdAt)}</span> },
    { key: 'action', header: t('Action'), render: (log) => <span className="text-[var(--text-primary)]">{log.action}</span> },
    { key: 'resource', header: t('Resource'), render: (log) => <span className="font-mono text-neon-cyan">{log.resource}</span> },
    { key: 'details', header: t('Details'), render: (log) => <span className="text-xs truncate max-w-xs text-[var(--text-muted)]">{log.details}</span> },
  ];

  // API key columns
  const keyColumns: Column<APIKey>[] = [
    { key: 'name', header: t('Name'), render: (k) => <span className="text-[var(--text-primary)]">{k.name}</span> },
    { key: 'prefix', header: t('Prefix'), render: (k) => <span className="font-mono text-neon-cyan">{k.keyPrefix}…</span> },
    { key: 'permissions', header: t('Permissions'), render: (k) => <Badge variant="neutral" size="sm">{k.permissions}</Badge> },
    { key: 'last_used', header: t('Last Used'), render: (k) => <span className="text-xs text-[var(--text-muted)]">{k.lastUsedAt ? formatDate(k.lastUsedAt) : t('Never')}</span> },
    { key: 'expires', header: t('Expires'), render: (k) => <span className="text-xs text-[var(--text-muted)]">{k.expiresAt ? formatDate(k.expiresAt) : '—'}</span> },
  ];

  // Quick actions
  const quickActions = [
    { icon: <RefreshCw className="w-4 h-4" />, label: t('Refresh Tokens'), action: () => refreshMut.mutate(undefined, { onSuccess: () => toast.success(t('Tokens refreshed')), onError: () => toast.error(t('Token refresh failed')) }) },
    { icon: <Download className="w-4 h-4" />, label: t('Download Backup'), action: () => window.open('/api/v1/system/backup', '_blank') },
    { icon: <Trash2 className="w-4 h-4" />, label: t('Clear Cache'), action: () => { queryClient.clear(); toast.success(t('Query cache cleared')); } },
    { icon: <Search className="w-4 h-4" />, label: t('Run Health Check'), action: () => { queryClient.invalidateQueries({ queryKey: ['system-health'] }); toast.success(t('Health check triggered')); } },
    { icon: <BarChart3 className="w-4 h-4" />, label: t('View API Usage'), action: () => { queryClient.invalidateQueries({ queryKey: ['api-log-stats'] }); toast.success(t('API usage refreshed')); } },
    { icon: <Key className="w-4 h-4" />, label: t('Manage API Keys'), action: () => { window.location.href = '/admin#api-keys'; } },
  ];

  // Polling configuration (static, configured via env vars)
  const pollingConfig = [
    { label: t('Status Check'), value: '60s', desc: 'POLL_INTERVAL_STATUS' },
    { label: t('While Driving'), value: '10s', desc: 'POLL_INTERVAL_DRIVING' },
    { label: t('While Charging'), value: '30s', desc: 'POLL_INTERVAL_CHARGING' },
    { label: t('Idle'), value: '300s', desc: 'POLL_INTERVAL_IDLE' },
    { label: t('Sleep Attempt'), value: '900s', desc: 'POLL_INTERVAL_SLEEP' },
  ];

  return (
    <PageContainer
      title={t('Admin Panel')}
      subtitle={t('System configuration and monitoring')}
      loading={healthLoading && usageLoading}
    >
      {/* ── Error banner ─────────────────────────────────────────── */}
      {anyError && (
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 text-neon-red text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {healthError && `${t('Health check failed')}: ${(healthError as Error).message}. `}
              {usageError && `${t('API usage load failed')}: ${(usageError as Error).message}.`}
            </span>
          </div>
        </GlassPanel>
      )}

      {/* ── System overview cards ────────────────────────────────── */}
      <FadeIn>
        {healthLoading || usageLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard icon={<Server className="h-4 w-4" />} label={t('System Status')} value={healthStatus === 'healthy' ? `✓ ${t('Healthy')}` : healthStatus} color="green" />
            <MetricCard icon={<Activity className="h-4 w-4" />} label={t('API Requests')} value={apiLogStats?.totalCalls != null ? fmtInt(apiLogStats.totalCalls) : '—'} color="cyan" />
            <MetricCard icon={<Shield className="h-4 w-4" />} label={t('Components')} value={String(componentCount)} color="purple" />
            <MetricCard icon={<HardDrive className="h-4 w-4" />} label={t('DB Size')} value={dbSize} color="amber" />
          </div>
        )}
      </FadeIn>

      {/* ── Quick Actions ────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <span className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-neon-cyan" />
            {t('Quick Actions')}
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            {quickActions.map(({ icon, label, action }) => (
              <Button key={label} variant="secondary" size="sm" icon={icon} onClick={action}>{label}</Button>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Polling Config + Database ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Polling Configuration */}
        <FadeIn>
          <GlassPanel className="p-6">
            <span className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-neon-cyan" />
              {t('Polling Configuration')}
            </span>
            <span className="text-xs text-[var(--text-muted)] mb-4 block mt-2">{t('Configured via environment variables')}</span>
            <div className="space-y-3">
              {pollingConfig.map(({ label, value, desc }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-white/5">
                  <div>
                    <span className="text-sm text-[var(--text-primary)]">{label}</span>
                    <span className="ml-2 text-xs font-mono text-[var(--text-muted)]">{desc}</span>
                  </div>
                  <span className="text-sm font-mono text-neon-cyan">{value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Database Stats */}
        <FadeIn>
          <GlassPanel className="p-6">
            <span className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-neon-cyan" />
              {t('Database')}
            </span>
            {healthLoading ? (
              <div className="space-y-2 mt-4">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
              </div>
            ) : typedHealth ? (
              <div className="mt-4">
                <div className="mb-4 flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-[var(--text-muted)]">{t('Total Size')}</span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">{dbSize}</span>
                </div>
                <div className="mb-2 flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-[var(--text-muted)]">{t('Tables')}</span>
                  <span className="text-sm font-mono text-[var(--text-primary)]">{tableCount}</span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-[var(--text-muted)] mt-4 block">{t('Unable to load database stats')}</span>
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* ── Recent Audit Log ─────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <span className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-neon-cyan" />
            {t('Recent Activity')}
          </span>
          {auditLoading ? (
            <div className="space-y-2 mt-4">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8" />)}</div>
          ) : auditError ? (
            <span className="text-sm text-neon-red flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" /> {t('Failed to load audit logs')}: {(auditError as Error).message}
            </span>
          ) : (auditLogs as AuditLogEntry[])?.length ? (
            <div className="mt-4">
              <DataTable
                columns={auditColumns}
                data={auditLogs as AuditLogEntry[]}
                keyExtractor={(log) => String(log.id)}
                compact
                pagination={{ defaultPageSize: 50 }}
              />
            </div>
          ) : (
            <span className="text-sm text-[var(--text-muted)] mt-4 block">{t('No audit entries found')}</span>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── API Keys ─────────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6" id="api-keys">
          <span className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Key className="w-5 h-5 text-neon-cyan" />
            {t('API Keys')}
          </span>
          {keysLoading ? (
            <div className="space-y-2 mt-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>
          ) : keysError ? (
            <span className="text-sm text-neon-red flex items-center gap-2 mt-4">
              <AlertTriangle className="h-4 w-4" /> {t('Failed to load API keys')}: {(keysError as Error).message}
            </span>
          ) : (apiKeys as APIKey[])?.length ? (
            <div className="mt-4">
              <DataTable
                columns={keyColumns}
                data={apiKeys as APIKey[]}
                keyExtractor={(k) => String(k.id)}
                compact
                pagination
              />
            </div>
          ) : (
            <span className="text-sm text-[var(--text-muted)] mt-4 block">{t('No API keys configured')}</span>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
