import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Copy, Check, Link2, AlertTriangle, Package } from 'lucide-react';
import { Modal, Button, Badge } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
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
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const jsonSize = useMemo(() => {
    const bytes = new Blob([JSON.stringify(dashboard, null, 2)]).size;
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }, [dashboard]);

  const handleCopyClipboard = useCallback(async () => {
    const json = JSON.stringify(dashboard, null, 2);
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [dashboard]);

  const handleShareUrl = useCallback(async () => {
    setShareError(null);
    const minimal = buildMinimalExport(dashboard);
    const encoded = toUrlSafeBase64(minimal);
    const url = `${window.location.origin}/dashboard#import=${encoded}`;

    if (url.length > 2000) {
      setShareError(
        t('export.urlTooLong', 'Layout too large for URL sharing ({{size}} chars). Use clipboard or file export instead.', {
          size: url.length,
        }),
      );
      return;
    }

    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }, [dashboard, t]);

  const handleDownload = useCallback(() => {
    onDownload();
    onClose();
  }, [onDownload, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('export.title', 'Export Dashboard')}
      size="md"
      className="bg-[#0f1218] border border-white/[0.08] text-white"
    >
      <div className="space-y-5">
        {/* Dashboard summary */}
        <div className="flex gap-4">
          <div className="w-32 shrink-0">
            <MiniGridPreview dashboard={dashboard} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h3 className="text-base font-semibold text-white/90 truncate">
              {dashboard.name}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">
                <Package className="h-3 w-3 mr-1" />
                {t('export.widgetCount', '{{count}} widgets', { count: dashboard.widgets.length })}
              </Badge>
              <Badge variant="neutral">{jsonSize}</Badge>
            </div>
            <p className="text-xs text-white/30">
              {t('export.updated', 'Updated {{date}}', {
                date: new Date(dashboard.updatedAt).toLocaleDateString(),
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

          <Button
            variant="ghost"
            size="md"
            className="w-full justify-start"
            onClick={handleCopyClipboard}
          >
            {copied ? (
              <Check className="h-4 w-4 mr-2 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied
              ? t('export.copied', 'Copied!')
              : t('export.copyClipboard', 'Copy to Clipboard')}
          </Button>

          <Button
            variant="ghost"
            size="md"
            className="w-full justify-start"
            onClick={handleShareUrl}
          >
            {shareCopied ? (
              <Check className="h-4 w-4 mr-2 text-emerald-400" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            {shareCopied
              ? t('export.urlCopied', 'URL Copied!')
              : t('export.copyShareUrl', 'Copy Shareable URL')}
          </Button>
        </div>

        {shareError && (
          <AlertBanner variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            {shareError}
          </AlertBanner>
        )}
      </div>
    </Modal>
  );
}
