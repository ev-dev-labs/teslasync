import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, CopyButton } from '@/components/ui';
import { PanelTitle, Caption, Text, Code } from '@/components/ui/Typography';
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
            value={
              <div className="flex items-center gap-2">
                <Code className="break-all">{artifact.id}</Code>
                <CopyButton text={artifact.id} iconOnly variant="ghost" size="sm" />
              </div>
            }
          />

          {artifact.user_id && (
            <MetaRow
              label={t('admin.gdprExport.metaUser', 'User')}
              value={<Text variant="bodySm" className="break-all text-[var(--text-primary)]">{artifact.user_id}</Text>}
            />
          )}

          <MetaRow
            label={t('admin.gdprExport.metaCreated', 'Created')}
            value={<TimeValue iso={artifact.created_at} />}
          />

          {artifact.completed_at && (
            <MetaRow
              label={t('admin.gdprExport.metaCompleted', 'Completed')}
              value={<TimeValue iso={artifact.completed_at} />}
            />
          )}

          {artifact.expires_at && (
            <MetaRow
              label={t('admin.gdprExport.metaExpires', 'Expires')}
              value={<TimeValue iso={artifact.expires_at} />}
            />
          )}

          {artifact.sha256 && (
            <MetaRow
              label={t('admin.gdprExport.metaSha256', 'SHA-256')}
              className="md:col-span-2 2xl:col-span-3"
              value={
                <div className="flex items-center gap-2">
                  <Code className="break-all text-[var(--text-secondary)]">{artifact.sha256}</Code>
                  <CopyButton text={artifact.sha256} iconOnly variant="ghost" size="sm" />
                </div>
              }
            />
          )}
        </dl>
      ) : (
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

function TimeValue({ iso }: { iso: string }) {
  return (
    <>
      <Text variant="bodySm" as="div" className="text-[var(--text-primary)]">
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
      <Caption>{label}</Caption>
      <div className="mt-0.5 text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
