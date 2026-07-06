import { useTranslation } from 'react-i18next';
import { HardDriveDownload } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { PanelTitle, Caption, Text } from '@/components/ui/Typography';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

interface GDPRDownloadPanelProps {
  artifact?: GDPRExportArtifact;
  downloadUrl: string | null;
  loading?: boolean;
  className?: string;
}

/** Download action panel — streams the bundle or explains why it can't yet. */
export function GDPRDownloadPanel({ artifact, downloadUrl, loading, className }: GDPRDownloadPanelProps) {
  const { t } = useTranslation();
  const showLoading = Boolean(loading) && !artifact;
  const status = artifact?.status;

  return (
    <GlassPanel className={cn('flex flex-col p-4 sm:p-5', className)}>
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
              'admin.gdprExport.downloadHint',
              'The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.',
            )}
          </Text>
          <a
            href={downloadUrl}
            download
            className={cn(
              // A download is navigation, so the anchor itself is the single
              // interactive control — wrapping a <Button> here would nest
              // interactive content (axe `nested-interactive`, two tab stops).
              // Styled to match the shared primary Button via the theme vars.
              'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4',
              'text-sm font-medium transition sm:w-auto',
              'bg-[var(--theme-primary)] text-[var(--theme-on-primary)] hover:brightness-110',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2',
              'forced-colors:border forced-colors:border-[ButtonBorder]',
            )}
          >
            <HardDriveDownload className="h-4 w-4" aria-hidden="true" />
            {t('admin.gdprExport.downloadButton', 'Download bundle')}
          </a>
        </div>
      ) : (
        <Caption>
          {status === 'queued' || status === 'running'
            ? t('admin.gdprExport.downloadWait', 'Download becomes available once the export completes.')
            : status === 'expired'
              ? t('admin.gdprExport.downloadExpired', 'This artifact has expired and is no longer downloadable.')
              : t('admin.gdprExport.downloadFailed', 'No bundle available — see the error above.')}
        </Caption>
      )}
    </GlassPanel>
  );
}
