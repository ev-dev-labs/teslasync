import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { FSM_STATES, FSM_EDGES, getStateColor } from '@/types/fsm';
import type { FSMTransition } from '@/types/fsm';
import { VisuallyHidden } from '@/components/a11y';
import { useA11ySummary } from '@/hooks/useA11ySummary';

interface FSMStateDiagramProps {
  fsmType: string;
  /** Transition history to overlay on the diagram. Tolerates `undefined`
   *  during initial load — the component renders the static diagram either way. */
  transitions?: FSMTransition[];
}

export function FSMStateDiagram({ fsmType, transitions }: FSMStateDiagramProps) {
  const { t } = useTranslation();
  const { describeStateMachine } = useA11ySummary();

  const states = FSM_STATES[fsmType];
  const edges = FSM_EDGES[fsmType];

  const { stateCounts, edgeCounts, latestState } = useMemo(() => {
    const sc = new Map<string, number>();
    const ec = new Map<string, number>();
    let latest = '';
    let latestTime = 0;

    for (const tr of transitions ?? []) {
      if (fsmType !== 'all' && tr.fsm_name !== fsmType) continue;
      sc.set(tr.to_state, (sc.get(tr.to_state) ?? 0) + 1);
      sc.set(tr.from_state, (sc.get(tr.from_state) ?? 0) + 1);
      const edgeKey = `${tr.from_state}->${tr.to_state}`;
      ec.set(edgeKey, (ec.get(edgeKey) ?? 0) + 1);
      const tMs = new Date(tr.ts).getTime();
      if (Number.isFinite(tMs) && tMs > latestTime) {
        latestTime = tMs;
        latest = tr.to_state;
      }
    }
    return { stateCounts: sc, edgeCounts: ec, latestState: latest };
  }, [transitions, fsmType]);

  const reachableFromLatest = useMemo(() => {
    if (!latestState) return [];
    return (FSM_EDGES[fsmType] ?? [])
      .filter(([from]) => from === latestState)
      .map(([, to]) => to);
  }, [fsmType, latestState]);

  const stateSummary = describeStateMachine({
    label: t('fsm.stateDiagram', 'State Diagram'),
    current: latestState || t('fsm.noObservedState', 'No observed state'),
    next: reachableFromLatest,
  });

  if (!states || !edges) {    return (
      <GlassPanel className="p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {t('fsm.stateDiagram', 'State Diagram')}
        </h2>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.selectFsmType', 'Select a specific FSM type to view its state diagram')} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-5">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
        {t('fsm.stateDiagram', 'State Diagram')}
      </h2>
      {/* A11Y-10: the diagram encodes the machine's position with colour
          and left-to-right placement, both invisible to assistive tech.
          The summary answers the question the diagram exists to answer —
          which state is the machine in, and where can it go next — before
          the user has to walk the node list. */}
      <VisuallyHidden>{stateSummary}</VisuallyHidden>
      <div className="flex flex-wrap items-start gap-2 sm:gap-3">
        {states.map((state, i) => {
          const color = getStateColor(fsmType, state);
          const count = stateCounts.get(state) ?? 0;
          const isCurrent = state === latestState;
          // Show arrow after node unless last
          const hasArrow = i < states.length - 1;

          return (
            <div key={state} className="flex items-center gap-2 sm:gap-3">
              <div
                data-testid={`fsm-node-${state}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={cn(
                  'relative flex flex-col items-center rounded-lg border px-3 py-2 min-w-[70px] sm:min-w-[80px] transition-all',
                  isCurrent
                    ? 'border-[var(--border-strong)] bg-white/[0.08] ring-1 ring-white/20'
                    : count > 0
                      ? 'border-[var(--border-subtle)] bg-white/[0.04]'
                      : 'border-white/[0.05] bg-white/[0.02] opacity-50',
                )}
              >
                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full mb-1', color.dot)} />
                <span className={cn('text-xs font-medium', color.text)}>{state}</span>
                {count > 0 && (
                  <span className="text-2xs text-[var(--text-muted)] mt-0.5">{count}</span>
                )}
                {isCurrent && (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-400 animate-pulse"
                    />
                    <VisuallyHidden>{t('fsm.currentState', 'current state')}</VisuallyHidden>
                  </>
                )}
              </div>
              {hasArrow && (
                <div className="relative flex items-center text-[var(--text-muted)]">
                  <svg
                    width="20"
                    height="12"
                    viewBox="0 0 20 12"
                    className="shrink-0"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <line x1="0" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" />
                    <polygon points="14,2 20,6 14,10" fill="currentColor" />
                  </svg>
                  {(() => {
                    const edgeKey = `${state}->${states[i + 1]}`;
                    const edgeCount = edgeCounts.get(edgeKey);
                    return edgeCount ? (
                      <span className="text-2xs text-[var(--text-muted)] absolute -mt-4 ml-1">{edgeCount}</span>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edge summary below */}
      {edgeCounts.size > 0 && (
        <div data-testid="fsm-edge-summary" className="mt-4 flex flex-wrap gap-2">
          {Array.from(edgeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([edge, count]) => {
              const [from, to] = edge.split('->');
              return (
                <span
                  key={edge}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/[0.03] text-2xs text-[var(--text-secondary)]"
                >
                  <span className={getStateColor(fsmType, from).text}>{from}</span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span className={getStateColor(fsmType, to).text}>{to}</span>
                  <span className="text-[var(--text-muted)] font-mono">×{count}</span>
                </span>
              );
            })}
        </div>
      )}
    </GlassPanel>
  );
}
