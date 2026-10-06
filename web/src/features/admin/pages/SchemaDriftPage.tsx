/**
 * Schema fingerprints, object-count comparisons and operator interpretation.
 * Queries and remediation remain read-only; refresh never replaces retained evidence.
 */
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DataStateNotice, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { useSchemaDrift } from '@/api/hooks/useOperatorConfidence';
import { deriveDataState } from '@/api/dataState';
import { isApiError } from '@/lib/resilience';
import { SchemaKpis } from '../components/continuation-admin-1/SchemaKpis';
import { SchemaFingerprints } from '../components/continuation-admin-1/SchemaFingerprints';
import { SchemaBreakdown } from '../components/continuation-admin-1/SchemaBreakdown';
import { SchemaGuidance } from '../components/continuation-admin-1/SchemaGuidance';
import type { SchemaSectionState } from '../components/continuation-admin-1/schemaPresentation';

export default function SchemaDriftPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.schemaDrift.pageTitle', 'Schema drift'));
  const query = useSchemaDrift();
  const source = deriveDataState(query);
  const drift = query.data?.drift ?? null;
  const isDrifted = query.data ? (query.data.is_different ?? drift?.has_drift ?? false) : false;
  const subsystemMissing = isApiError(source.fatalError) && source.fatalError.status === 503;
  const state: SchemaSectionState = {
    drift,
    isLoading: source.status === 'initial',
    error: subsystemMissing ? null : source.fatalError,
    onRetry: () => { void query.refetch(); },
  };

  return (
    <PageLayout
      title={t('admin.schemaDrift.pageTitle', 'Schema drift')}
      subtitle={t('admin.schemaDrift.subtitle', 'Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.')}
      secondaryActions={
        <Button variant="ghost" onClick={state.onRetry}
          aria-label={t('common.refresh', 'Refresh')} title={t('common.refresh', 'Refresh')}>
          <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} aria-hidden />
        </Button>
      }
      query={query}
      dataSources={!subsystemMissing
        ? [{ id: 'schema-drift', label: t('admin.schemaDrift.pageTitle', 'Schema drift'), query }]
        : undefined}
    >
      {subsystemMissing && (
        <DataStateNotice state="unsupported" title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}>
          {t('admin.schemaDrift.notConfigured', 'The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.')}
        </DataStateNotice>
      )}
      <FadeIn><SchemaKpis state={state} isDrifted={isDrifted}
        retained={source.hasData && (source.status === 'stale' || source.isRefreshing)} /></FadeIn>
      <FadeIn delay={0.1}>
        <SectionErrorBoundary name="schema-drift-fingerprints">
          <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            <div className="min-w-0 xl:col-span-2"><SchemaFingerprints state={state} /></div>
            <div className="min-w-0"><SchemaBreakdown state={state} /></div>
          </section>
        </SectionErrorBoundary>
      </FadeIn>
      <FadeIn delay={0.2}><SchemaGuidance state={state} isDrifted={isDrifted} /></FadeIn>
    </PageLayout>
  );
}
