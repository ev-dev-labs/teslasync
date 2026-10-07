/**
 * Signature/key management panel — surfaces the local ECDSA P-256 signing
 * key's lifecycle: persistence capability, active key, full key history
 * (including revoked/rotated-from linkage), and generate/rotate/revoke
 * actions. Always shows the honest local-attestation disclaimer — this
 * key proves nothing about identity, only "signed by this browser".
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { LOCAL_ATTESTATION_NOTE } from '../lib/constants';
import type { UseSigningVaultResult } from '../hooks/useSigningVault';

export interface SignatureKeyPanelProps {
  vault: UseSigningVaultResult;
}

export function SignatureKeyPanel({ vault }: SignatureKeyPanelProps) {
  const { t } = useTranslation();
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  const { capability, keys, activeKey, isLoading, isMutating, error, generateKey, rotateKey, revokeKey } = vault;

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.keys.title', 'Signature & Key Management')}</PanelTitle>
        <KeyRound className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
      </div>

      {capability && !capability.supported && (
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {capability.reason}
        </InlineCallout>
      )}

      {error && (
        <InlineCallout variant="danger" icon={<ShieldAlert />}>
          {error}
        </InlineCallout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void generateKey()} loading={isMutating} disabled={isLoading}>
          {t('resaleVault.keys.generate', 'Generate new key')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void rotateKey()} loading={isMutating} disabled={isLoading || !activeKey}>
          {t('resaleVault.keys.rotate', 'Rotate active key')}
        </Button>
      </div>

      <div>
        <HelperText className="mb-2">
          {t('resaleVault.keys.activeKey', 'Active key')}: {activeKey ? activeKey.key_id : t('resaleVault.keys.none', 'none — generate one to sign reports')}
        </HelperText>
        {activeKey && (
          <Badge variant={activeKey.persisted ? 'success' : 'warning'}>
            {activeKey.persisted
              ? t('resaleVault.keys.persisted', 'Persisted (survives reload)')
              : t('resaleVault.keys.sessionOnly', 'Session-only (lost on reload)')}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <HelperText>{t('resaleVault.keys.loading', 'Loading key registry…')}</HelperText>
      ) : keys.length === 0 ? (
        <HelperText>{t('resaleVault.keys.empty', 'No signing keys yet in this browser.')}</HelperText>
      ) : (
        <ul className="space-y-2">
          {keys.map((key) => (
            <li key={key.key_id} className="rounded-lg border border-white/[0.06] p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[var(--text-primary)] break-all">{key.key_id}</span>
                <Badge variant={key.revoked_at ? 'danger' : 'success'}>
                  {key.revoked_at ? t('resaleVault.keys.revoked', 'Revoked') : t('resaleVault.keys.active', 'Active')}
                </Badge>
              </div>
              <div className="mt-1 text-[var(--text-muted)]">
                {t('resaleVault.keys.created', 'Created')}: {key.created_at}
                {key.rotated_from && ` · ${t('resaleVault.keys.rotatedFrom', 'Rotated from')} ${key.rotated_from}`}
              </div>
              {key.revoked_at && (
                <div className="mt-1 text-[var(--text-muted)]">
                  {t('resaleVault.keys.revokedAt', 'Revoked at')} {key.revoked_at}
                  {key.revoked_reason && ` (${key.revoked_reason})`}
                </div>
              )}
              {!key.revoked_at && (
                <div className="mt-2">
                  {revokeTarget === key.key_id ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          void revokeKey(key.key_id, 'manual_revocation');
                          setRevokeTarget(null);
                        }}
                      >
                        {t('resaleVault.keys.confirmRevoke', 'Confirm revoke')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(null)}>
                        {t('common.cancel', 'Cancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setRevokeTarget(key.key_id)}>
                      {t('resaleVault.keys.revoke', 'Revoke')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {LOCAL_ATTESTATION_NOTE}
      </InlineCallout>
    </GlassPanel>
  );
}
