// DoorWindowStatusWidget — native parity port of
// web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx.
//
// The dashboard "Door & Window Status" widget. It resolves a vehicle from the
// explicit `vehicleId` prop, falling back to the first vehicle (`useVehicles`),
// then reads that vehicle's latest security snapshot (`GET /security/latest?
// vehicle_id=` via useSecurityLatest, 5_000ms poll). It parses the raw
// door_state + fd/fp/rd/rp_window signal values (which the Go backend may emit
// as either a string or a native boolean) into a per-corner open/closed/partial/
// unknown map, then renders one of three branches, preserved verbatim from the
// web source:
//   1. isCompact (1x1) -> two centered status badges: "Doors ✓"/"N door(s) open"
//      and "Windows ✓"/"N window(s) open", each success when its open-count is 0
//      else warning.
//   2. otherwise, when securityData exists -> a "Doors" heading over a 2-col
//      status grid (FL/FR/RL/RR) and a "Windows" heading over a second 2-col
//      grid; section spacing widens (space-y-4) when the widget is >=2 rows tall.
//   3. no securityData -> an empty status grid (DoorOpen glyph + "No door/window
//      data").
// Every state name (vehicles, id, securityData, isLoading, error, isFetching,
// isStale, isError, dataUpdatedAt, refetch, isCompact, isTall, doors, windows,
// openDoorCount, openWindowCount, doorCells, windowCells), API path, the
// boolean-or-string signal parsing, the i18n key + English fallback for every
// label, and each render branch is preserved; all 191 source lines are mapped in
// the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react useMemo (web L1) -> react useMemo (unchanged); the four memo blocks
//     (doors, windows, doorCells, windowCells) keep identical dependency arrays.
//   - react-i18next useTranslation('dashboard') (web L2) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN); the same `t` is
//     handed to the module-level toValueLabel, whose
//     (key, fallback) => string contract is preserved.
//   - lucide-react DoorOpen (web L3) -> the native SemanticIcon 'doorOpen' glyph
//     via getSemanticIconDefinition (lucide is browser-only); the title glyph is
//     tinted with the accent token (web text-neon-cyan) and the empty-state glyph
//     with the muted token.
//   - @/components/ui Badge (web L4) -> an inline native Badge pill that maps the
//     web variant prop values (success / warning) to the success / warning
//     surface+border+text theme tokens — the ui barrel Badge is a DOM <span> and
//     is not in the native parity manifest. The web `size="sm"` is the only size
//     used, so the inline Badge bakes the sm padding/text scale.
//   - @/api/hooks useVehicles/useSecurityLatest (web L5) -> imported from their
//     canonical converted native hooks (../../../api/hooks/useVehicles) — same
//     query keys, same /vehicles + /security/latest paths, same fields.
//   - @/lib/typeGuards asNonEmptyString (web L6) -> ported inline verbatim
//     (string with length > 0 -> the string, else null), matching the
//     security-access component precedent; it preserves the "never coerce a
//     non-string to a string" invariant the parsers rely on.
//   - ./shared WidgetStatusGrid + StatusCell (web L7) -> reproduced self-contained
//     here: the shared grid primitive is not yet in the native manifest. The
//     native WidgetStatusGrid keeps the StatusCell shape, the cols/compact/
//     emptyMessage/emptyIcon props, the empty -> EmptyState fallback, and the
//     per-status surface+border+dot palette (ok->success, warning->warning,
//     error->danger, inactive/unknown->raised surface + muted dot).
//   - ./WidgetShell (web L8) + ./types WidgetProps (web L9) -> reproduced
//     self-contained here (their own later manifest entries pending), per the
//     ChargeStatusWidget inline-reproduction precedent. WidgetShell's browser-only
//     DataFreshness/PinButton/HelpTooltip/Skeleton/QueryError chrome becomes a
//     native-safe freshness pill (relative "updated" time + a refresh Pressable
//     wired to onRefresh, with stale/error/fetching markers), a dimmed skeleton
//     box, and a centered error message; the title-aware header matches the web
//     shell's title vs. title-less branches.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports reach
// the native output — only react, react-native primitives, the canonical AppText
// + GlassPanel + SemanticIcon, the parity hooks, and theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useSecurityLatest, useVehicles} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only vehicleId +
 *  size. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/** A single status cell (web `./shared` StatusCell). `icon` is part of the
 *  contract but this widget never sets it. */
interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported type guard (web @/lib/typeGuards asNonEmptyString) ─────────────────

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ── Domain logic (web L11-85) — pure, native-safe ─────────────────────────────

type DoorWindowState = 'closed' | 'open' | 'partial' | 'unknown';

function toGridStatus(state: DoorWindowState): StatusCell['status'] {
  if (state === 'closed') return 'ok';
  if (state === 'open' || state === 'partial') return 'warning';
  return 'unknown';
}

function toValueLabel(state: DoorWindowState, t: NativeTFunction): string {
  if (state === 'closed') return t('widget.doorWindow.closed', 'Closed');
  if (state === 'open') return t('widget.doorWindow.open', 'Open');
  if (state === 'partial') return t('widget.doorWindow.partial', 'Partial');
  return '—';
}

function parseWindowState(val: unknown): DoorWindowState {
  // Backend may emit window state as a native boolean.
  if (typeof val === 'boolean') return val ? 'open' : 'closed';
  const raw = asNonEmptyString(val);
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'closed') return 'closed';
  if (lower.includes('vent') || lower.includes('partial')) return 'partial';
  return 'open';
}

function parseDoorStates(doorState: unknown): Record<string, DoorWindowState> {
  const result: Record<string, DoorWindowState> = {
    fl: 'unknown',
    fr: 'unknown',
    rl: 'unknown',
    rr: 'unknown',
  };
  // Backend may emit DoorState as a native boolean.
  if (typeof doorState === 'boolean') {
    return doorState
      ? {fl: 'open', fr: 'open', rl: 'open', rr: 'open'}
      : {fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed'};
  }
  const raw = asNonEmptyString(doorState);
  if (!raw) return result;

  const parts = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const hasAllClosed = parts.some(p => p === 'all_closed' || p === 'allclosed');
  if (hasAllClosed) {
    return {fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed'};
  }

  if (parts.length > 0) {
    result.fl = 'closed';
    result.fr = 'closed';
    result.rl = 'closed';
    result.rr = 'closed';
  }

  for (const part of parts) {
    if (part.includes('driver') && part.includes('front') && part.includes('open'))
      result.fl = 'open';
    else if (part.includes('passenger') && part.includes('front') && part.includes('open'))
      result.fr = 'open';
    else if (part.includes('driver') && part.includes('rear') && part.includes('open'))
      result.rl = 'open';
    else if (part.includes('passenger') && part.includes('rear') && part.includes('open'))
      result.rr = 'open';
    else if (part.includes('front') && part.includes('left') && part.includes('open'))
      result.fl = 'open';
    else if (part.includes('front') && part.includes('right') && part.includes('open'))
      result.fr = 'open';
    else if (part.includes('rear') && part.includes('left') && part.includes('open'))
      result.rl = 'open';
    else if (part.includes('rear') && part.includes('right') && part.includes('open'))
      result.rr = 'open';
    else if (part === 'open') {
      result.fl = 'open';
      result.fr = 'open';
      result.rl = 'open';
      result.rr = 'open';
    }
  }

  return result;
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native Badge (web @/components/ui Badge, size="sm") ────────────────

type BadgeVariant = 'success' | 'warning';

function Badge({variant, children}: {variant: BadgeVariant; children: string}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetStatusGrid (web ./shared WidgetStatusGrid) ───────────

const statusCellStyles: Record<
  StatusCell['status'],
  {bg: string; border: string; dot: string}
> = {
  ok: {bg: colors.successSurface, border: colors.successBorder, dot: colors.success},
  warning: {bg: colors.warningSurface, border: colors.warningBorder, dot: colors.warning},
  error: {bg: colors.dangerSurface, border: colors.dangerBorder, dot: colors.danger},
  inactive: {bg: colors.surfaceRaised, border: colors.border, dot: colors.textMuted},
  unknown: {bg: colors.surfaceRaised, border: colors.border, dot: colors.textMuted},
};

function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage = 'No status data available',
  emptyIcon,
}: {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}) {
  if (cells.length === 0) {
    // no-action: transient empty state — surfaces when source data is missing;
    // no specific recovery action available.
    return <EmptyState message={emptyMessage} icon={emptyIcon} />;
  }

  const resolvedCols = compact ? 2 : cols;
  const colStyle =
    resolvedCols === 2
      ? styles.gridCellCol2
      : resolvedCols === 3
        ? styles.gridCellCol3
        : styles.gridCellCol4;

  return (
    <View style={styles.grid}>
      {cells.map(cell => {
        const palette = statusCellStyles[cell.status];
        return (
          <View
            key={cell.id}
            style={[
              styles.gridCell,
              colStyle,
              compact && styles.gridCellCompact,
              {backgroundColor: palette.bg, borderColor: palette.border},
            ]}>
            <View style={[styles.statusDot, {backgroundColor: palette.dot}]} />
            {cell.icon ? <View style={styles.cellIcon}>{cell.icon}</View> : null}
            <View style={styles.cellContent}>
              <AppText numberOfLines={1} style={styles.cellLabel}>
                {cell.label}
              </AppText>
              {!compact && cell.value ? (
                <AppText numberOfLines={1} style={styles.cellValue}>
                  {cell.value}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
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
}: {
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
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={[styles.shellHeader, !title && styles.shellHeaderEnd]}>
        {title ? (
          <View style={styles.shellTitleGroup}>
            {icon}
            <AppText style={styles.shellTitle}>{title}</AppText>
          </View>
        ) : null}
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function DoorWindowStatusWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: securityData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSecurityLatest(id, 5_000);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const doors = useMemo(
    () => parseDoorStates(securityData?.door_state),
    [securityData?.door_state],
  );

  const windows = useMemo<Record<string, DoorWindowState>>(
    () => ({
      fl: parseWindowState(securityData?.fd_window),
      fr: parseWindowState(securityData?.fp_window),
      rl: parseWindowState(securityData?.rd_window),
      rr: parseWindowState(securityData?.rp_window),
    }),
    [
      securityData?.fd_window,
      securityData?.fp_window,
      securityData?.rd_window,
      securityData?.rp_window,
    ],
  );

  const openDoorCount = Object.values(doors).filter(s => s === 'open').length;
  const openWindowCount = Object.values(windows).filter(
    s => s !== 'closed' && s !== 'unknown',
  ).length;

  const doorCells = useMemo<StatusCell[]>(() => {
    const positions = ['fl', 'fr', 'rl', 'rr'] as const;
    const labels: Record<string, string> = {
      fl: t('widget.doorWindow.fl', 'Front Left'),
      fr: t('widget.doorWindow.fr', 'Front Right'),
      rl: t('widget.doorWindow.rl', 'Rear Left'),
      rr: t('widget.doorWindow.rr', 'Rear Right'),
    };
    return positions.map(pos => ({
      id: `door-${pos}`,
      label: labels[pos],
      status: toGridStatus(doors[pos]),
      value: toValueLabel(doors[pos], t),
    }));
  }, [doors, t]);

  const windowCells = useMemo<StatusCell[]>(() => {
    const positions = ['fl', 'fr', 'rl', 'rr'] as const;
    const labels: Record<string, string> = {
      fl: t('widget.doorWindow.fl', 'Front Left'),
      fr: t('widget.doorWindow.fr', 'Front Right'),
      rl: t('widget.doorWindow.rl', 'Rear Left'),
      rr: t('widget.doorWindow.rr', 'Rear Right'),
    };
    return positions.map(pos => ({
      id: `window-${pos}`,
      label: labels[pos],
      status: toGridStatus(windows[pos]),
      value: toValueLabel(windows[pos], t),
    }));
  }, [windows, t]);

  return (
    <WidgetShell
      title={
        isCompact
          ? undefined
          : t('widget.doorWindow.title', 'Door & Window Status')
      }
      icon={glyphNode('doorOpen', colors.accent, styles.titleGlyph)}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {securityData ? (
        isCompact ? (
          <View style={styles.compactContainer}>
            <Badge variant={openDoorCount === 0 ? 'success' : 'warning'}>
              {openDoorCount === 0
                ? t('widget.doorWindow.doorsAllClosed', 'Doors \u2713')
                : `${openDoorCount} ${t('widget.doorWindow.doorsOpen', 'door(s) open')}`}
            </Badge>
            <Badge variant={openWindowCount === 0 ? 'success' : 'warning'}>
              {openWindowCount === 0
                ? t('widget.doorWindow.windowsAllClosed', 'Windows \u2713')
                : `${openWindowCount} ${t('widget.doorWindow.windowsOpen', 'window(s) open')}`}
            </Badge>
          </View>
        ) : (
          <View style={isTall ? styles.sectionsTall : styles.sections}>
            <View>
              <AppText style={styles.sectionHeading}>
                {t('widget.doorWindow.doors', 'Doors')}
              </AppText>
              <WidgetStatusGrid cells={doorCells} cols={2} />
            </View>
            <View>
              <AppText style={styles.sectionHeading}>
                {t('widget.doorWindow.windows', 'Windows')}
              </AppText>
              <WidgetStatusGrid cells={windowCells} cols={2} />
            </View>
          </View>
        )
      ) : (
        <WidgetStatusGrid
          cells={[]}
          emptyIcon={glyphNode('doorOpen', colors.textMuted, styles.emptyGlyph)}
          emptyMessage={t('widget.doorWindow.noData', 'No door/window data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  cellContent: {
    flex: 1,
    minWidth: 0,
  },
  cellIcon: {
    flexShrink: 0,
  },
  cellLabel: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  cellValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 1,
  },
  compactContainer: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 14,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  gridCell: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'relative',
  },
  gridCellCol2: {
    width: '48%',
  },
  gridCellCol3: {
    width: '31%',
  },
  gridCellCol4: {
    width: '23%',
  },
  gridCellCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  sectionHeading: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sections: {
    gap: 8,
  },
  sectionsTall: {
    gap: 16,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellHeaderEnd: {
    justifyContent: 'flex-end',
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 8,
    top: 8,
    width: 8,
  },
  titleGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
});

const badgeVariantStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
