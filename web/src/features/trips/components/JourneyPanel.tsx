import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useCreateJourney,
  useJourney,
  useJourneys,
  useTransitionJourney,
  type JourneySession,
  type JourneyStatus,
  type JourneyTransition,
} from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Button, DataTable, GlassPanel, Input, PanelTitle, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { EmptyState, ListSkeleton, QueryError } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';

const STATUS_FILTERS = ['', 'planned', 'active', 'paused', 'completed', 'aborted'] as const;

function statusVariant(status: JourneyStatus) {
  switch (status) {
    case 'active':
      return 'success' as const;
    case 'paused':
      return 'warning' as const;
    case 'completed':
      return 'info' as const;
    case 'aborted':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

function transitionAction(next: JourneyStatus, current: JourneyStatus): JourneyTransition {
  if (next === 'active') return current === 'paused' ? 'resume' : 'start';
  if (next === 'paused') return 'pause';
  if (next === 'completed') return 'complete';
  return 'abort';
}

const TRANSITION_LABEL_KEYS = {
  start: 'journey.transition.start',
  pause: 'journey.transition.pause',
  resume: 'journey.transition.resume',
  complete: 'journey.transition.complete',
  abort: 'journey.transition.abort',
} as const;

const TRANSITION_DEFAULTS = {
  start: 'Start',
  pause: 'Pause',
  resume: 'Resume',
  complete: 'Complete',
  abort: 'Abort',
} as const;

function transitionIcon(action: JourneyTransition) {
  switch (action) {
    case 'start':
    case 'resume':
      return <Icons.play className="h-4 w-4" aria-hidden="true" />;
    case 'pause':
      return <Icons.pause className="h-4 w-4" aria-hidden="true" />;
    case 'complete':
      return <Icons.success className="h-4 w-4" aria-hidden="true" />;
    default:
      return <Icons.delete className="h-4 w-4" aria-hidden="true" />;
  }
}

/**
 * Journey Autopilot session manager: plan trips, then walk them through
 * the planned → active → paused → completed/aborted lifecycle. The
 * action set always comes from the server's `next_statuses` — the panel
 * never re-implements the state machine.
 */
export function JourneyPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', origin_name: '', dest_name: '' });

  const listQuery = useJourneys(vehicleId, statusFilter);
  const listState = useDataState(listQuery);
  const sessions = listQuery.data ?? [];

  const detailQuery = useJourney(selectedId);
  const detailState = useDataState(detailQuery);
  const detail = detailQuery.data ?? null;

  const create = useCreateJourney();
  const transition = useTransitionJourney();

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null || !draft.name.trim()) return;
    create.mutate(
      {
        vehicle_id: vehicleId,
        name: draft.name.trim(),
        origin_name: draft.origin_name.trim() || undefined,
        dest_name: draft.dest_name.trim() || undefined,
      },
      {
        onSuccess: (session) => {
          setFormOpen(false);
          setDraft({ name: '', origin_name: '', dest_name: '' });
          setSelectedId(session.id);
        },
      },
    );
  };

  const columns: Column<JourneySession>[] = [
    {
      key: 'journey',
      header: t('journey.col.journey', 'Journey'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.name}
          </Text>
          <Text as="p" variant="caption">
            {row.origin_name && row.dest_name
              ? `${row.origin_name} → ${row.dest_name}`
              : t('journey.noRoute', 'Route not set yet')}
          </Text>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('journey.col.status', 'Status'),
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'plan',
      header: t('journey.col.plan', 'Plan'),
      render: (row) => (
        <span className="tabular-nums">
          {t('journey.planVersion', 'v{{version}}', { version: row.plan_version })}
        </span>
      ),
    },
    {
      key: 'updated',
      header: t('journey.col.updated', 'Updated'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.updated_at)}
        </Text>
      ),
    },
    {
      key: 'open',
      header: t('journey.col.actions', 'Actions'),
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(row.id)}>
          {t('journey.open', 'Open')}
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <PanelTitle>{t('journey.list.title', 'Planned journeys')}</PanelTitle>
            <Text as="p" size="sm" color="secondary">
              {t(
                'journey.list.subtitle',
                'One session per trip, from planning through the live drive to the debrief.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('journey.filter.status', 'Filter by status')}
              value={statusFilter}
              options={STATUS_FILTERS.map((s) => ({
                value: s,
                label: s === '' ? t('journey.filter.all', 'All') : s,
              }))}
              onChange={(event) => setStatusFilter(event.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Icons.add className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen
                ? t('journey.action.cancel', 'Cancel')
                : t('journey.action.plan', 'Plan journey')}
            </Button>
          </div>
        </div>

        {formOpen ? (
          <form className="mb-4 grid gap-3" onSubmit={submitCreate}>
            <Input
              label={t('journey.form.name', 'Journey name')}
              value={draft.name}
              required
              maxLength={200}
              placeholder={t('journey.form.namePlaceholder', 'Tahoe ski trip')}
              onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('journey.form.origin', 'Origin')}
                value={draft.origin_name}
                maxLength={300}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, origin_name: event.target.value }))
                }
              />
              <Input
                label={t('journey.form.destination', 'Destination')}
                value={draft.dest_name}
                maxLength={300}
                onChange={(event) => setDraft((d) => ({ ...d, dest_name: event.target.value }))}
              />
            </div>
            <div>
              <Button type="submit" loading={create.isPending} disabled={vehicleId == null}>
                {t('journey.form.submit', 'Create journey')}
              </Button>
            </div>
          </form>
        ) : null}

        {listQuery.isLoading ? (
          <ListSkeleton label={t('journey.list.loading', 'Loading journeys…')} />
        ) : listState.fatalError ? (
          <QueryError error={listState.fatalError} onRetry={() => listState.retry?.()} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Icons.trip className="h-10 w-10" aria-hidden="true" />}
            message={t(
              'journey.list.empty',
              'No journeys yet. Plan one above and it will live here from planning to debrief.',
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            data={sessions}
            keyExtractor={(row) => row.id}
            tableId="journey-sessions"
          />
        )}
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Icons.flag className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {detail ? detail.session.name : t('journey.detail.title', 'Journey detail')}
        </PanelTitle>
        {detailQuery.isLoading || detail == null ? (
          detailQuery.isLoading ? (
            <ListSkeleton label={t('journey.detail.loading', 'Loading journey…')} />
          ) : (
            <EmptyState
              icon={<Icons.mapPinned className="h-10 w-10" aria-hidden="true" />}
              message={t('journey.detail.empty', 'Select a journey to manage its lifecycle and plans.')}
            />
          )
        ) : detailState.fatalError ? (
          <QueryError error={detailState.fatalError} onRetry={() => detailState.retry?.()} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(detail.session.status)}>{detail.session.status}</Badge>
              {detail.next_statuses.map((next) => {
                const action = transitionAction(next, detail.session.status);
                return (
                  <Button
                    key={next}
                    variant={action === 'abort' ? 'danger' : 'secondary'}
                    size="sm"
                    icon={transitionIcon(action)}
                    loading={transition.isPending}
                    onClick={() => transition.mutate({ id: detail.session.id, action })}
                  >
                    {t(TRANSITION_LABEL_KEYS[action], TRANSITION_DEFAULTS[action])}
                  </Button>
                );
              })}
            </div>
            <div>
              <Text as="p" variant="label" className="mb-2 flex items-center gap-2">
                <Icons.package className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                {t('journey.plans.title', 'Plan versions')}
              </Text>
              {detail.plans.length === 0 ? (
                <Text as="p" size="sm" color="secondary">
                  {t('journey.plans.empty', 'No plans saved yet — the stop optimizer lands here.')}
                </Text>
              ) : (
                <ul className="space-y-2">
                  {detail.plans.map((plan) => (
                    <li
                      key={plan.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                    >
                      <Text as="span" size="sm">
                        {t('journey.planVersion', 'v{{version}}', { version: plan.version })}
                        {plan.note ? ` · ${plan.note}` : ''}
                      </Text>
                      <Text as="span" variant="caption">
                        {formatDateTime(plan.created_at)}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
