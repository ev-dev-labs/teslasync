import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/cn';
import { getStateColor } from '@/types/fsm';
import type { FSMTransition } from '@/types/fsm';
import { Tooltip, Button } from '@/components/ui';
import { formatRelative } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';

/**
 * horizontal mini-timeline of FSM transitions.
 *
 * Each tick is a state transition placed on the timeline by its created_at
 * timestamp, colored by destination state via the shared FSM theme. Clicking a
 * tick selects that transition in the inspector. The component is purely
 * presentational — the page owns the buffer/window and the selected id.
 *
 * the component is no longer responsible for
 * windowing transitions. Callers pre-window via `windowTransitions()` so
 * the page-level "buffered" counter and the timeline view share a single
 * source of truth. When the page hands us an empty array AND a
 * `lastTransition` exists outside the active window, we surface an
 * actionable "widen window / jump to last" hint instead of just "No
 * transitions in window".
 */
export interface StateTimelineProps {
  /** Pre-windowed transitions to render. Order doesn't matter — the component sorts. */
  transitions: FSMTransition[];
  /** FSM type for state-color resolution. */
  fsmType: string;
  /** Currently selected transition id, if any. Highlighted on the timeline. */
  selectedId?: number | null;
  /** Selection callback — receives the transition row. */
  onSelect?: (transition: FSMTransition) => void;
  /** Window length in minutes — defaults to 10. Only used for the axis labels. */
  windowMinutes?: number;
  /** Optional fixed end-time anchor; defaults to "now" (live). */
  anchor?: Date;
  /**
   * Most recent transition (in or outside the window). Used to render an
   * actionable hint in the empty state — when the window is empty but the
   * user has data outside it, we point at it instead of going silent.
   */
  lastTransition?: FSMTransition | null;
  /** Smallest dropdown preset (in minutes) that would include `lastTransition`. */
  widerPreset?: number | null;
  /** Snap the toolbar Window dropdown to `widerPreset`. */
  onWidenWindow?: () => void;
  /** Switch to Freeze mode and select `lastTransition`. */
  onJumpToLast?: () => void;
  className?: string;
}

function presetLabel(min: number, t: TFunction): string {
  if (min < 60) return t('debugger.window.minutes', '{{n}} min', { n: min });
  if (min < 1440) return t('debugger.window.hours', '{{n}} h', { n: Math.round(min / 60) });
  return t('debugger.window.day', '24 h');
}

export function StateTimeline({
  transitions,
  fsmType,
  selectedId,
  onSelect,
  windowMinutes = 10,
  anchor,
  lastTransition,
  widerPreset,
  onWidenWindow,
  onJumpToLast,
  className,
}: StateTimelineProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();

  const { ticks, end, start } = useMemo(() => {
    const endTs = (anchor ?? new Date()).getTime();
    const startTs = endTs - windowMinutes * 60_000;
    const span = endTs - startTs || 1;
    const sorted = [...transitions].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    return {
      ticks: sorted.map((tr) => ({
        tr,
        leftPct: ((new Date(tr.ts).getTime() - startTs) / span) * 100,
      })),
      end: new Date(endTs),
      start: new Date(startTs),
    };
  }, [transitions, anchor, windowMinutes]);

  if (ticks.length === 0) {
    const hasHint = Boolean(lastTransition);
    const showWiden = widerPreset != null && onWidenWindow != null;
    const showJump = lastTransition != null && onJumpToLast != null;
    return (
      <div
        data-testid="state-timeline-empty"
        className={cn(
          'rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-3 text-xs text-[var(--text-muted)]',
          'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
          className,
        )}
      >
        <div>
          {t('debugger.timeline.empty', 'No transitions in window')}
          {hasHint ? (
            <>
              {' · '}
              <span className="text-[var(--text-secondary)]">
                {t('debugger.timeline.lastSeen', 'Last transition {{rel}}', {
                  rel: formatRelative(lastTransition!.ts),
                })}
              </span>
            </>
          ) : null}
        </div>
        {hasHint && (showWiden || showJump) ? (
          <div className="flex items-center gap-2">
            {showWiden ? (
              <Button
                size="sm"
                variant="primary"
                onClick={onWidenWindow}
                data-testid="state-timeline-widen"
              >
                {t('debugger.timeline.widenTo', 'Widen window to {{label}}', {
                  label: presetLabel(widerPreset!, t),
                })}
              </Button>
            ) : null}
            {showJump ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onJumpToLast}
                data-testid="state-timeline-jump"
              >
                {t('debugger.timeline.jumpToLast', 'Jump to last transition')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-testid="state-timeline"
      className={cn('rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-3', className)}
    >
      <div className="mb-2 flex items-center justify-between text-2xs uppercase tracking-wider text-[var(--text-muted)]">
        <span>{formatTime(start)}</span>
        <span>
          {t('debugger.timeline.windowLabel', 'Window: {{minutes}} min', { minutes: windowMinutes })}
        </span>
        <span>{formatTime(end)}</span>
      </div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--surface-2)]" />
        {ticks.map(({ tr, leftPct }) => {
          const color = getStateColor(fsmType, tr.to_state);
          const isSelected = selectedId != null && tr.id === selectedId;
          return (
            <Tooltip
              key={tr.id}
              content={`${tr.from_state} → ${tr.to_state} · ${formatTime(new Date(tr.ts))}`}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  onSelect?.(tr);
                }}
                className={cn(
                  'touch-target-overlay absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border p-0 transition-all',
                  isSelected
                    ? 'h-4 w-4 border-[var(--border-strong)] ring-2 ring-white/30'
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
