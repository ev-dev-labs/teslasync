import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Modal, Button, Input, Select, Checkbox, GlassPanel, CopyButton, MaskedValue, Text, HelperText } from '@/components/ui';
import { useCreateApiKey } from '@/api/hooks/useAdmin';
import { useAuthMode } from '@/api/hooks/useAuthMode';
import { PERMISSION_ORDER, type ApiKeyPermission } from './constants';

interface CreateApiKeyModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Two-phase key creation dialog:
 *   1. name + permission form → POST /api-keys
 *   2. one-time reveal of the generated secret (masked, copyable).
 * Owns its own form + generated-key state and resets it whenever the dialog
 * closes so a stale secret can never leak into the next open.
 */
export function CreateApiKeyModal({ open, onClose }: CreateApiKeyModalProps) {
  // The form owns queries (auth mode) — keep it unmounted while closed so
  // the page pays nothing until the dialog opens. Unmounting also resets
  // form + generated-secret state for free on every close.
  if (!open) return null;
  return <CreateApiKeyDialog onClose={onClose} />;
}

function CreateApiKeyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const createMut = useCreateApiKey();
  const authMode = useAuthMode();

  const [name, setName] = useState('');
  const [perm, setPerm] = useState<ApiKeyPermission>('read');
  const [appToken, setAppToken] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // App binding needs an identity to bind to — open-mode servers have
  // none, so the toggle stays hidden there (the backend 501s anyway).
  const canBindApp = authMode.data?.mode === 'forward_auth';

  const reset = () => {
    setName('');
    setPerm('read');
    setAppToken(false);
    setGeneratedKey(null);
    createMut.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleGenerate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMut.mutate(
      { name: trimmed, permissions: perm, ...(appToken ? { app_token: true as const } : {}) },
      { onSuccess: (data) => setGeneratedKey(data?.key ?? null) },
    );
  };

  const permissionOptions = useMemo(
    () =>
      PERMISSION_ORDER.map((value) => ({
        value,
        label:
          value === 'read'
            ? t('apiKeys.perm.read', 'Read')
            : value === 'read-write'
              ? t('apiKeys.perm.readWrite', 'Read-write')
              : t('apiKeys.perm.admin', 'Admin'),
      })),
    [t],
  );

  return (
    <Modal
      open
      onClose={handleClose}
      title={generatedKey ? t('apiKeys.keyCreated', 'API key created') : t('apiKeys.newKey', 'New API key')}
    >
      {generatedKey ? (
        <div className="space-y-4">
          <Text as="p" variant="caption">
            {t('apiKeys.copyWarning', "Copy this key now — it won't be shown again.")}
          </Text>
          <div className="flex items-center gap-2">
            <GlassPanel className="min-w-0 flex-1 p-3">
              <MaskedValue
                value={generatedKey}
                variant="token"
                ariaLabel={t('apiKeys.revealAria', 'API key, click to reveal')}
                copyable
                auditOnReveal
              />
            </GlassPanel>
            <CopyButton
              text={generatedKey}
              variant="secondary"
              size="md"
              withToast
              ariaLabel={t('apiKeys.copyAria', 'Copy API key')}
              title={t('apiKeys.copy', 'Copy')}
              iconOnly
              className="shrink-0"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={handleClose}>
            {t('apiKeys.done', 'Done')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label={t('apiKeys.name', 'Name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('apiKeys.namePlaceholder', 'My Application')}
          />
          <Select
            label={t('apiKeys.permissions', 'Permissions')}
            value={perm}
            onChange={(e) => setPerm(e.target.value as ApiKeyPermission)}
            options={permissionOptions}
            disabled={appToken}
          />
          {canBindApp && (
            <div className="space-y-1">
              <Checkbox
                label={t('apiKeys.appToken', 'App sign-in')}
                checked={appToken}
                onChange={(checked) => {
                  setAppToken(checked);
                  setPerm(checked ? 'admin' : 'read');
                }}
              />
              <HelperText>{t('apiKeys.appTokenHint', 'Signs in as you with full admin access. Treat this key like a password.')}</HelperText>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={handleGenerate}
              disabled={!name.trim()}
              loading={createMut.isPending}
            >
              {t('apiKeys.generate', 'Generate key')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              {t('apiKeys.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
