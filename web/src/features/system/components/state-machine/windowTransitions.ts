import type { FSMTransition } from '@/types/fsm';

/**
 * Phase 45 / Prompt 35 — single source of truth for windowing FSM
 * transitions in the State Machine debugger.
 *
 * The page fetches a wide range (typically the last 24 h) so the user can
 * scroll back through history with `Step ← / →`, but the toolbar's
 * *Window* dropdown narrows the view to a smaller chronological slice
 * (5 min … 2 h) for the timeline ticks. Before this helper, the page's
 * "buffered" counter and `StateTimeline`'s tick filter measured DIFFERENT
 * scopes and could therefore render contradictions ("23 buffered" + "No
 * transitions in window"). All windowed views now route through here.
 */

export interface WindowedTransitions {
  /** Transitions inside [anchor - minutes, anchor], chronological. */
  inWindow: FSMTransition[];
  /** All transitions outside the window, chronological. */
  outsideWindow: FSMTransition[];
  /** Most recent transition overall (in or out of window), if any. */
  lastTransition: FSMTransition | null;
  /** Anchor used (defaults to now if omitted). */
  anchor: Date;
  /** Window length in minutes. */
  minutes: number;
}

/**
 * Presets the helper considers when looking for a "wider window that
 * would surface the most-recent transition". The toolbar dropdown still
 * exposes the smaller subset `[5, 10, 30, 120]`; the helper additionally
 * considers `[360, 1440]` so that a stale-by-many-hours last transition
 * can still be reached by widening the window.
 */
const PRESETS_MIN = [5, 10, 30, 120, 360, 1440] as const;

/** Pure helper — same source of truth for page, timeline, and toolbar. */
export function windowTransitions(
  transitions: FSMTransition[],
  minutes: number,
  anchor?: Date,
): WindowedTransitions {
  const a = anchor ?? new Date();
  const endTs = a.getTime();
  const startTs = endTs - minutes * 60_000;
  const inWindow: FSMTransition[] = [];
  const outsideWindow: FSMTransition[] = [];
  let lastTs = -Infinity;
  let last: FSMTransition | null = null;
  for (const tr of transitions) {
    const ts = new Date(tr.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts > lastTs) {
      lastTs = ts;
      last = tr;
    }
    if (ts >= startTs && ts <= endTs) inWindow.push(tr);
    else outsideWindow.push(tr);
  }
  inWindow.sort(
    (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime(),
  );
  outsideWindow.sort(
    (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime(),
  );
  return { inWindow, outsideWindow, lastTransition: last, anchor: a, minutes };
}

/**
 * Returns the smallest preset (in minutes) that would include `lastTs`
 * relative to `anchor`, or `null` if nothing fits the largest preset
 * (i.e., the gap is greater than 24 h or the gap is negative).
 */
export function nextWiderPreset(
  lastTs: number,
  anchor: Date,
  currentMinutes: number,
): number | null {
  if (!Number.isFinite(lastTs)) return null;
  const gapMs = anchor.getTime() - lastTs;
  if (gapMs < 0) return null;
  for (const p of PRESETS_MIN) {
    if (p > currentMinutes && p * 60_000 >= gapMs) return p;
  }
  return null;
}
