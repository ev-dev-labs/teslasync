// StateTimeline — React Native parity port of
// web/src/features/system/components/state-machine/StateTimeline.tsx.
//
// Horizontal mini-timeline of FSM transitions. Each tick is a state transition
// placed on the axis by its `ts` timestamp, colored by destination state via
// the shared FSM theme. Pressing a tick selects that transition in the
// inspector. Purely presentational — the page owns the buffer/window and the
// selected id. Behaviors preserved 1:1 from the source:
//   - useMemo window math: endTs = (anchor ?? now); startTs = endTs -
//     windowMinutes*60_000; span = (endTs-startTs) || 1; transitions are sorted
//     ascending by ts and mapped to { tr, leftPct } where leftPct =
//     ((ts - startTs) / span) * 100. windowMinutes defaults to 10.
//   - Empty branch (ticks.length === 0): renders the "No transitions in window"
//     placeholder. When a `lastTransition` exists it appends a "Last transition
//     {rel}" hint, and — gated exactly like the source — a primary "Widen window
//     to {label}" button (showWiden = widerPreset != null && onWidenWindow !=
//     null) and/or a ghost "Jump to last transition" button (showJump =
//     lastTransition != null && onJumpToLast != null).
//   - Non-empty branch: a header row (start time · "Window: N min" · end time)
//     over an axis line with one absolutely-positioned dot per transition.
//     Selected ticks (selectedId === tr.id) grow + gain a ring.
//
// Browser-only dependencies are reduced explicitly and documented in the
// .parity.json sidecar:
//   - react-i18next useTranslation / i18next TFunction (web L2-3): native-safe
//     useNativeTranslationFallback returning t(key, default, params?) that
//     interpolates i18next-style {{name}} placeholders — every key + fallback +
//     interpolation arg preserved verbatim (the SessionList precedent).
//   - @/lib/cn (web L4): dropped — native styling is StyleSheet + theme tokens.
//     The `className` prop is kept on the interface for source compatibility but
//     is not consumed (the SessionList precedent).
//   - @/types/fsm getStateColor + FSMTransition (web L5-6): FSMTransition is
//     imported from the already-ported native useFSM hook (single source of
//     truth). getStateColor is reproduced as a native-safe slice
//     (getStateDotColor) that mirrors the web variant theme + per-state `dot`
//     overrides across all 8 FSMs and resolves to a React Native color string —
//     only `.dot` is consumed by this component, so only the dot channel is
//     ported (unknown fsmType → vehicle fallback, unknown state → neutral
//     default, state.toLowerCase() lookup — identical to the source).
//   - @/components/ui Tooltip / Button (web L7): Tooltip is a hover-only DOM
//     affordance with no RN analog — its content (`from → to · time`) is
//     surfaced as the tick's accessibilityHint so the information survives. The
//     two empty-state Buttons become a local TimelineButton (Pressable + AppText)
//     that forwards testID + primary/ghost variants (the AIRestorePanel
//     ActionButton precedent — the shared AppButton does not forward testID).
//   - @/lib/dateFormat formatRelative + @/hooks/useDateFormat formatTime (web
//     L8-9): ported as native-safe local formatters. formatTime mirrors the lib
//     `formatTime` (toLocaleTimeString hour/minute 2-digit, guarded for
//     reduced-Intl RN runtimes); formatRelative is the verbatim "—" / "just now"
//     / "{n}m ago" / "{n}h ago" / "{n}d ago" / localized-date port.
//   - DOM <div> / <span> / <button> (web L99-196): replaced by react-native
//     View / AppText / Pressable. Tailwind class strings + CSS vars map to
//     StyleSheet + tokens; the responsive `sm:flex-row` empty layout collapses
//     to a mobile-first column. Absolute `left: {pct}%` + `-translate-x/y-1/2`
//     dot centering is reproduced with a percentage DimensionValue left and
//     negative margins equal to half the dot size (the chart-layer precedent).

import React, {useMemo, useRef} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import type {FSMTransition} from '../../../../api/hooks/useFSM';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue, params) =>
    interpolate(defaultValue, params),
  ).current;
}

// ── time formatter (native-safe port of useDateFormat().formatTime) ──
// Mirrors @/lib/dateFormat formatTime: "—" for nullish/invalid, otherwise a
// locale-aware "HH:MM" via toLocaleTimeString, guarded for reduced-Intl RN.
function formatTime(value: Date | string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  } catch {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

// ── relative-time formatter (native-safe port of @/lib/dateFormat formatRelative) ──
function formatRelative(value: Date | string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toDateString();
  }
}

// ── FSM state dot colors (native-safe port of @/types/fsm getStateColor) ──
// The web getStateColor resolves a BadgeVariant theme (+ optional per-state
// overrides) into Tailwind classes; this component only ever reads `.dot`, so
// the dot channel is ported here as React Native color strings. Tailwind tokens
// map to their v3 palette hex values.
type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const VARIANT_DOT: Record<BadgeVariant, string> = {
  success: '#4ade80', // bg-green-400
  warning: '#fbbf24', // bg-amber-400
  danger: '#f87171', // bg-red-400
  info: '#60a5fa', // bg-blue-400
  neutral: '#9ca3af', // bg-gray-400
};

const GREEN_400 = '#4ade80';
const CYAN_400 = '#22d3ee';
const PURPLE_400 = '#c084fc';
const ORANGE_400 = '#fb923c';
const INDIGO_400 = '#818cf8';
const RED_500 = '#ef4444';
const GRAY_500 = '#6b7280';
const RED_400_50 = 'rgba(248, 113, 113, 0.5)';

interface StateDot {
  variant: BadgeVariant;
  /** Resolved `dot` override color when the source state overrides the theme. */
  dot?: string;
}

// Per-FSM state → { variant, dot? } entries mirroring web/src/types/fsm/*.
// Keys are lowercase to match the source `state.toLowerCase()` lookup.
const FSM_STATE_DOTS: Record<string, Record<string, StateDot>> = {
  vehicle: {
    online: {variant: 'success'},
    driving: {variant: 'success', dot: GREEN_400},
    charging: {variant: 'warning', dot: CYAN_400},
    parked: {variant: 'info', dot: PURPLE_400},
    updating: {variant: 'info', dot: INDIGO_400},
    asleep: {variant: 'neutral'},
    offline: {variant: 'danger', dot: GRAY_500},
  },
  drive_session: {
    pending: {variant: 'warning'},
    active: {variant: 'success'},
    ending: {variant: 'warning', dot: ORANGE_400},
    completed: {variant: 'info', dot: INDIGO_400},
    recovered: {variant: 'neutral', dot: PURPLE_400},
  },
  charge_session: {
    pending: {variant: 'warning'},
    active: {variant: 'success', dot: CYAN_400},
    completing: {variant: 'info'},
    done: {variant: 'success'},
    recovered: {variant: 'neutral', dot: PURPLE_400},
  },
  command: {
    queued: {variant: 'neutral'},
    waking: {variant: 'warning'},
    wake_confirmed: {variant: 'info'},
    wake_timeout: {variant: 'warning', dot: ORANGE_400},
    sending: {variant: 'info'},
    succeeded: {variant: 'success'},
    failed: {variant: 'danger'},
    timed_out: {variant: 'warning', dot: ORANGE_400},
    retrying: {variant: 'neutral', dot: PURPLE_400},
    gave_up: {variant: 'danger', dot: RED_500},
  },
  notification: {
    created: {variant: 'neutral'},
    sending: {variant: 'info'},
    delivered: {variant: 'success'},
    partial: {variant: 'warning'},
    failed: {variant: 'danger'},
    retrying: {variant: 'neutral', dot: PURPLE_400},
    dead: {variant: 'danger', dot: RED_500},
  },
  alert_cooldown: {
    armed: {variant: 'success'},
    fired: {variant: 'danger'},
    suppressed: {variant: 'warning'},
  },
  automation: {
    idle: {variant: 'neutral'},
    evaluating: {variant: 'info', dot: CYAN_400},
    executing: {variant: 'warning'},
    succeeded: {variant: 'success'},
    partial: {variant: 'warning'},
    failed: {variant: 'danger'},
    retrying: {variant: 'warning'},
    gave_up: {variant: 'danger', dot: RED_500},
    skipped: {variant: 'neutral', dot: GRAY_500},
    cooldown: {variant: 'neutral', dot: PURPLE_400},
    disabled: {variant: 'danger', dot: RED_400_50},
  },
  telemetry_connection: {
    unknown: {variant: 'neutral'},
    connecting: {variant: 'warning'},
    streaming: {variant: 'success'},
    stale: {variant: 'warning'},
    disconnected: {variant: 'danger'},
    polling_only: {variant: 'info'},
  },
};

/**
 * Resolve the timeline dot color for a given FSM type + destination state.
 * Mirrors `getStateColor(fsmType, state).dot` from @/types/fsm: unknown FSM
 * types fall back to the vehicle FSM, unknown states fall back to the neutral
 * default, and the state name is lower-cased before lookup.
 */
function getStateDotColor(fsmType: string, state: string): string {
  const states = FSM_STATE_DOTS[fsmType] ?? FSM_STATE_DOTS.vehicle;
  const entry = states[state.toLowerCase()];
  if (!entry) {
    return VARIANT_DOT.neutral;
  }
  return entry.dot ?? VARIANT_DOT[entry.variant];
}

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
  /**
   * Accepted for source compatibility with the web prop. Native layout is
   * driven by StyleSheet + tokens, so the Tailwind class string is ignored.
   */
  className?: string;
}

function presetLabel(min: number, t: NativeTFunction): string {
  if (min < 60) {
    return t('debugger.window.minutes', '{{n}} min', {n: min});
  }
  if (min < 1440) {
    return t('debugger.window.hours', '{{n}} h', {n: Math.round(min / 60)});
  }
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
}: StateTimelineProps) {
  const t = useNativeTranslationFallback();

  const {ticks, end, start} = useMemo(() => {
    const endTs = (anchor ?? new Date()).getTime();
    const startTs = endTs - windowMinutes * 60_000;
    const span = endTs - startTs || 1;
    const sorted = [...transitions].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    return {
      ticks: sorted.map(tr => ({
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
      <View style={styles.emptyBox} testID="state-timeline-empty">
        <View style={styles.emptyTextWrap}>
          <AppText style={styles.emptyText}>
            {t('debugger.timeline.empty', 'No transitions in window')}
            {hasHint ? (
              <AppText style={styles.lastSeen}>
                {' · '}
                {t('debugger.timeline.lastSeen', 'Last transition {{rel}}', {
                  rel: formatRelative(lastTransition!.ts),
                })}
              </AppText>
            ) : null}
          </AppText>
        </View>
        {hasHint && (showWiden || showJump) ? (
          <View style={styles.buttonRow}>
            {showWiden ? (
              <TimelineButton
                label={t('debugger.timeline.widenTo', 'Widen window to {{label}}', {
                  label: presetLabel(widerPreset!, t),
                })}
                onPress={onWidenWindow!}
                testID="state-timeline-widen"
                variant="primary"
              />
            ) : null}
            {showJump ? (
              <TimelineButton
                label={t('debugger.timeline.jumpToLast', 'Jump to last transition')}
                onPress={onJumpToLast!}
                testID="state-timeline-jump"
                variant="ghost"
              />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.box} testID="state-timeline">
      <View style={styles.header}>
        <AppText style={styles.axisLabel}>{formatTime(start)}</AppText>
        <AppText style={styles.axisLabel}>
          {t('debugger.timeline.windowLabel', 'Window: {{minutes}} min', {
            minutes: windowMinutes,
          })}
        </AppText>
        <AppText style={styles.axisLabel}>{formatTime(end)}</AppText>
      </View>
      <View style={styles.track}>
        <View style={styles.axisLine} />
        {ticks.map(({tr, leftPct}) => {
          const dotColor = getStateDotColor(fsmType, tr.to_state);
          const isSelected = selectedId != null && tr.id === selectedId;
          const size = isSelected ? 16 : 10;
          return (
            <Pressable
              accessibilityHint={`${tr.from_state} → ${tr.to_state} · ${formatTime(
                new Date(tr.ts),
              )}`}
              accessibilityLabel={t('debugger.timeline.tickAria', '{{from}} to {{to}}', {
                from: tr.from_state,
                to: tr.to_state,
              })}
              accessibilityRole="button"
              accessibilityState={{selected: isSelected}}
              hitSlop={8}
              key={tr.id}
              onPress={() => onSelect?.(tr)}
              style={[
                styles.tick,
                isSelected ? styles.tickSelected : styles.tickDefault,
                {
                  backgroundColor: dotColor,
                  height: size,
                  left: `${leftPct}%` as DimensionValue,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                  width: size,
                },
              ]}
              testID={`state-timeline-tick-${tr.id}`}
            />
          );
        })}
      </View>
    </View>
  );
}

function TimelineButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.buttonPressed,
      ]}
      testID={testID}>
      <AppText
        style={variant === 'primary' ? styles.primaryButtonText : styles.ghostButtonText}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    paddingHorizontal: 16,
    paddingVertical: spacing.md,
  },
  emptyBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    paddingHorizontal: 16,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  emptyTextWrap: {
    flexShrink: 1,
  },
  emptyText: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  lastSeen: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  button: {
    minHeight: 32,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  primaryButtonText: {
    fontSize: typography.caption,
    color: colors.background,
  },
  ghostButtonText: {
    fontSize: typography.caption,
    color: colors.textPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  axisLabel: {
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  track: {
    position: 'relative',
    height: 40,
  },
  axisLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    marginTop: -0.5,
    backgroundColor: colors.border,
  },
  tick: {
    position: 'absolute',
    top: '50%',
    borderRadius: 999,
  },
  tickDefault: {
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tickSelected: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
});
