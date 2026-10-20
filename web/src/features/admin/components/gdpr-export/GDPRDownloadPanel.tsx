import { useTranslation } from 'react-i18next';
import { HardDriveDownload } from 'lucide-react';

import { BUTTON_BASE, BUTTON_VARIANTS, GlassPanel, Icon, PanelTitle, Caption, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

interface GDPRDownloadPanelProps {
  artifact?: GDPRExportArtifact;
  downloadUrl: string | null;
  loading?: boolean;
  className?: string;
  /** Optional page-owned clock; the supplied href remains the eligibility authority. */
  now?: number;
}

/** Manifest explanation and one browser-owned link, not export-job progress or file proof. */
export function GDPRDownloadPanel({
  artifact, downloadUrl, loading, className, now = Date.now(),
}: GDPRDownloadPanelProps) {
  const { t } = useTranslation();
  const showLoading = Boolean(loading) && !artifact;
  const expiry = artifact?.expires_at;
  const parts = typeof expiry === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(expiry)
    : null;
  const parsed = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const expiryMs = parts
    && Number(parts[2]) >= 1 && Number(parts[2]) <= 12
    && Number(parts[3]) >= 1
    && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate()
    && Number.isFinite(parsed)
    ? parsed : null;
  const unavailable = !artifact
    ? t('admin.gdprExport.downloadMissing', 'No artifact result is available. Look up an artifact or retry the lookup to inspect download eligibility.')
    : expiryMs != null && now >= expiryMs
      ? t('admin.gdprExport.downloadExpired', 'This artifact has expired and is no longer downloadable.')
      : !artifact.storage_kind?.trim() || expiryMs == null
        ? t('admin.gdprExport.downloadUnknown', 'Download eligibility is unknown because storage or a valid expiry is missing. Refresh the artifact manifest to check its metadata.')
        : artifact.storage_kind !== 'local_fs'
          ? t('admin.gdprExport.downloadUnsupported', 'Downloads are not supported for this artifact’s storage kind.')
          : t('admin.gdprExport.downloadUnavailable', 'No eligible download link was supplied. Refresh the artifact manifest; metadata does not confirm that the stored file is available.');

  return (
    <GlassPanel className={cn('flex min-w-0 flex-col p-4 sm:p-5', className)} aria-busy={showLoading}>
      <PanelTitle className="mb-4">{t('admin.gdprExport.downloadTitle', 'Download')}</PanelTitle>

      {showLoading ? (
        <div className="space-y-3">
          <Skeleton width="90%" height={14} />
          <Skeleton width="55%" height={44} />
        </div>
      ) : downloadUrl ? (
        <div className="flex flex-col items-start gap-3">
          <Text variant="bodySm">
            {t(
              'admin.gdprExport.downloadManifestHint',
              'The bundle streams from the backend through this browser. An eligible request can still fail if the file is missing. Download timestamp and counter updates are best effort, not a durable audit record.',
            )}
          </Text>
          <a
            href={downloadUrl}
            download
            className={cn(
              BUTTON_BASE,
              BUTTON_VARIANTS.primary,
              typography.size.sm,
              'min-h-11 min-w-11 w-full max-w-full whitespace-normal px-4 py-2 sm:w-auto',
            )}
          >
            <Icon icon={HardDriveDownload} />
            <span className="min-w-0 break-words">
              {t('admin.gdprExport.downloadButton', 'Download bundle')}
            </span>
          </a>
        </div>
      ) : (
        <Caption>{unavailable}</Caption>
      )}
    </GlassPanel>
  );
}
