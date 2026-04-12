import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/api/hooks/useAdmin';

const permissionVariant: Record<string, 'info' | 'warning' | 'danger'> = {
  read: 'info', 'read-write': 'warning', admin: 'danger',
};

export default function APIKeysPage() {
  const { t } = useTranslation();
  const { data: keys, isLoading, error } = useApiKeys();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState('read');
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    const result = await createMutation.mutateAsync({ name, permissions });
    setGeneratedKey(result.key);
    setName('');
  }

  function handleCopy() {
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <PageContainer
      title={t('API Keys')}
      subtitle={t('Manage API keys for external integrations')}
      loading={isLoading}
      error={error as Error | null}
      actions={<Button variant="primary" size="sm" onClick={() => { setShowForm(true); setGeneratedKey(''); }}>{t('Create Key')}</Button>}
    >
      {showForm && (
        <Card>
          <CardHeader title={generatedKey ? t('Key Generated') : t('Create New Key')} />
          <div className="px-4 pb-4 space-y-3">
            {generatedKey ? (
              <>
                <p className="text-xs text-amber-400">{t('Copy this key now — it won\'t be shown again.')}</p>
                <div className="flex gap-2">
                  <code className="flex-1 bg-gray-800 px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
                  <Button size="sm" variant="outline" onClick={handleCopy}>{copied ? t('Copied!') : t('Copy')}</Button>
                </div>
                <Button size="sm" variant="secondary" onClick={() => { setShowForm(false); setGeneratedKey(''); }}>{t('Done')}</Button>
              </>
            ) : (
              <>
                <Input label={t('Name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="My integration" />
                <div>
                  <label className="text-sm text-gray-400 block mb-1">{t('Permissions')}</label>
                  <select className="w-full rounded border px-2 py-1 text-sm bg-transparent" value={permissions} onChange={(e) => setPermissions(e.target.value)}>
                    <option value="read">Read</option>
                    <option value="read-write">Read-Write</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" loading={createMutation.isPending} onClick={handleCreate}>{t('Generate')}</Button>
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>{t('Cancel')}</Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {keys?.length ? (
        <div className="space-y-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-semibold">{key.name}</p>
                  <p className="text-xs text-gray-400 font-mono">●●●●●{key.keyPrefix}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant={permissionVariant[key.permissions] ?? 'neutral'} size="sm">{key.permissions}</Badge>
                    {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                      <Badge variant="danger" size="sm">{t('Expired')}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(key.id)}>
                    {t('Delete')}
                  </Button>
                </div>
              </div>
              <div className="px-4 pb-3 text-xs text-gray-500">
                {t('Created')}: {new Date(key.createdAt).toLocaleDateString()}
                {key.lastUsedAt && <> · {t('Last used')}: {new Date(key.lastUsedAt).toLocaleDateString()}</>}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState message={t('No API keys yet. Create one to get started.')} />
      )}
    </PageContainer>
  );
}
