import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { getStateColor } from '@/types/fsm';
import type { FSMTransition } from '@/types/fsm';
import { Tooltip } from '@/components/ui';

/**
 * Phase 40 / Prompt 58 — horizontal mini-timeline of FSM transitions.
 *
 * Each tick is a state transition placed on the timeline by its created_at
 * timestamp, colored by destination state via the shared FSM theme. Clicking a
 * tick selects that transition in the inspector. The component is purely
 * presentational — the page owns the buffer/window and the selected id.
 */
export interface StateTimelineProps {
  /** Transitions to render. Order doesn't matter — the component sorts. */
  transitions: FSMTransition[];
  /** FSM type for state-color resolution. */
  fsmType: string;
  /** Currently selected transition id, if any. Highlighted on the timeline. */
  selectedId?: number | null;
  /** Selection callback — receives the transition row. */
  onSelect?: (transition: FSMTransition) => void;
  /** Window length in minutes — defaults to 10. */
  windowMinutes?: number;
  /** Optional fixed end-time anchor; defaults to "now" (live). */
  anchor?: Date;
  className?: string;
}

export function StateTimeline({
  transitions,
  fsmType,
  selectedId,
  onSelect,
  windowMinutes = 10,
  anchor,
  className,
}: StateTimelineProps) {
  const { t } = useTranslation();

  const { ticks, end, start } = useMemo(() => {
    const endTs = (anchor ?? new Date()).getTime();
    const startTs = endTs - windowMinutes * 60_000;
    const span = endTs - startTs || 1;
    const visible = transitions.filter((tr) => {
      const ts = new Date(tr.created_at).getTime();
      return ts >= startTs && ts <= endTs;
    });
    visible.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return {
      ticks: visible.map((tr) => ({
        tr,
        leftPct: ((new Date(tr.created_at).getTime() - startTs) / span) * 100,
      })),
      end: new Date(endTs),
      start: new Date(startTs),
    };
  }, [transitions, anchor, windowMinutes]);

  if (ticks.length === 0) {
    return (
      <div
        data-testid="state-timeline-empty"
        className={cn(
          'rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-xs text-[var(--text-muted)]',
          className,
        )}
      >
        {t('debugger.timeline.empty', 'No transitions in window')}
      </div>
    );
  }

  return (
    <div
      data-testid="state-timeline"
      className={cn('rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3', className)}
    >
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        <span>{start.toLocaleTimeString()}</span>
        <span>
          {t('debugger.timeline.windowLabel', 'Window: {{minutes}} min', { minutes: windowMinutes })}
        </span>
        <span>{end.toLocaleTimeString()}</span>
      </div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
        {ticks.map(({ tr, leftPct }) => {
          const color = getStateColor(fsmType, tr.to_state);
          const isSelected = selectedId != null && tr.id === selectedId;
          return (
            <Tooltip
              key={tr.id}
              content={`${tr.from_state} → ${tr.to_state} · ${new Date(tr.created_at).toLocaleTimeString()}`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onSelect?.(tr);
                }}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all',
                  isSelected
                    ? 'h-4 w-4 border-white/80 ring-2 ring-white/30'
                    : 'h-2.5 w-2.5 border-transparent hover:h-3.5 hover:w-3.5',
                  color.dot,
                )}
                style={{ left: `${leftPct}%` }}
                aria-label={t('debugger.timeline.tickAria', '{{from}} to {{to}}', {
                  from: tr.from_state,
                  to: tr.to_state,
                })}
                data-testid={`state-timeline-tick-${tr.id}`}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
