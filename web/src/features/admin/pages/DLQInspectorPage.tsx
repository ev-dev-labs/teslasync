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
 * The page is a full-width bento: a responsive KPI band, a hero row
 * pairing the dead-letter entries table with a failure-reason breakdown,
 * and a full-width global replay-audit log beneath so a freshly arrived
 * operator can see recent replay activity at a glance.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, BarChart3, History } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, ConfirmDialog, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AlertBanner, QueryError, SectionErrorBoundary } from '@/components/feedback';
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
  ReasonBreakdown,
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
      setReplayDisabledBanner(result.result === 'disabled');
      // Close the drawer on a successful publish so the audit row that
      // just landed in the global panel is the first thing the operator
      // sees.
      if (result.result === 'ok') {
        setSelected(null);
      }
    } catch (err) {
      // Hard-disabled at env level surfaces as a 403 — show the page
      // banner so the operator has more room than a toast affords.
      // Every other error (404 not_found / 409 unparseable / 502
      // publish_failed / 5xx) is surfaced by the mutation's built-in
      // toast (`useMutationToast`).
      const status = (err as { status?: number }).status;
      if (status === 403) {
        setReplayDisabledBanner(true);
      }
    } finally {
      // Always dismiss the confirm dialog once the replay settles. Without
      // this, a non-403 failure left the dialog open but out of its loading
      // state — a dead-end the operator could only escape by cancelling.
      // The toast (or the 403 banner) now carries the outcome instead.
      setPendingReplay(null);
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

        {/* 1 — KPI band: full-width responsive metric grid (2 → 3 → 6 cols) */}
        <FadeIn>
          <SectionErrorBoundary name="dlq-status">
            <StatusHeader
              data={list.data}
              loading={list.isLoading}
              error={list.isError ? list.error : undefined}
            />
          </SectionErrorBoundary>
        </FadeIn>

        {/* 2 — Hero bento: entries table (spans 2 cols) + reason breakdown */}
        <FadeIn delay={0.1}>
          <SectionErrorBoundary name="dlq-entries">
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
              <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
                <PanelTitle className="mb-3 flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('admin.dlq.panels.entries', 'Dead-letter entries')}
                </PanelTitle>
                {list.isError ? (
                  <QueryError error={list.error} onRetry={() => list.refetch()} />
                ) : (
                  <EntriesTable
                    rows={list.data?.entries ?? []}
                    loading={list.isLoading}
                    onInspect={handleInspect}
                  />
                )}
              </GlassPanel>

              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('admin.dlq.panels.reasons', 'Failure reasons')}
                </PanelTitle>
                <ReasonBreakdown
                  rows={list.data?.entries ?? []}
                  loading={list.isLoading}
                  error={list.isError ? list.error : null}
                  onRetry={() => list.refetch()}
                />
              </GlassPanel>
            </section>
          </SectionErrorBoundary>
        </FadeIn>

        {/* 3 — Detail band: full-width global replay-audit log */}
        <FadeIn delay={0.2}>
          <SectionErrorBoundary name="dlq-audit">
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('admin.dlq.panels.audit', 'Recent replay activity')}
              </PanelTitle>
              {audit.isError ? (
                <QueryError error={audit.error} onRetry={() => audit.refetch()} />
              ) : (
                <AuditPanel rows={audit.data?.rows ?? []} loading={audit.isLoading} />
              )}
            </GlassPanel>
          </SectionErrorBoundary>
        </FadeIn>
      </div>

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
