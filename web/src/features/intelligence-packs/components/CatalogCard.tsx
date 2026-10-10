/**
 * One catalog entry: verification badge, publisher fingerprint,
 * compatibility, capability count, and an action button whose label
 * reflects local install state (Install / Update available / Up to date).
 * Never makes a network request — `usePackVerification` runs entirely
 * client-side over the bundled envelope.
 */
import { useTranslation } from 'react-i18next';
import { Badge, Button, Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { usePackVerification } from '../hooks/usePackVerification';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import { PublisherFingerprintDisplay } from './PublisherFingerprintDisplay';
import { CompatibilityBadge } from './CompatibilityBadge';
import type { CatalogEntryWithStatus } from '../hooks/useCatalog';

export interface CatalogCardProps {
  entry: CatalogEntryWithStatus;
  onOpenDetail: (entry: CatalogEntryWithStatus) => void;
}

export function CatalogCard({ entry, onOpenDetail }: CatalogCardProps) {
  const { t } = useTranslation();
  const { manifest, signature } = entry.envelope;
  const verification = usePackVerification(entry.envelope);

  const actionLabel = entry.installedVersion == null
    ? t('intelPacks.catalog.install', 'View & install')
    : entry.isUpToDate
      ? t('intelPacks.catalog.upToDate', 'Up to date (v{{version}})', { version: entry.installedVersion })
      : t('intelPacks.catalog.upgradeAvailable', 'Update available → v{{version}}', { version: manifest.version });

  return (
    <LayoutCard title={manifest.name} description={manifest.description}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Caption as="p">
            {t('intelPacks.catalog.byPublisher', 'by {{publisher}} · v{{version}}', {
              publisher: manifest.publisher.name || t('intelPacks.catalog.anonymousPublisher', 'Anonymous'),
              version: manifest.version,
            })}
          </Caption>
        </div>
        {entry.installedVersion != null && (
          <Badge variant={entry.isUpToDate ? 'success' : 'warning'} size="sm">
            {entry.isUpToDate ? t('intelPacks.catalog.installed', 'Installed') : t('intelPacks.catalog.installedOutdated', 'Installed (outdated)')}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <VerificationStatusBadge result={verification.data} isLoading={verification.isLoading} error={verification.error} />
        <CompatibilityBadge compat={manifest.appCompatibility} />
        <Badge variant="neutral" size="sm">
          {t('intelPacks.catalog.capabilityCount', '{{count}} capabilities', { count: manifest.capabilities.length })}
        </Badge>
      </div>

      <PublisherFingerprintDisplay
        fingerprintHex={signature?.publicKeyBase64 ? (verification.data?.recomputedPublisherFingerprint ?? null) : null}
        recognizedName={verification.data?.recognizedPublisherName}
        claimedMismatch={verification.data?.claimedFingerprintMismatch}
      />

      <Caption className="block italic">{entry.sourceNote}</Caption>

      <div className="mt-auto pt-2">
        <Button variant="secondary" size="sm" wrapLabel onClick={() => onOpenDetail(entry)} className="w-full">
          {actionLabel}
        </Button>
      </div>
    </LayoutCard>
  );
}
