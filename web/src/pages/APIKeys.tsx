import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAPIKeys, createAPIKey, deleteAPIKey, revokeAPIKey, APIKey } from '../api'
import { Key, Plus, Trash2, Copy, Check, Shield, ShieldAlert, Crown, Clock, XCircle } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, EmptyState, ConfirmModal } from '../components/ui'
import { formatDate } from '../lib/dateFormat'
import clsx from 'clsx'

function PermissionBadge({ perm }: { perm: string }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    'read':       { icon: <Shield className="h-3 w-3" />,      color: '#10b981', label: '🔒 Read' },
    'read-write': { icon: <ShieldAlert className="h-3 w-3" />, color: '#f59e0b', label: '✏️ Read-Write' },
    'admin':      { icon: <Crown className="h-3 w-3" />,       color: '#a855f7', label: '👑 Admin' },
  }
  const c = cfg[perm] ?? cfg['read']
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: `${c.color}15`, color: c.color }}>
      {c.icon} {c.label}
    </span>
  )
}

export default function APIKeys() {
  const queryClient = useQueryClient()
  const { data: keys, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: getAPIKeys })
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPerm, setNewPerm] = useState('read')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null)

  const createMut = useMutation({
    mutationFn: createAPIKey,
    onSuccess: (data) => {
      setGeneratedKey(data.key)
      setNewName('')
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteAPIKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setDeleteTarget(null)
    },
  })

  const revokeMut = useMutation({
    mutationFn: revokeAPIKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  const handleCopy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const isExpired = (k: APIKey) => k.expires_at && new Date(k.expires_at) < new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        subtitle="Manage programmatic access to TeslaSync"
        icon={<Key className="h-6 w-6 text-neon-cyan" />}
        actions={
          <button onClick={() => { setShowCreate(true); setGeneratedKey(null) }} className="neon-button flex items-center gap-2 text-sm">
            <Plus className="h-4 w-4" /> Create Key
          </button>
        }
      />

      {/* Create Modal */}
      {showCreate && (
        <FadeIn>
          <GlassPanel className="p-6">
            {generatedKey ? (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-neon-green flex items-center gap-2">
                  <Check className="h-4 w-4" /> API Key Created
                </h3>
                <p className="text-xs text-[var(--text-muted)]">Copy this key now — it won't be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-neon-cyan break-all">
                    {generatedKey}
                  </code>
                  <button onClick={handleCopy} className="glass-button p-2.5 shrink-0" title="Copy">
                    {copied ? <Check className="h-4 w-4 text-neon-green" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <button onClick={() => { setShowCreate(false); setGeneratedKey(null) }} className="glass-button text-xs">
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Key className="h-4 w-4 text-neon-cyan" /> New API Key
                </h3>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Name</label>
                  <input
                    type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="My Application"
                    className="w-full p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-[var(--text-primary)] placeholder-gray-600 focus:outline-none focus:border-neon-cyan/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Permissions</label>
                  <select value={newPerm} onChange={e => setNewPerm(e.target.value)}
                    className="w-full p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-[var(--text-primary)] focus:outline-none focus:border-neon-cyan/40">
                    <option value="read">🔒 Read</option>
                    <option value="read-write">✏️ Read-Write</option>
                    <option value="admin">👑 Admin</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => createMut.mutate({ name: newName, permissions: newPerm })}
                    disabled={!newName.trim() || createMut.isPending}
                    className="neon-button text-xs flex items-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Generate Key
                  </button>
                  <button onClick={() => setShowCreate(false)} className="glass-button text-xs">Cancel</button>
                </div>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

      {/* Keys List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : keys && keys.length > 0 ? (
        <StaggerContainer className="space-y-3">
          {keys.map(k => (
            <StaggerItem key={k.id}>
              <GlassPanel className={clsx('p-4', isExpired(k) && 'opacity-50')}>
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-neon-cyan/5">
                    <Key className="h-5 w-5 text-neon-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{k.name}</span>
                      <PermissionBadge perm={k.permissions} />
                      {isExpired(k) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-neon-red/10 text-neon-red">
                          <XCircle className="h-3 w-3" /> Expired
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
                      <span className="font-mono">{k.key_prefix}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Created {formatDate(k.created_at)}
                      </span>
                      {k.last_used_at && (
                        <span>Last used {formatDate(k.last_used_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isExpired(k) && (
                      <button
                        onClick={() => revokeMut.mutate(k.id)}
                        className="rounded-lg p-2 text-gray-600 hover:bg-neon-amber/10 hover:text-neon-amber transition-all"
                        title="Revoke"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(k)}
                      className="rounded-lg p-2 text-gray-600 hover:bg-neon-red/10 hover:text-neon-red transition-all"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </GlassPanel>
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <EmptyState
          icon={<Key className="h-10 w-10" />}
          title="No API keys"
          description="Create an API key to enable programmatic access to TeslaSync data and controls."
        />
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete API Key"
        message={`Are you sure you want to permanently delete the key "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
