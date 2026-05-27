/**
 * GDPR Export Page — Phase-45 admin observability surface.
 *
 * Polls a specific export artifact by id and exposes a Download
 * button that hits the binary streaming endpoint. The id can be
 * supplied via `?id=<uuid>` so links to specific exports work.
 *
 * Backed by:
 *   GET /api/v1/admin/gdpr/exports/{id}           (artifact status)
 *   GET /api/v1/admin/gdpr/exports/{id}/download  (binary stream)
 *
 * See internal/handler/v1/gdpr_export_handler.go.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { HardDriveDownload, Search } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Input, CopyButton } from '@/components/ui';
import { PanelTitle, Caption, Text } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatBytes } from '@/lib/numberFormat';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { useGDPRExport } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { GDPRArtifactStatus } from '@/types/admin-operator-confidence';

const STATUS_VARIANT: Record<GDPRArtifactStatus, 'info' | 'success' | 'danger' | 'warning' | 'neutral'> = {
  queued: 'info',
  running: 'info',
  complete: 'success',
  failed: 'danger',
  expired: 'warning',
};

export default function GDPRExportPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.gdprExport.pageTitle', 'GDPR Export'));

  const [searchParams, setSearchParams] = useSearchParams();
  const initialId = searchParams.get('id') ?? '';
  const [idInput, setIdInput] = useState(initialId);
  const [activeId, setActiveId] = useState(initialId);

  // Keep URL in sync when activeId changes so refresh + share works.
  useEffect(() => {
    if (activeId && searchParams.get('id') !== activeId) {
      setSearchParams({ id: activeId }, { replace: true });
    }
  }, [activeId, searchParams, setSearchParams]);

  const query = useGDPRExport(activeId);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const notFound = isApiError(query.error) && query.error.status === 404;
  const artifact = query.data;

  const handleLookup = () => {
    setActiveId(idInput.trim());
  };

  const downloadUrl = artifact && artifact.status === 'complete'
    ? `/api/v1/admin/gdpr/exports/${encodeURIComponent(artifact.id)}/download`
    : null;

  return (
    <PageContainer
      title={t('admin.gdprExport.pageTitle', 'GDPR Export')}
      subtitle={t(
        'admin.gdprExport.subtitle',
        'Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.',
      )}
      query={activeId ? query : undefined}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.gdprExport.notConfigured',
                'GDPR export subsystem is not configured on this deployment.',
              )}
            </AlertBanner>
          )}

          <GlassPanel className="p-6">
            <PanelTitle className="mb-4">{t('admin.gdprExport.lookupTitle', 'Lookup artifact')}</PanelTitle>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Input
                  label={t('admin.gdprExport.idLabel', 'Artifact ID')}
                  placeholder={t('admin.gdprExport.idPlaceholder', 'e.g. 8f4c…')}
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLookup();
                  }}
                />
              </div>
              <Button variant="primary" size="md" onClick={handleLookup} disabled={!idInput.trim()}>
                <Search className="mr-1 h-4 w-4" />
                {t('admin.gdprExport.lookupButton', 'Look up')}
              </Button>
            </div>
            <Caption className="mt-2">
              {t(
                'admin.gdprExport.lookupHint',
                'IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running.',
              )}
            </Caption>
          </GlassPanel>

          {!activeId && (
            <GlassPanel className="p-6">
              {/* no-action: the artifact-ID lookup input is immediately above this panel; this empty state only renders before submission */}
              <EmptyState
                icon={<HardDriveDownload className="h-8 w-8" />}
                title={t('admin.gdprExport.emptyTitle', 'No artifact selected')}
                message={t(
                  'admin.gdprExport.emptyMessage',
                  'Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes.',
                )}
              />
            </GlassPanel>
          )}

          {activeId && notFound && (
            <AlertBanner variant="danger" title={t('admin.gdprExport.notFoundTitle', 'Artifact not found')}>
              {t(
                'admin.gdprExport.notFoundMessage',
                'No artifact with that id exists, or it has been purged. Check the id and try again.',
              )}
            </AlertBanner>
          )}

          {artifact && (
            <SectionErrorBoundary name="gdpr-export-artifact">
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <GlassPanel className="p-4">
                    <Caption>{t('admin.gdprExport.statusLabel', 'Status')}</Caption>
                    <div className="mt-2">
                      <Badge variant={STATUS_VARIANT[artifact.status] ?? 'neutral'} size="lg">
                        {artifact.status}
                      </Badge>
                    </div>
                  </GlassPanel>
                  <StatCard
                    label={t('admin.gdprExport.formatLabel', 'Format')}
                    value={artifact.format || '—'}
                  />
                  <StatCard
                    label={t('admin.gdprExport.bytesLabel', 'Size')}
                    value={artifact.bytes != null ? formatBytes(artifact.bytes) : '—'}
                  />
                  <StatCard
                    label={t('admin.gdprExport.storageLabel', 'Storage')}
                    value={artifact.storage || '—'}
                  />
                </div>

                <GlassPanel className="p-6">
                  <PanelTitle className="mb-4">{t('admin.gdprExport.metaTitle', 'Artifact details')}</PanelTitle>
                  <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <MetaRow label={t('admin.gdprExport.metaId', 'ID')} value={
                      <div className="flex items-center gap-2">
                        <span className="break-all font-mono text-sm text-[var(--text-primary)]">{artifact.id}</span>
                        <CopyButton text={artifact.id} iconOnly variant="ghost" size="sm" />
                      </div>
                    } />
                    {artifact.user_id && (
                      <MetaRow label={t('admin.gdprExport.metaUser', 'User')} value={artifact.user_id} />
                    )}
                    <MetaRow
                      label={t('admin.gdprExport.metaCreated', 'Created')}
                      value={
                        <>
                          <div>{formatDateTime(artifact.created_at)}</div>
                          <Caption>{formatRelative(artifact.created_at)}</Caption>
                        </>
                      }
                    />
                    {artifact.completed_at && (
                      <MetaRow
                        label={t('admin.gdprExport.metaCompleted', 'Completed')}
                        value={
                          <>
                            <div>{formatDateTime(artifact.completed_at)}</div>
                            <Caption>{formatRelative(artifact.completed_at)}</Caption>
                          </>
                        }
                      />
                    )}
                    {artifact.expires_at && (
                      <MetaRow
                        label={t('admin.gdprExport.metaExpires', 'Expires')}
                        value={
                          <>
                            <div>{formatDateTime(artifact.expires_at)}</div>
                            <Caption>{formatRelative(artifact.expires_at)}</Caption>
                          </>
                        }
                      />
                    )}
                    {artifact.sha256 && (
                      <MetaRow
                        label={t('admin.gdprExport.metaSha256', 'SHA-256')}
                        value={
                          <div className="flex items-center gap-2">
                            <span className="break-all font-mono text-xs text-[var(--text-secondary)]">{artifact.sha256}</span>
                            <CopyButton text={artifact.sha256} iconOnly variant="ghost" size="sm" />
                          </div>
                        }
                      />
                    )}
                  </dl>
                </GlassPanel>

                {artifact.error && (
                  <AlertBanner variant="danger" title={t('admin.gdprExport.errorTitle', 'Export failed')}>
                    {artifact.error}
                  </AlertBanner>
                )}

                <GlassPanel className="p-6">
                  <PanelTitle className="mb-4">{t('admin.gdprExport.downloadTitle', 'Download')}</PanelTitle>
                  {downloadUrl ? (
                    <div className="flex flex-col items-start gap-3">
                      <Text variant="bodySm">
                        {t(
                          'admin.gdprExport.downloadHint',
                          'The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.',
                        )}
                      </Text>
                      <a href={downloadUrl} download>
                        <Button variant="primary" size="md">
                          <HardDriveDownload className="mr-2 h-4 w-4" />
                          {t('admin.gdprExport.downloadButton', 'Download bundle')}
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <Caption>
                      {artifact.status === 'queued' || artifact.status === 'running'
                        ? t('admin.gdprExport.downloadWait', 'Download becomes available once the export completes.')
                        : artifact.status === 'expired'
                          ? t('admin.gdprExport.downloadExpired', 'This artifact has expired and is no longer downloadable.')
                          : t('admin.gdprExport.downloadFailed', 'No bundle available — see the error above.')}
                    </Caption>
                  )}
                </GlassPanel>
              </div>
            </SectionErrorBoundary>
          )}
        </div>
      </FadeIn>
    </PageContainer>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Caption>{label}</Caption>
      <div className="text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
