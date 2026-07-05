import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, AlertTriangle, Package } from 'lucide-react';
import { Modal, Button, Badge, CopyButton } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { MiniGridPreview } from './MiniGridPreview';
import { toUrlSafeBase64, buildMinimalExport } from '../hooks/validateImport';
import type { SavedDashboard } from '../widgets/types';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  onDownload: () => void;
}

export function ExportModal({ open, onClose, dashboard, onDownload }: ExportModalProps) {
  const { t } = useTranslation('dashboard');
  const { formatDate } = useDateFormat();

  const dashboardJson = useMemo(
    () => JSON.stringify(dashboard, null, 2),
    [dashboard],
  );

  const jsonSize = useMemo(() => {
    const bytes = new Blob([dashboardJson]).size;
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }, [dashboardJson]);

  // Compute the shareable URL eagerly so we can validate length and disable the
  // copy button up-front (instead of letting users click through to a silent
  // failure or a delayed inline error).
  const shareUrl = useMemo(() => {
    const minimal = buildMinimalExport(dashboard);
    const encoded = toUrlSafeBase64(minimal);
    return `${window.location.origin}/dashboard#import=${encoded}`;
  }, [dashboard]);

  const shareUrlTooLong = shareUrl.length > 2000;
  const shareError = shareUrlTooLong
    ? t('export.urlTooLong', 'Layout too large for URL sharing ({{size}} chars). Use clipboard or file export instead.', {
        size: shareUrl.length,
      })
    : null;

  const handleDownload = () => {
    onDownload();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('export.title', 'Export Dashboard')}
      size="md"
      className="bg-[#0f1218] border border-white/[0.08] text-[var(--text-on-accent)]"
    >
      <div className="space-y-5">
        {/* Dashboard summary */}
        <div className="flex gap-4">
          <div className="w-32 shrink-0">
            <MiniGridPreview dashboard={dashboard} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
              {dashboard.name}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">
                <Package className="h-3 w-3 mr-1" />
                {t('export.widgetCount', '{{count}} widgets', { count: dashboard.widgets.length })}
              </Badge>
              <Badge variant="neutral">{jsonSize}</Badge>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {t('export.updated', 'Updated {{date}}', {
              date: formatDate(dashboard.updatedAt),
              })}
            </p>
          </div>
        </div>

        {/* Export options */}
        <div className="space-y-2">
          <Button
            variant="primary"
            size="md"
            className="w-full justify-start"
            onClick={handleDownload}
          >
            <Download className="h-4 w-4 mr-2" />
            {t('export.downloadFile', 'Download JSON File')}
          </Button>

          <CopyButton
            text={dashboardJson}
            variant="ghost"
            size="md"
            withToast
            label={t('export.copyClipboard', 'Copy to Clipboard')}
            className="w-full justify-start"
          />

          <CopyButton
            text={shareUrl}
            variant="ghost"
            size="md"
            withToast
            disabled={shareUrlTooLong}
            label={t('export.copyShareUrl', 'Copy Shareable URL')}
            className="w-full justify-start"
          />
        </div>

        {shareError && (
          <AlertBanner
            variant="warning"
            role="alert"
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          >
            {shareError}
          </AlertBanner>
        )}
      </div>
    </Modal>
  );
}
