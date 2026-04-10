import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAPIKeys, createAPIKey, deleteAPIKey, revokeAPIKey, APIKey } from '../api'
import { Key, Plus, Trash2, Copy, Check, Shield, ShieldAlert, Crown, Clock, XCircle } from 'lucide-react'
import { PageHeader, GlassPanel, StaggerContainer, StaggerItem, Skeleton, EmptyState, ConfirmModal, Button, Badge, Modal, Select, Input } from '../components/ui'
import { formatDate } from '../lib/dateFormat'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

function PermissionBadge({ perm }: { perm: string }) {
  usePageTitle('API Keys')
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
          <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setShowCreate(true); setGeneratedKey(null) }}>Create Key</Button>
        }
      />

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setGeneratedKey(null) }} title={generatedKey ? 'API Key Created' : 'New API Key'}>
        {generatedKey ? (
          <div className="space-y-4">
            <p className="text-xs text-[var(--text-muted)]">Copy this key now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-neon-cyan break-all">
                {generatedKey}
              </code>
              <Button variant="secondary" onClick={handleCopy} className="p-2.5 shrink-0" title="Copy" aria-label="Copy API key">
                {copied ? <Check className="h-4 w-4 text-neon-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setShowCreate(false); setGeneratedKey(null) }}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="api-key-name" className="block text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Name</label>
              <Input
                id="api-key-name"
                type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="My Application"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">Permissions</label>
              <Select value={newPerm} onChange={e => setNewPerm(e.target.value)}
                options={[{ value: 'read', label: '🔒 Read' }, { value: 'read-write', label: '✏️ Read-Write' }, { value: 'admin', label: '👑 Admin' }]} />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => createMut.mutate({ name: newName, permissions: newPerm })} disabled={!newName.trim()} loading={createMut.isPending}>Generate Key</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

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
                        <Badge color="red"><XCircle className="h-3 w-3" /> Expired</Badge>
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
                      <Button variant="ghost" onClick={() => revokeMut.mutate(k.id)} title="Revoke" className="!p-2 hover:bg-neon-amber/10 hover:text-neon-amber">
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setDeleteTarget(k)} title="Delete" className="!p-2 hover:bg-neon-red/10 hover:text-neon-red">
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
