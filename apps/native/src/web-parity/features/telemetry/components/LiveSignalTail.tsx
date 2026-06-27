// Native parity port of
// web/src/features/telemetry/components/LiveSignalTail.tsx.
//
// LiveSignalTail — scrolling table of incoming SSE signal events. Pure-render
// component: the underlying state (entries, paused, rate) is owned by the
// caller's useLiveSignalStream hook so the tail can be dropped anywhere
// (LiveSignalMonitorPage full-page tail / SignalsWorkspacePage live tail)
// without coupling the SSE subscription to the panel. Every behaviour, state
// name (autoScroll, filter), derived value (filtered, uniqueSignals, columns),
// the 5-column layout, the 4 stat cards, the pause/auto-scroll/clear controls,
// and the waiting/no-match empty copy are preserved one-for-one.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented here + in
// the sidecar:
//
//   - react-i18next useTranslation (web L12) -> inlined useNativeTranslation():
//     a stable (key, fallback?, options?) shim returning the English fallback
//     (preserving i18n intent without the web i18n runtime).
//   - lucide-react Activity/ArrowDown/ArrowUpDown/Pause/Play/Radio/Trash2
//     (web L13) -> shared SemanticIcon glyphs (activity / arrowDown /
//     arrowUpDown / pause / play / radio / delete); lucide SVG has no native
//     renderer. The red `animate-pulse` Radio (web L122) becomes a pulsing red
//     "live" dot (Animated opacity 1<->0.5, the Tailwind pulse range) — the
//     same approach the SignalSparklinePreview port uses.
//   - @/components/ui GlassPanel (web L15) -> the shared native GlassPanel.
//     Badge -> inline tone pill (info/warning/success), Button -> inline
//     ActionButton (icon + label + secondary/danger tone + active highlight),
//     Input -> native TextInput, DataTable + `Column<T>` -> a static native
//     table (header + rows keyed by `id`) carrying the web
//     `pagination={{ defaultPageSize: 50 }}` paging and `tableId` (-> testID);
//     the web DataTable's sort/resize/column-menu/virtualization have no
//     analogue in this static table.
//   - @/components/data-display StatCard / FreshnessIndicator (web L16) -> the
//     ported native data-display siblings (same label/value/unit/icon and
//     same timestamp freshness dot+label).
//   - @/components/motion FadeIn (web L17) -> a local Animated.View mount fade
//     reproducing the framer-motion entry (opacity 0->1, translateY 12->0,
//     400ms easeOut).
//   - @/lib/dateFormat formatTime (web L18) -> an inlined native formatTime
//     mirroring the web helper (toLocaleTimeString hour/minute 2-digit, the
//     "—" fallback for null/invalid input).
//   - @/lib/cn cn (web L19) -> dropped: native has no Tailwind classNames. The
//     branch class strings become StyleSheet styles + theme tokens. The public
//     `className` prop is kept for call-site parity but is inert
//     (renamed `_className`), mirroring the sibling Sparkline port.
//   - @/types/telemetry SignalEntry (web L20) -> mirrored + re-exported locally
//     (the native types/telemetry module is not ported yet) with the identical
//     {id,timestamp,name,value,type} shape.
//   - The web `maxHeight` prop stays a string for call-site parity ('65vh'
//     default) and is resolved to a native pixel height (vh -> % of the window
//     height via Dimensions; px/number parsed directly).
//
// No DOM modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI imports remain.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {FreshnessIndicator, StatCard} from '../../../components/data-display';

/**
 * Native mirror of web/src/types/telemetry.ts `SignalEntry` (the native
 * types/telemetry module is not ported yet). Re-exported so native consumers
 * and the eventual ported types module share the same UI-normalised shape.
 */
export interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
}

/**
 * Native-pragmatic subset of the web `@/components/ui` DataTable `Column<T>`.
 * Only the fields the tail actually consumes are carried; the web DataTable's
 * interactive column features (sortable / resizable / visibility / widths) are
 * runtime concerns with no analogue in this static native table.
 */
interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

// Mirrors web `pagination={{ defaultPageSize: 50 }}`.
const DEFAULT_PAGE_SIZE = 50;
// Mirrors web `tableId="telemetry:live-signal-tail"`.
const TABLE_ID = 'telemetry:live-signal-tail';
// Mirrors web default `maxHeight = '65vh'`.
const DEFAULT_MAX_HEIGHT = '65vh';
// FadeIn entry timing — mirrors the web framer-motion FadeIn duration.
const FADE_DURATION_MS = 400;
// Native equivalent of Tailwind `animate-pulse`: opacity loops 1 <-> 0.5.
const PULSE_MIN_OPACITY = 0.5;
const PULSE_HALF_DURATION_MS = 1000;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

// web TYPE_VALUE_COLOR (L22-26): number text-cyan-400, string text-green-400,
// boolean text-amber-400 -> the native accent / success / warning tokens.
const TYPE_VALUE_COLOR: Record<SignalEntry['type'], string> = {
  number: colors.accent,
  string: colors.success,
  boolean: colors.warning,
};

/* ── react-i18next useTranslation replacement ──────────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── @/lib/dateFormat formatTime replacement ───────────── */

function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/* ── web `maxHeight` string -> native pixel height ─────── */

function resolveMaxHeight(value: string): number {
  const windowHeight = Dimensions.get('window').height;
  const vh = /^(\d+(?:\.\d+)?)vh$/.exec(value.trim());
  if (vh) {
    return (windowHeight * Number(vh[1])) / 100;
  }
  const px = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim());
  if (px) {
    return Number(px[1]);
  }
  return (windowHeight * 65) / 100;
}

/**
 * `@/components/motion` FadeIn -> Animated.View mount fade reproducing the web
 * framer-motion entry: opacity 0->1, translateY 12->0, 400ms easeOut.
 */
function FadeIn({children}: {children: ReactNode}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

/**
 * Red pulsing "live" dot — the native stand-in for the web
 * `<Radio className="text-red-500 animate-pulse" />` title affordance.
 */
function LiveDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: PULSE_MIN_OPACITY,
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_HALF_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.liveDot, {opacity}]}
    />
  );
}

/* ── web @/components/ui Badge (type column) ───────────── */

type BadgeTone = 'info' | 'warning' | 'success';

function TypeBadge({type}: {type: SignalEntry['type']}) {
  const tone: BadgeTone =
    type === 'number' ? 'info' : type === 'boolean' ? 'warning' : 'success';
  return (
    <View style={[styles.badge, badgeSurface[tone]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[tone]]}
        variant="caption"
        weight="semibold">
        {type}
      </AppText>
    </View>
  );
}

/* ── web @/components/ui Button (header controls) ──────── */

interface ActionButtonProps {
  label: string;
  iconName: SemanticIconName;
  onPress: () => void;
  tone?: 'secondary' | 'danger';
  active?: boolean;
}

function ActionButton({
  label,
  iconName,
  onPress,
  tone = 'secondary',
  active = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        tone === 'danger' ? styles.actionDanger : styles.actionSecondary,
        active && styles.actionActive,
        pressed && styles.pressed,
      ]}>
      <SemanticIcon decorative name={iconName} size="sm" style={styles.actionIcon} />
      <AppText
        style={[
          styles.actionLabel,
          tone === 'danger' ? styles.actionDangerLabel : null,
          active ? styles.actionActiveLabel : null,
        ]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── web @/components/ui DataTable (the scrolling tail) ── */

interface SignalTableProps {
  columns: Column<SignalEntry>[];
  rows: SignalEntry[];
  emptyMessage: string;
}

function SignalTable({columns, rows, emptyMessage}: SignalTableProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * DEFAULT_PAGE_SIZE;
  const visibleRows = rows.slice(start, start + DEFAULT_PAGE_SIZE);

  if (rows.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <AppText style={styles.emptyText} tone="muted">
          {emptyMessage}
        </AppText>
      </View>
    );
  }

  return (
    <View accessibilityRole="summary" testID={TABLE_ID}>
      <View style={[styles.tableRow, styles.headerTableRow]}>
        {columns.map(column => (
          <View key={column.key} style={styles.cell}>
            <AppText
              style={styles.headerCellText}
              tone="muted"
              variant="caption"
              weight="semibold">
              {column.header}
            </AppText>
          </View>
        ))}
      </View>
      {visibleRows.map(row => (
        <View key={String(row.id)} style={[styles.tableRow, styles.bodyRow]}>
          {columns.map(column => (
            <View key={column.key} style={styles.cell}>
              {column.render(row)}
            </View>
          ))}
        </View>
      ))}
      {pageCount > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel="Previous page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage === 0}}
            disabled={currentPage === 0}
            hitSlop={8}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage === 0 && styles.disabled,
              pressed && currentPage !== 0 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="previous" size="sm" style={styles.pagerIcon} />
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`${currentPage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityLabel="Next page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage >= pageCount - 1}}
            disabled={currentPage >= pageCount - 1}
            hitSlop={8}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage >= pageCount - 1 && styles.disabled,
              pressed && currentPage < pageCount - 1 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="next" size="sm" style={styles.pagerIcon} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export interface LiveSignalTailProps {
  entries: SignalEntry[];
  rate: number;
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  /** Buffer cap displayed in the "Buffer Size" stat (typically 500). */
  bufferMax: number;
  /** Show the 4 stat cards (rate, buffer, unique, filtered). Default true. */
  showStats?: boolean;
  /** Override panel title. */
  title?: string;
  /** Slot rendered next to the title — e.g. connection badge. */
  headerExtra?: ReactNode;
  /** Max-height for the scrolling table. Default '65vh' (resolved to px). */
  maxHeight?: string;
  /** Inert in native (no Tailwind classNames); kept for call-site parity. */
  className?: string;
}

export function LiveSignalTail({
  entries,
  rate,
  paused,
  onPauseToggle,
  onClear,
  bufferMax,
  showStats = true,
  title,
  headerExtra,
  maxHeight = DEFAULT_MAX_HEIGHT,
  className: _className,
}: LiveSignalTailProps) {
  const t = useNativeTranslation();
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const filtered = useMemo(
    () =>
      filter
        ? entries.filter(e =>
            e.name.toLowerCase().includes(filter.toLowerCase()),
          )
        : entries,
    [entries, filter],
  );

  useEffect(() => {
    if (autoScroll) {
      scrollRef.current?.scrollTo({y: 0, animated: false});
    }
  }, [entries, autoScroll]);

  const columns: Column<SignalEntry>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('liveMonitor.time', 'Time'),
        render: entry => (
          <AppText numberOfLines={1} style={styles.cellTime}>
            {formatTime(entry.timestamp)}
          </AppText>
        ),
      },
      {
        key: 'signal',
        header: t('liveMonitor.signal', 'Signal'),
        render: entry => (
          <AppText numberOfLines={1} style={styles.cellSignal}>
            {entry.name}
          </AppText>
        ),
      },
      {
        key: 'value',
        header: t('liveMonitor.value', 'Value'),
        render: entry => (
          <AppText
            numberOfLines={1}
            style={[styles.cellValue, {color: TYPE_VALUE_COLOR[entry.type]}]}>
            {entry.value}
          </AppText>
        ),
      },
      {
        key: 'type',
        header: t('liveMonitor.type', 'Type'),
        render: entry => <TypeBadge type={entry.type} />,
      },
      {
        key: 'freshness',
        header: t('liveMonitor.freshness', 'Freshness'),
        render: entry => (
          <FreshnessIndicator size="sm" timestamp={entry.timestamp} />
        ),
      },
    ],
    [t],
  );

  const uniqueSignals = useMemo(
    () => new Set(entries.map(e => e.name)).size,
    [entries],
  );

  const emptyMessage =
    entries.length === 0
      ? t('liveMonitor.waiting', 'Waiting for signals…')
      : t('liveMonitor.noMatch', 'No signals match filter');

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          {title ? (
            <View style={styles.titleGroup}>
              <LiveDot />
              <AppText style={styles.sectionTitle} weight="semibold">
                {title}
              </AppText>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel={t('liveMonitor.filterLabel', 'Filter signals')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setFilter}
            placeholder={t(
              'liveMonitor.filterPlaceholder',
              'Filter by signal name...',
            )}
            placeholderTextColor={colors.textMuted}
            style={styles.filterInput}
            value={filter}
          />
          <View style={styles.controls}>
            {headerExtra}
            <ActionButton
              iconName={paused ? 'play' : 'pause'}
              label={
                paused
                  ? t('liveMonitor.resume', 'Resume')
                  : t('liveMonitor.pause', 'Pause')
              }
              onPress={onPauseToggle}
            />
            <ActionButton
              active={autoScroll}
              iconName="arrowDown"
              label={t('liveMonitor.autoScroll', 'Auto-scroll')}
              onPress={() => setAutoScroll(a => !a)}
            />
            <ActionButton
              iconName="delete"
              label={t('liveMonitor.clear', 'Clear')}
              onPress={onClear}
              tone="danger"
            />
          </View>
        </View>

        {showStats ? (
          <View style={styles.statGrid}>
            <StatCard
              icon={
                <SemanticIcon decorative name="activity" size="sm" style={styles.statIcon} />
              }
              label={t('liveMonitor.sigPerSec', 'Signals / sec')}
              style={styles.statCard}
              value={rate}
            />
            <StatCard
              icon={
                <SemanticIcon decorative name="arrowUpDown" size="sm" style={styles.statIcon} />
              }
              label={t('liveMonitor.bufferSize', 'Buffer Size')}
              style={styles.statCard}
              unit={`/ ${bufferMax}`}
              value={entries.length}
            />
            <StatCard
              icon={
                <SemanticIcon decorative name="activity" size="sm" style={styles.statIcon} />
              }
              label={t('liveMonitor.uniqueSignals', 'Unique Signals')}
              style={styles.statCard}
              value={uniqueSignals}
            />
            <StatCard
              icon={
                <SemanticIcon decorative name="activity" size="sm" style={styles.statIcon} />
              }
              label={t('liveMonitor.filtered', 'Filtered')}
              style={styles.statCard}
              value={filtered.length}
            />
          </View>
        ) : null}

        <ScrollView
          nestedScrollEnabled
          ref={scrollRef}
          style={[styles.tableScroll, {maxHeight: resolveMaxHeight(maxHeight)}]}>
          <SignalTable
            columns={columns}
            emptyMessage={emptyMessage}
            rows={filtered}
          />
        </ScrollView>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  liveDot: {
    backgroundColor: '#ef4444',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    letterSpacing: 0.2,
    lineHeight: 22,
  },
  filterInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  actionDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  actionActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  actionIcon: {
    borderWidth: 0,
  },
  actionLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  actionDangerLabel: {
    color: colors.danger,
  },
  actionActiveLabel: {
    color: colors.accent,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  statIcon: {
    borderWidth: 0,
  },
  tableScroll: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  headerTableRow: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cell: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  headerCellText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cellTime: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  cellSignal: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  cellValue: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pagerButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pagerIcon: {
    borderWidth: 0,
  },
  pagerLabel: {
    minWidth: 36,
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
});

const badgeSurface = StyleSheet.create<Record<BadgeTone, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeTone, TextStyle>>({
  info: {
    color: colors.accent,
  },
  warning: {
    color: colors.warning,
  },
  success: {
    color: colors.success,
  },
});
