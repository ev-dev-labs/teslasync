/**
 * APIKeysPage — manage API keys for programmatic access to TeslaSync.
 *
 * Modern-UI full-width redesign: a KPI band, a hero key grid, and a supporting
 * access-levels + guidance column form a responsive bento that reflows to more
 * columns on wide screens. Create / revoke / delete are preserved in full; each
 * data section owns its own loading / error / empty state.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Key, KeyRound, ShieldCheck, Info,
} from 'lucide-react';

import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import { Button, ConfirmDialog, Text, Caption } from '@/components/ui';
import { MetricBar, type StatMetric } from '@/components/data-display';
import { AdminSummary } from '../components/operationalbrief-a-g/AdminSummary';
import {
  EmptyState,
  Skeleton,
  QueryError,
  OperationalWriteNotice,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useApiKeys, useDeleteApiKey, useRevokeApiKey } from '@/api/hooks/useAdmin';
import type { APIKey } from '@/types/admin';
import {
  ApiKeyCard,
  CreateApiKeyModal,
  summarizeKeys,
  permissionMeta,
  PERMISSION_ORDER,
} from '../components/api-keys';

export default function APIKeysPage() {
  const { t } = useTranslation();
  usePageTitle(t('apiKeys.title', 'API keys'));

  const keysQuery = useApiKeys();
  const { data, isLoading, refetch } = keysQuery;
  const keysState = useDataState(keysQuery);
  const keys = data ?? [];

  const deleteMut = useDeleteApiKey();
  const revokeMut = useRevokeApiKey();
  const operationalMode = useOperationalMode();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null);

  useEffect(() => {
    if (operationalMode.canWrite) return;
    setShowCreate(false);
    setDeleteTarget(null);
  }, [operationalMode.canWrite]);

  const summary = useMemo(() => summarizeKeys(keys), [keys]);
  const sourceState = !keysState.hasData
    ? 'loading' : keysState.status === 'stale' ? 'retained' : keys.length === 0 ? 'empty' : 'ready';
  const emptyInventory = (
    // no-action: the page header owns Create key and its read-only guard; do not duplicate an unguarded write CTA here.
    <EmptyState
      icon={<Key className="h-10 w-10" aria-hidden="true" />}
      title={t('apiKeys.empty.title', 'No API keys')}
      message={t('apiKeys.empty.message', 'Create an API key to enable programmatic access to TeslaSync data and controls.')}
    />
  );
  const emptyPermissions = (
    // no-action: this is derived usage detail; the page header already offers guarded key creation.
    <EmptyState
      icon={<KeyRound className="h-8 w-8" aria-hidden="true" />}
      message={t('apiKeys.accessLevelsEmpty', 'Permission usage appears once you create a key.')}
    />
  );

  const kpis: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total', label: t('apiKeys.kpi.total', 'Total keys'), rawValue: keysState.hasData ? summary.total : undefined },
    { metricId: 'count', occurrenceId: 'active', label: t('apiKeys.kpi.active', 'Active'), rawValue: keysState.hasData ? summary.active : undefined },
    { metricId: 'count', occurrenceId: 'expired', label: t('apiKeys.kpi.expired', 'Expired'), rawValue: keysState.hasData ? summary.expired : undefined },
    { metricId: 'count', occurrenceId: 'admin', label: t('apiKeys.kpi.admin', 'Admin access'), rawValue: keysState.hasData ? summary.admin : undefined },
  ];

  const guidancePoints = [
    t('apiKeys.guidance.secret', 'Treat keys like passwords — never commit them to source control.'),
    t('apiKeys.guidance.leastPrivilege', 'Grant the lowest permission level each integration actually needs.'),
    t('apiKeys.guidance.rotate', 'Revoke keys you no longer use and rotate them periodically.'),
  ];

  return (
    <PageLayout
      title={t('apiKeys.title', 'API keys')}
      subtitle={t('apiKeys.subtitle', 'Manage programmatic access to TeslaSync')}
      query={keysQuery}
      primaryAction={
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setShowCreate(true)}
          disabled={!operationalMode.canWrite}
          title={operationalMode.writeBlockReason ?? undefined}
        >
          {t('apiKeys.createKey', 'Create key')}
        </Button>
      }
    >
      <OperationalWriteNotice
        title={t('apiKeys.readOnly.title', 'API key management is read-only')}
      />

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <AdminSummary metrics={kpis} testId="api-keys-summary"
          eyebrow={t('apiKeys.title', 'API keys')} title={t('apiKeys.kpi.aria', 'API key summary')}
          description={t('apiKeys.summary.source', 'Counts are derived from the loaded API key inventory, including active, expired and administrator-access keys.')}
          scope={t('apiKeys.summary.scope', 'Loaded inventory snapshot; the response does not report an observation time.')}
          sourceStatus={keysState.status === 'stale' ? 'stale' : keysState.isRefreshing ? 'refreshing' : keysState.status}
          loading={isLoading && !keysState.hasData} />
      </FadeIn>

      {/* 2 — Bento: hero key grid (col-span-2) + access-levels/guidance column */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Hero — the key inventory */}
          <div className="min-w-0 xl:col-span-2">
            <LayoutCard
              title={t('apiKeys.keysPanel', 'Your API keys')}
              actions={
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {keysState.hasData && summary.total > 0 && (
                    <Caption>{t('apiKeys.count', '{{count}} total', { count: summary.total })}</Caption>
                  )}
                </div>
              }
            >
              {keysState.fatalError ? (
                <QueryError
                  error={keysState.fatalError}
                  onRetry={() => refetch()}
                  resourceName={t('apiKeys.resource', 'API key')}
                />
              ) : (
                <SourceContent
                  state={sourceState}
                  label={t('apiKeys.keysPanel', 'Your API keys')}
                  emptyMessage={t('apiKeys.empty.message', 'Create an API key to enable programmatic access to TeslaSync data and controls.')}
                  errorMessage={t('error.loadFailed', 'Failed to load data')}
                  errorRecovery={{ onRetry: () => { void refetch(); } }}
                  emptyContent={emptyInventory}
                  loadingContent={
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={128} className="rounded-xl" />)}
                    </div>
                  }
                >
                  {keys.length === 0 ? emptyInventory : (
                    <StaggerContainer className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {keys.map((k) => (
                        <StaggerItem key={k.id}>
                          <ApiKeyCard
                            apiKey={k}
                            onRevoke={(id) => revokeMut.mutate(id)}
                            onDelete={setDeleteTarget}
                            revoking={revokeMut.isPending && revokeMut.variables === k.id}
                            actionsDisabled={!operationalMode.canWrite}
                            actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
                          />
                        </StaggerItem>
                      ))}
                    </StaggerContainer>
                  )}
                </SourceContent>
              )}
            </LayoutCard>
          </div>

          {/* Supporting column — access levels + guidance */}
          <div className="space-y-4">
            <LayoutCard
              title={t('apiKeys.accessLevels', 'Access levels')}
              actions={<KeyRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            >
              {keysState.fatalError ? (
                <QueryError error={keysState.fatalError} onRetry={() => refetch()} />
              ) : (
                <SourceContent
                  state={sourceState}
                  label={t('apiKeys.accessLevels', 'Access levels')}
                  emptyMessage={t('apiKeys.accessLevelsEmpty', 'Permission usage appears once you create a key.')}
                  errorMessage={t('error.loadFailed', 'Failed to load data')}
                  errorRecovery={{ onRetry: () => { void refetch(); } }}
                  loadingContent={<Skeleton height={160} />}
                  emptyContent={emptyPermissions}
                >
                  {summary.total === 0 ? emptyPermissions : (
                    <div className="space-y-4">
                      {PERMISSION_ORDER.map((perm) => {
                        const meta = permissionMeta(perm);
                        const count = summary.byPermission[perm] ?? 0;
                        return (
                          <div key={perm} className="space-y-1">
                            <MetricBar
                              label={t(meta.labelKey, meta.labelFallback)}
                              value={count}
                              max={summary.total || 1}
                              color={meta.barColor}
                              sublabel={String(count)}
                            />
                            <Caption>{t(meta.descKey, meta.descFallback)}</Caption>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SourceContent>
              )}
            </LayoutCard>

            <LayoutCard
              title={t('apiKeys.guidance.title', 'About API keys')}
              actions={<Info className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            >
              <ul className="space-y-2">
                {guidancePoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
                    <Text as="span" variant="bodySm">{point}</Text>
                  </li>
                ))}
              </ul>
            </LayoutCard>
          </div>
        </section>
      </FadeIn>

      {/* Create dialog — owns its own form + generated-key state */}
      <CreateApiKeyModal open={showCreate} onClose={() => setShowCreate(false)} />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('apiKeys.deleteTitle', 'Delete API key')}
        message={t('apiKeys.deleteConfirm', 'Are you sure you want to permanently delete the key "{{name}}"?', {
          name: deleteTarget?.name,
        })}
        confirmLabel={t('apiKeys.delete', 'Delete')}
        cancelLabel={t('apiKeys.cancel', 'Cancel')}
        variant="danger"
        loading={deleteMut.isPending}
        onConfirm={() =>
          deleteTarget && deleteMut.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }
        onCancel={() => setDeleteTarget(null)}
      />
    </PageLayout>
  );
}
