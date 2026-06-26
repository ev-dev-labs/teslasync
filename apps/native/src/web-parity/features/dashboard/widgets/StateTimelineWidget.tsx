// Native parity port of web/src/features/dashboard/widgets/StateTimelineWidget.tsx.
//
// The web widget is a dashboard tile that visualises how a vehicle splits its
// time across states (driving / charging / asleep / idle / offline). It renders
// a proportional stacked bar (always), then — depending on tile size — either a
// compact legend of coloured dots + percentages or a full per-state list, and on
// wide tiles an extra 24h transition stripe. Data comes from useVehicles() plus
// useStateSummary()/useTimeline().
//
// The web deps have no native port yet (WidgetShell, ./types, @/components/ui
// Badge, @/components/feedback EmptyState, lucide-react Clock, react-i18next,
// @/lib/numberFormat), so — mirroring the sibling native ports
// (DriveScoreGaugeWidget / CostBreakdownWidget) — each is rebuilt inline with
// React Native primitives, AppText, the repo SemanticIcon glyphs and the design
// tokens. The pure stacked bar / timeline stripe (web CSS flex with width %) is
// reproduced with proportional flexGrow segments.
//
// Line-by-line coverage of the source:
//   L1   `import { useMemo }` -> useMemo (plus useCallback/useEffect/useRef/
//        useState for the inlined WidgetShell + i18n fallback).
//   L2   useTranslation('dashboard') -> useNativeTranslationFallback (the
//        'dashboard' namespace is retained as I18N_NAMESPACE; every i18n key is
//        preserved, fallbacks returned verbatim).
//   L3   lucide Clock -> repo SemanticIcon 'clock' glyph (CLOCK_GLYPH).
//   L4   @/components/ui Badge -> inlined native Badge (neutral variant).
//   L5   @/components/feedback EmptyState -> inlined native EmptyState.
//   L6   useStateSummary/useTimeline -> native api hooks (same names + paths).
//   L7   useVehicles -> native api hook (same name).
//   L8   @/lib/numberFormat fmtNumber/fmtInt -> inlined value-identical natives.
//   L9   ./WidgetShell -> inlined WidgetShell (freshness pill + pulse + error).
//   L10  ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L12-23 STATE_COLORS map + stateColor(state) (fallback #6b7280) -> ported verbatim.
//   L25-31 fmtDuration(totalMin, t) (h/m suffixes via i18n) -> ported verbatim.
//   L33-52 StateSegment interface + buildSegments(data) (sum totalMin, 0 -> [],
//        else pct/totalMin/count with ?? guards) -> ported verbatim.
//   L54-68 StackedBar({segments}) (CSS flex row, per-segment width % + colour,
//        rounded/overflow-hidden, hover title) -> native proportional flexGrow
//        segments inside a clipped pill; hover title -> accessibilityLabel.
//   L70-102 TimelineStripe({transitions,t}) (sum durationMin, 0 -> null, uppercase
//        label, per-transition width %, skip <0.5%) -> native flexGrow stripe with
//        the same skip/label logic; hover title -> accessibilityLabel.
//   L104-131 StateRow({seg,t}) (colour dot + capitalised state label + duration +
//        % Badge, min-h 44) -> native row, same i18n key/fmt + neutral Badge.
//   L133-138 default export ({vehicleId,size}); t; useVehicles(); id = vehicleId ??
//        vehicles?.[0]?.id ?? null; idStr -> ported verbatim.
//   L140-141 summary = useStateSummary(idStr); timeline = useTimeline(idStr) -> ported.
//   L143-144 isCompact = cols<=1; isWide = cols>=3 -> ported.
//   L146-158 segments useMemo(buildSegments) + transitions useMemo(map) -> ported verbatim.
//   L160 hasData = segments.length > 0 -> ported.
//   L162-167 freshness merge: updatedAt = max(dataUpdatedAt); isFetching/isStale/
//        isError/isLoading OR-merged across both queries -> ported verbatim.
//   L169-182 WidgetShell props (conditional title/icon when !isCompact, loading,
//        updatedAt, isFetching, isStale, isError, onRefresh -> both refetch) -> ported.
//   L183-219 hasData body: StackedBar always; isCompact ? legend dots (slice 0,5,
//        fmtInt %) : state list (StateRow per segment); isWide && transitions.length
//        > 0 ? TimelineStripe -> ported.
//   L220-226 : EmptyState(clock glyph, widget.stateTimeline.noData) -> ported (the
//        web no-action transient-empty-state intent is preserved in a comment).
//   L227-229 closing tags -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (AppText, SemanticIcon), tokens and native hooks.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {useStateSummary, useTimeline} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` type exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  lucide Clock -> repo SemanticIcon glyph                            */
/* ------------------------------------------------------------------ */

// web rendered <Clock /> in the header (text-cyan-400) and in the empty state.
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;

/* ------------------------------------------------------------------ */
/*  State colors (ported verbatim)                                     */
/* ------------------------------------------------------------------ */

const STATE_COLORS: Record<string, string> = {
  driving: '#22d3ee', // cyan-400
  charging: '#22c55e', // green-500
  asleep: '#a855f7', // purple-500
  idle: '#f59e0b', // amber-500
  offline: '#ef4444', // red-500
};

function stateColor(state: string): string {
  return STATE_COLORS[state.toLowerCase()] ?? '#6b7280';
}

/* ------------------------------------------------------------------ */
/*  Parity for @/lib/numberFormat fmtNumber / fmtInt                   */
/* ------------------------------------------------------------------ */

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web fmtNumber(v, decimals, locale): locale-grouped fixed-precision string,
// falling back to en-US when the locale tag is rejected by Intl.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v): fmtNumber(v, 0).
function fmtInt(value: unknown, locale = 'en-US'): string {
  return fmtNumber(value, 0, locale);
}

/* ------------------------------------------------------------------ */
/*  Duration formatter (ported verbatim)                               */
/* ------------------------------------------------------------------ */

function fmtDuration(totalMin: number, t: NativeTFunction): string {
  const hrs = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  if (hrs === 0) return `${mins}${t('widget.stateTimeline.min', 'm')}`;
  return `${hrs}${t('widget.stateTimeline.hr', 'h')} ${mins}${t(
    'widget.stateTimeline.min',
    'm',
  )}`;
}

/* ------------------------------------------------------------------ */
/*  Stacked bar data builder (ported verbatim)                         */
/* ------------------------------------------------------------------ */

interface StateSegment {
  state: string;
  pct: number;
  totalMin: number;
  count: number;
}

function buildSegments(
  data: Array<{state: string; totalMin: number; count: number}>,
): StateSegment[] {
  const totalMin = data.reduce((sum, d) => sum + (d.totalMin ?? 0), 0);
  if (totalMin === 0) return [];
  return data.map(d => ({
    state: d.state ?? '—',
    pct: ((d.totalMin ?? 0) / totalMin) * 100,
    totalMin: d.totalMin ?? 0,
    count: d.count ?? 0,
  }));
}

/* ------------------------------------------------------------------ */
/*  Freshness caption helper (inlined WidgetShell)                     */
/* ------------------------------------------------------------------ */

// The web <DataFreshness> renders a relative "updated" time when not compact.
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Clock, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                       */
/* ------------------------------------------------------------------ */

// web <Badge variant="neutral" className="text-[10px] tabular-nums">: a small
// pill with the neutral (raised surface) tone.
function Badge({children}: {children: ReactNode}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText}>{children}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Stacked bar (ported from the web pure-CSS bar)                      */
/* ------------------------------------------------------------------ */

// web StackedBar: a rounded, overflow-hidden flex row where each segment's width
// is its percentage. Native uses proportional flexGrow segments inside a clipped
// pill (the rounded container does the corner work the web first/last classes
// did). The web hover `title` has no native equivalent, so it becomes an
// accessibilityLabel carrying the same "state: pct%" text.
function StackedBar({segments}: {segments: StateSegment[]}) {
  return (
    <View style={styles.stackedBar}>
      {segments.map(seg => (
        <View
          accessibilityLabel={`${seg.state}: ${fmtNumber(seg.pct, 1)}%`}
          key={seg.state}
          style={[
            styles.stackedSegment,
            {backgroundColor: stateColor(seg.state), flexGrow: seg.pct},
          ]}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Timeline stripe (24h state transitions)                            */
/* ------------------------------------------------------------------ */

// web TimelineStripe: returns null when there is no duration; otherwise an
// uppercase "24h Timeline" label above a flex stripe whose segments are the
// per-transition durations (segments under 0.5% are skipped).
function TimelineStripe({
  transitions,
  t,
}: {
  transitions: Array<{state: string; startDate: string; durationMin: number}>;
  t: NativeTFunction;
}) {
  const totalMin = transitions.reduce(
    (sum, tr) => sum + (tr.durationMin ?? 0),
    0,
  );
  if (totalMin === 0) return null;

  return (
    <View style={styles.timelineWrap}>
      <AppText style={styles.timelineLabel} tone="muted">
        {t('widget.stateTimeline.timeline', '24h Timeline')}
      </AppText>
      <View style={styles.timelineStripe}>
        {transitions.map((tr, i) => {
          const pct = ((tr.durationMin ?? 0) / totalMin) * 100;
          if (pct < 0.5) return null;
          return (
            <View
              accessibilityLabel={`${tr.state}: ${fmtNumber(
                tr.durationMin ?? 0,
                0,
              )} min`}
              key={`${tr.state}-${i}`}
              style={[
                styles.timelineSegment,
                {backgroundColor: stateColor(tr.state ?? ''), flexGrow: pct},
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  State list row                                                     */
/* ------------------------------------------------------------------ */

function StateRow({seg, t}: {seg: StateSegment; t: NativeTFunction}) {
  return (
    <View style={styles.stateRow}>
      <View style={styles.stateRowLeft}>
        <View
          style={[styles.stateDot, {backgroundColor: stateColor(seg.state)}]}
        />
        <AppText numberOfLines={1} style={styles.stateLabel}>
          {t(`widget.stateTimeline.state.${seg.state}`, seg.state)}
        </AppText>
      </View>
      <View style={styles.stateRowRight}>
        <AppText style={styles.stateDuration} tone="secondary">
          {fmtDuration(seg.totalMin, t)}
        </AppText>
        <Badge>{`${fmtNumber(seg.pct, 1)}%`}</Badge>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>). A pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption. Consumes every freshness
// prop so the refresh-on-press behaviour is preserved.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function StateTimelineWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const summary = useStateSummary(idStr);
  const timeline = useTimeline(idStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const segments = useMemo(
    () => buildSegments(summary.data ?? []),
    [summary.data],
  );

  const transitions = useMemo(
    () =>
      (timeline.data ?? []).map(tr => ({
        state: tr.state ?? '',
        startDate: tr.startDate ?? '',
        durationMin: tr.durationMin ?? 0,
      })),
    [timeline.data],
  );

  const hasData = segments.length > 0;

  /* Freshness: merge from both queries */
  const updatedAt = Math.max(
    summary.dataUpdatedAt ?? 0,
    timeline.dataUpdatedAt ?? 0,
  );
  const isFetching = summary.isFetching || timeline.isFetching;
  const isStale = summary.isStale || timeline.isStale;
  const isError = summary.isError || timeline.isError;
  const isLoading = summary.isLoading || timeline.isLoading;

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <AppText style={styles.headerIcon} tone="accent" weight="bold">
            {CLOCK_GLYPH}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => {
        summary.refetch();
        timeline.refetch();
      }}
      title={
        isCompact ? undefined : t('widget.stateTimeline.title', 'State Timeline')
      }
      updatedAt={updatedAt}>
      {hasData ? (
        <View style={styles.body}>
          {/* Stacked bar (always shown) */}
          <StackedBar segments={segments} />

          {isCompact ? (
            /* Compact: legend dots + % */
            <View style={styles.legendRow}>
              {segments.slice(0, 5).map(seg => (
                <View key={seg.state} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {backgroundColor: stateColor(seg.state)},
                    ]}
                  />
                  <AppText
                    numberOfLines={1}
                    style={styles.legendLabel}
                    tone="secondary">
                    {t(`widget.stateTimeline.state.${seg.state}`, seg.state)}
                  </AppText>
                  <AppText style={styles.legendPct} tone="muted">
                    {`${fmtInt(seg.pct)}%`}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            /* Standard + Wide: state list */
            <View style={styles.stateList}>
              {segments.map(seg => (
                <StateRow key={seg.state} seg={seg} t={t} />
              ))}
            </View>
          )}

          {/* Wide: 24h timeline stripe */}
          {isWide && transitions.length > 0 ? (
            <TimelineStripe t={t} transitions={transitions} />
          ) : null}
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          glyph={CLOCK_GLYPH}
          message={t('widget.stateTimeline.noData', 'No state data available')}
        />
      )}
    </WidgetShell>
  );
}

StateTimelineWidget.displayName = 'StateTimelineWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const STATE_TIMELINE_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Body ---
  body: {
    flex: 1,
    gap: spacing.md,
  },

  headerIcon: {
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 14,
  },

  // --- StackedBar ---
  stackedBar: {
    flexDirection: 'row',
    height: 20,
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  stackedSegment: {
    height: '100%',
    flexBasis: 0,
  },

  // --- Compact legend ---
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'capitalize',
  },
  legendPct: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },

  // --- State list ---
  stateList: {
    gap: spacing.xs,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  stateRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.sm,
  },
  stateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stateLabel: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'capitalize',
  },
  stateRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateDuration: {
    fontSize: 12,
    lineHeight: 16,
  },

  // --- TimelineStripe ---
  timelineWrap: {
    gap: spacing.xs,
  },
  timelineLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  timelineStripe: {
    flexDirection: 'row',
    height: 16,
    width: '100%',
    borderRadius: 4,
    overflow: 'hidden',
  },
  timelineSegment: {
    height: '100%',
    flexBasis: 0,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  emptyGlyph: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- Badge ---
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 14,
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
