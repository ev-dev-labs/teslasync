// Native parity port of web/src/features/automations/pages/AutomationActivityFeed.tsx.
//
// Presentational "Recent Activity" panel for automations: a header (Activity
// glyph + title + live/reconnecting connection indicator + optional run-stats),
// an optional live-SSE event list (first 5 of liveEvents) and the execution
// history list (skeletons while loading, rows when present, empty state when
// not). Every behaviour from the web component is preserved one-for-one:
//   - The exported component keeps the same props contract and names:
//     AutomationActivityFeedProps { history, historyStats, isLoading,
//     liveEvents, connectionState } and the same destructure.
//   - The same derivations: recentLive = useMemo(() => liveEvents.slice(0, 5),
//     [liveEvents]) and items = history.
//   - The HistoryRow status lookup (statusConfig[item.status] ?? .running),
//     the LiveEventRow typeMap lookup (?? 'automation.triggered'), and the
//     LiveEventRow name/error/reason field probing
//     ('name'/'error'/'reason' in event.data) are reproduced verbatim.
//   - The timeAgo() relative-time helper and the formatDurationMs() /
//     fmtPercent() formatters are ported byte-for-byte from web @/lib/dateFormat
//     + @/lib/numberFormat (incl. isFiniteNumber / safeNumber / fmtNumber and
//     the '—' FALLBACK), so 'just now'/'Nm ago'/'Nh ago'/'Nd ago',
//     'Nms'/'N.Ns' durations and 'N% success' percentages render identically.
//   - The five render branches (header stats only when total_executions > 0,
//     live list only when recentLive.length > 0, then isLoading -> 5 skeletons
//     / items.length > 0 -> rows / else -> empty state) keep the same order
//     and the same conditions.
//   - Every i18n key keeps its English default string (intent preserved):
//     automations.recentActivity/live/reconnecting/totalRuns/successRate/
//     avgDuration/noHistory.
//   - No physical units appear on this page (counts, percentages and ms
//     durations only), so there is no SI/display unit conversion to perform.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim reproducing i18next {{name}}
//     interpolation against the English fallback copy (no interpolation is used
//     by this page, but the shim signature is kept for parity).
//   - @/lib/cn cn(): dropped — RN composes styles via arrays, not class merges.
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/ui Badge (variant="neutral") -> inline native Badge: a
//     rounded surfaceRaised/border chip with a caption label.
//   - @/components/feedback Skeleton (h-10 rounded-lg) -> inline placeholder
//     bars (surfaceRaised, rounded, fixed height).
//   - @/components/feedback EmptyState (icon + message, no title) -> inline
//     native EmptyState pairing the shared SemanticIcon 'activity' with the
//     message, matching the web icon+message shape.
//   - @/components/motion FadeIn (framer-motion, delay in seconds, honours
//     reduced-motion) -> inline Animated.View opacity 0->1 mount fade with the
//     same delay*1000 ms offset (reduced-motion preference is not observable on
//     bare RN, so the entry fade always plays; it is purely decorative).
//   - lucide-react CheckCircle/XCircle/SkipForward/Activity/Clock/Wifi/WifiOff/
//     Zap -> small colour-coded text glyphs (Glyph) for the inline 16px row
//     icons, the shared SemanticIcon 'activity' chip for the 32px empty-state
//     icon, and a small colour dot for the Wifi/WifiOff connection indicator
//     (the standard mobile "live"/"reconnecting" affordance). The web
//     animate-pulse on the live-event icon and the reconnecting indicator is
//     reproduced with an Animated opacity loop (Pulse).
//   - @/api/types AutomationHistory/AutomationHistoryStats and the automation
//     SSE event types -> imported from the already-ported web-parity
//     ../../../api/types. @/hooks/useAutomationEvents AutomationActivityEvent
//     (the hook itself is not ported) -> its type is reproduced locally over
//     those same SSE event unions, so the prop shape is byte-identical.
//
// Tailwind status colours (text-green-400/amber-400/red-400/purple-400/
// blue-400/red-400-80) are preserved verbatim as hex literals so the
// success/partial/failed/skipped/test/undo/running palette keeps its meaning;
// text-neon-cyan maps to the native accent token; --text-primary/-secondary/
// -muted map to colors.textPrimary/textSecondary/textMuted. No DOM-only
// modules, HTML elements, react-i18next, lucide-react, Recharts, Leaflet, or
// old web UI components are imported — only react, react-native primitives, the
// ported web-parity api types, and the existing apps/native SemanticIcon /
// AppText / GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {Animated, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import type {
  AutomationFailedEvent,
  AutomationHistory,
  AutomationHistoryStats,
  AutomationSkippedEvent,
  AutomationSSEEventType,
  AutomationStateChangedEvent,
  AutomationSucceededEvent,
  AutomationTriggeredEvent,
} from '../../../api/types';

/* ── Local analogue of web @/hooks/useAutomationEvents AutomationActivityEvent ── */

/** A single automation SSE event with its type and receive timestamp. */
export interface AutomationActivityEvent {
  id: string;
  type: AutomationSSEEventType;
  data:
    | AutomationTriggeredEvent
    | AutomationSucceededEvent
    | AutomationFailedEvent
    | AutomationSkippedEvent
    | AutomationStateChangedEvent;
  receivedAt: Date;
}

/* ── i18n shim (react-i18next useTranslation) ──────────── */

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ── Formatters (web @/lib/dateFormat + @/lib/numberFormat) ── */

const FALLBACK = '—';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale?: string): string {
  const d = decimals ?? 2;
  const lc = locale ?? 'en-US';
  try {
    return safeNumber(v).toLocaleString(lc, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return FALLBACK;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── Status / event visual config (lucide-react -> glyph + colour) ── */

// Tailwind status colours from the web component, preserved verbatim.
const STATUS_GREEN = '#4ade80'; // text-green-400
const STATUS_AMBER = '#fbbf24'; // text-amber-400
const STATUS_RED = '#f87171'; // text-red-400
const STATUS_PURPLE = '#c084fc'; // text-purple-400
const STATUS_BLUE = '#60a5fa'; // text-blue-400
const STATUS_RED_SOFT = 'rgba(248, 113, 133, 0.8)'; // text-red-400/80

interface StatusVisual {
  glyph: string;
  color: string;
  label: string;
}

const statusConfig: Record<string, StatusVisual> = {
  success: {glyph: 'OK', color: STATUS_GREEN, label: 'Succeeded'},
  partial: {glyph: 'OK', color: STATUS_AMBER, label: 'Partial'},
  failed: {glyph: 'X', color: STATUS_RED, label: 'Failed'},
  skipped: {glyph: '»', color: colors.textMuted, label: 'Skipped'},
  test: {glyph: 'ZP', color: colors.accent, label: 'Test'},
  undo: {glyph: 'CK', color: STATUS_PURPLE, label: 'Undo'},
  running: {glyph: 'AC', color: STATUS_BLUE, label: 'Running'},
  cancelled: {glyph: 'X', color: colors.textMuted, label: 'Cancelled'},
};

const liveTypeConfig: Record<string, {glyph: string; color: string}> = {
  'automation.triggered': {glyph: 'ZP', color: colors.accent},
  'automation.succeeded': {glyph: 'OK', color: STATUS_GREEN},
  'automation.failed': {glyph: 'X', color: STATUS_RED},
  'automation.skipped': {glyph: '»', color: colors.textMuted},
  'automation.state_changed': {glyph: 'AC', color: STATUS_PURPLE},
};

/* ── FadeIn (web @/components/motion FadeIn) ──────────── */

function FadeIn({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 400,
      delay: Math.round(delay * 1000),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ── Pulse (web Tailwind animate-pulse) ──────────────── */

function Pulse({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ── Glyph (lucide inline 16px icon) ─────────────────── */

function Glyph({
  text,
  color,
  pulse,
}: {
  text: string;
  color: string;
  pulse?: boolean;
}) {
  const node = (
    <AppText style={[styles.glyph, {color}]} variant="caption" weight="bold">
      {text}
    </AppText>
  );
  return pulse ? <Pulse>{node}</Pulse> : node;
}

/* ── Badge (web @/components/ui Badge, neutral) ──────── */

function Badge({label}: {label: string}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

/* ── History item ────────────────────────────────────── */

function HistoryRow({item}: {item: AutomationHistory}) {
  const cfg = statusConfig[item.status] ?? statusConfig.running;

  return (
    <View style={styles.row}>
      <Glyph color={cfg.color} text={cfg.glyph} />
      <View style={styles.rowMain}>
        <AppText numberOfLines={1} style={styles.rowName} weight="semibold">
          {item.automation_name}
        </AppText>
        {item.error ? (
          <AppText numberOfLines={1} style={styles.rowError} variant="caption">
            — {item.error}
          </AppText>
        ) : null}
      </View>
      <AppText style={styles.meta} tone="muted" variant="caption">
        {timeAgo(item.triggered_at)}
      </AppText>
      <AppText style={styles.meta} tone="muted" variant="caption">
        {formatDurationMs(item.duration_ms)}
      </AppText>
      {item.actions_total > 0 ? (
        <AppText style={styles.meta} tone="muted" variant="caption">
          {item.actions_succeeded}/{item.actions_total}
        </AppText>
      ) : null}
    </View>
  );
}

/* ── Live SSE event row ──────────────────────────────── */

function LiveEventRow({event}: {event: AutomationActivityEvent}) {
  const cfg = liveTypeConfig[event.type] ?? liveTypeConfig['automation.triggered'];
  const data = event.data;
  const name =
    'name' in data
      ? (data as {name: string}).name
      : `#${(data as {automation_id: number}).automation_id}`;
  const error = 'error' in data ? (data as {error?: string}).error : undefined;
  const reason =
    'reason' in data ? (data as {reason?: string}).reason : undefined;

  return (
    <View style={styles.liveRow}>
      <Glyph color={cfg.color} pulse text={cfg.glyph} />
      <View style={styles.rowMain}>
        <AppText numberOfLines={1} style={styles.rowName} weight="semibold">
          {name}
        </AppText>
        {error ? (
          <AppText numberOfLines={1} style={styles.rowError} variant="caption">
            — {error}
          </AppText>
        ) : null}
        {reason ? (
          <AppText
            numberOfLines={1}
            style={styles.rowReason}
            tone="muted"
            variant="caption">
            — {reason}
          </AppText>
        ) : null}
      </View>
      <Badge label={event.type.replace('automation.', '')} />
    </View>
  );
}

/* ── Empty state (web @/components/feedback EmptyState) ── */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.empty}>
      <SemanticIcon decorative name="activity" size="lg" />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Main component ──────────────────────────────────── */

export interface AutomationActivityFeedProps {
  history: AutomationHistory[];
  historyStats: AutomationHistoryStats | null;
  isLoading: boolean;
  liveEvents: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
}

export function AutomationActivityFeed({
  history,
  historyStats,
  isLoading,
  liveEvents,
  connectionState,
}: AutomationActivityFeedProps) {
  const t = useNativeTranslation();

  const recentLive = useMemo(() => liveEvents.slice(0, 5), [liveEvents]);
  const items = history;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel style={styles.panel}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Glyph color={colors.textSecondary} text="AC" />
            <AppText style={styles.title} weight="semibold">
              {t('automations.recentActivity', 'Recent Activity')}
            </AppText>
            {connectionState === 'connected' ? (
              <View style={styles.connRow}>
                <View style={styles.connDotLive} />
                <AppText
                  style={styles.connLive}
                  variant="caption"
                  weight="semibold">
                  {t('automations.live', 'Live')}
                </AppText>
              </View>
            ) : connectionState === 'reconnecting' ? (
              <Pulse>
                <View style={styles.connRow}>
                  <View style={styles.connDotReconnecting} />
                  <AppText
                    style={styles.connReconnecting}
                    variant="caption"
                    weight="semibold">
                    {t('automations.reconnecting', 'Reconnecting')}
                  </AppText>
                </View>
              </Pulse>
            ) : null}
          </View>
          {historyStats && historyStats.total_executions > 0 ? (
            <View style={styles.statsRow}>
              <AppText tone="secondary" variant="caption">
                {historyStats.total_executions} {t('automations.totalRuns', 'total')}
              </AppText>
              <AppText style={styles.statSuccess} variant="caption">
                {fmtPercent(historyStats.success_rate, 0)}{' '}
                {t('automations.successRate', 'success')}
              </AppText>
              <AppText tone="secondary" variant="caption">
                {formatDurationMs(historyStats.avg_duration_ms)}{' '}
                {t('automations.avgDuration', 'avg')}
              </AppText>
            </View>
          ) : null}
        </View>

        {/* Live events (SSE) */}
        {recentLive.length > 0 ? (
          <View style={styles.liveList}>
            {recentLive.map(evt => (
              <LiveEventRow key={evt.id} event={evt} />
            ))}
          </View>
        ) : null}

        {/* History items */}
        {isLoading ? (
          <View style={styles.historyLoading}>
            {Array.from({length: 5}).map((_, i) => (
              <View key={`skel-${i}`} style={styles.skeleton} />
            ))}
          </View>
        ) : items.length > 0 ? (
          <View style={styles.historyList}>
            {items.map(item => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </View>
        ) : (
          /* no-action: transient empty state — surfaces when source data is
             missing; no specific recovery action available */
          <EmptyState message={t('automations.noHistory', 'No execution history yet')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    textTransform: 'lowercase',
  },
  connDotLive: {
    backgroundColor: STATUS_GREEN,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  connDotReconnecting: {
    backgroundColor: STATUS_AMBER,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  connLive: {
    color: STATUS_GREEN,
  },
  connReconnecting: {
    color: STATUS_AMBER,
  },
  connRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  empty: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  glyph: {
    flexShrink: 0,
    minWidth: 18,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  historyList: {
    gap: 2,
  },
  historyLoading: {
    gap: 8,
  },
  liveList: {
    gap: 4,
    marginBottom: 12,
  },
  liveRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(53, 213, 255, 0.03)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  meta: {
    flexShrink: 0,
  },
  panel: {
    padding: 24,
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowError: {
    color: STATUS_RED_SOFT,
    flexShrink: 1,
  },
  rowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
  rowName: {
    flexShrink: 1,
  },
  rowReason: {
    flexShrink: 1,
  },
  statSuccess: {
    color: STATUS_GREEN,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 40,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
});
