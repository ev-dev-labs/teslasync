import { useTranslation } from 'react-i18next';
import {
  Clock3,
  Database,
  Download,
  Files,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import {
  OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS,
  type CommunicationsCatalogStatus,
  type OfficialNHTSACommunicationsArtifactURL,
} from '@/api/hooks/useServiceIntelligence';
import { DateTime } from '@/components/data-display';
import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, Button, Caption, GlassPanel, PanelTitle, Text } from '@/components/ui';

const catalogFreshnessMs = 8 * 24 * 60 * 60 * 1000;

export type CommunicationsCatalogFreshness = 'fresh' | 'stale' | 'unavailable';

export function communicationsCatalogFreshness(
  status: CommunicationsCatalogStatus | null,
  now = Date.now(),
): CommunicationsCatalogFreshness {
  const completedAt = status?.latest_successful?.completed_at;
  if (!completedAt) return 'unavailable';
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs) || now - completedMs >= catalogFreshnessMs) {
    return 'stale';
  }
  return 'fresh';
}

export interface CommunicationsCatalogPanelProps {
  status: CommunicationsCatalogStatus | null;
  loading: boolean;
  error: unknown;
  importing: boolean;
  importingArtifactURL: OfficialNHTSACommunicationsArtifactURL | null;
  importError: unknown;
  onRetry: () => void;
  onImport: (artifactURL: OfficialNHTSACommunicationsArtifactURL) => void;
}

function artifactFilename(artifactURL: string): string {
  return artifactURL.slice(artifactURL.lastIndexOf('/') + 1);
}

export function CommunicationsCatalogPanel({
  status,
  loading,
  error,
  importing,
  importingArtifactURL,
  importError,
  onRetry,
  onImport,
}: CommunicationsCatalogPanelProps) {
  const { t } = useTranslation();
  const freshness = communicationsCatalogFreshness(status);
  const latest = status?.latest_successful ?? null;
  const latestAttempt = status?.latest_attempt ?? null;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('serviceIntelligence.catalog.title', 'Official NHTSA TSB catalog')}
          </PanelTitle>
          <Text as="p" variant="helper" className="mt-1">
            {t(
              'serviceIntelligence.catalog.subtitle',
              'Administrator controls for the normalized manufacturer-communications index.',
            )}
          </Text>
        </div>
        <Badge
          variant={
            freshness === 'fresh'
              ? 'success'
              : freshness === 'stale'
                ? 'warning'
                : 'neutral'
          }
        >
          {freshness === 'fresh'
            ? t('serviceIntelligence.catalog.fresh', 'Fresh')
            : freshness === 'stale'
              ? t('serviceIntelligence.catalog.stale', 'Stale')
              : t('serviceIntelligence.catalog.unavailable', 'Not imported')}
        </Badge>
      </div>

      {loading ? (
        <Skeleton lines={5} className="py-3" />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
              <dt>
                <Caption>{t('serviceIntelligence.catalog.records', 'Normalized Tesla records')}</Caption>
              </dt>
              <dd><Text variant="metricValue">{status?.record_count ?? 0}</Text></dd>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
              <dt>
                <Caption>{t('serviceIntelligence.catalog.coverage', 'Official period artifacts')}</Caption>
              </dt>
              <dd><Text variant="metricValue">{OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS.length}</Text></dd>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
              <dt>
                <Caption>{t('serviceIntelligence.catalog.lastSuccess', 'Last successful import')}</Caption>
              </dt>
              <dd>
                {latest?.completed_at ? (
                  <DateTime value={latest.completed_at} variant="full" />
                ) : (
                  <Text variant="body">{t('serviceIntelligence.catalog.never', 'Never')}</Text>
                )}
              </dd>
            </div>
          </dl>

          {freshness === 'unavailable' && (
            <EmptyState
              /* no-action: period-specific shared buttons below initiate the first import. */
              icon={<Files className="h-9 w-9" />}
              title={t('serviceIntelligence.catalog.emptyTitle', 'TSB catalog is not populated')}
              message={t(
                'serviceIntelligence.catalog.empty',
                'Import the official periods below to enable manufacturer-communication matching.',
              )}
            />
          )}

          {freshness === 'stale' && (
            <AlertBanner
              variant="warning"
              icon={<Clock3 className="h-4 w-4" />}
              title={t('serviceIntelligence.catalog.staleTitle', 'Catalog refresh recommended')}
            >
              {t(
                'serviceIntelligence.catalog.staleBody',
                'The latest successful import is more than eight days old. Existing normalized matches remain available.',
              )}
            </AlertBanner>
          )}

          {latestAttempt?.status === 'failed' && (
            <AlertBanner
              variant="danger"
              icon={<TriangleAlert className="h-4 w-4" />}
              title={t('serviceIntelligence.catalog.failedTitle', 'Latest import failed')}
            >
              {latestAttempt.error_detail ??
                t(
                  'serviceIntelligence.catalog.failedBody',
                  'The last successful catalog remains active. Retry the affected official period.',
                )}
            </AlertBanner>
          )}

          {importError != null && (
            <AlertBanner
              variant="danger"
              title={t('serviceIntelligence.catalog.importError', 'Catalog import failed')}
            >
              {importError instanceof Error
                ? importError.message
                : t('serviceIntelligence.catalog.importErrorBody', 'Retry the official artifact import.')}
            </AlertBanner>
          )}

          {latest && (
            <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <Text variant="body" weight="semibold">
                  {artifactFilename(latest.artifact_url)}
                </Text>
                {latest.not_modified && (
                  <Badge variant="neutral">
                    {t('serviceIntelligence.catalog.notModified', 'Already current')}
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Caption>
                  {t('serviceIntelligence.catalog.rowsRead', '{{count}} source rows', {
                    count: latest.total_rows,
                  })}
                </Caption>
                <Caption>
                  {t('serviceIntelligence.catalog.rowsImported', '{{count}} Tesla rows', {
                    count: latest.imported_rows,
                  })}
                </Caption>
                <Caption>
                  {t('serviceIntelligence.catalog.rowsRejected', '{{count}} rejected', {
                    count: latest.rejected_rows,
                  })}
                </Caption>
                {latest.artifact_sha256 && (
                  <Text variant="caption" mono title={latest.artifact_sha256}>
                    SHA-256 {latest.artifact_sha256.slice(0, 12)}…
                  </Text>
                )}
              </div>
            </div>
          )}

          <div>
            <Text variant="body" weight="semibold">
              {t('serviceIntelligence.catalog.periodsTitle', 'Official artifact coverage')}
            </Text>
            <Text as="p" variant="helper" className="mt-1">
              {t(
                'serviceIntelligence.catalog.periodsBody',
                'Imports are idempotent, restricted to official NHTSA URLs, and may request step-up authentication.',
              )}
            </Text>
            <ol className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS.map((artifact) => {
                const isLatest = latest?.artifact_url === artifact.url;
                const isImporting = importing && importingArtifactURL === artifact.url;
                return (
                  <li
                    key={artifact.url}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
                  >
                    <div>
                      <Text variant="body" weight="semibold">{artifact.period}</Text>
                      <Caption className="mt-1 block">{artifactFilename(artifact.url)}</Caption>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isLatest && (
                        <Badge variant="success">
                          {t('serviceIntelligence.catalog.latest', 'Latest successful')}
                        </Badge>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={isLatest ? 'secondary' : 'outline'}
                        loading={isImporting}
                        disabled={importing}
                        icon={
                          isLatest
                            ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            : <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        }
                        aria-label={t(
                          'serviceIntelligence.catalog.importPeriodLabel',
                          'Import official NHTSA artifact for {{period}}',
                          { period: artifact.period },
                        )}
                        onClick={() => onImport(artifact.url)}
                      >
                        {isLatest
                          ? t('serviceIntelligence.catalog.refreshPeriod', 'Refresh')
                          : t('serviceIntelligence.catalog.importPeriod', 'Import')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
