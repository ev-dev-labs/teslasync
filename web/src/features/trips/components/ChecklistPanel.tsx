import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useChecklist,
  useRefreshChecklist,
  type ChecklistStatus,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, Text } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { LayoutCard, SourceContent } from '@/components/layout';
import { EmptyState, ErrorDisplay, ListSkeleton } from '@/components/feedback';
import { isApiError } from '@/lib/resilience';
import { formatDateTime } from '@/lib/dateFormat';
import { safeArray } from '@/lib/safeArray';

const ITEM_LABEL_KEYS = {
  charge_level: 'journey.checklist.item.charge_level',
  charge_limit: 'journey.checklist.item.charge_limit',
  tire_pressure: 'journey.checklist.item.tire_pressure',
  storm: 'journey.checklist.item.storm',
  software_update: 'journey.checklist.item.software_update',
} as const;

const ITEM_DEFAULTS = {
  charge_level: 'Charge level',
  charge_limit: 'Charge limit',
  tire_pressure: 'Tire pressure',
  storm: 'Storm',
  software_update: 'Software update',
} as const;

const STATUS_LABEL_KEYS = {
  ok: 'journey.checklist.status.ok',
  attention: 'journey.checklist.status.attention',
  action: 'journey.checklist.status.action',
  unknown: 'journey.checklist.status.unknown',
} as const;

const STATUS_DEFAULTS = {
  ok: 'Ready',
  attention: 'Check',
  action: 'Fix now',
  unknown: 'Unknown',
} as const;

function statusVariant(status: ChecklistStatus) {
  switch (status) {
    case 'ok':
      return 'success' as const;
    case 'attention':
      return 'warning' as const;
    case 'action':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Ready-to-roll checklist: live readiness verdicts (charge, tires,
 * storm, update) with a persisted run history. A 404 from the latest
 * endpoint means the checklist never ran — an empty state with a run
 * button, not an error.
 */
export function ChecklistPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();

  const runQuery = useChecklist(session.id);
  const runState = useDataState(runQuery);
  const run = runQuery.data ?? null;
  const items = safeArray(run?.items);

  const refresh = useRefreshChecklist();

  const neverRan =
    runState.fatalError != null &&
    isApiError(runState.fatalError) &&
    runState.fatalError.status === 404;
  const emptyChecklist = (
    <EmptyState
      icon={<Icons.checklist className="h-10 w-10" aria-hidden="true" />}
      message={t('journey.checklist.empty', 'No checks yet. Run the checklist to snapshot charge, tires, storm, and update state.')}
      action={{
        label: t('journey.checklist.run', 'Run checklist'),
        onClick: () => refresh.mutate(session.id),
      }}
    />
  );

  return (
    <LayoutCard
      title={t('journey.checklist.title', 'Ready to roll')}
      actions={
        run != null ? (
          <Button
            wrapLabel
            variant="secondary"
            size="sm"
            loading={refresh.isPending}
            onClick={() => refresh.mutate(session.id)}
          >
            {t('journey.checklist.refresh', 'Re-check')}
          </Button>
        ) : null
      }
    >
      {refresh.error ? (
        <ErrorDisplay compact error={refresh.error} message={t('journey.checklist.refreshFailed', 'Readiness could not be checked. Try the checklist again.')} />
      ) : null}
      <SourceContent
        state={(runQuery.isLoading || refresh.isPending) && run == null ? 'loading'
          : neverRan ? 'empty' : runState.fatalError ? 'error'
          : runState.status === 'stale' ? 'retained' : run == null ? 'empty' : 'ready'}
        label={t('journey.checklist.title', 'Ready to roll')}
        emptyMessage={t('journey.checklist.empty', 'No checks yet. Run the checklist to snapshot charge, tires, storm, and update state.')}
        errorMessage={t('journey.checklist.loadFailed', 'The readiness checklist could not be loaded.')}
        error={runState.fatalError}
        errorRecovery={{ onRetry: runState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.checklist.loading', 'Checking readiness…')} />}
        emptyContent={emptyChecklist}
      >
      {run != null ? (
        <div className="space-y-2">
          <Text as="p" variant="caption">
            {t('journey.checklist.runAt', 'Checked {{time}}', {
              time: formatDateTime(run.run_at),
            })}
          </Text>
          <KVList
            layout="responsive"
            items={items.map((item) => ({
              id: item.key,
              label: (
                <div className="min-w-0 space-y-1">
                  <Text as="p" variant="label">
                    {t(
                      ITEM_LABEL_KEYS[item.key as keyof typeof ITEM_LABEL_KEYS],
                      ITEM_DEFAULTS[item.key as keyof typeof ITEM_DEFAULTS],
                    )}
                  </Text>
                  <Text as="p" variant="caption">
                    {item.detail}
                  </Text>
                </div>
              ),
              value: (
                <Badge variant={statusVariant(item.status)}>
                  {t(STATUS_LABEL_KEYS[item.status], STATUS_DEFAULTS[item.status])}
                </Badge>
              ),
            }))}
          />
        </div>
      ) : emptyChecklist}
      </SourceContent>
    </LayoutCard>
  );
}
