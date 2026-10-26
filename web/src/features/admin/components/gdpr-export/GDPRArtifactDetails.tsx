import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, CopyButton, PanelTitle, Caption, Text, Code, ErrorText, HelperText } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

interface GDPRArtifactDetailsProps {
  artifact?: GDPRExportArtifact;
  loading?: boolean;
  className?: string;
}

/** Metadata detail panel — responsive KV grid that widens on large screens. */
export function GDPRArtifactDetails({ artifact, loading, className }: GDPRArtifactDetailsProps) {
  const { t } = useTranslation();
  const showLoading = Boolean(loading) && !artifact;

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} aria-busy={showLoading}>
      <PanelTitle className="mb-4">{t('admin.gdprExport.metaTitle', 'Artifact details')}</PanelTitle>

      {showLoading ? (
        <div aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton width="40%" height={12} />
              <Skeleton width="80%" height={18} />
            </div>
          ))}
        </div>
      ) : artifact ? (
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <MetaRow
            label={t('admin.gdprExport.metaId', 'ID')}
            className="md:col-span-2 2xl:col-span-3"
            value={<CopyValue key={artifact.id} text={artifact.id} />}
          />

          <MetaRow
            label={t('admin.gdprExport.metaExportJob', 'Export job ID')}
            value={<Code className="select-text whitespace-pre-wrap break-all">{artifact.export_job_id ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaVehicle', 'Vehicle ID')}
            value={<Code>{artifact.vehicle_id ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaCreated', 'Created')}
            value={<TimeValue iso={artifact.created_at} />}
          />

          <MetaRow
            label={t('admin.gdprExport.metaDownloaded', 'Downloaded')}
            value={<TimeValue iso={artifact.downloaded_at} />}
          />

          <MetaRow
            label={t('admin.gdprExport.metaExpires', 'Expires')}
            value={<TimeValue iso={artifact.expires_at} />}
          />

          <MetaRow
            label={t('admin.gdprExport.metaByteCount', 'Byte count')}
            value={<Code>{artifact.byte_count ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaStorageKind', 'Storage kind')}
            value={<Code className="select-text whitespace-pre-wrap break-all">{artifact.storage_kind ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaStoragePath', 'Storage path')}
            value={<Code className="select-text whitespace-pre-wrap break-all">{artifact.storage_path ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaDownloadCount', 'Download count')}
            value={<Code>{artifact.download_count ?? '—'}</Code>}
          />

          <MetaRow
            label={t('admin.gdprExport.metaSha256', 'SHA-256')}
            className="md:col-span-2 2xl:col-span-3"
            value={<CopyValue key={artifact.sha256} text={artifact.sha256} />}
          />
        </dl>
      ) : (
        // no-action: purely mirrors the parent's `artifact` prop — the
        // export ID lookup input above the panel is the trigger surface.
        <EmptyState
          message={t(
            'admin.gdprExport.metaEmpty',
            'Look up an export artifact to see its metadata here.',
          )}
        />
      )}
    </GlassPanel>
  );
}

function CopyValue({ text }: { text: string | null | undefined }) {
  const { t } = useTranslation(['translation', 'settings']);
  const [copyFailed, setCopyFailed] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <Code className="min-w-0 select-text whitespace-pre-wrap break-all">{text ?? '—'}</Code>
        {text != null && (
          <CopyButton
            text={text}
            iconOnly
            variant="ghost"
            size="sm"
            className="h-11 min-h-11 min-w-11 shrink-0 md:h-9 md:min-h-9 md:min-w-0"
            onCopy={() => setCopyFailed(false)}
            onCopyError={() => setCopyFailed(true)}
          />
        )}
      </div>
      {copyFailed && (
        <div className="space-y-1">
          <ErrorText>{t('common.copyButton.errorToast', 'Failed to copy')}</ErrorText>
          <HelperText>{t('totp.copy.manualHint', {
            ns: 'settings',
            defaultValue: 'Clipboard unavailable. Select the displayed text and copy it manually.',
          })}</HelperText>
        </div>
      )}
    </div>
  );
}

function TimeValue({ iso }: { iso: string | null | undefined }) {
  return (
    <>
      <Text variant="bodySm" as="div">
        {formatDateTime(iso)}
      </Text>
      <Caption>{formatRelative(iso)}</Caption>
    </>
  );
}

function MetaRow({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <Caption as="dt">{label}</Caption>
      <Text as="dd" variant="bodySm" className="mt-0.5">{value}</Text>
    </div>
  );
}
