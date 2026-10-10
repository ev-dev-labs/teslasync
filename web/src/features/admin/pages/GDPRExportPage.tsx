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
import { HardDriveDownload, RefreshCw } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
import type { StatMetric } from '@/components/data-display';
import { AdminSummary } from '../components/operationalbrief-a-g/AdminSummary';
import { FadeIn } from '@/components/motion';
import {
  EmptyState,
  AlertBanner,
  DataStateNotice,
  QueryError,
  SectionErrorBoundary,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useGDPRExport } from '@/api/hooks/useOperatorConfidence';
import { apiUrl } from '@/api/client';
import { isApiError } from '@/lib/resilience';

import { formatRelative } from '@/lib/dateFormat';

import {
  GDPRLookupPanel,
  GDPRArtifactDetails,
  GDPRDownloadPanel,
  GDPRLifecyclePanel,
} from '../components/gdpr-export';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';

export default function GDPRExportPage() {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('admin.gdprExport.pageTitle', 'GDPR export'));

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
  const artifactState = deriveDataState(query);
  const subsystemMissing = isApiError(artifactState.fatalError) && artifactState.fatalError.status === 503;
  const notFound = isApiError(artifactState.fatalError) && artifactState.fatalError.status === 404;
  const otherError = artifactState.fatalError && !subsystemMissing && !notFound;
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
  const summaryMetrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'status', label: t('admin.gdprExport.statusLabel', 'Status'),
      rawValue: status ? t(`admin.gdprExport.status.${status}`, status) : undefined },
    { metricId: 'text', occurrenceId: 'format', label: t('admin.gdprExport.formatLabel', 'Format'), rawValue: artifact?.format || undefined },
    { metricId: 'bytes', occurrenceId: 'bytes', label: t('admin.gdprExport.bytesLabel', 'Size'), rawValue: artifact?.bytes,
      display: { formatter: raw => ({ value: formatBytes(raw), unit: '' }) } },
    { metricId: 'text', occurrenceId: 'storage', label: t('admin.gdprExport.storageLabel', 'Storage'), rawValue: artifact?.storage || undefined },
    { metricId: 'text', occurrenceId: 'created', label: t('admin.gdprExport.createdLabel', 'Created'),
      rawValue: artifact?.created_at ? formatRelative(artifact.created_at) : undefined, context: artifact?.created_at },
    { metricId: 'text', occurrenceId: 'expires', label: t('admin.gdprExport.expiresLabel', 'Expires'),
      rawValue: artifact?.expires_at ? formatRelative(artifact.expires_at) : undefined, context: artifact?.expires_at },
  ];

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
    <PageLayout
      title={t('admin.gdprExport.pageTitle', 'GDPR export')}
      subtitle={t(
        'admin.gdprExport.subtitle',
        'Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.',
      )}
      secondaryActions={actions}
      query={activeId ? query : undefined}
      dataSources={activeId && artifactState.hasData
        ? [{ id: 'gdpr-artifact', label: t('admin.gdprExport.resourceName', 'Export artifact'), query }]
        : undefined}
    >
      <div className="space-y-6">
        <FadeIn>
          <GDPRLookupPanel idInput={idInput} onIdChange={setIdInput} onLookup={handleLookup} />
        </FadeIn>

        {subsystemMissing && (
          <DataStateNotice
            state="unsupported"
            title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}
          >
            {t(
              'admin.gdprExport.notConfigured',
              'GDPR export subsystem is not configured on this deployment.',
            )}
          </DataStateNotice>
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
              error={artifactState.fatalError}
              onRetry={handleRefresh}
              resourceName={t('admin.gdprExport.resourceName', 'Export artifact')}
            />
          </GlassPanel>
        ) : subsystemMissing ? null : (
          <SectionErrorBoundary name="gdpr-export-artifact">
            <div className="space-y-6">
              {/* KPI band — full-width responsive summary, more columns on wide screens */}
              <FadeIn delay={0.05}>
                <AdminSummary metrics={summaryMetrics} testId="gdpr-export-summary"
                  eyebrow={t('admin.gdprExport.pageTitle', 'GDPR export')}
                  title={t('admin.gdprExport.kpis', 'Artifact summary')}
                  description={t('admin.gdprExport.summary.source', 'Status, format, size, storage and lifecycle timestamps describe only the selected export artifact.')}
                  scope={t('admin.gdprExport.summary.scope', 'Selected artifact snapshot; creation and expiry are lifecycle events, not a shared analysis range.')}
                  sourceStatus={artifactState.status === 'stale' ? 'stale' : artifactState.isRefreshing ? 'refreshing' : artifactState.status}
                  loading={kpiLoading} />
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
    </PageLayout>
  );
}
