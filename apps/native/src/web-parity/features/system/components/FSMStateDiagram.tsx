// Native parity port of web/src/features/system/components/FSMStateDiagram.tsx.
//
// Renders the "State Diagram" panel on the State-Machine Debugger page: a
// horizontal, wrapping row of FSM state nodes (status dot + state name + a live
// hit-count + a "current state" marker) connected by right-pointing arrows that
// carry per-edge transition counts, followed by a "top 10 busiest edges"
// summary of from -> to ×count chips. When the panel is asked for an FSM type it
// has no diagram for (e.g. the aggregate 'all'), it shows the same title with an
// EmptyState prompting the user to pick a concrete FSM type.
//
// Native-safe substitutions (rules 4-7), documented in the parity sidecar:
//   * `@/types/fsm` (FSM_STATES / FSM_EDGES / getStateColor) is NOT yet ported
//     into the parity tree (it has its own conversion slots). Following the
//     CollapsibleCommandGroup precedent for not-yet-ported siblings, the exact
//     state lists, derived transition edges, and per-state color resolution for
//     all eight FSMs are inlined here. The web getStateColor returns Tailwind
//     class strings (`.dot`/`.text`); the native resolver returns the literal
//     hex/rgba each class maps to (the LocationsPage exact-hex precedent) so the
//     diagram keeps web color parity. Only `.dot` + `.text` are consumed by this
//     component, so only those two channels are resolved.
//   * The `FSMTransition` API row type IS already ported — it is imported from
//     the native `api/hooks/useFSM` instead of being re-inlined.
//   * react-i18next `useTranslation()` -> a local stand-in whose `t(key,
//     fallback)` returns the English fallback, preserving every key + default
//     copy at the call site.
//   * `@/components/ui` GlassPanel + `@/components/feedback` EmptyState -> the
//     native shell GlassPanel and the parity EmptyState (icon/title/message).
//   * `cn()` + Tailwind classes -> StyleSheet + theme tokens. The inline SVG
//     arrow (`<svg><line/><polygon/></svg>`) -> a muted "→" glyph (react-native
//     ships no SVG renderer in this bundle), keeping the left-to-right edge
//     intent. The web responsive `flex flex-wrap` row -> RN flexWrap row. The
//     `animate-pulse` current-state badge -> a static green dot (no looping
//     timer, which would otherwise leak an open handle under the test gate); the
//     dropped pulse is decorative only.
// No DOM elements, react-i18next, Recharts, Leaflet, SVG, or web UI-kit modules
// are imported into the native output.

import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import type {FSMTransition} from '../../../api/hooks/useFSM';
import {EmptyState} from '../../../components/feedback';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next: the parity bundle ships no i18n runtime,
// so `t` returns the English fallback (or the key) while preserving every key +
// default copy at the call site.
function useTranslation(): {t: TFunc} {
  return {t: (key, fallback) => fallback ?? key};
}

/* ─── inlined `@/types/fsm` registry (states + edges + colors) ─────────── */

// The web getStateColor resolves a state's BadgeVariant (+ optional override)
// to Tailwind classes; the native port resolves the same to literal colors.
// Exact Tailwind v3 palette hexes used by the source overrides/variants:
const TW = {
  green400: '#4ade80',
  amber400: '#fbbf24',
  red400: '#f87171',
  red500: '#ef4444',
  blue400: '#60a5fa',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  cyan400: '#22d3ee',
  purple400: '#c084fc',
  indigo400: '#818cf8',
  orange400: '#fb923c',
  // automation.disabled uses text-red-400/50 + dot red-400/50 (50% alpha).
  red400Alpha50: 'rgba(248,113,113,0.5)',
} as const;

interface StateColor {
  // backgroundColor of the status dot (web `.dot` Tailwind class).
  dot: string;
  // color of the state-name label (web `.text` Tailwind class).
  text: string;
}

// Neutral default, matching the web DEFAULT_STATE (variant 'neutral': gray-400
// dot, muted text) returned by getStateColor for unknown states.
const DEFAULT_STATE_COLOR: StateColor = {dot: TW.gray400, text: colors.textMuted};

// Per-FSM, per-state resolved colors (variant theme + the source `overrides`
// already applied). Keys are the lowercase state names getStateColor looks up.
const STATE_COLORS: Record<string, Record<string, StateColor>> = {
  vehicle: {
    online: {dot: TW.green400, text: TW.green400},
    driving: {dot: TW.green400, text: TW.green400},
    charging: {dot: TW.cyan400, text: TW.cyan400},
    parked: {dot: TW.purple400, text: TW.purple400},
    updating: {dot: TW.indigo400, text: TW.indigo400},
    asleep: {dot: TW.gray400, text: colors.textMuted},
    offline: {dot: TW.gray500, text: colors.textMuted},
  },
  drive_session: {
    pending: {dot: TW.amber400, text: TW.amber400},
    active: {dot: TW.green400, text: TW.green400},
    ending: {dot: TW.orange400, text: TW.orange400},
    completed: {dot: TW.indigo400, text: TW.indigo400},
    recovered: {dot: TW.purple400, text: TW.purple400},
  },
  charge_session: {
    pending: {dot: TW.amber400, text: TW.amber400},
    active: {dot: TW.cyan400, text: TW.cyan400},
    completing: {dot: TW.blue400, text: TW.blue400},
    done: {dot: TW.green400, text: TW.green400},
    recovered: {dot: TW.purple400, text: TW.purple400},
  },
  command: {
    queued: {dot: TW.gray400, text: colors.textMuted},
    waking: {dot: TW.amber400, text: TW.amber400},
    wake_confirmed: {dot: TW.blue400, text: TW.blue400},
    wake_timeout: {dot: TW.orange400, text: TW.orange400},
    sending: {dot: TW.blue400, text: TW.blue400},
    succeeded: {dot: TW.green400, text: TW.green400},
    failed: {dot: TW.red400, text: TW.red400},
    timed_out: {dot: TW.orange400, text: TW.orange400},
    retrying: {dot: TW.purple400, text: TW.purple400},
    gave_up: {dot: TW.red500, text: TW.red500},
  },
  notification: {
    created: {dot: TW.gray400, text: colors.textMuted},
    sending: {dot: TW.blue400, text: TW.blue400},
    delivered: {dot: TW.green400, text: TW.green400},
    partial: {dot: TW.amber400, text: TW.amber400},
    failed: {dot: TW.red400, text: TW.red400},
    retrying: {dot: TW.purple400, text: TW.purple400},
    dead: {dot: TW.red500, text: TW.red500},
  },
  alert_cooldown: {
    armed: {dot: TW.green400, text: TW.green400},
    fired: {dot: TW.red400, text: TW.red400},
    suppressed: {dot: TW.amber400, text: TW.amber400},
  },
  automation: {
    idle: {dot: TW.gray400, text: colors.textSecondary},
    evaluating: {dot: TW.cyan400, text: TW.cyan400},
    executing: {dot: TW.amber400, text: TW.amber400},
    succeeded: {dot: TW.green400, text: TW.green400},
    partial: {dot: TW.amber400, text: TW.amber400},
    failed: {dot: TW.red400, text: TW.red400},
    retrying: {dot: TW.amber400, text: TW.amber400},
    gave_up: {dot: TW.red500, text: TW.red500},
    skipped: {dot: TW.gray500, text: colors.textMuted},
    cooldown: {dot: TW.purple400, text: TW.purple400},
    disabled: {dot: TW.red400Alpha50, text: TW.red400Alpha50},
  },
  telemetry_connection: {
    unknown: {dot: TW.gray400, text: colors.textMuted},
    connecting: {dot: TW.amber400, text: TW.amber400},
    streaming: {dot: TW.green400, text: TW.green400},
    stale: {dot: TW.amber400, text: TW.amber400},
    disconnected: {dot: TW.red400, text: TW.red400},
    polling_only: {dot: TW.blue400, text: TW.blue400},
  },
};

// Ordered state name arrays per FSM type (mirrors FSM_STATES — stable ordering).
const FSM_STATES: Record<string, readonly string[]> = {
  vehicle: ['online', 'driving', 'charging', 'parked', 'updating', 'asleep', 'offline'],
  drive_session: ['pending', 'active', 'ending', 'completed', 'recovered'],
  charge_session: ['pending', 'active', 'completing', 'done', 'recovered'],
  command: [
    'queued', 'waking', 'wake_confirmed', 'wake_timeout', 'sending',
    'succeeded', 'failed', 'timed_out', 'retrying', 'gave_up',
  ],
  notification: ['created', 'sending', 'delivered', 'partial', 'failed', 'retrying', 'dead'],
  alert_cooldown: ['armed', 'fired', 'suppressed'],
  automation: [
    'idle', 'evaluating', 'executing', 'succeeded', 'partial', 'failed',
    'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled',
  ],
  telemetry_connection: ['unknown', 'connecting', 'streaming', 'stale', 'disconnected', 'polling_only'],
};

// Transition edges per FSM type (mirrors FSM_EDGES — the unique, first-seen
// [from, to] pairs deriveEdges() produces from each FSM's transition table).
const FSM_EDGES: Record<string, [string, string][]> = {
  vehicle: [
    ['online', 'driving'], ['online', 'charging'], ['online', 'parked'], ['online', 'asleep'], ['online', 'offline'],
    ['driving', 'parked'], ['driving', 'charging'], ['driving', 'online'], ['driving', 'offline'],
    ['charging', 'driving'], ['charging', 'parked'], ['charging', 'online'], ['charging', 'asleep'], ['charging', 'offline'],
    ['parked', 'driving'], ['parked', 'charging'], ['parked', 'online'], ['parked', 'asleep'], ['parked', 'offline'],
    ['asleep', 'online'], ['asleep', 'charging'], ['asleep', 'driving'], ['asleep', 'parked'], ['asleep', 'offline'],
    ['offline', 'online'], ['offline', 'charging'], ['offline', 'driving'], ['offline', 'parked'], ['offline', 'asleep'],
  ],
  drive_session: [
    ['pending', 'active'], ['pending', 'recovered'], ['active', 'ending'], ['active', 'recovered'],
    ['ending', 'completed'], ['recovered', 'active'], ['recovered', 'ending'],
  ],
  charge_session: [
    ['pending', 'active'], ['pending', 'recovered'], ['active', 'completing'], ['active', 'recovered'],
    ['completing', 'done'], ['recovered', 'active'], ['recovered', 'completing'],
  ],
  command: [
    ['queued', 'sending'], ['queued', 'waking'], ['queued', 'gave_up'], ['waking', 'wake_confirmed'],
    ['waking', 'wake_timeout'], ['wake_confirmed', 'sending'], ['wake_timeout', 'waking'], ['wake_timeout', 'gave_up'],
    ['sending', 'succeeded'], ['sending', 'failed'], ['sending', 'timed_out'], ['failed', 'retrying'],
    ['failed', 'gave_up'], ['timed_out', 'retrying'], ['timed_out', 'gave_up'], ['retrying', 'sending'],
  ],
  notification: [
    ['created', 'sending'], ['sending', 'delivered'], ['sending', 'partial'], ['sending', 'failed'],
    ['partial', 'sending'], ['partial', 'dead'], ['failed', 'retrying'], ['failed', 'dead'], ['retrying', 'sending'],
  ],
  alert_cooldown: [
    ['armed', 'fired'], ['fired', 'suppressed'], ['fired', 'armed'], ['suppressed', 'suppressed'], ['suppressed', 'armed'],
  ],
  automation: [
    ['idle', 'evaluating'], ['evaluating', 'executing'], ['evaluating', 'skipped'], ['executing', 'succeeded'],
    ['executing', 'partial'], ['executing', 'failed'], ['failed', 'retrying'], ['retrying', 'executing'],
    ['retrying', 'gave_up'], ['succeeded', 'cooldown'], ['succeeded', 'idle'], ['partial', 'cooldown'],
    ['partial', 'idle'], ['gave_up', 'idle'], ['gave_up', 'disabled'], ['skipped', 'idle'],
    ['cooldown', 'idle'], ['disabled', 'idle'],
  ],
  telemetry_connection: [
    ['unknown', 'connecting'], ['unknown', 'polling_only'], ['connecting', 'streaming'], ['connecting', 'stale'],
    ['connecting', 'disconnected'], ['streaming', 'stale'], ['streaming', 'disconnected'], ['stale', 'streaming'],
    ['stale', 'disconnected'], ['disconnected', 'streaming'], ['polling_only', 'streaming'],
  ],
};

// Resolve a state's diagram colors for a given FSM type. Mirrors the web
// getStateColor: unknown FSM type falls back to the vehicle table, unknown
// state falls back to the neutral DEFAULT_STATE, and the state name is matched
// case-insensitively.
function getStateColor(fsmType: string, state: string): StateColor {
  const table = STATE_COLORS[fsmType] ?? STATE_COLORS.vehicle;
  return table[state.toLowerCase()] ?? DEFAULT_STATE_COLOR;
}

/* ─── component ───────────────────────────────────────────────────────── */

interface FSMStateDiagramProps {
  fsmType: string;
  transitions: FSMTransition[];
}

export function FSMStateDiagram({fsmType, transitions}: FSMStateDiagramProps) {
  const {t} = useTranslation();

  const states = FSM_STATES[fsmType];
  const edges = FSM_EDGES[fsmType];

  const {stateCounts, edgeCounts, latestState} = useMemo(() => {
    const sc = new Map<string, number>();
    const ec = new Map<string, number>();
    let latest = '';
    let latestTime = 0;

    for (const tr of transitions) {
      if (fsmType !== 'all' && tr.fsm_name !== fsmType) continue;
      sc.set(tr.to_state, (sc.get(tr.to_state) ?? 0) + 1);
      sc.set(tr.from_state, (sc.get(tr.from_state) ?? 0) + 1);
      const edgeKey = `${tr.from_state}->${tr.to_state}`;
      ec.set(edgeKey, (ec.get(edgeKey) ?? 0) + 1);
      // Renamed from the source's `t` to avoid shadowing the i18n `t`
      // (native lint `no-shadow`); behavior is identical.
      const whenMs = new Date(tr.ts).getTime();
      if (whenMs > latestTime) {
        latestTime = whenMs;
        latest = tr.to_state;
      }
    }
    return {stateCounts: sc, edgeCounts: ec, latestState: latest};
  }, [transitions, fsmType]);

  if (!states || !edges) {
    return (
      <GlassPanel style={styles.panel}>
        <AppText style={styles.titleEmpty} weight="semibold">
          {t('fsm.stateDiagram', 'State Diagram')}
        </AppText>
        <EmptyState
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          message={t('fsm.selectFsmType', 'Select a specific FSM type to view its state diagram')}
        />
      </GlassPanel>
    );
  }

  // Build adjacency: for each state, what states it transitions to
  const outEdges = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const list = outEdges.get(from) ?? [];
    list.push(to);
    outEdges.set(from, list);
  }

  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.title} weight="semibold">
        {t('fsm.stateDiagram', 'State Diagram')}
      </AppText>
      <View style={styles.row}>
        {states.map((state, i) => {
          const color = getStateColor(fsmType, state);
          const count = stateCounts.get(state) ?? 0;
          const isCurrent = state === latestState;
          // Show arrow after node unless last
          const hasArrow = i < states.length - 1;
          const edgeCount = hasArrow
            ? edgeCounts.get(`${state}->${states[i + 1]}`)
            : undefined;

          return (
            <View key={state} style={styles.nodeGroup}>
              <View
                style={[
                  styles.node,
                  isCurrent
                    ? styles.nodeCurrent
                    : count > 0
                      ? styles.nodeActive
                      : styles.nodeIdle,
                ]}>
                <View style={[styles.dot, {backgroundColor: color.dot}]} />
                <AppText style={[styles.stateLabel, {color: color.text}]}>{state}</AppText>
                {count > 0 && <AppText style={styles.count}>{count}</AppText>}
                {isCurrent && <View style={styles.currentBadge} />}
              </View>
              {hasArrow && (
                <View style={styles.arrowWrap}>
                  <AppText style={styles.arrowGlyph}>→</AppText>
                  {edgeCount ? (
                    <AppText style={styles.arrowCount}>{edgeCount}</AppText>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Edge summary below */}
      {edgeCounts.size > 0 && (
        <View style={styles.edgeSummary}>
          {Array.from(edgeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([edge, count]) => {
              const [from, to] = edge.split('->');
              return (
                <View key={edge} style={styles.edgeChip}>
                  <AppText style={[styles.edgeState, {color: getStateColor(fsmType, from).text}]}>
                    {from}
                  </AppText>
                  <AppText style={styles.edgeArrow}>→</AppText>
                  <AppText style={[styles.edgeState, {color: getStateColor(fsmType, to).text}]}>
                    {to}
                  </AppText>
                  <AppText style={styles.edgeMult}>×{count}</AppText>
                </View>
              );
            })}
        </View>
      )}
    </GlassPanel>
  );
}

FSMStateDiagram.displayName = 'FSMStateDiagram';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  titleEmpty: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  nodeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  node: {
    position: 'relative',
    flexDirection: 'column',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 70,
  },
  nodeCurrent: {
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  nodeActive: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  nodeIdle: {
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    opacity: 0.5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: spacing.xs,
  },
  stateLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  count: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
    color: colors.textMuted,
  },
  currentBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TW.green400,
  },
  arrowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
  },
  arrowGlyph: {
    fontSize: 16,
    lineHeight: 16,
    color: colors.textMuted,
  },
  arrowCount: {
    position: 'absolute',
    top: -10,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
  },
  edgeSummary: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  edgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  edgeState: {
    fontSize: 10,
    lineHeight: 14,
  },
  edgeArrow: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  edgeMult: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
});
