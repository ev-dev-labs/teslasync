import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Shield,
  Clock,
  Activity,
  Car,
  Database,
  RefreshCw,
  Download,
  Trash2,
  Search,
  BarChart3,
  Key,
  Server,
  HardDrive,
  AlertTriangle,
} from 'lucide-react'
import { FadeIn, GlassPanel, PageHeader, Skeleton, Button, DataTable, Badge } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatDate, formatDateTime } from '../lib/dateFormat'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  getAPIUsage,
  getBackupStats,
  getAuditLogs,
  getAPIKeys,
  getExtendedHealth,
  refreshAuth,
  type BackupStats,
  type APIUsage,
  type ExtendedHealthResponse,
} from '../api'

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <GlassPanel className="p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-gradient-to-br ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
          <p className="text-lg font-semibold text-white">{value}</p>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function Admin() {
  usePageTitle('Admin')
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: health, isLoading: healthLoading, error: healthError } = useQuery<ExtendedHealthResponse>({
    queryKey: ['admin-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  })

  const { data: apiUsage, isLoading: usageLoading, error: usageError } = useQuery<APIUsage>({
    queryKey: ['admin-api-usage'],
    queryFn: getAPIUsage,
  })

  const { data: backupStats, isLoading: backupLoading, error: backupError } = useQuery<BackupStats>({
    queryKey: ['admin-backup-stats'],
    queryFn: getBackupStats,
  })

  const { data: auditLogs, isLoading: auditLoading, error: auditError } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => getAuditLogs(20),
  })

  const { data: apiKeys, isLoading: keysLoading, error: keysError } = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: getAPIKeys,
  })

  const healthStatus = health?.status ?? 'unknown'
  const componentCount = health?.components ? Object.keys(health.components).length : 0

  return (
    <FadeIn>
      <PageHeader
        title="Admin Panel"
        subtitle="System configuration and monitoring"
        icon={<Shield className="w-6 h-6 text-red-400" />}
      />

      {/* Error states */}
      {(healthError || usageError || backupError) && (
        <GlassPanel className="p-4 mb-6">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {healthError && `Health check failed: ${(healthError as Error).message}. `}
              {usageError && `API usage load failed: ${(usageError as Error).message}. `}
              {backupError && `Backup stats failed: ${(backupError as Error).message}.`}
            </span>
          </div>
        </GlassPanel>
      )}

      {/* System Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {healthLoading || usageLoading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : (
          <>
            <StatCard
              icon={Server}
              label="System Status"
              value={healthStatus === 'healthy' ? '✅ Healthy' : `⚠️ ${healthStatus}`}
              color="from-emerald-600 to-emerald-800"
            />
            <StatCard
              icon={Activity}
              label="API Requests"
              value={apiUsage?.total_requests?.toLocaleString() ?? '—'}
              color="from-blue-600 to-blue-800"
            />
            <StatCard
              icon={Car}
              label="Components"
              value={String(componentCount)}
              color="from-violet-600 to-violet-800"
            />
            <StatCard
              icon={HardDrive}
              label="DB Size"
              value={backupStats?.database_size ?? '—'}
              color="from-amber-600 to-amber-800"
            />
          </>
        )}
      </div>

      {/* Quick Actions */}
      <GlassPanel className="p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-cyan" />
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { icon: <RefreshCw className="w-4 h-4" />, label: 'Refresh Tokens', action: () => { refreshAuth().then(() => toast.success('Tokens refreshed')).catch(() => toast.error('Token refresh failed')) } },
            { icon: <Download className="w-4 h-4" />, label: 'Download Backup', action: () => window.open('/api/v1/system/backup', '_blank') },
            { icon: <Trash2 className="w-4 h-4" />, label: 'Clear Cache', action: () => { queryClient.clear(); toast.success('Query cache cleared') } },
            { icon: <Search className="w-4 h-4" />, label: 'Run Health Check', action: () => { queryClient.invalidateQueries({ queryKey: ['admin-health'] }); toast.success('Health check triggered') } },
            { icon: <BarChart3 className="w-4 h-4" />, label: 'View API Usage', action: () => { queryClient.invalidateQueries({ queryKey: ['admin-api-usage'] }); toast.success('API usage refreshed') } },
            { icon: <Key className="w-4 h-4" />, label: 'Manage API Keys', action: () => { window.location.href = '/admin#api-keys' } },
          ].map(({ icon, label, action }) => (
            <Button key={label} variant="secondary" size="sm" icon={icon} onClick={action}>{label}</Button>
          ))}
        </div>
      </GlassPanel>

      {/* Configuration & Database */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Polling Configuration */}
        <GlassPanel className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-neon-cyan" />
            Polling Configuration
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            Configured via environment variables
          </p>
          <div className="space-y-3">
            {[
              { label: 'Status Check', value: '60s', desc: 'POLL_INTERVAL_STATUS' },
              { label: 'While Driving', value: '10s', desc: 'POLL_INTERVAL_DRIVING' },
              { label: 'While Charging', value: '30s', desc: 'POLL_INTERVAL_CHARGING' },
              { label: 'Idle', value: '300s', desc: 'POLL_INTERVAL_IDLE' },
              { label: 'Sleep Attempt', value: '900s', desc: 'POLL_INTERVAL_SLEEP' },
            ].map(({ label, value, desc }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <span className="text-sm text-white">{label}</span>
                  <span className="ml-2 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                </div>
                <span className="text-sm font-mono text-neon-cyan">{value}</span>
              </div>
            ))}
          </div>
        </GlassPanel>

        {/* Database Stats */}
        <GlassPanel className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-neon-cyan" />
            Database
          </h3>
          {backupLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : backupStats ? (
            <>
              <div className="mb-4 flex items-center justify-between py-2 border-b border-white/5">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Size</span>
                <span className="text-sm font-mono text-white">{backupStats.database_size}</span>
              </div>
              <div className="mb-2 flex items-center justify-between py-2 border-b border-white/5">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Tables</span>
                <span className="text-sm font-mono text-white">{backupStats.table_count}</span>
              </div>
              {backupStats.row_counts && (
                <div className="mt-4 space-y-1.5 max-h-48 overflow-y-auto">
                  {Object.entries(backupStats.row_counts).map(([table, count]) => (
                    <div key={table} className="flex items-center justify-between text-xs">
                      <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{table}</span>
                      <span className="font-mono text-white">{(count as number).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Unable to load database stats</p>
          )}
        </GlassPanel>
      </div>

      {/* Recent Audit Log */}
      <GlassPanel className="p-6 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-neon-cyan" />
          Recent Activity
        </h3>
        {auditLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : auditError ? (
          <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Failed to load audit logs: {(auditError as Error).message}</p>
        ) : auditLogs?.length ? (
          <DataTable
            columns={[
              { key: 'time', header: 'Time', render: (log) => <span className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatDateTime(log.created_at)}</span> },
              { key: 'action', header: 'Action', render: (log) => <span className="text-white">{log.action}</span> },
              { key: 'resource', header: 'Resource', render: (log) => <span className="font-mono text-neon-cyan">{log.resource}</span> },
              { key: 'details', header: 'Details', render: (log) => <span className="text-xs truncate max-w-xs" style={{ color: 'var(--text-secondary)' }}>{log.details}</span> },
            ]}
            data={auditLogs}
            keyExtractor={(log) => String(log.id)}
            compact
          />
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No audit entries found</p>
        )}
      </GlassPanel>

      {/* API Keys */}
      <GlassPanel className="p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-neon-cyan" />
          API Keys
        </h3>
        {keysLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : keysError ? (
          <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Failed to load API keys: {(keysError as Error).message}</p>
        ) : apiKeys?.length ? (
          <DataTable
            columns={[
              { key: 'name', header: 'Name', render: (key) => <span className="text-white">{key.name}</span> },
              { key: 'prefix', header: 'Prefix', render: (key) => <span className="font-mono text-neon-cyan">{key.key_prefix}…</span> },
              { key: 'permissions', header: 'Permissions', render: (key) => <Badge color="neutral">{key.permissions}</Badge> },
              { key: 'last_used', header: 'Last Used', render: (key) => <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</span> },
              { key: 'expires', header: 'Expires', render: (key) => <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{key.expires_at ? formatDate(key.expires_at) : '—'}</span> },
            ]}
            data={apiKeys}
            keyExtractor={(key) => String(key.id)}
            compact
          />
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No API keys configured</p>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
