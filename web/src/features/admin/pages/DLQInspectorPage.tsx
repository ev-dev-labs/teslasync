/**
 * DLQ Inspector Page — operator surface for the Phase-tracing
 * `/system/dlq*` routes.
 *
 * Reads the list of dead-lettered payloads, lets an operator open any
 * entry to view its raw + inner payload, and replay it back to the
 * original source topic. The replay action is sudo-gated (handled
 * transparently by the shared `request()` client) and gated again at
 * the server boundary by the `DLQ_REPLAY_ENABLED` env flag — when
 * disabled the page surfaces a persistent warning banner instead of
 * showing a useless "Replay" button.
 *
 * The audit log is dual-rendered: scoped to the open entry inside its
 * drawer, AND globally on the bottom panel of the page so a freshly
 * arrived operator can see the recent replay activity at a glance.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, History } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, ConfirmDialog } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useDLQAudit,
  useDLQEntry,
  useDLQList,
  useDLQReplay,
} from '@/api/hooks/useDLQ';
import type { DLQEntrySummary } from '@/types/admin-diagnostics';

import {
  AuditPanel,
  EntriesTable,
  EntryDrawer,
  StatusHeader,
} from '../components/dlq-inspector';

export default function DLQInspectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.dlq.pageTitle', 'DLQ Inspector'));

  // Selected DLQ summary row drives both the drawer and the scoped
  // audit fetch. Keeping it in page state (rather than a route param)
  // lets the drawer stack on top of the table without a navigation
  // round-trip.
  const [selected, setSelected] = useState<DLQEntrySummary | null>(null);
  const [pendingReplay, setPendingReplay] = useState<DLQEntrySummary | null>(null);
  const [replayDisabledBanner, setReplayDisabledBanner] = useState(false);

  const list = useDLQList();
  const entry = useDLQEntry(selected?.id, !!selected);
  const audit = useDLQAudit(null, 50);
  const replay = useDLQReplay();

  const handleInspect = (row: DLQEntrySummary) => {
    setSelected(row);
  };

  const handleAskReplay = () => {
    if (selected) setPendingReplay(selected);
  };

  const handleConfirmReplay = async () => {
    if (!pendingReplay) return;
    try {
      const result = await replay.mutateAsync({ id: pendingReplay.id });
      // Server may return 200 OK with result="disabled" via a future
      // soft-flag — keep the banner branch in case that arrives.
      if (result.result === 'disabled') {
        setReplayDisabledBanner(true);
      } else {
        setReplayDisabledBanner(false);
      }
      setPendingReplay(null);
      // Close the drawer on a successful publish so the audit row that
      // just landed in the global panel is the first thing the operator
      // sees.
      if (result.result === 'ok') {
        setSelected(null);
      }
    } catch (err) {
      // Hard-disabled at env level surfaces as a 403 — show the page
      // banner so the operator has more room than a toast affords.
      const status = (err as { status?: number }).status;
      if (status === 403) {
        setReplayDisabledBanner(true);
        setPendingReplay(null);
      }
      // Every other error is already handled by the mutation's
      // built-in toast (`useMutationToast`).
    }
  };

  return (
    <PageContainer
      title={t('admin.dlq.pageTitle', 'DLQ Inspector')}
      subtitle={t(
        'admin.dlq.subtitle',
        'Dead-letter queue — inspect failed ingests and replay them back to their source topic.',
      )}
      query={list}
    >
      <FadeIn>
        <div className="space-y-6">
          {replayDisabledBanner && (
            <AlertBanner
              variant="warning"
              title={t('admin.dlq.banners.replayBlockedTitle', 'Replay blocked')}
              onClose={() => setReplayDisabledBanner(false)}
            >
              {t(
                'admin.dlq.banners.replayBlockedMessage',
                'The server rejected the replay because DLQ_REPLAY_ENABLED is not set. Restart the worker with this env var to enable replays.',
              )}
            </AlertBanner>
          )}

          <SectionErrorBoundary name="dlq-status">
            <StatusHeader data={list.data} loading={list.isLoading} />
          </SectionErrorBoundary>

          <SectionErrorBoundary name="dlq-entries">
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-[var(--text-muted)]" />
                <PanelTitle>
                  {t('admin.dlq.panels.entries', 'Dead-letter entries')}
                </PanelTitle>
              </div>
              <EntriesTable
                rows={list.data?.entries ?? []}
                loading={list.isLoading}
                onInspect={handleInspect}
              />
            </GlassPanel>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="dlq-audit">
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <History className="h-5 w-5 text-[var(--text-muted)]" />
                <PanelTitle>
                  {t('admin.dlq.panels.audit', 'Recent replay activity')}
                </PanelTitle>
              </div>
              <AuditPanel
                rows={audit.data?.rows ?? []}
                loading={audit.isLoading}
              />
            </GlassPanel>
          </SectionErrorBoundary>
        </div>
      </FadeIn>

      <EntryDrawer
        open={selected !== null}
        summary={selected}
        full={entry.data}
        loading={entry.isLoading}
        replayEnabled={list.data?.replay_enabled ?? false}
        replayInFlight={replay.isPending}
        onClose={() => setSelected(null)}
        onReplay={handleAskReplay}
      />

      <ConfirmDialog
        open={pendingReplay !== null}
        title={t('admin.dlq.confirm.title', 'Replay DLQ entry?')}
        message={t(
          'admin.dlq.confirm.message',
          'This will republish entry #{{id}} to its source topic. The action is logged and rate-limited.',
          { id: pendingReplay?.id ?? 0 },
        )}
        confirmLabel={t('admin.dlq.confirm.confirm', 'Replay')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="warning"
        loading={replay.isPending}
        onConfirm={handleConfirmReplay}
        onCancel={() => setPendingReplay(null)}
      />
    </PageContainer>
  );
}
