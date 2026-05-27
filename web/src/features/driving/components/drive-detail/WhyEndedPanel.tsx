/**
 * Drive Detail — "Why did this drive end?" diagnostic panel.
 *
 * Joins the FSM transition history with the raw signal window around
 * `end_ts` (or `now()` while live), so an operator can correlate
 * state changes with what the vehicle was reporting at the moment.
 *
 * Lazy by default — the panel starts collapsed and only fires the
 * `useDriveWhyEnded` query when expanded. This keeps Drive Detail's
 * default render cheap for the common case where nobody is debugging
 * a session.
 *
 * Server validates `window` ∈ {30s, 60s, 5m, 15m} and rejects anything
 * else with 400.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, GitBranch, Radio } from 'lucide-react';

import {
  Button,
  DataTable,
  GlassPanel,
  Select,
  type Column,
  type SelectOption,
} from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { Timeline, TimeStamp } from '@/components/data-display';
import { EmptyState, Spinner } from '@/components/feedback';
import { useDriveWhyEnded } from '@/api/hooks/useDriving';
import type {
  DriveDiagnosticSignal,
  DriveDiagnosticTransition,
  DriveDiagnosticWindow,
} from '@/types/admin-diagnostics';

interface WhyEndedPanelProps {
  driveId: string | number;
}

const WINDOWS: DriveDiagnosticWindow[] = ['30s', '60s', '5m', '15m'];

export function WhyEndedPanel({ driveId }: WhyEndedPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [windowSel, setWindowSel] = useState<DriveDiagnosticWindow>('60s');

  const why = useDriveWhyEnded(driveId, windowSel, expanded);

  const windowOptions: SelectOption[] = WINDOWS.map((w) => ({
    value: w,
    label: t(`driveDetail.whyEnded.windowOption.${w}`, w),
  }));

  const signalColumns: Column<KeyedSignal>[] = [
    {
      key: 'ts',
      header: t('driveDetail.whyEnded.signal.cols.ts', 'Timestamp'),
      visibleOnMobile: true,
      render: (row) => <TimeStamp value={row.ts} format="absolute" />,
    },
    {
      key: 'field',
      header: t('driveDetail.whyEnded.signal.cols.field', 'Field'),
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs">{row.field}</span>
      ),
    },
    {
      key: 'value',
      header: t('driveDetail.whyEnded.signal.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => (
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {row.value}
        </span>
      ),
    },
  ];

  const transitions: DriveDiagnosticTransition[] = why.data?.fsm_transitions ?? [];
  const signals: DriveDiagnosticSignal[] = why.data?.signal_window ?? [];
  // Keyed signal rows for DataTable — `ts+field` is not guaranteed unique
  // (same field can re-emit at the same second on busy vehicles) so we
  // splice the array index in to keep React reconciliation stable.
  type KeyedSignal = DriveDiagnosticSignal & { __idx: number };
  const keyedSignals: KeyedSignal[] = signals.map((s, idx) => ({ ...s, __idx: idx }));

  return (
    <GlassPanel className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          icon={
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          }
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
        >
          <PanelTitle>
            {t('driveDetail.whyEnded.title', 'Why did this drive end?')}
          </PanelTitle>
        </Button>

        {expanded && (
          <div className="w-40">
            <Select
              value={windowSel}
              onChange={(e) =>
                setWindowSel(e.target.value as DriveDiagnosticWindow)
              }
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
        <div className="mt-4 space-y-6">
          {why.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : why.error ? (
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
          ) : (
            <>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[var(--text-muted)]" />
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
                  <Timeline
                    items={transitions.map((tx) => ({
                      title: (
                        <span className="font-mono text-sm">
                          {tx.fsm_name}: {tx.from_state} → {tx.to_state}
                        </span>
                      ),
                      subtitle: (
                        <span className="text-xs text-[var(--text-muted)]">
                          {t(
                            'driveDetail.whyEnded.trigger',
                            'trigger: {{trigger}}',
                            { trigger: tx.trigger || '—' },
                          )}
                        </span>
                      ),
                      time: new Date(tx.ts).toLocaleString(),
                      color: 'var(--accent-primary)',
                    }))}
                  />
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-[var(--text-muted)]" />
                  <PanelTitle>
                    {t(
                      'driveDetail.whyEnded.signalTitle',
                      'Signal window',
                    )}
                  </PanelTitle>
                </div>
                <DataTable<KeyedSignal>
                  tableId="drive:why-ended-signals"
                  name="why-ended-signals"
                  columns={signalColumns}
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
