import { useTranslation } from 'react-i18next';
import { useAutomationExecutionDetail } from '@/api/hooks/useAutomations';
import { DateTime } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Modal, PanelTitle, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { AutomationExecutionDetail as ExecutionDetail } from '@/api/types';

interface SectionAvailability {
  status: 'available' | 'unavailable' | 'failed' | 'not_applicable';
  truncated: boolean;
  complete: boolean;
  total: number;
}

type DetailWithAvailability = ExecutionDetail & {
  action_results_availability?: SectionAvailability;
  fsm_transitions_availability?: SectionAvailability;
};

export function AutomationExecutionDetail({ id, onClose }: {
  id: number | null;
  onClose: () => void;
}) {
  const { formatDurationMs } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useAutomationExecutionDetail(id);
  const detail: DetailWithAvailability | null | undefined = query.data;
  const actions = detail?.actions_executed ?? [];
  const transitions = detail?.fsm_transitions ?? [];
  const availabilityMessage = (meta: SectionAvailability | undefined) => {
    if (meta?.status === 'failed') return t('automations.historyPage.availability.failed', 'This history section could not be loaded.');
    if (meta?.status === 'not_applicable') return t('automations.historyPage.availability.notApplicable', 'No vehicle is associated with this execution.');
    if (meta?.status !== 'available') return t('automations.historyPage.availability.unavailable', 'History availability is unknown.');
    if (meta.truncated) return t('automations.historyPage.availability.truncated', 'Only part of this history is shown.');
    if (!meta.complete) return t('automations.historyPage.availability.incomplete', 'This execution window is still open; history may be incomplete.');
    return null;
  };
  const source = useDataState({ ...query, data: detail ?? undefined });
  return (
    <Modal
      open={id != null}
      onClose={onClose}
      size="lg"
      title={t('automations.historyPage.detail', 'Execution details')}
    >
      <StaleRefreshWarning state={source} label={t('automations.historyPage.detail', 'Execution details')} />
      {query.isLoading && !source.hasData ? (
        <Skeleton className="h-48 w-full" />
      ) : source.fatalError ? (
        <QueryError error={source.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : detail ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Text variant="caption">{t('automations.historyPage.rule', 'Automation')}</Text>
              <Text className="break-words">{detail.automation_name}</Text>
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
          {detail.error && <Text variant="bodySm" className="break-words">{detail.error}</Text>}
            <section className="rounded-lg border border-[var(--border-subtle)] p-3">
              <PanelTitle>{t('automations.historyPage.actionResults', 'Action results')}</PanelTitle>
              {availabilityMessage(detail.action_results_availability) && <Text variant="bodySm">{availabilityMessage(detail.action_results_availability)}</Text>}
              {actions.length === 0 && detail.action_results_availability?.status === 'available' && detail.action_results_availability.complete && !detail.action_results_availability.truncated && <Text variant="bodySm">{t('automations.historyPage.availability.noActionResults', 'No action results are recorded for this execution.')}</Text>}
              <ul className="mt-2 space-y-2">
                {actions.map((action, index) => (
                  <li key={index} className="overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3">
                    <Text variant="bodySm" className="whitespace-pre-wrap break-words">
                      {JSON.stringify(action, null, 2)}
                    </Text>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-[var(--border-subtle)] p-3">
              <PanelTitle>{t('automations.historyPage.transitions', 'Vehicle state transitions')}</PanelTitle>
              {availabilityMessage(detail.fsm_transitions_availability) && <Text variant="bodySm">{availabilityMessage(detail.fsm_transitions_availability)}</Text>}
              {transitions.length === 0 && detail.fsm_transitions_availability?.status === 'available' && detail.fsm_transitions_availability.complete && !detail.fsm_transitions_availability.truncated && (
                <Text variant="bodySm">{t('automations.historyPage.availability.noTransitions', 'No vehicle state transitions were recorded during this execution window.')}</Text>
              )}
              <ul className="mt-2 space-y-2">
                {transitions.map((transition) => (
                  <li key={transition.id} className="rounded-lg bg-[var(--surface-2)] p-3">
                    <DateTime value={transition.ts} in="user" />
                    <Text variant="bodySm" className="break-words">{transition.fsm_name}: {transition.from_state} → {transition.to_state}</Text>
                  </li>
                ))}
              </ul>
            </section>
        </div>
      ) : id != null ? (
        <EmptyState
          message={t('automations.historyPage.detailUnavailable', 'Execution details are unavailable.')}
          action={{ label: t('common.retry', 'Retry'), onClick: () => { void query.refetch(); } }}
        />
      ) : null}
    </Modal>
  );
}
