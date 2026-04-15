/**
 * ApiKeysPage — manage API keys for programmatic access to TeslaSync.
 *
 * Create, revoke, and delete API keys with permission levels.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { useApiKeys, useCreateApiKey, useDeleteApiKey, useRevokeApiKey } from '@/api/hooks/useAdmin';
import type { APIKey } from '@/types/admin';
import {
  Key, Plus, Trash2, Copy, Check, Shield, ShieldAlert, Crown, Clock, XCircle,
} from 'lucide-react';

// ─── Permission badge ────────────────────────────────────────────────────────

function PermissionBadge({ perm, t }: { perm: string; t: (k: string) => string }) {
  const cfg: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    read:         { icon: <Shield className="h-3 w-3" />,      color: '#10b981', label: t('Read') },
    'read-write': { icon: <ShieldAlert className="h-3 w-3" />, color: '#f59e0b', label: t('Read-Write') },
    admin:        { icon: <Crown className="h-3 w-3" />,       color: '#a855f7', label: t('Admin') },
  };
  const c = cfg[perm] ?? cfg.read;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: `${c.color}15`, color: c.color }}
    >
      {c.icon} {c.label}
    </span>
  );
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function APIKeysPage() {
  const { t } = useTranslation();
  usePageTitle(t('API Keys'));

  const { data: keys, isLoading } = useApiKeys();
  const createMut = useCreateApiKey();
  const deleteMut = useDeleteApiKey();
  const revokeMut = useRevokeApiKey();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerm, setNewPerm] = useState('read');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null);

  const handleCopy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isExpired = (k: APIKey) => k.expiresAt && new Date(k.expiresAt) < new Date();

  return (
    <PageContainer
      title={t('API Keys')}
      subtitle={t('Manage programmatic access to TeslaSync')}
      loading={isLoading}
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => { setShowCreate(true); setGeneratedKey(null); }}
        >
          {t('Create Key')}
        </Button>
      }
    >
      {/* ── Create Modal ─────────────────────────────────────────── */}
      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setGeneratedKey(null); }}
        title={generatedKey ? t('API Key Created') : t('New API Key')}
      >
        {generatedKey ? (
          <div className="space-y-4">
            <span className="text-xs text-[var(--text-muted)] block">
              {t("Copy this key now — it won't be shown again.")}
            </span>
            <div className="flex items-center gap-2">
              <GlassPanel className="flex-1 p-3 font-mono text-xs text-neon-cyan break-all">
                {generatedKey}
              </GlassPanel>
              <Button variant="secondary" onClick={handleCopy} className="p-2.5 shrink-0" title={t('Copy')}>
                {copied ? <Check className="h-4 w-4 text-neon-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setShowCreate(false); setGeneratedKey(null); }}>
              {t('Done')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label={t('Name')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('My Application')}
            />
            <Select
              label={t('Permissions')}
              value={newPerm}
              onChange={e => setNewPerm(e.target.value)}
              options={[
                { value: 'read', label: t('Read') },
                { value: 'read-write', label: t('Read-Write') },
                { value: 'admin', label: t('Admin') },
              ]}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => createMut.mutate(
                  { name: newName, permissions: newPerm },
                  { onSuccess: (data) => { setGeneratedKey(data.key); setNewName(''); } },
                )}
                disabled={!newName.trim()}
                loading={createMut.isPending}
              >
                {t('Generate Key')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Keys list ────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : keys && keys.length > 0 ? (
        <StaggerContainer className="space-y-3">
          {keys.map(k => (
            <StaggerItem key={k.id}>
              <GlassPanel className={cn('p-4', isExpired(k) && 'opacity-50')}>
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-neon-cyan/5 shrink-0">
                    <Key className="h-5 w-5 text-neon-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{k.name}</span>
                      <PermissionBadge perm={k.permissions} t={t} />
                      {isExpired(k) && (
                        <Badge variant="danger" size="sm">
                          <XCircle className="h-3 w-3 inline mr-0.5" /> {t('Expired')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)] flex-wrap">
                      <span className="font-mono">{k.keyPrefix}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t('Created')} {formatDate(k.createdAt)}
                      </span>
                      {k.lastUsedAt && (
                        <span>{t('Last used')} {formatDate(k.lastUsedAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isExpired(k) && (
                      <Button
                        variant="ghost"
                        onClick={() => revokeMut.mutate(k.id)}
                        title={t('Revoke')}
                        className="!p-2 hover:bg-neon-amber/10 hover:text-neon-amber"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(k)}
                      title={t('Delete')}
                      className="!p-2 hover:bg-neon-red/10 hover:text-neon-red"
                    >
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
          title={t('No API keys')}
          message={t('Create an API key to enable programmatic access to TeslaSync data and controls.')}
        />
      )}

      {/* ── Delete confirmation ──────────────────────────────────── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('Delete API Key')}
        message={t('Are you sure you want to permanently delete the key "{{name}}"?', { name: deleteTarget?.name })}
        confirmLabel={t('Delete')}
        variant="danger"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  );
}
