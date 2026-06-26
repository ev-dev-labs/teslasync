// SafetyFeaturesWidget — native parity port of
// web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx.
//
// The dashboard "Safety Features" widget. It resolves a vehicle from the
// explicit `vehicleId` prop, falling back to the first vehicle (`useVehicles`),
// then reads that vehicle's latest safety snapshot (`GET /safety/latest?
// vehicle_id=` via useSafety) — passing `vid > 0 ? String(vid) : ''` exactly
// like the web source so the query stays disabled until a vehicle is known. It
// builds eight StatusCell entries (FCW / AEB / LDA / ELDA / Blind-Spot-Camera /
// Blind-Spot-Collision-Warning / Speed-Limit-Warning / Cruise-Follow-Distance)
// from the snapshot, then renders one of three branches, preserved verbatim from
// the web source:
//   1. data && isCompact (cols <= 1) -> a centered big number (count of cells
//      whose status === 'ok') over an "Active Features" caption.
//   2. data && !isCompact -> a WidgetStatusGrid of the eight cells, 4 cols when
//      the widget is >= 3 cols wide else 2.
//   3. no data -> an EmptyState (ShieldAlert glyph + "No safety data").
// Every state name (vehicles, vid, data, isLoading, error, isFetching, isStale,
// isError, dataUpdatedAt, refetch, isCompact, cells, activeCount), the
// /safety/latest API path, the safety-enum / boolean normalization, the i18n key
// + English fallback for every label/value, and each render branch is preserved;
// all 166 source lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react useMemo (web L1) -> react useMemo (unchanged); the cells memo keeps
//     the identical [data, t] dependency array.
//   - react-i18next useTranslation('dashboard') (web L2) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN); the same `t` is
//     handed to the module-level buildCells, whose
//     (key, defaultValue) => string contract is preserved.
//   - lucide-react ShieldAlert (web L3) -> the native SemanticIcon 'securityAlert'
//     glyph via getSemanticIconDefinition (lucide is browser-only); the title
//     glyph is tinted with the success token (web text-neon-green) and the
//     empty-state glyph with the muted token.
//   - @/components/feedback EmptyState (web L4) -> an inline native EmptyState
//     (icon chip + muted centered message); the feedback barrel is a DOM tree
//     and is not in the native parity manifest.
//   - @/api/hooks useSafety/useVehicles (web L5-6) -> imported from their
//     canonical converted native hooks (../../../api/hooks/useVehicleSystems and
//     ../../../api/hooks/useVehicles) — same query keys, same /safety/latest +
//     /vehicles paths, same SafetySnapshot fields.
//   - @/lib/numberFormat fmtInt (web L7) -> ported inline native-safe. The web
//     fmtInt -> fmtNumber(v, 0) -> Number.toLocaleString depends on a global
//     precision/locale set by useSettings plus a full Intl runtime, neither of
//     which exists in the parity tree; the inline port reproduces the
//     round-then-group integer output (e.g. 12345.6 -> "12,346") for the default
//     en-US grouping and returns "0" for nullish/NaN, matching safeNumber.
//   - @/lib/safetyEnum cleanSafetyEnum/isSafetyEnumActive/SafetyEnumField
//     (web L8) -> ported inline VERBATIM (the SAFETY_ENUM_PREFIXES table, the
//     boolean->On/Off + finite-number + prefix-strip cleanEnum, and the
//     off/none/disabled/0 isActive classifier), together with the
//     asNonEmptyString/asFiniteNumber type guards they depend on. These libs are
//     not yet in the native manifest.
//   - ./WidgetShell (web L9) + ./shared WidgetStatusGrid + StatusCell (web
//     L10-11) + ./types WidgetProps (web L12) -> reproduced self-contained here,
//     per the DoorWindowStatusWidget inline-reproduction precedent (their own
//     manifest entries pending). WidgetShell's browser-only DataFreshness /
//     PinButton / HelpTooltip / Skeleton / QueryError chrome becomes a
//     native-safe freshness pill (relative "updated" time + a refresh Pressable
//     wired to onRefresh, with stale/error/fetching markers), a dimmed skeleton
//     box, and a centered error message; the title-aware header matches the web
//     shell's title vs. title-less branches.
//   - @/types/vehicle-systems SafetySnapshot (web L13) -> the identical
//     SafetySnapshot type re-used from the converted native useVehicleSystems
//     hook (its canonical native home), so buildCells stays type-checked.
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
import {useSafety, type SafetySnapshot} from '../../../api/hooks/useVehicleSystems';
import {useVehicles} from '../../../api/hooks/useVehicles';

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

// ── Ported type guards (web @/lib/typeGuards) ─────────────────────────────────

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Returns `v` when it is a finite number; `null` otherwise. */
function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ── Ported number format (web @/lib/numberFormat fmtInt) ─────────────────────

/** Native-safe integer format with en-US thousands grouping:
 *  fmtInt(12345.6) -> "12,346", fmtInt(null) -> "0". */
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── Ported safety-enum helpers (web @/lib/safetyEnum) ─────────────────────────

/** Tesla raw enum prefixes that need stripping for old signal_log rows. */
const SAFETY_ENUM_PREFIXES = {
  forward_collision_warning: 'ForwardCollisionSensitivity',
  lane_departure_avoidance: 'LaneAssistLevel',
  speed_limit_warning: 'SpeedAssistLevel',
  cruise_follow_distance: 'FollowDistance',
} as const;

type SafetyEnumField = keyof typeof SAFETY_ENUM_PREFIXES;

/** Convert a raw safety-enum value into a human-renderable, prefix-stripped
 *  string. Accepts `unknown`. Returns `fallback` for null/undefined/empty.
 *  Booleans render as "On" / "Off". Numbers render as their decimal form. */
function cleanSafetyEnum(value: unknown, field: SafetyEnumField, fallback = '—'): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';

  const num = asFiniteNumber(value);
  if (num !== null) return String(num);

  const raw = asNonEmptyString(value);
  if (!raw) return fallback;

  const prefix = SAFETY_ENUM_PREFIXES[field];
  if (prefix && raw.startsWith(prefix)) {
    const stripped = raw.slice(prefix.length);
    if (field === 'speed_limit_warning' && stripped === 'None') return 'Off';
    return stripped || raw;
  }
  return raw;
}

/** Whether a safety-enum value represents an ENABLED feature. */
function isSafetyEnumActive(value: unknown, field: SafetyEnumField): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  const cleaned = cleanSafetyEnum(value, field, '');
  if (cleaned === '') return false;
  const lower = cleaned.toLowerCase();
  if (lower === 'off' || lower === 'none' || lower === 'disabled' || lower === '0') return false;
  return true;
}

// ── Domain logic (web L15-104) — pure, native-safe ────────────────────────────

function boolStatus(val: boolean | null | undefined): StatusCell['status'] {
  if (val == null) return 'unknown';
  return val ? 'ok' : 'inactive';
}

function invertedBoolStatus(val: boolean | null | undefined): StatusCell['status'] {
  if (val == null) return 'unknown';
  // Field is "off" flag — true means feature is disabled
  return val ? 'inactive' : 'ok';
}

/** Maps a safety enum value to a StatusCell.status.
 *  Accepts unknown so a stray boolean/number from the backend never
 *  crashes .toLowerCase(). See lib/safetyEnum.ts for the contract. */
function safetyEnumStatus(val: unknown, field: SafetyEnumField): StatusCell['status'] {
  if (val == null) return 'unknown';
  return isSafetyEnumActive(val, field) ? 'ok' : 'inactive';
}

function buildCells(data: SafetySnapshot, t: NativeTFunction): StatusCell[] {
  return [
    {
      id: 'fcw',
      label: t('widget.safety.fcw', 'Forward Collision Warning'),
      status: safetyEnumStatus(data.forward_collision_warning, 'forward_collision_warning'),
      value: cleanSafetyEnum(data.forward_collision_warning, 'forward_collision_warning'),
    },
    {
      id: 'aeb',
      label: t('widget.safety.aeb', 'Auto Emergency Braking'),
      status: invertedBoolStatus(data.automatic_emergency_braking_off),
      value:
        data.automatic_emergency_braking_off == null
          ? '—'
          : data.automatic_emergency_braking_off
            ? t('widget.safety.disabled', 'Disabled')
            : t('widget.safety.enabled', 'Enabled'),
    },
    {
      id: 'lda',
      label: t('widget.safety.lda', 'Lane Departure Avoidance'),
      status: safetyEnumStatus(data.lane_departure_avoidance, 'lane_departure_avoidance'),
      value: cleanSafetyEnum(data.lane_departure_avoidance, 'lane_departure_avoidance'),
    },
    {
      id: 'elda',
      label: t('widget.safety.elda', 'Emergency Lane Departure'),
      status: boolStatus(data.emergency_lane_departure_avoidance),
      value:
        data.emergency_lane_departure_avoidance == null
          ? '—'
          : data.emergency_lane_departure_avoidance
            ? t('widget.safety.enabled', 'Enabled')
            : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bsc',
      label: t('widget.safety.bsc', 'Blind Spot Camera'),
      status: boolStatus(data.automatic_blind_spot_camera),
      value:
        data.automatic_blind_spot_camera == null
          ? '—'
          : data.automatic_blind_spot_camera
            ? t('widget.safety.enabled', 'Enabled')
            : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'bscw',
      label: t('widget.safety.bscw', 'Blind Spot Collision Warning'),
      status: boolStatus(data.blind_spot_collision_warning),
      value:
        data.blind_spot_collision_warning == null
          ? '—'
          : data.blind_spot_collision_warning
            ? t('widget.safety.enabled', 'Enabled')
            : t('widget.safety.disabled', 'Disabled'),
    },
    {
      id: 'slw',
      label: t('widget.safety.slw', 'Speed Limit Warning'),
      status: safetyEnumStatus(data.speed_limit_warning, 'speed_limit_warning'),
      value: cleanSafetyEnum(data.speed_limit_warning, 'speed_limit_warning'),
    },
    {
      id: 'cfd',
      label: t('widget.safety.cfd', 'Cruise Follow Distance'),
      status: safetyEnumStatus(data.cruise_follow_distance, 'cruise_follow_distance'),
      value: cleanSafetyEnum(data.cruise_follow_distance, 'cruise_follow_distance'),
    },
  ];
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
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
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

export default function SafetyFeaturesWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSafety(vid > 0 ? String(vid) : '');

  const isCompact = size.cols <= 1;

  const cells = useMemo<StatusCell[]>(
    () => (data ? buildCells(data, t) : []),
    [data, t],
  );

  const activeCount = cells.filter(c => c.status === 'ok').length;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.safety.title', 'Safety Features')}
      icon={glyphNode('securityAlert', colors.success, styles.titleGlyph)}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {data ? (
        isCompact ? (
          <View style={styles.compactContainer}>
            <AppText style={styles.compactNumber} weight="bold">
              {fmtInt(activeCount)}
            </AppText>
            <AppText style={styles.compactLabel}>
              {t('widget.safety.activeFeatures', 'Active Features')}
            </AppText>
          </View>
        ) : (
          <WidgetStatusGrid
            cells={cells}
            cols={size.cols >= 3 ? 4 : 2}
            compact={false}
            emptyIcon={glyphNode('securityAlert', colors.textMuted, styles.emptyGlyph)}
            emptyMessage={t('widget.safety.noData', 'No safety data')}
          />
        )
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('securityAlert', colors.textMuted, styles.emptyGlyph)}
          message={t('widget.safety.noData', 'No safety data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
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
  compactLabel: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  compactNumber: {
    color: colors.success,
    fontSize: 30,
    lineHeight: 36,
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
