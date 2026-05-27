/**
 * Feature Flags Page — operator surface for the typed feature-flag
 * registry mounted under `/api/v1/system/flags*`.
 *
 * The page surfaces two concerns side-by-side:
 *
 *   1. The CURRENT set of flags (FlagsTable) with inline Edit + Delete
 *      actions per row. The "Add flag" CTA in the page header opens the
 *      same drawer with `initial=null`.
 *
 *   2. The recent change-audit log (ChangesPanel). When an operator
 *      saves or deletes a flag, both feeds re-render via shared
 *      query invalidation in the mutation hooks.
 *
 * Both Edit/Create and Delete are sudo-gated by the server's RequireSudo
 * middleware — the shared `request()` client transparently re-opens the
 * mounted ReauthDialog on 401 + SUDO_REQUIRED and replays the request
 * once the operator authenticates again.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Flag, Plus } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, Input, Modal } from '@/components/ui';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary } from '@/components/feedback';
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

import {
  ChangesPanel,
  FlagEditDrawer,
  FlagsTable,
} from '../components/feature-flags';

export default function FeatureFlagsPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.flags.pageTitle', 'Feature Flags'));

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureFlagEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeatureFlagEntry | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const flags = useFlags();
  const changes = useFlagChanges(null, 50);
  const setFlag = useSetFlag();
  const deleteFlag = useDeleteFlag();

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
    <PageContainer
      title={t('admin.flags.pageTitle', 'Feature Flags')}
      subtitle={t(
        'admin.flags.subtitle',
        'Typed feature-flag registry — all changes are sudo-gated and logged.',
      )}
      actions={
        <Button
          variant="primary"
          icon={<Plus className="h-4 w-4" />}
          onClick={handleCreate}
        >
          {t('admin.flags.actions.add', 'Add flag')}
        </Button>
      }
      query={flags}
    >
      <FadeIn>
        <div className="space-y-6">
          <SectionErrorBoundary name="flags-table">
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Flag className="h-5 w-5 text-[var(--text-muted)]" />
                <PanelTitle>
                  {t('admin.flags.panels.registry', 'Registry')}
                </PanelTitle>
              </div>
              <FlagsTable
                rows={flags.data?.flags ?? []}
                loading={flags.isLoading}
                onEdit={handleEdit}
                onAskDelete={handleAskDelete}
              />
            </GlassPanel>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="flags-changes">
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <History className="h-5 w-5 text-[var(--text-muted)]" />
                <PanelTitle>
                  {t('admin.flags.panels.changes', 'Recent changes')}
                </PanelTitle>
              </div>
              <ChangesPanel
                rows={changes.data?.rows ?? []}
                loading={changes.isLoading}
              />
            </GlassPanel>
          </SectionErrorBoundary>
        </div>
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
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPendingDelete(null);
                setDeleteReason('');
              }}
              disabled={deleteFlag.isPending}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deleteFlag.isPending}
              disabled={deleteReason.trim().length === 0 || deleteFlag.isPending}
              onClick={handleConfirmDelete}
            >
              {t('admin.flags.delete.confirm', 'Delete flag')}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
