/**
 * Drive Detail — "Why did this drive end?" diagnostic panel.
 *
 * Joins the FSM transition history with the raw signal window around
 * `end_ts` (or `now()` while live), so an operator can correlate
 * state changes with what the vehicle was reporting at the moment.
 *
 * Evidence is visible on arrival; independently collapsing this disclosure
 * pauses its query without hiding any other section of the report.
 *
 * Server validates `window` ∈ {30s, 60s, 5m, 15m} and rejects anything
 * else with 400.
 */
import { useCallback, useId, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, GitBranch, Radio } from 'lucide-react';

import {
  Button,
  DataTable,
  GlassPanel,
  Select,
  type Column,
  type SelectOption,
  PanelTitle,
} from '@/components/ui';
import { Timeline, TimeStamp } from '@/components/data-display';
import { EmptyState, ListSkeleton, StaleRefreshWarning, TableSkeleton } from '@/components/feedback';
import { useDriveWhyEnded } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDateTime, type FormatOptions } from '@/lib/dateFormat';
import type {
  DriveDiagnosticSignal,
  DriveDiagnosticTransition,
  DriveDiagnosticWindow,
} from '@/types/admin-diagnostics';

interface WhyEndedPanelProps {
  driveId: string | number;
}

const WINDOWS: DriveDiagnosticWindow[] = ['30s', '60s', '5m', '15m'];

// Keyed signal rows for DataTable — `ts+field` is not guaranteed unique
// (the same field can re-emit at the same second on busy vehicles) so we
// splice the array index in to keep React reconciliation stable.
type KeyedSignal = DriveDiagnosticSignal & { __idx: number };

/**
 * Formats an FSM-transition timestamp for the timeline's time slot.
 *
 * The shared formatter guards missing and unparseable diagnostic timestamps.
 */
export function formatTransitionTime(ts: string | null | undefined, opts?: FormatOptions): string {
  return formatDateTime(ts, opts);
}

export function WhyEndedPanel({ driveId }: WhyEndedPanelProps) {
  const { t } = useTranslation();
  const { opts } = useDateFormat();
  const [expanded, setExpanded] = useState(true);
  const [windowSel, setWindowSel] = useState<DriveDiagnosticWindow>('60s');
  // Ties the disclosure toggle to the region it expands so assistive tech
  // announces the relationship (aria-controls ⇄ id).
  const regionId = useId();

  const why = useDriveWhyEnded(driveId, windowSel, expanded);
  const state = useDataState(why, { provenance: 'historical' });

  const toggle = useCallback(() => setExpanded((p) => !p), []);
  const handleWindowChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) =>
      setWindowSel(e.target.value as DriveDiagnosticWindow),
    [],
  );

  const windowOptions: SelectOption[] = useMemo(
    () =>
      WINDOWS.map((w) => ({
        value: w,
        label: t(`driveDetail.whyEnded.windowOption.${w}`, w),
      })),
    [t],
  );

  const signalColumns: Column<KeyedSignal>[] = useMemo(
    () => [
      {
        key: 'ts',
        filterValue: (row) => row.ts,
        header: t('driveDetail.whyEnded.signal.cols.ts', 'Timestamp'),
        visibleOnMobile: true,
        render: (row) => <time dateTime={row.ts}><TimeStamp value={row.ts} format="absolute" /></time>,
      },
      {
        key: 'field',
        filterValue: (row) => row.field,
        header: t('driveDetail.whyEnded.signal.cols.field', 'Field'),
        visibleOnMobile: true,
        render: (row) => <span className="font-mono text-xs">{row.field}</span>,
      },
      {
        key: 'value',
        filterValue: (row) => row.value,
        header: t('driveDetail.whyEnded.signal.cols.value', 'Value'),
        visibleOnMobile: true,
        render: (row) => (
          <span className="font-mono text-xs text-[var(--text-muted)]">
            {row.value}
          </span>
        ),
      },
    ],
    [t],
  );

  const transitions: DriveDiagnosticTransition[] = why.data?.fsm_transitions ?? [];
  const signals: DriveDiagnosticSignal[] = why.data?.signal_window ?? [];
  const keyedSignals: KeyedSignal[] = useMemo(
    () => signals.map((s, idx) => ({ ...s, __idx: idx })),
    [signals],
  );

  const timelineItems = useMemo(
    () =>
      transitions.map((tx) => ({
        title: (
          <span className="font-mono text-sm">
            {tx.fsm_name}: {tx.from_state} → {tx.to_state}
          </span>
        ),
        subtitle: (
          <span className="text-xs text-[var(--text-muted)]">
            {t('driveDetail.whyEnded.trigger', 'trigger: {{trigger}}', {
              trigger: tx.trigger || '—',
            })}
          </span>
        ),
        time: formatTransitionTime(tx.ts, opts),
        color: 'var(--theme-primary)',
      })),
    [transitions, t, opts],
  );

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-6 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_a]:min-h-11 max-md:[&_a]:min-w-11 max-md:[&_input]:min-h-11 max-md:[&_select]:min-h-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          wrapLabel
          icon={
            expanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )
          }
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={regionId}
        >
          <PanelTitle>
            {t('driveDetail.whyEnded.title', 'Why did this drive end?')}
          </PanelTitle>
        </Button>

        {expanded && (
          <div className="w-full md:w-40">
            <Select
              value={windowSel}
              onChange={handleWindowChange}
              options={windowOptions}
              aria-label={t(
                'driveDetail.whyEnded.windowAria',
                'Diagnostic window',
              )}
            />
          </div>
        )}
      </div>

      {expanded && (
        <div id={regionId} className="mt-4 space-y-6">
          <StaleRefreshWarning
            state={state}
            label={t('driveDetail.whyEnded.title', 'Why did this drive end?')}
          />
          {state.status === 'initial' && why.fetchStatus === 'fetching' ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <ListSkeleton
                rows={3}
                label={t('driveDetail.whyEnded.loading', 'Loading drive diagnostic…')}
                testId="why-ended-timeline-loading"
              />
              <TableSkeleton rows={4} cols={3} />
            </div>
          ) : state.fatalError ? (
            <EmptyState
              title={t(
                'driveDetail.whyEnded.error.title',
                'Could not load diagnostic',
              )}
              message={
                why.error instanceof Error
                  ? why.error.message
                  : t(
                      'driveDetail.whyEnded.error.message',
                      'Try a different window or reload the page.',
                    )
              }
              action={{
                label: t('common.retry', 'Retry'),
                onClick: () => why.refetch(),
              }}
            />
          ) : !state.hasData ? (
            <EmptyState
              title={state.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused') : undefined}
              message={t('driving.brief.pending', 'Drive evidence is not available yet.')}
              action={{
                label: t('common.retry', 'Retry'),
                onClick: () => why.refetch(),
              }}
            />
          ) : (
            <>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <PanelTitle>
                    {t(
                      'driveDetail.whyEnded.fsmTitle',
                      'FSM transitions',
                    )}
                  </PanelTitle>
                </div>
                {transitions.length === 0 ? (
                  <EmptyState
                    title={t(
                      'driveDetail.whyEnded.fsmEmpty.title',
                      'No transitions in window',
                    )}
                    message={t(
                      'driveDetail.whyEnded.fsmEmpty.message',
                      'No FSM state changes recorded near the drive end. Try a wider window.',
                    )}
                    // no-action: window selector above is the CTA.
                  />
                ) : (
                  <Timeline items={timelineItems} />
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <PanelTitle>
                    {t(
                      'driveDetail.whyEnded.signalTitle',
                      'Signal window',
                    )}
                  </PanelTitle>
                </div>
                <DataTable<KeyedSignal>
                  variant="embedded"
                  tableId="drive:why-ended-signals"
                  name="why-ended-signals"
                  columns={signalColumns}
                  enableValueFilters
                  data={keyedSignals}
                  keyExtractor={(row) => `${row.ts}-${row.field}-${row.__idx}`}
                  emptyMessage={t(
                    'driveDetail.whyEnded.signalEmpty',
                    'No signals in this window for the default whitelist.',
                  )}
                  pagination={{
                    defaultPageSize: 25,
                    pageSizeOptions: [25, 50, 100],
                  }}
                  mobileColumns={['ts', 'field', 'value']}
                />
              </div>
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
