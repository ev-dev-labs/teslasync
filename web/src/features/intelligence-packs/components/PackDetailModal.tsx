/**
 * Catalog detail modal: full manifest review + the install/upgrade action,
 * including the mandatory explicit local-development trust flow for
 * unsigned packs (typed-confirmation, clearly labeled risk) and a hard
 * block (no install path at all) for any pack whose signature/digest
 * check failed or whose platform cannot even attempt the check.
 *
 * Already-installed packs' lifecycle (enable/disable/rollback/uninstall)
 * lives in `InstalledInventoryPanel` — this modal only ever creates a new
 * `InstalledPackRecord` or supersedes one with a newer version.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Modal } from '@/components/ui';
import { Text } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { usePackVerification } from '../hooks/usePackVerification';
import { usePackActions } from '../hooks/usePackActions';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import { TrustDistinctionNote } from './TrustDistinctionNote';
import { PublisherFingerprintDisplay } from './PublisherFingerprintDisplay';
import { CapabilityRequestList } from './CapabilityRequestList';
import { CompatibilityBadge } from './CompatibilityBadge';
import type { CatalogEntryWithStatus } from '../hooks/useCatalog';
import type { PackCapabilityId } from '../lib/manifestTypes';
import type { TrustDecisionKind } from '../lib/trust';

/** Literal the user must type verbatim to install an unsigned pack. Not translated — it is typed, not read. */
export const UNSIGNED_TRUST_PHRASE = 'TRUST UNSIGNED';

export interface PackDetailModalProps {
  entry: CatalogEntryWithStatus | null;
  open: boolean;
  onClose: () => void;
}

type ConfirmMode = 'none' | 'install-verified' | 'install-unsigned';

export function PackDetailModal({ entry, open, onClose }: PackDetailModalProps) {
  const { t } = useTranslation();
  const { install, upgrade, recordTrustDecision } = usePackActions();
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>('none');

  const verification = usePackVerification(entry?.envelope ?? null);

  const manifest = entry?.envelope.manifest ?? null;
  const status = verification.data?.status;

  const installability = useMemo<'installable' | 'requires-trust' | 'blocked' | 'unknown'>(() => {
    if (!status) return 'unknown';
    if (status === 'signature-valid') return 'installable';
    if (status === 'unsigned') return 'requires-trust';
    return 'blocked';
  }, [status]);

  if (!entry || !manifest) return null;

  const isUpgrade = entry.installedVersion != null && !entry.isUpToDate;
  const busy = install.isPending || upgrade.isPending || recordTrustDecision.isPending;

  function trustKindFor(): TrustDecisionKind {
    if (status === 'signature-valid') {
      return verification.data?.recognizedPublisherName ? 'trusted-signed-recognized' : 'trusted-signed-unrecognized';
    }
    return 'trusted-dev-unsigned';
  }

  async function performInstall() {
    if (!entry || !manifest || !verification.data) return;
    const approvedCapabilities: PackCapabilityId[] = [...manifest.capabilities];
    await recordTrustDecision.mutateAsync({
      packId: manifest.id,
      decision: trustKindFor(),
      publisherFingerprint: verification.data.recomputedPublisherFingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities,
    });
    if (isUpgrade) {
      await upgrade.mutateAsync({ packId: manifest.id, envelope: entry.envelope, verification: verification.data });
    } else {
      await install.mutateAsync({ envelope: entry.envelope, verification: verification.data, enabled: true });
    }
    setConfirmMode('none');
    onClose();
  }

  async function blockPack() {
    if (!manifest) return;
    await recordTrustDecision.mutateAsync({
      packId: manifest.id,
      decision: 'blocked',
      publisherFingerprint: verification.data?.recomputedPublisherFingerprint ?? null,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: [],
    });
  }

  return (
    <>
      <Modal open={open && confirmMode === 'none'} onClose={onClose} title={manifest.name} size="lg">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <VerificationStatusBadge result={verification.data} isLoading={verification.isLoading} error={verification.error} />
            <CompatibilityBadge compat={manifest.appCompatibility} />
            <Badge variant="neutral" size="sm">v{manifest.version}</Badge>
          </div>

          <p className="text-sm text-[var(--text-secondary)]">{manifest.description}</p>

          <TrustDistinctionNote />

          {verification.data && (
            <p className="text-xs text-[var(--text-muted)]">{verification.data.summary}</p>
          )}

          <section>
            <Text variant="bodySm" className="font-semibold mb-1">
              {t('intelPacks.detail.publisher', 'Publisher')}
            </Text>
            <p className="text-sm text-[var(--text-primary)] mb-1">{manifest.publisher.name || t('intelPacks.catalog.anonymousPublisher', 'Anonymous')}</p>
            <PublisherFingerprintDisplay
              fingerprintHex={verification.data?.recomputedPublisherFingerprint ?? null}
              recognizedName={verification.data?.recognizedPublisherName}
              claimedMismatch={verification.data?.claimedFingerprintMismatch}
            />
          </section>

          <section>
            <Text variant="bodySm" className="font-semibold mb-1">
              {t('intelPacks.detail.capabilities', 'Requested capabilities')}
            </Text>
            <CapabilityRequestList capabilityIds={manifest.capabilities} />
          </section>

          <section>
            <Text variant="bodySm" className="font-semibold mb-1">
              {t('intelPacks.detail.contents', 'Manifest contents')}
            </Text>
            <ul className="text-xs text-[var(--text-secondary)] space-y-0.5">
              <li>{t('intelPacks.detail.formulasCount', '{{count}} analytics formulas', { count: manifest.formulas.length })}</li>
              <li>{t('intelPacks.detail.coefficientsCount', '{{count}} bounded coefficients', { count: manifest.coefficients.length })}</li>
              <li>{t('intelPacks.detail.dashboardsCount', '{{count}} dashboard layouts', { count: manifest.dashboards.length })}</li>
              <li>
                {t('intelPacks.detail.recommendationsCount', '{{count}} automation recommendations (suggestions only — never auto-applied)', {
                  count: manifest.automationRecommendations.length,
                })}
              </li>
            </ul>
          </section>

          {installability === 'blocked' && (
            <AlertBanner variant="danger" title={t('intelPacks.detail.blockedTitle', 'This pack cannot be installed')} icon={<ShieldAlert className="h-4 w-4" />}>
              {t(
                'intelPacks.detail.blockedBody',
                'Signature/content verification failed or this platform cannot perform it. Installing a pack in this state is never allowed.',
              )}
            </AlertBanner>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {installability === 'blocked' && (
              <Button variant="secondary" size="sm" onClick={blockPack} loading={recordTrustDecision.isPending}>
                {t('intelPacks.detail.markBlocked', 'Record as blocked')}
              </Button>
            )}
            {installability === 'installable' && (
              <Button variant="primary" size="sm" onClick={() => setConfirmMode('install-verified')} disabled={busy}>
                {isUpgrade
                  ? t('intelPacks.detail.upgradeTo', 'Upgrade to v{{version}}', { version: manifest.version })
                  : t('intelPacks.detail.installAction', 'Install')}
              </Button>
            )}
            {installability === 'requires-trust' && (
              <Button variant="danger" size="sm" onClick={() => setConfirmMode('install-unsigned')} disabled={busy}>
                {t('intelPacks.detail.trustAndInstall', 'Trust as local-development pack…')}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmMode === 'install-verified'}
        title={isUpgrade ? t('intelPacks.confirm.upgradeTitle', 'Upgrade pack?') : t('intelPacks.confirm.installTitle', 'Install pack?')}
        message={t(
          'intelPacks.confirm.installMessage',
          'Signature verified for "{{name}}" v{{version}}. Installing grants it exactly the capabilities listed: {{caps}}. Remember: a valid signature proves key possession, not that this publisher\u2019s intentions are trustworthy.',
          { name: manifest.name, version: manifest.version, caps: manifest.capabilities.join(', ') || 'none' },
        )}
        variant="warning"
        confirmLabel={isUpgrade ? t('intelPacks.confirm.upgrade', 'Upgrade') : t('intelPacks.confirm.install', 'Install')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={busy}
        onConfirm={performInstall}
        onCancel={() => setConfirmMode('none')}
      />

      <ConfirmDialog
        open={confirmMode === 'install-unsigned'}
        title={t('intelPacks.confirm.unsignedTitle', 'Trust this unsigned pack? (local development only)')}
        message={t(
          'intelPacks.confirm.unsignedMessage',
          '"{{name}}" has NO signature. TeslaSync cannot verify who created it or whether it has been altered. Only trust unsigned packs you personally authored or fully understand. This decision is recorded locally and can be reversed by uninstalling.',
          { name: manifest.name },
        )}
        variant="danger"
        requireTypedConfirmation={UNSIGNED_TRUST_PHRASE}
        typedConfirmationLabel={t('intelPacks.confirm.typePhrase', 'Type "{{phrase}}" to confirm', { phrase: UNSIGNED_TRUST_PHRASE })}
        confirmLabel={t('intelPacks.confirm.trustAndInstall', 'Trust & install')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={busy}
        onConfirm={performInstall}
        onCancel={() => setConfirmMode('none')}
      />
    </>
  );
}
