import { useTranslation } from 'react-i18next';
import { useAutomationExecutionDetail } from '@/api/hooks/useAutomations';
import { DateTime } from '@/components/data-display';
import { QueryError, Skeleton } from '@/components/feedback';
import { Modal, PanelTitle, Text } from '@/components/ui';
import { formatDurationMs } from '@/lib/dateFormat';

export function AutomationExecutionDetail({ id, onClose }: {
  id: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useAutomationExecutionDetail(id);
  const detail = query.data;
  return (
    <Modal
      open={id != null}
      onClose={onClose}
      size="lg"
      title={t('automations.historyPage.detail', 'Execution details')}
    >
      {query.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => { void query.refetch(); }} />
      ) : detail ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Text variant="caption">{t('automations.historyPage.rule', 'Automation')}</Text>
              <Text>{detail.automation_name}</Text>
            </div>
            <div>
              <Text variant="caption">{t('automations.historyPage.outcome', 'Outcome')}</Text>
              <Text>{t(`automations.historyPage.status.${detail.status}`, detail.status)}</Text>
            </div>
            <div>
              <Text variant="caption">{t('automations.historyPage.time', 'Triggered')}</Text>
              <DateTime value={detail.triggered_at} in="user" />
            </div>
            <div>
              <Text variant="caption">{t('automations.historyPage.durationColumn', 'Duration')}</Text>
              <Text>{detail.duration_ms != null ? formatDurationMs(detail.duration_ms) : '—'}</Text>
            </div>
            <div>
              <Text variant="caption">{t('automations.historyPage.trigger', 'Trigger')}</Text>
              <Text>{detail.trigger_type || '—'}</Text>
            </div>
            <div>
              <Text variant="caption">{t('automations.historyPage.actions', 'Actions')}</Text>
              <Text>{detail.actions_succeeded}/{detail.actions_total}</Text>
            </div>
          </div>
          {detail.error && <Text variant="bodySm" className="text-rose-300">{detail.error}</Text>}
          {detail.actions_executed && detail.actions_executed.length > 0 && (
            <section>
              <PanelTitle>{t('automations.historyPage.actionResults', 'Action results')}</PanelTitle>
              <ul className="mt-2 space-y-2">
                {detail.actions_executed.map((action, index) => (
                  <li key={index} className="overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3">
                    <Text variant="bodySm" className="whitespace-pre-wrap break-words">
                      {JSON.stringify(action, null, 2)}
                    </Text>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detail.fsm_transitions && detail.fsm_transitions.length > 0 && (
            <section>
              <PanelTitle>{t('automations.historyPage.transitions', 'Vehicle state transitions')}</PanelTitle>
              <ul className="mt-2 space-y-2">
                {detail.fsm_transitions.map((transition) => (
                  <li key={transition.id} className="rounded-lg bg-[var(--surface-2)] p-3">
                    <DateTime value={transition.ts} in="user" />
                    <Text variant="bodySm">{transition.fsm_name}: {transition.from_state} → {transition.to_state}</Text>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
