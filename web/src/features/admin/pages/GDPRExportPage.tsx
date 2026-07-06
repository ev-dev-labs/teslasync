/**
 * GDPR Export Page — admin observability surface.
 *
 * Polls a specific export artifact by id and exposes a Download
 * button that hits the binary streaming endpoint. The id can be
 * supplied via `?id=<uuid>` so links to specific exports work.
 *
 * Backed by:
 *   GET  admin/gdpr/exports/{id}           (artifact status)
 *   GET  admin/gdpr/exports/{id}/download  (binary stream)
 *
 * See internal/handler/v1/gdpr_export_handler.go.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  HardDriveDownload,
  RefreshCw,
  FileText,
  HardDrive,
  Database,
  CalendarPlus,
  CalendarClock,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Card, Badge } from '@/components/ui';
import { MetricLabel, MetricValue } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState,
  AlertBanner,
  QueryError,
  SectionErrorBoundary,
  Skeleton,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useGDPRExport } from '@/api/hooks/useOperatorConfidence';
import { apiUrl } from '@/api/client';
import { isApiError } from '@/lib/resilience';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';

import {
  GDPRLookupPanel,
  GDPRArtifactDetails,
  GDPRDownloadPanel,
  GDPRLifecyclePanel,
  STATUS_VARIANT,
  STATUS_ICON,
} from '../components/gdpr-export';

export default function GDPRExportPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.gdprExport.pageTitle', 'GDPR Export'));

  const [searchParams, setSearchParams] = useSearchParams();
  // The URL `?id=` param is the single source of truth for which artifact is
  // shown. Deriving `activeId` from it — rather than mirroring it into a second
  // piece of state — means a shared/bookmarked link, or a back/forward
  // navigation that swaps `?id=` while the page stays mounted, always drives
  // the active lookup instead of stranding the view on the id read at mount.
  const activeId = (searchParams.get('id') ?? '').trim();
  const [idInput, setIdInput] = useState(activeId);

  // Re-sync the editable draft whenever the URL id changes (deep link, history
  // navigation) so the input field mirrors the artifact currently on screen.
  useEffect(() => {
    setIdInput(activeId);
  }, [activeId]);

  const query = useGDPRExport(activeId);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const notFound = isApiError(query.error) && query.error.status === 404;
  const otherError = query.isError && !subsystemMissing && !notFound;
  const artifact = query.data;

  const { refetch } = query;
  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleLookup = useCallback(() => {
    const next = idInput.trim();
    setSearchParams(next ? { id: next } : {}, { replace: true });
  }, [idInput, setSearchParams]);

  // Direct browser-owned download URL — apiUrl() adds the fully qualified
  // origin + version prefix (the `request()` client does that for XHR, but a
  // raw anchor href must carry the whole path itself).
  const downloadUrl =
    artifact && artifact.status === 'complete'
      ? apiUrl(`/admin/gdpr/exports/${encodeURIComponent(artifact.id)}/download`)
      : null;

  // KPI band summary state. `kpiLoading` keeps the tiles visible with
  // skeletons while the first fetch resolves, then shows real values.
  const kpiLoading = query.isLoading && !artifact;
  const status = artifact?.status;
  const StatusIcon = status ? STATUS_ICON[status] : null;

  const actions = (
    <Button
      variant="ghost"
      onClick={handleRefresh}
      disabled={!activeId}
      aria-label={t('admin.gdprExport.refresh', 'Refresh artifact status')}
      className="min-h-11"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
    </Button>
  );

  return (
    <PageContainer
      title={t('admin.gdprExport.pageTitle', 'GDPR Export')}
      subtitle={t(
        'admin.gdprExport.subtitle',
        'Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.',
      )}
      actions={actions}
      query={activeId ? query : undefined}
    >
      <div className="space-y-6">
        <FadeIn>
          <GDPRLookupPanel idInput={idInput} onIdChange={setIdInput} onLookup={handleLookup} />
        </FadeIn>

        {subsystemMissing && (
          <AlertBanner
            variant="warning"
            title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}
          >
            {t(
              'admin.gdprExport.notConfigured',
              'GDPR export subsystem is not configured on this deployment.',
            )}
          </AlertBanner>
        )}

        {!activeId ? (
          <FadeIn delay={0.05}>
            <GlassPanel className="p-4 sm:p-5">
              {/* no-action: the artifact-ID lookup input is immediately above; this empty state only renders before submission */}
              <EmptyState
                icon={<HardDriveDownload className="h-8 w-8" />}
                title={t('admin.gdprExport.emptyTitle', 'No artifact selected')}
                message={t(
                  'admin.gdprExport.emptyMessage',
                  'Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes.',
                )}
              />
            </GlassPanel>
          </FadeIn>
        ) : notFound ? (
          <AlertBanner
            variant="danger"
            title={t('admin.gdprExport.notFoundTitle', 'Artifact not found')}
          >
            {t(
              'admin.gdprExport.notFoundMessage',
              'No artifact with that id exists, or it has been purged. Check the id and try again.',
            )}
          </AlertBanner>
        ) : otherError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError
              error={query.error}
              onRetry={handleRefresh}
              resourceName={t('admin.gdprExport.resourceName', 'Export artifact')}
            />
          </GlassPanel>
        ) : subsystemMissing ? null : (
          <SectionErrorBoundary name="gdpr-export-artifact">
            <div className="space-y-6">
              {/* KPI band — full-width responsive summary, more columns on wide screens */}
              <FadeIn delay={0.05}>
                <section
                  aria-label={t('admin.gdprExport.kpis', 'Artifact summary')}
                  className="grid grid-cols-2 gap-4 md:grid-cols-3 3xl:grid-cols-6"
                >
                  <Card className="flex flex-col gap-1">
                    <MetricLabel>{t('admin.gdprExport.statusLabel', 'Status')}</MetricLabel>
                    {kpiLoading ? (
                      <Skeleton width="60%" height={28} className="mt-1" />
                    ) : status && StatusIcon ? (
                      <div className="mt-1">
                        <Badge
                          variant={STATUS_VARIANT[status] ?? 'neutral'}
                          size="lg"
                          className="capitalize"
                        >
                          <StatusIcon
                            className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')}
                            aria-hidden="true"
                          />
                          {t(`admin.gdprExport.status.${status}`, status)}
                        </Badge>
                      </div>
                    ) : (
                      <MetricValue>—</MetricValue>
                    )}
                  </Card>

                  <StatCard
                    label={t('admin.gdprExport.formatLabel', 'Format')}
                    value={artifact?.format || '—'}
                    icon={<FileText className="h-5 w-5" />}
                    loading={kpiLoading}
                  />
                  <StatCard
                    label={t('admin.gdprExport.bytesLabel', 'Size')}
                    value={artifact?.bytes != null ? formatBytes(artifact.bytes) : '—'}
                    icon={<HardDrive className="h-5 w-5" />}
                    loading={kpiLoading}
                  />
                  <StatCard
                    label={t('admin.gdprExport.storageLabel', 'Storage')}
                    value={artifact?.storage || '—'}
                    icon={<Database className="h-5 w-5" />}
                    loading={kpiLoading}
                  />
                  <StatCard
                    label={t('admin.gdprExport.createdLabel', 'Created')}
                    value={artifact?.created_at ? formatRelative(artifact.created_at) : '—'}
                    icon={<CalendarPlus className="h-5 w-5" />}
                    loading={kpiLoading}
                  />
                  <StatCard
                    label={t('admin.gdprExport.expiresLabel', 'Expires')}
                    value={artifact?.expires_at ? formatRelative(artifact.expires_at) : '—'}
                    icon={<CalendarClock className="h-5 w-5" />}
                    loading={kpiLoading}
                  />
                </section>
              </FadeIn>

              {artifact?.error && (
                <AlertBanner
                  variant="danger"
                  title={t('admin.gdprExport.errorTitle', 'Export failed')}
                >
                  {artifact.error}
                </AlertBanner>
              )}

              {/* Detail bento — hero details span two columns, supporting panels fill the third */}
              <FadeIn delay={0.1}>
                <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <GDPRArtifactDetails
                    artifact={artifact}
                    loading={query.isLoading}
                    className="xl:col-span-2"
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <GDPRDownloadPanel
                      artifact={artifact}
                      downloadUrl={downloadUrl}
                      loading={query.isLoading}
                    />
                    <GDPRLifecyclePanel artifact={artifact} loading={query.isLoading} />
                  </div>
                </section>
              </FadeIn>
            </div>
          </SectionErrorBoundary>
        )}
      </div>
    </PageContainer>
  );
}
