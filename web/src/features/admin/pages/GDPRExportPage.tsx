import { Icons } from '@/lib/icons';
/**
 * GDPR Export Page — admin observability surface.
 *
 * Looks up a persisted manifest by id with explicit refresh and exposes a
 * browser-owned download for supported, unexpired artifacts. The id can be
 * supplied via `?id=<uuid>` so links to specific exports work.
 *
 * Backed by:
 *   GET  admin/gdpr/exports/{id}           (persisted manifest)
 *   GET  admin/gdpr/exports/{id}/download  (binary stream)
 *
 * See internal/handler/v1/gdpr_export_handler.go.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button, Icon } from '@/components/ui';
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

import { useDateFormat } from '@/hooks/useDateFormat';

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
  const { formatRelative } = useDateFormat();
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
  const [now, setNow] = useState(Date.now);
  const expiry = artifact?.expires_at;
  const expiryParts = typeof expiry === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(expiry)
    : null;
  const parsedExpiryMs = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  const expiryMs = expiryParts
    && Number(expiryParts[2]) >= 1 && Number(expiryParts[2]) <= 12
    && Number(expiryParts[3]) >= 1
    && Number(expiryParts[3]) <= new Date(Date.UTC(Number(expiryParts[1]), Number(expiryParts[2]), 0)).getUTCDate()
    && Number.isFinite(parsedExpiryMs)
    ? parsedExpiryMs
    : null;

  useEffect(() => {
    setNow(Date.now());
    if (!artifact) return;
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1_000);
    const remaining = expiryMs == null ? 0 : expiryMs - Date.now();
    const boundary = remaining > 0 && remaining <= 2_147_483_647
      ? window.setTimeout(tick, remaining)
      : undefined;
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(boundary);
    };
  }, [artifact, expiryMs]);

  const { refetch } = query;
  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleLookup = useCallback(() => {
    const next = idInput.trim();
    setSearchParams(next ? { id: next } : {}, { replace: true });
  }, [idInput, setSearchParams]);

  const expired = expiryMs != null && now >= expiryMs;
  const identityMatches = typeof artifact?.id === 'string' && artifact.id === activeId && activeId !== '';
  const availability = !artifact ? undefined
    : !identityMatches || expiryMs == null || !artifact.storage_kind
      ? t('admin.gdprExport.availability.unknown', 'Download eligibility unknown')
      : expired
        ? t('admin.gdprExport.availability.expired', 'Expired')
        : artifact.storage_kind !== 'local_fs'
          ? t('admin.gdprExport.availability.unsupported', 'Storage download not supported')
          : t('admin.gdprExport.availability.eligible', 'Eligible to request download');
  // A manifest cannot prove that the stored file still exists or will stream.
  const downloadUrl = artifact && identityMatches && artifact.storage_kind === 'local_fs'
    && expiryMs != null && !expired
    ? apiUrl(`/admin/gdpr/exports/${encodeURIComponent(artifact.id)}/download`)
    : null;

  // KPI band summary state. `kpiLoading` keeps the tiles visible with
  // skeletons while the first fetch resolves, then shows real values.
  const kpiLoading = artifactState.status === 'initial';
  const summaryMetrics: StatMetric[] = [
    { metricId: 'text', occurrenceId: 'availability', label: t('admin.gdprExport.availabilityLabel', 'Download eligibility'),
      rawValue: availability },
    { metricId: 'text', occurrenceId: 'export-job', label: t('admin.gdprExport.exportJobLabel', 'Export job ID'), rawValue: artifact?.export_job_id },
    { metricId: 'bytes', occurrenceId: 'bytes', label: t('admin.gdprExport.bytesLabel', 'Size'), rawValue: artifact?.byte_count,
      display: { formatter: raw => ({ value: formatBytes(raw), unit: '' }) } },
    { metricId: 'text', occurrenceId: 'storage', label: t('admin.gdprExport.storageLabel', 'Storage'), rawValue: artifact?.storage_kind },
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
      aria-label={t('admin.gdprExport.manifestRefresh', 'Refresh artifact manifest')}
      className="min-h-11 min-w-11 shrink-0"
    >
      <Icon icon={Icons.refresh} />
    </Button>
  );

  return (
    <PageLayout
      title={t('admin.gdprExport.pageTitle', 'GDPR export')}
      subtitle={t(
        'admin.gdprExport.manifestSubtitle',
        'Look up a persisted GDPR export manifest by artifact ID. Refresh explicitly to check metadata; download requests require supported storage and a valid future expiry.',
      )}
      secondaryActions={actions}
      query={activeId ? query : undefined}
      dataSources={activeId && artifactState.hasData
        ? [{ id: 'gdpr-artifact', label: t('admin.gdprExport.resourceName', 'Export artifact'), query }]
        : undefined}
    >
      <div className="min-w-0 space-y-6">
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
                icon={<Icon icon={Icons.hardDriveDownload} size="xl" />}
                title={t('admin.gdprExport.emptyTitle', 'No artifact selected')}
                message={t(
                  'admin.gdprExport.manifestEmptyMessage',
                  'Enter an artifact ID above to look up its manifest. Use Refresh to check for updated metadata.',
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
            <div className="min-w-0 space-y-6">
              {artifactState.isRefreshBlocked && !artifactState.hasData && (
                <DataStateNotice state="partial"
                  title={t('admin.gdprExport.lookupPausedTitle', 'Artifact lookup paused')}>
                  {t('admin.gdprExport.lookupPausedMessage', 'The lookup is paused. No artifact result has been received; this is not an export failure or an empty result. Retry when the request can resume.')}
                  <Button variant="ghost" onClick={handleRefresh}>{t('common.retry', 'Retry')}</Button>
                </DataStateNotice>
              )}
              {/* KPI band — full-width responsive summary, more columns on wide screens */}
              <FadeIn delay={0.05}>
                <AdminSummary metrics={summaryMetrics} testId="gdpr-export-summary"
                  eyebrow={t('admin.gdprExport.pageTitle', 'GDPR export')}
                  title={t('admin.gdprExport.kpis', 'Artifact summary')}
                  description={t('admin.gdprExport.summary.manifestSource', 'Persisted manifest metadata describes only the selected export artifact, not export-job progress or file availability.')}
                  scope={t('admin.gdprExport.summary.manifestScope', 'Selected artifact snapshot; creation, download and expiry timestamps are manifest events, not a shared analysis range.')}
                  sourceStatus={artifactState.status === 'stale' ? 'stale' : artifactState.isRefreshing ? 'refreshing' : artifactState.status}
                  loading={kpiLoading} />
              </FadeIn>

              {artifact && (
                <AlertBanner variant={downloadUrl ? 'info' : 'warning'} title={availability}>
                  {t('admin.gdprExport.availabilityHint', 'Only local filesystem downloads are supported. Expired artifacts or unknown identity, storage or expiry do not offer a download. An eligible request can still fail if the stored bundle is missing.')}
                </AlertBanner>
              )}

              {/* Detail bento — hero details span two columns, supporting panels fill the third */}
              <FadeIn delay={0.1}>
                <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
                  <GDPRArtifactDetails
                    artifact={artifact}
                    loading={kpiLoading}
                    className="min-w-0 xl:col-span-2"
                  />
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <GDPRDownloadPanel
                      artifact={artifact}
                      downloadUrl={downloadUrl}
                      loading={kpiLoading}
                      className="min-w-0"
                    />
                    <GDPRLifecyclePanel artifact={artifact} loading={kpiLoading} now={now} className="min-w-0" />
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
