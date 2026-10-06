/**
 * Feature Flags Page — operator surface for the typed feature-flag
 * registry mounted under the `system/flags*` API.
 *
 * Full-width modern-ui bento: a summary KPI band up top, then the live
 * registry (hero) beside a value-type composition breakdown, and finally
 * the recent change-audit log as a full-width detail band:
 *
 *   1. FeatureFlagsOperationalBrief — typed total / boolean / structured /
 *      change / delete / contributor counts with independent feed context.
 *   2. FlagsTable — the CURRENT set of flags with inline Edit + Delete
 *      per row. The "Add flag" CTA in the page header opens the same
 *      drawer with `initial=null`.
 *   3. FlagCompositionPanel — proportional breakdown of stored value
 *      types, sitting beside the registry on wide screens.
 *   4. ChangesPanel — the recent change-audit log. When an operator
 *      saves or deletes a flag, every feed re-renders via shared query
 *      invalidation in the mutation hooks.
 *
 * Each section owns its loading / empty / error state; nothing is gated
 * behind a single page-level guard.
 *
 * Both Edit/Create and Delete are sudo-gated by the server's RequireSudo
 * middleware — the shared `request()` client transparently re-opens the
 * mounted ReauthDialog on 401 + SUDO_REQUIRED and replays the request
 * once the operator authenticates again.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag, History, Layers, Plus } from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { Button, Input, Modal, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { QueryError, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useDeleteFlag,
  useFlagChanges,
  useFlags,
  useSetFlag,
} from '@/api/hooks/useFeatureFlags';
import type {
  FeatureFlagEntry,
  FeatureFlagValue,
} from '@/types/admin-diagnostics';
import { deriveDataState } from '@/api/dataState';
import { FeatureFlagsOperationalBrief } from '../components/statstrip-coverage-flags-secrets/FeatureFlagsOperationalBrief';

import {
  ChangesPanel,
  FlagCompositionPanel,
  FlagEditDrawer,
  FlagsTable,
} from '../components/feature-flags';

export default function FeatureFlagsPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.flags.pageTitle', 'Feature flags'));

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureFlagEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeatureFlagEntry | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const flags = useFlags();
  const changes = useFlagChanges(null, 50);
  const setFlag = useSetFlag();
  const deleteFlag = useDeleteFlag();
  const flagsState = deriveDataState(flags);
  const changesState = deriveDataState(changes);

  const flagRows = flags.data?.flags ?? [];
  const changeRows = changes.data?.rows ?? [];

  const handleEdit = (row: FeatureFlagEntry) => {
    setEditing(row);
    setEditorOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const handleSave = async (input: {
    key: string;
    value: FeatureFlagValue;
    reason: string;
  }) => {
    try {
      await setFlag.mutateAsync(input);
      setEditorOpen(false);
      setEditing(null);
    } catch {
      // Toast + sudo handling are already routed through the mutation.
      // Keep the drawer open so the operator can retry without re-typing.
    }
  };

  const handleAskDelete = (row: FeatureFlagEntry) => {
    setPendingDelete(row);
    setDeleteReason('');
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || deleteReason.trim().length === 0) return;
    try {
      await deleteFlag.mutateAsync({
        key: pendingDelete.key,
        reason: deleteReason.trim(),
      });
      setPendingDelete(null);
      setDeleteReason('');
    } catch {
      // Toast + sudo handling already routed. Leave dialog open on retry.
    }
  };

  return (
    <PageLayout
      title={t('admin.flags.pageTitle', 'Feature flags')}
      subtitle={t(
        'admin.flags.subtitle',
        'Typed feature-flag registry — all changes are sudo-gated and logged.',
      )}
      primaryAction={
        <Button
          variant="primary"
          icon={<Plus className="h-4 w-4" />}
          onClick={handleCreate}
          wrapLabel
        >
          {t('admin.flags.actions.add', 'Add flag')}
        </Button>
      }
      query={[flags, changes]}
      dataSources={[
        { id: 'flag-registry', label: t('admin.flags.panels.registry', 'Registry'), query: flags },
        { id: 'flag-changes', label: t('admin.flags.panels.changes', 'Recent changes'), query: changes },
      ]}
    >
      {/* 1 — Summary KPI band: full-width responsive metric grid */}
      <FadeIn>
        <FeatureFlagsOperationalBrief flags={flags} changes={changes} />
      </FadeIn>

      {/* 2 — Registry (hero) beside the value-type composition breakdown */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionErrorBoundary name="flags-table">
            <div className="min-w-0 xl:col-span-2">
            <LayoutCard title={t('admin.flags.panels.registry', 'Registry')}
              actions={<Flag className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
              {flagsState.fatalError ? (
                <QueryError
                  error={flagsState.fatalError}
                  onRetry={() => flags.refetch()}
                  resourceName={t('admin.flags.stats.resource', 'Feature flags')}
                />
              ) : (
                <FlagsTable
                  rows={flagRows}
                  loading={flagsState.status === 'initial'}
                  onEdit={handleEdit}
                  onAskDelete={handleAskDelete}
                />
              )}
            </LayoutCard>
            </div>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="flags-composition">
            <LayoutCard title={t('admin.flags.panels.composition', 'Value composition')}
              actions={<Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
              <FlagCompositionPanel
                flags={flagRows}
                loading={flagsState.status === 'initial'}
                error={flagsState.fatalError}
                onRetry={() => flags.refetch()}
              />
            </LayoutCard>
          </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* 3 — Recent change-audit log: full-width detail band */}
      <FadeIn delay={0.2}>
        <SectionErrorBoundary name="flags-changes">
          <LayoutCard title={t('admin.flags.panels.changes', 'Recent changes')}
            actions={<History className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
            {changesState.fatalError ? (
              <QueryError
                error={changesState.fatalError}
                onRetry={() => changes.refetch()}
                resourceName={t('admin.flags.stats.resource', 'Feature flags')}
              />
            ) : (
              <ChangesPanel rows={changeRows} loading={changesState.status === 'initial'} />
            )}
          </LayoutCard>
        </SectionErrorBoundary>
      </FadeIn>

      <FlagEditDrawer
        open={editorOpen}
        initial={editing}
        saving={setFlag.isPending}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (deleteFlag.isPending) return;
          setPendingDelete(null);
          setDeleteReason('');
        }}
        title={t('admin.flags.delete.title', 'Delete flag?')}
        size="sm"
      >
        <div className="space-y-4">
          <Text variant="bodySm" as="p">
            {t(
              'admin.flags.delete.message',
              'Permanently remove flag "{{key}}". This is logged as a delete operation in the audit feed.',
              { key: pendingDelete?.key ?? '' },
            )}
          </Text>
          <Input
            label={t('admin.flags.delete.reasonLabel', 'Reason')}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            required
            placeholder={t(
              'admin.flags.delete.reasonPlaceholder',
              'Why this delete? (logged in audit)',
            )}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPendingDelete(null);
                setDeleteReason('');
              }}
              disabled={deleteFlag.isPending}
              wrapLabel
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deleteFlag.isPending}
              disabled={deleteReason.trim().length === 0 || deleteFlag.isPending}
              onClick={handleConfirmDelete}
              wrapLabel
            >
              {t('admin.flags.delete.confirm', 'Delete flag')}
            </Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
