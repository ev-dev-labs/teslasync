import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/SecurityStatusWidget.tsx.
//
// The web widget is a dashboard tile that shows a vehicle's live security
// posture as a 2-column grid of status cells (Lock, Sentry, Doors, Windows).
// It reads the latest /security/latest snapshot via useSecurityLatest (5s poll,
// falling back to the first vehicle's id when no explicit vehicleId prop is
// given) and derives each cell's status/value/icon inside a useMemo. The cells
// render inside the shared <WidgetShell> through the shared <WidgetStatusGrid>.
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (AutomationStatusWidget, QuickStatsPage, ExportModal) — each piece is
// rebuilt with React Native primitives, AppText, the repo SemanticIcon glyphs,
// the design tokens, and the existing native vehicle hooks. The deps that have
// no native port yet (WidgetShell, ./shared WidgetStatusGrid + StatusCell,
// ./types WidgetProps, @/lib/typeGuards asNonEmptyString, react-i18next,
// lucide-react) are inlined as self-contained native-safe parity in this file.
//
// Line-by-line coverage of the source:
//   L1     `import { useMemo }` -> kept (from 'react').
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback (the i18n
//          namespace is retained as SECURITY_STATUS_WIDGET_I18N_NAMESPACE).
//   L3     lucide Lock/Unlock/Shield/ShieldCheck/DoorOpen/AppWindow -> repo
//          SemanticIcon glyph stand-ins resolved once (locked/unlocked/security/
//          securityCheck/doorOpen and monitor as the nearest window/pane glyph,
//          since the icon set has no dedicated window glyph).
//   L4     useVehicles + useSecurityLatest -> native ../../../api/hooks/useVehicles.
//   L5     asNonEmptyString -> inlined verbatim from @/lib/typeGuards.
//   L6     WidgetStatusGrid + StatusCell type -> inlined native parity.
//   L7     WidgetShell -> inlined native parity.
//   L8     WidgetProps type -> mirrored field-for-field.
//   L10    default export SecurityStatusWidget({ vehicleId }: WidgetProps).
//   L11    const { t } = useTranslation('dashboard') -> useNativeTranslationFallback().
//   L12    const { data: vehicles } = useVehicles().
//   L13    const id = vehicleId ?? vehicles?.[0]?.id ?? 0 -> ported verbatim.
//   L14    useSecurityLatest(id, 5_000) destructure (securityData/isLoading/
//          isFetching/isStale/isError/dataUpdatedAt/refetch) -> ported verbatim.
//   L16-82 const cells = useMemo<StatusCell[]>(...) -> ported verbatim:
//   L17      if (!securityData) return [].
//   L19-23   doorRaw = asNonEmptyString(door_state) ?? ''; split(',')/trim/filter(Boolean).
//   L24-26   doorBoolOpen = door_state === true; openDoors = boolOpen ? ['open']
//            : doorStates.filter(includes('open')).
//   L28-33   windows = [fd/fp/rd/rp_window].
//   L34-38   openWindows filter: boolean -> the bool; else asNonEmptyString && != 'closed'.
//   L40-51   lock cell: locked ? ok 'Locked' : error 'Unlocked', Lock/Unlock glyph.
//   L52-62   sentry cell: sentry_mode ? ok 'Active' : inactive 'Off', ShieldCheck/Shield glyph.
//   L63-71   doors cell: openDoors.length===0 ? ok 'All Closed' : warning '{n} Open', DoorOpen glyph.
//   L72-80   windows cell: openWindows.length===0 ? ok 'All Closed' : warning '{n} Open', AppWindow glyph.
//   L82      useMemo deps [securityData, t].
//   L84-101 render: <WidgetShell title 'Security', green Shield icon, loading,
//          updatedAt/isFetching/isStale/isError/onRefresh=refetch> wrapping a
//          <WidgetStatusGrid cells cols={2} emptyGlyph(Shield) emptyMessage
//          'No security data'>.
//   L103   component close.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, no
// framer-motion, and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { useSecurityLatest, useVehicles } from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's `t` usage exactly (no interpolation is used).
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
/*  @/lib/typeGuards mirror (no native port yet)                       */
/* ------------------------------------------------------------------ */

// Ported verbatim from web/src/lib/typeGuards.ts. NEVER coerce a non-string to a
// string: narrow first so a boolean `false` in a "string" field can't be mis-read
// as an open door/window.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ------------------------------------------------------------------ */
/*  lucide -> repo SemanticIcon glyph stand-ins                        */
/* ------------------------------------------------------------------ */

// Repo-canonical native stand-ins for the lucide glyphs, resolved once. The web
// cell icons inherit `text-[var(--text-secondary)]` from the WidgetStatusGrid
// wrapper, so every cell glyph is rendered with tone='secondary'; the header
// Shield keeps its text-neon-green intent via tone='green'. lucide has no window
// glyph, so AppWindow maps to the nearest window/pane stand-in ('monitor').
const LOCK_GLYPH = getSemanticIconDefinition('locked').glyph;
const UNLOCK_GLYPH = getSemanticIconDefinition('unlocked').glyph;
const SHIELD_GLYPH = getSemanticIconDefinition('security').glyph;
const SHIELD_CHECK_GLYPH = getSemanticIconDefinition('securityCheck').glyph;
const DOOR_GLYPH = getSemanticIconDefinition('doorOpen').glyph;
const WINDOW_GLYPH = getSemanticIconDefinition('monitor').glyph;

type GlyphTone = 'green' | 'muted' | 'secondary';

function GlyphLegacyUnused({
  glyph,
  tone,
  style,
}: {
  glyph: string;
  tone: GlyphTone;
  style?: TextStyle | TextStyle[];
}) {
  return (
    <AppText style={[styles.glyph, glyphToneStyles[tone], style]} weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message): a centred icon glyph above a muted message line.
function EmptyState({ glyph, message }: { glyph: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetStatusGrid + StatusCell                     */
/* ------------------------------------------------------------------ */

type StatusCellStatus = 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';

interface StatusCell {
  id: string;
  label: string;
  status: StatusCellStatus;
  value?: string;
  icon?: ReactNode;
}

// web WidgetStatusGrid: empty -> EmptyState; otherwise a `cols`-wide grid of
// status cells. Each cell is a bordered surface tinted by status, with a
// top-right status dot, an optional leading icon, a truncated label, and (when
// not compact) a truncated value. The CSS container-query grid collapses to a
// flex-wrap layout here with a per-`cols` flex-basis approximation.
function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage = 'No status data available',
  emptyGlyph = SHIELD_GLYPH,
}: {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyGlyph?: string;
}) {
  if (cells.length === 0) {
    return <EmptyState glyph={emptyGlyph} message={emptyMessage} />;
  }

  const resolvedCols = compact ? 2 : cols;
  const basisStyle =
    resolvedCols === 4
      ? styles.cellBasis4
      : resolvedCols === 3
        ? styles.cellBasis3
        : styles.cellBasis2;

  return (
    <View style={styles.grid}>
      {cells.map(cell => (
        <View
          key={cell.id}
          style={[
            styles.cell,
            basisStyle,
            statusCellSurface[cell.status],
            compact && styles.cellCompact,
          ]}>
          <View style={[styles.cellDot, statusDotStyles[cell.status]]} />
          {cell.icon}
          <View style={styles.cellTextWrap}>
            <AppText numberOfLines={1} style={styles.cellLabel} tone="secondary">
              {cell.label}
            </AppText>
            {!compact && cell.value ? (
              <AppText numberOfLines={1} style={styles.cellValue} weight="semibold">
                {cell.value}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Relative "updated X ago" formatter for the freshness caption. The web
// <DataFreshness> (from @/components/data-display) renders this internally; it
// has no native port yet, so it is reproduced here as part of the shell parity.
function formatUpdatedAgo(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

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
          {formatUpdatedAgo(updatedAt, t)}
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

export default function SecurityStatusWidget({ vehicleId }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: securityData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSecurityLatest(id, 5_000);

  const cells = useMemo<StatusCell[]>(() => {
    if (!securityData) return [];

    const doorRaw = asNonEmptyString(securityData.door_state) ?? '';
    const doorStates = doorRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    // If door_state arrived as native boolean true, treat as one open door.
    const doorBoolOpen = securityData.door_state === true;
    const openDoors = doorBoolOpen
      ? ['open']
      : doorStates.filter(s => s.toLowerCase().includes('open'));

    const windows = [
      { val: securityData.fd_window },
      { val: securityData.fp_window },
      { val: securityData.rd_window },
      { val: securityData.rp_window },
    ];
    const openWindows = windows.filter(w => {
      if (typeof w.val === 'boolean') return w.val;
      const s = asNonEmptyString(w.val);
      return !!s && s.toLowerCase() !== 'closed';
    });

    return [
      {
        id: 'lock',
        label: t('widget.lock', 'Lock'),
        status: securityData.locked ? 'ok' : 'error',
        value: securityData.locked
          ? t('widget.locked', 'Locked')
          : t('widget.unlocked', 'Unlocked'),
        icon: (
          <Glyph
            glyph={securityData.locked ? LOCK_GLYPH : UNLOCK_GLYPH}
            style={styles.cellGlyph}
            tone="secondary"
          />
        ),
      },
      {
        id: 'sentry',
        label: t('widget.sentry', 'Sentry'),
        status: securityData.sentry_mode ? 'ok' : 'inactive',
        value: securityData.sentry_mode
          ? t('widget.active', 'Active')
          : t('widget.off', 'Off'),
        icon: (
          <Glyph
            glyph={securityData.sentry_mode ? SHIELD_CHECK_GLYPH : SHIELD_GLYPH}
            style={styles.cellGlyph}
            tone="secondary"
          />
        ),
      },
      {
        id: 'doors',
        label: t('widget.doors', 'Doors'),
        status: openDoors.length === 0 ? 'ok' : 'warning',
        value:
          openDoors.length === 0
            ? t('widget.allClosed', 'All Closed')
            : `${openDoors.length} ${t('widget.open', 'Open')}`,
        icon: <Glyph glyph={DOOR_GLYPH} style={styles.cellGlyph} tone="secondary" />,
      },
      {
        id: 'windows',
        label: t('widget.windows', 'Windows'),
        status: openWindows.length === 0 ? 'ok' : 'warning',
        value:
          openWindows.length === 0
            ? t('widget.allClosed', 'All Closed')
            : `${openWindows.length} ${t('widget.open', 'Open')}`,
        icon: <Glyph glyph={WINDOW_GLYPH} style={styles.cellGlyph} tone="secondary" />,
      },
    ];
  }, [securityData, t]);

  return (
    <WidgetShell
      icon={<Glyph glyph={SHIELD_GLYPH} style={styles.headerIcon} tone="green" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.security', 'Security')}
      updatedAt={dataUpdatedAt}>
      <WidgetStatusGrid
        cells={cells}
        cols={2}
        emptyGlyph={SHIELD_GLYPH}
        emptyMessage={t('widget.noSecurity', 'No security data')}
      />
    </WidgetShell>
  );
}

SecurityStatusWidget.displayName = 'SecurityStatusWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const SECURITY_STATUS_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
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

  // --- Status grid ---
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    position: 'relative',
    minHeight: 44,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cellCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cellBasis2: {
    flexBasis: '46%',
  },
  cellBasis3: {
    flexBasis: '30%',
  },
  cellBasis4: {
    flexBasis: '22%',
  },
  cellDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cellGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  cellTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  cellLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  cellValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- Header icon ---
  headerIcon: {
    fontSize: 13,
    lineHeight: 16,
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  green: {
    color: colors.success,
  },
  muted: {
    color: colors.textMuted,
  },
  secondary: {
    color: colors.textSecondary,
  },
});

const statusCellSurface = StyleSheet.create<Record<StatusCellStatus, ViewStyle>>({
  ok: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  error: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  inactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  unknown: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
});

const statusDotStyles = StyleSheet.create<Record<StatusCellStatus, ViewStyle>>({
  ok: {
    backgroundColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
  },
  error: {
    backgroundColor: colors.danger,
  },
  inactive: {
    backgroundColor: colors.surfaceRaised,
  },
  unknown: {
    backgroundColor: colors.surfaceRaised,
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
