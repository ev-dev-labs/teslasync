import { useQuery } from '@tanstack/react-query'
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
} from 'lucide-react'
import { FadeIn, GlassPanel, PageHeader, Skeleton } from '../components/ui'
import {
  getAPIUsage,
  getBackupStats,
  getAuditLogs,
  getAPIKeys,
  getExtendedHealth,
  refreshAuth,
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
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['admin-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  })

  const { data: apiUsage, isLoading: usageLoading } = useQuery({
    queryKey: ['admin-api-usage'],
    queryFn: getAPIUsage,
  })

  const { data: backupStats, isLoading: backupLoading } = useQuery({
    queryKey: ['admin-backup-stats'],
    queryFn: getBackupStats,
  })

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => getAuditLogs(20),
  })

  const { data: apiKeys, isLoading: keysLoading } = useQuery({
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
        <div className="flex flex-wrap gap-3">
          {[
            { icon: <RefreshCw className="w-4 h-4" />, label: 'Refresh Tokens', action: () => refreshAuth() },
            { icon: <Download className="w-4 h-4" />, label: 'Download Backup', action: () => window.open('/api/v1/system/backup', '_blank') },
            { icon: <Trash2 className="w-4 h-4" />, label: 'Clear Cache', action: () => {} },
            { icon: <Search className="w-4 h-4" />, label: 'Run Health Check', action: () => {} },
            { icon: <BarChart3 className="w-4 h-4" />, label: 'View API Usage', action: () => {} },
            { icon: <Key className="w-4 h-4" />, label: 'Rotate API Keys', action: () => {} },
          ].map(({ icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              {icon}
              {label}
            </button>
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
        ) : auditLogs?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Time</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Action</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Resource</th>
                  <th className="text-left py-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 text-xs font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-white">{log.action}</td>
                    <td className="py-2 pr-4 font-mono text-neon-cyan">{log.resource}</td>
                    <td className="py-2 text-xs truncate max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        ) : apiKeys?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Prefix</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Permissions</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Last Used</th>
                  <th className="text-left py-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 text-white">{key.name}</td>
                    <td className="py-2 pr-4 font-mono text-neon-cyan">{key.key_prefix}…</td>
                    <td className="py-2 pr-4">
                      <span className="px-1.5 py-0.5 text-xs rounded bg-white/10 text-gray-300">{key.permissions}</span>
                    </td>
                    <td className="py-2 pr-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {key.expires_at ? new Date(key.expires_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No API keys configured</p>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
