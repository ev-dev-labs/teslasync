/**
 * Screen-reader summaries for complex visualisations (A11Y-10).
 *
 * Charts already have a fallback data table (`<ChartContainer>` +
 * `chartRowsFromTimeseries`). The other four visualisation families in
 * this app do not, and each fails a screen-reader user in a different
 * way:
 *
 * - **Maps.** A Leaflet route is an SVG `<path>` and a pile of markers.
 *   To a screen reader it is nothing at all — the user cannot tell
 *   whether a drive went two blocks or two hundred miles.
 * - **Gauges.** `role="meter"` + `aria-valuenow` gets the NUMBER across
 *   but loses the meaning: is 82 good? What is the ceiling? Is it
 *   trending the right way?
 * - **State machines.** The FSM diagrams communicate the current state
 *   by colour and position. Both are invisible, and "what state is the
 *   car in and how long has it been there" is the actual question.
 * - **Timelines.** A vertical rail of dots reads as an undifferentiated
 *   list of fragments with no sense of span, ordering, or size.
 *
 * These builders produce ONE sentence per visualisation, meant to be
 * rendered inside `<VisuallyHidden>` next to (not instead of) the
 * visual. They are hooks because every string is translated; they
 * return plain strings so callers can also feed them to `aria-label`,
 * `aria-describedby`, or the announcer.
 *
 * Design rules followed by every builder here:
 *
 * 1. **Lead with the answer.** The first clause is the thing the user
 *    came for ("Charging, 82 percent"), not scaffolding ("This is a
 *    gauge showing…").
 * 2. **Never invent precision.** Missing inputs are omitted from the
 *    sentence rather than rendered as "unknown" or "0".
 * 3. **Values arrive pre-formatted.** Callers pass display strings that
 *    already went through `useFormatting()` / `useUnits()`, so a
 *    summary always agrees with the number printed next to it and this
 *    module never has to know about SI conversion.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Drop empty segments and join the rest into one spoken sentence. */
function sentence(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join('. ');
}

export interface RouteSummaryInput {
  /** Number of GPS samples that make up the drawn path. */
  pointCount: number;
  /** Pre-formatted distance, e.g. "12.4 mi". */
  distance?: string | null;
  /** Pre-formatted duration, e.g. "28 min". */
  duration?: string | null;
  /** Human-readable origin, e.g. "Home". */
  start?: string | null;
  /** Human-readable destination. */
  end?: string | null;
}

export interface GaugeSummaryInput {
  /** What is being measured, already translated. */
  label: string;
  /** Pre-formatted current value, e.g. "82%" or "3.4 mi/kWh". */
  value: string;
  /** Pre-formatted range bounds, when the scale is meaningful. */
  min?: string | null;
  max?: string | null;
  /** Qualitative reading, already translated ("Healthy", "Degraded"). */
  status?: string | null;
}

export interface StateMachineSummaryInput {
  /** Which machine, already translated ("Vehicle state"). */
  label: string;
  /** Current state, already translated ("Charging"). */
  current: string;
  /** Pre-formatted dwell time, e.g. "12 minutes". */
  since?: string | null;
  /** State it came from, already translated. */
  previous?: string | null;
  /** Reachable next states, already translated. */
  next?: readonly string[];
}

export interface TimelineSummaryInput {
  /** What the timeline covers, already translated. */
  label: string;
  /** Number of entries rendered. */
  count: number;
  /** Pre-formatted timestamp of the first (oldest) entry. */
  start?: string | null;
  /** Pre-formatted timestamp of the last (newest) entry. */
  end?: string | null;
}

export interface A11ySummaryBuilders {
  describeRoute: (input: RouteSummaryInput) => string;
  describeGauge: (input: GaugeSummaryInput) => string;
  describeStateMachine: (input: StateMachineSummaryInput) => string;
  describeTimeline: (input: TimelineSummaryInput) => string;
}

export function useA11ySummary(): A11ySummaryBuilders {
  const { t } = useTranslation();

  const describeRoute = useCallback(
    ({ pointCount, distance, duration, start, end }: RouteSummaryInput): string => {
      if (pointCount <= 0) {
        return t('a11y.summary.route.empty', 'Route map. No location data recorded.');
      }
      const head =
        start && end
          ? t('a11y.summary.route.fromTo', 'Route map from {{start}} to {{end}}', {
              start,
              end,
            })
          : t('a11y.summary.route.generic', 'Route map');
      return sentence([
        head,
        distance ? t('a11y.summary.route.distance', 'Distance {{distance}}', { distance }) : null,
        duration ? t('a11y.summary.route.duration', 'Duration {{duration}}', { duration }) : null,
        t('a11y.summary.route.points', '{{count}} recorded points', { count: pointCount }),
      ]);
    },
    [t],
  );

  const describeGauge = useCallback(
    ({ label, value, min, max, status }: GaugeSummaryInput): string =>
      sentence([
        t('a11y.summary.gauge.value', '{{label}}: {{value}}', { label, value }),
        status,
        min != null && max != null
          ? t('a11y.summary.gauge.range', 'Scale {{min}} to {{max}}', { min, max })
          : null,
      ]),
    [t],
  );

  const describeStateMachine = useCallback(
    ({ label, current, since, previous, next }: StateMachineSummaryInput): string =>
      sentence([
        t('a11y.summary.state.current', '{{label}}: {{state}}', { label, state: current }),
        since ? t('a11y.summary.state.since', 'For {{duration}}', { duration: since }) : null,
        previous
          ? t('a11y.summary.state.previous', 'Previously {{state}}', { state: previous })
          : null,
        next && next.length > 0
          ? t('a11y.summary.state.next', 'Can move to {{states}}', {
              states: next.join(', '),
            })
          : null,
      ]),
    [t],
  );

  const describeTimeline = useCallback(
    ({ label, count, start, end }: TimelineSummaryInput): string => {
      if (count <= 0) {
        return t('a11y.summary.timeline.empty', '{{label}}: no entries', { label });
      }
      return sentence([
        t('a11y.summary.timeline.count', '{{label}}: {{count}} entries', { label, count }),
        start && end
          ? t('a11y.summary.timeline.span', 'From {{start}} to {{end}}', { start, end })
          : null,
      ]);
    },
    [t],
  );

  return useMemo(
    () => ({ describeRoute, describeGauge, describeStateMachine, describeTimeline }),
    [describeRoute, describeGauge, describeStateMachine, describeTimeline],
  );
}
