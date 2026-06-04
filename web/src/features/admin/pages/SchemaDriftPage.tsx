/**
 * Schema Drift admin observability surface.
 *
 * Renders the current schema fingerprint vs the recorded seed
 * fingerprint, with deltas for table/column/index counts. The seed
 * is captured at boot and persisted in `schema_fingerprint`; drift
 * surfaces when a migration ran without a corresponding seed
 * regeneration, or when raw DDL bypassed migrations.
 *
 * Backed by GET /api/v1/admin/observability/schema-drift
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useTranslation } from 'react-i18next';
import { Fingerprint, AlertTriangle, CheckCircle2 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, Text, Caption } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { useSchemaDrift } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';

export default function SchemaDriftPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.schemaDrift.pageTitle', 'Schema Drift'));

  const query = useSchemaDrift();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;

  return (
    <PageContainer
      title={t('admin.schemaDrift.pageTitle', 'Schema Drift')}
      subtitle={t(
        'admin.schemaDrift.subtitle',
        'Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.',
      )}
      query={query}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.schemaDrift.notConfigured',
                'The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.',
              )}
            </AlertBanner>
          )}

          {query.data && <DriftSummary data={query.data} />}
          {query.data && (
            <SectionErrorBoundary name="schema-drift-details">
              <DriftDetails data={query.data} />
            </SectionErrorBoundary>
          )}

          {!query.isLoading && !query.data && !subsystemMissing && (
            <GlassPanel className="p-6">
              {/* no-action: the schema fingerprint is seeded by an API restart, which is an ops action not exposed in the UI */}
              <EmptyState
                icon={<Fingerprint className="h-8 w-8" />}
                title={t('admin.schemaDrift.emptyTitle', 'No fingerprint available')}
                message={t(
                  'admin.schemaDrift.emptyMessage',
                  'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.',
                )}
              />
            </GlassPanel>
          )}
        </div>
      </FadeIn>
    </PageContainer>
  );
}

interface DriftSummaryProps {
  data: ReturnType<typeof useSchemaDrift>['data'] & object;
}

function DriftSummary({ data }: DriftSummaryProps) {
  const { t } = useTranslation();
  const drift = data.drift;
  const isDrifted = data.is_different ?? drift.has_drift;

  return (
    <GlassPanel className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <PanelTitle>{t('admin.schemaDrift.statusTitle', 'Drift status')}</PanelTitle>
        <Badge
          variant={isDrifted ? 'warning' : 'success'}
          className="flex items-center gap-2"
        >
          {isDrifted ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {isDrifted
            ? t('admin.schemaDrift.statusDrifted', 'Drift detected')
            : t('admin.schemaDrift.statusClean', 'No drift')}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label={t('admin.schemaDrift.tableDelta', 'Tables Δ')}
          value={formatDelta(drift.table_count_delta)}
          sublabel={t('admin.schemaDrift.tableSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.table_count),
            expected: fmtNumber(drift.expected.table_count),
          })}
        />
        <StatCard
          label={t('admin.schemaDrift.columnDelta', 'Columns Δ')}
          value={formatDelta(drift.column_count_delta)}
          sublabel={t('admin.schemaDrift.columnSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.column_count),
            expected: fmtNumber(drift.expected.column_count),
          })}
        />
        <StatCard
          label={t('admin.schemaDrift.indexDelta', 'Indexes Δ')}
          value={formatDelta(drift.index_count_delta)}
          sublabel={t('admin.schemaDrift.indexSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.index_count),
            expected: fmtNumber(drift.expected.index_count),
          })}
        />
      </div>
    </GlassPanel>
  );
}

function DriftDetails({ data }: DriftSummaryProps) {
  const { t } = useTranslation();
  const drift = data.drift;

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4">{t('admin.schemaDrift.fingerprintTitle', 'Fingerprints')}</PanelTitle>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <FingerprintCard
          title={t('admin.schemaDrift.fingerprintCurrent', 'Current')}
          sha256={drift.current.sha256}
          tableCount={drift.current.table_count}
          columnCount={drift.current.column_count}
          indexCount={drift.current.index_count}
        />
        <FingerprintCard
          title={t('admin.schemaDrift.fingerprintExpected', 'Expected (seed)')}
          sha256={drift.expected.sha256}
          tableCount={drift.expected.table_count}
          columnCount={drift.expected.column_count}
          indexCount={drift.expected.index_count}
          generatedAt={drift.expected_generated_at ?? null}
        />
      </div>
    </GlassPanel>
  );
}

interface FingerprintCardProps {
  title: string;
  sha256: string;
  tableCount: number;
  columnCount: number;
  indexCount: number;
  generatedAt?: string | null;
}

function FingerprintCard({
  title,
  sha256,
  tableCount,
  columnCount,
  indexCount,
  generatedAt,
}: FingerprintCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
      <Text variant="bodySm" className="mb-2 font-medium text-[var(--text-primary)]">
        {title}
      </Text>
      <Caption className="mb-3 break-all font-mono">{sha256 || '—'}</Caption>
      <div className="grid grid-cols-3 gap-2 text-center">
        <FingerprintStat label={t('admin.schemaDrift.tables', 'Tables')} value={tableCount} />
        <FingerprintStat label={t('admin.schemaDrift.columns', 'Columns')} value={columnCount} />
        <FingerprintStat label={t('admin.schemaDrift.indexes', 'Indexes')} value={indexCount} />
      </div>
      {generatedAt && (
        <Caption className="mt-3">
          {t('admin.schemaDrift.generatedAt', 'Captured {{when}}', {
            when: formatDateTime(generatedAt),
          })}
        </Caption>
      )}
    </div>
  );
}

function FingerprintStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-[var(--text-primary)]">{fmtNumber(value)}</div>
      <Caption>{label}</Caption>
    </div>
  );
}

function formatDelta(delta: number): string {
  if (delta === 0) return '0';
  return delta > 0 ? `+${fmtNumber(delta)}` : fmtNumber(delta);
}
