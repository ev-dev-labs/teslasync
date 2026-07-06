import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Modal, Button, Input, Select, GlassPanel, CopyButton, MaskedValue, Text } from '@/components/ui';
import { useCreateApiKey } from '@/api/hooks/useAdmin';
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
  const { t } = useTranslation();
  const createMut = useCreateApiKey();

  const [name, setName] = useState('');
  const [perm, setPerm] = useState<ApiKeyPermission>('read');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setPerm('read');
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
      { name: trimmed, permissions: perm },
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
              ? t('apiKeys.perm.readWrite', 'Read-Write')
              : t('apiKeys.perm.admin', 'Admin'),
      })),
    [t],
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={generatedKey ? t('apiKeys.keyCreated', 'API Key Created') : t('apiKeys.newKey', 'New API Key')}
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
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={handleGenerate}
              disabled={!name.trim()}
              loading={createMut.isPending}
            >
              {t('apiKeys.generate', 'Generate Key')}
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
