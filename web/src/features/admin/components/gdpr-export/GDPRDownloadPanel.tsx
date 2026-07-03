import { useTranslation } from 'react-i18next';
import { HardDriveDownload } from 'lucide-react';

import { GlassPanel, Button } from '@/components/ui';
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
          <Text variant="bodySm" className="text-[var(--text-secondary)]">
            {t(
              'admin.gdprExport.downloadHint',
              'The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.',
            )}
          </Text>
          <a href={downloadUrl} download className="w-full sm:w-auto">
            <Button variant="primary" size="md" className="min-h-11 w-full sm:w-auto">
              <HardDriveDownload className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('admin.gdprExport.downloadButton', 'Download bundle')}
            </Button>
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
