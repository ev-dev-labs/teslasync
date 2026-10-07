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
  Plus, Key, KeyRound, ShieldCheck, XCircle, Crown, Info,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, ConfirmDialog, PanelTitle, Text, Caption } from '@/components/ui';
import { MetricCard, MetricBar } from '@/components/data-display';
import {
  EmptyState,
  Skeleton,
  QueryError,
  OperationalWriteNotice,
} from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useApiKeys, useDeleteApiKey, useRevokeApiKey } from '@/api/hooks/useAdmin';
import type { NeonColor } from '@/lib/tokens';
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
  usePageTitle(t('apiKeys.title', 'API Keys'));

  const keysQuery = useApiKeys();
  const { data, isLoading, isError, error, refetch } = keysQuery;
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

  const kpis: { key: string; label: string; value: number; icon: React.ReactNode; color: NeonColor }[] = [
    { key: 'total', label: t('apiKeys.kpi.total', 'Total Keys'), value: summary.total, icon: <Key className="h-5 w-5" />, color: 'cyan' },
    { key: 'active', label: t('apiKeys.kpi.active', 'Active'), value: summary.active, icon: <ShieldCheck className="h-5 w-5" />, color: 'green' },
    { key: 'expired', label: t('apiKeys.kpi.expired', 'Expired'), value: summary.expired, icon: <XCircle className="h-5 w-5" />, color: 'red' },
    { key: 'admin', label: t('apiKeys.kpi.admin', 'Admin Access'), value: summary.admin, icon: <Crown className="h-5 w-5" />, color: 'purple' },
  ];

  const guidancePoints = [
    t('apiKeys.guidance.secret', 'Treat keys like passwords — never commit them to source control.'),
    t('apiKeys.guidance.leastPrivilege', 'Grant the lowest permission level each integration actually needs.'),
    t('apiKeys.guidance.rotate', 'Revoke keys you no longer use and rotate them periodically.'),
  ];

  return (
    <PageContainer
      title={t('apiKeys.title', 'API Keys')}
      subtitle={t('apiKeys.subtitle', 'Manage programmatic access to TeslaSync')}
      query={keysQuery}
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setShowCreate(true)}
          disabled={!operationalMode.canWrite}
          title={operationalMode.writeBlockReason ?? undefined}
        >
          {t('apiKeys.createKey', 'Create Key')}
        </Button>
      }
    >
      <OperationalWriteNotice
        title={t('apiKeys.readOnly.title', 'API key management is read-only')}
      />

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('apiKeys.kpi.aria', 'API key summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {isLoading
            ? Array.from({ length: kpis.length }).map((_, i) => (
                <Skeleton key={i} height={84} className="rounded-xl" />
              ))
            : kpis.map((k) => (
                // On error the query holds no data — surface the em-dash
                // placeholder instead of a fabricated "0" so the KPI band
                // never reports counts that don't actually exist.
                <MetricCard
                  key={k.key}
                  label={k.label}
                  value={isError ? '—' : k.value}
                  icon={k.icon}
                  color={k.color}
                />
              ))}
        </section>
      </FadeIn>

      {/* 2 — Bento: hero key grid (col-span-2) + access-levels/guidance column */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Hero — the key inventory */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <PanelTitle className="flex items-center gap-2">
                <Key className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('apiKeys.keysPanel', 'Your API Keys')}
              </PanelTitle>
              {!isLoading && !isError && summary.total > 0 && (
                <Caption>{t('apiKeys.count', '{{count}} total', { count: summary.total })}</Caption>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={128} className="rounded-xl" />
                ))}
              </div>
            ) : isError ? (
              <QueryError
                error={error}
                onRetry={() => refetch()}
                resourceName={t('apiKeys.resource', 'API key')}
              />
            ) : keys.length === 0 ? (
              <EmptyState /* no-action: transient empty state — the Create Key toolbar button is the recovery action */
                icon={<Key className="h-10 w-10" aria-hidden="true" />}
                title={t('apiKeys.empty.title', 'No API keys')}
                message={t(
                  'apiKeys.empty.message',
                  'Create an API key to enable programmatic access to TeslaSync data and controls.',
                )}
              />
            ) : (
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
          </GlassPanel>

          {/* Supporting column — access levels + guidance */}
          <div className="space-y-4">
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('apiKeys.accessLevels', 'Access Levels')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton height={160} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : summary.total === 0 ? (
                <EmptyState /* no-action: transient — populated once keys exist */
                  icon={<KeyRound className="h-8 w-8" aria-hidden="true" />}
                  message={t('apiKeys.accessLevelsEmpty', 'Permission usage appears once you create a key.')}
                />
              ) : (
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
            </GlassPanel>

            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('apiKeys.guidance.title', 'About API Keys')}
              </PanelTitle>
              <ul className="space-y-2">
                {guidancePoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
                    <Text as="span" variant="bodySm">{point}</Text>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* Create dialog — owns its own form + generated-key state */}
      <CreateApiKeyModal open={showCreate} onClose={() => setShowCreate(false)} />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('apiKeys.deleteTitle', 'Delete API Key')}
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
    </PageContainer>
  );
}
