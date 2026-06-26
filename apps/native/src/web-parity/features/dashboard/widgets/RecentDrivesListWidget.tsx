// Native parity port of
// web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx.
//
// A dashboard widget that lists a vehicle's most recent drives. The drive count
// scales with the widget footprint (wide >=3 cols -> 10, tall >=2 rows -> 7,
// else 5). Each row shows a left column (distance in the user's unit + a
// clock-cued duration), a centre column of start/end addresses that only appears
// in the wide layout, and a right column (start->end battery SoC + an optional
// battery-used percentage and the drive's short date). When there are no drives
// the body never hides — it falls back to an EmptyState ("No recent drives
// recorded"). The shell renders the "Recent Drives" title, a route icon, a
// query-freshness chip wired to refetch, and a "View all" link action.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (DriveEfficiencyChartWidget /
// MediaHistoryWidget / ChargingSessionCard) — every such dependency is
// reproduced inline with React Native primitives + the shared native building
// blocks and documented in the sidecar:
//
//   - react-router-dom <Link> (web L2) -> accessible link Pressables
//     (accessibilityRole="link", accessibilityValue.text = the destination
//     path) exactly like the committed native ChargingSessionCard idiom. The
//     destinations (`/drives/${id}` per row, `/drives` for "View all") are
//     preserved in accessibilityValue; there is no native router wired, so the
//     tap has no navigation side-effect (documented unavailable state). The
//     row keeps its hover->pressed visual intent via the Pressable pressed
//     style.
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block;
//     otherwise a header (icon + uppercase muted title) with the freshness chip
//     and the `actions` slot on the right, over the children. Only the props
//     this widget uses (title, icon, loading, updatedAt, isFetching, isStale,
//     isError, onRefresh, actions) are honoured; the shell's error/noPadding/
//     help/widgetId/PinButton/HelpTooltip extras are out of scope here (this
//     widget never passes them).
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip the shell renders — is reproduced inline as `WidgetFreshness`:
//     same isError>fetching>stale>fresh precedence, the same dot colour tiers,
//     the "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, a 30s re-render tick, and onRefresh wired to a Pressable.
//   - @/hooks/useUnits -> inline `useUnits` (derives `unitPrefs.distance` from
//     the native useSettings exactly as web useUnits' deriveDistance does:
//     unit_of_length === 'mi' -> 'mi' else 'km'). This widget only reads
//     `unitPrefs.distance`.
//   - @/lib/unitConversion convertDistanceFromSI -> inlined verbatim (km =
//     m/1000, mi = m/1609.344, ft = m/0.3048) with the NIST metre constants.
//   - @/lib/dateFormat formatDurationMinutes (+ its isFiniteNumber /
//     formatRoundedInt / FALLBACK helpers) -> inlined verbatim.
//   - @/hooks/useDateFormat formatDateShort -> inline `formatDateShort`
//     mirroring web lib/dateFormat.formatDateShort (month short + day numeric,
//     '—' on invalid). The web hook is locale/tz-aware; the native mirror uses
//     the device locale (the faithful unconfigured default).
//   - @/lib/numberFormat fmtNumber/fmtInt -> inlined verbatim (safeNumber guard,
//     en-US grouping; fmtNumber default precision 2, fmtInt = fmtNumber(v, 0))
//     without useSettings-driven global precision/locale wiring.
//   - lucide-react Route/ArrowUpRight/MapPin/Clock/Battery have no native icon
//     font; they become small tintable glyphs / colour dots: Route -> a cyan
//     "➤" header glyph, ArrowUpRight -> "↗", the start/end MapPins -> emerald /
//     red colour dots (the origin/destination map convention), Clock -> "◷",
//     Battery -> "▭". The empty-state Route icon has no native EmptyState slot
//     and is dropped (the route signal is preserved by the shell header glyph).
//   - feedback.EmptyState -> shared native EmptyState (web single `message`
//     -> native EmptyState `title`, empty `message`).
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.*/freshness.* key + {{var}} interpolation intact.
//   - ../types Drive / ./types WidgetProps -> the native canonical ApiDrive
//     (../../../api/hooks/useDriving) aliased as Drive (same snake_case fields
//     this widget reads) + a local WidgetSize/WidgetProps subset.
//
// The drives query is preserved unchanged: `useQuery` (TanStack) with the same
// queryKey (['drives', id, `recent-list-${driveLimit}`]), the same queryFn
// calling `request<Drive[]>('/drives?vehicle_id=${id}&limit=${driveLimit}')`
// against the native API client, and the same `enabled: id > 0`. useVehicles()
// is called unchanged for the vehicle fallback. State names (vehicles, id,
// unitPrefs, isWide, isTall, driveLimit, drives, isLoading, isFetching, isStale,
// isError, dataUpdatedAt, refetch, items, dist, batteryUsed) are preserved. The
// pure helper truncateAddress is ported verbatim (param widened to accept the
// canonical drive's `string | null` addresses). No DOM, react-router,
// framer-motion, lucide-react, Recharts, Leaflet, or old web UI components are
// imported into the native output.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import type {ApiDrive as Drive} from '../../../api/hooks/useDriving';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

// Universal em-dash placeholder used by the web widget / formatters ('\u2014').
const FALLBACK = '\u2014';

/* ─── Glyph substitutes for lucide-react icons ────────────────────────────── */

// lucide Route -> "\u27A4" (black rightwards arrowhead) tinted cyan, the widget
// identity. lucide ArrowUpRight -> "\u2197". lucide Clock -> "\u25F7" (upper
// right quadrant circle). lucide Battery -> "\u25AD" (white horizontal rect).
const ROUTE_GLYPH = '\u27A4';
const ARROW_UP_RIGHT_GLYPH = '\u2197';
const CLOCK_GLYPH = '\u25F7';
const BATTERY_GLYPH = '\u25AD';

// SoC start->end separator the web renders literally ("X% \u2192 Y%").
const ARROW_RIGHT = '\u2192';

// lucide MapPin start/end -> emerald-400/60 and red-400/60 colour dots (the
// origin/destination map convention), reproduced as View dots.
const START_DOT = 'rgba(52, 211, 153, 0.6)';
const END_DOT = 'rgba(248, 113, 113, 0.6)';

/* ─── Inlined number formatters (web @/lib/numberFormat) ───────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which this widget does not wire), so 2 is
// the faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — fmtNumber at zero precision.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

interface UnitPrefs {
  distance: DistanceUnitPref;
}

// NIST metre constants (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// Mirrors web useUnits: derive the distance preference from useSettings exactly
// as web's deriveDistance does (unit_of_length === 'mi' -> 'mi' else 'km').
// This widget only reads `unitPrefs.distance`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({unitPrefs: {distance}}), [distance]);
}

/* ─── Inlined date/duration formatters (web @/lib/dateFormat) ──────────────── */

// web lib/dateFormat.isFiniteNumber.
function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// web lib/dateFormat.formatRoundedInt — en-US grouped, zero fraction digits.
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// web lib/dateFormat.formatDurationMinutes — "1h 5m" / "5m", subMinuteLabel for
// <1m, '—' for nullish / non-finite / negative. Ported verbatim.
function formatDurationMinutes(
  minutes: number | null | undefined,
  options: {subMinuteLabel?: string} = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return FALLBACK;
  }
  if (options.subMinuteLabel && minutes < 1) {
    return options.subMinuteLabel;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// web formatDateShort: "Jun 26" — month short + day numeric, '—' on invalid.
// The web hook threads a settings-bound locale/tz; the native mirror uses the
// device locale (the faithful unconfigured default).
function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* ─── truncateAddress (web source L18-21, param widened to string | null) ──── */

function truncateAddress(
  addr: string | null | undefined,
  maxLen: number,
): string {
  if (!addr) {
    return FALLBACK;
  }
  return addr.length > maxLen ? `${addr.slice(0, maxLen)}\u2026` : addr;
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="recent-drives-list-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="recent-drives-list-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── RouteGlyph (web header lucide Route, text-neon-cyan) ─────────────────── */

function RouteGlyph() {
  return (
    <View style={styles.headerGlyph} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" tone="accent">
        {ROUTE_GLYPH}
      </AppText>
    </View>
  );
}

/* ─── ViewAllLink (web header actions <Link to="/drives">) ────────────────── */

function ViewAllLink() {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityValue={{text: '/drives'}}
      accessibilityLabel={t('widget.viewAll', 'View all')}
      testID="recent-drives-list-view-all"
      style={styles.viewAll}>
      <AppText variant="caption" tone="muted" style={styles.viewAllText}>
        {t('widget.viewAll', 'View all')}
      </AppText>
      <AppText
        variant="caption"
        tone="muted"
        accessibilityElementsHidden
        style={styles.viewAllArrow}>
        {ARROW_UP_RIGHT_GLYPH}
      </AppText>
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  actions,
  children,
  testID,
}: {
  title: string;
  icon: React.ReactNode;
  loading?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="recent-drives-list-loading" />;
  }

  return (
    <View style={styles.shell} testID={testID}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        <View style={styles.shellHeaderRight}>
          <WidgetFreshness
            updatedAt={updatedAt}
            isFetching={isFetching}
            isStale={isStale}
            isError={isError}
            onRefresh={onRefresh}
          />
          {actions}
        </View>
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── DriveRow (web source L70-124 per-drive <Link> row) ──────────────────── */

function DriveRow({
  drive: d,
  isWide,
  unit,
}: {
  drive: Drive;
  isWide: boolean;
  unit: DistanceUnitPref;
}) {
  const dist = convertDistanceFromSI(d.distance_m ?? 0, unit);
  const batteryUsed =
    d.start_soc_pct != null && d.end_soc_pct != null
      ? d.start_soc_pct - d.end_soc_pct
      : null;

  const startSoc = d.start_soc_pct ?? '?';
  const endSoc = d.end_soc_pct ?? '?';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityValue={{text: `/drives/${d.id}`}}
      accessibilityLabel={t('widget.recentDrivesList', 'Recent Drives')}
      testID={`recent-drives-list-row-${d.id}`}
      style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
      {/* Left column: distance + duration */}
      <View style={styles.leftCol}>
        <AppText weight="semibold" numberOfLines={1} style={styles.distance}>
          {`${fmtNumber(dist, 1)} ${unit}`}
        </AppText>
        <View style={styles.metaRow}>
          <AppText
            variant="caption"
            tone="muted"
            accessibilityElementsHidden
            style={styles.metaGlyph}>
            {CLOCK_GLYPH}
          </AppText>
          <AppText variant="caption" tone="muted" style={styles.metaText}>
            {formatDurationMinutes((d.duration_s ?? 0) / 60, {
              subMinuteLabel: '<1m',
            })}
          </AppText>
        </View>
      </View>

      {/* Center column: addresses (only when wide enough) */}
      {isWide ? (
        <View style={styles.centerCol}>
          <View style={styles.addrRow}>
            <View
              style={[styles.mapDot, {backgroundColor: START_DOT}]}
              accessibilityElementsHidden
            />
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.addrText}>
              {truncateAddress(d.start_address, 30)}
            </AppText>
          </View>
          <View style={[styles.addrRow, styles.rowGapTop]}>
            <View
              style={[styles.mapDot, {backgroundColor: END_DOT}]}
              accessibilityElementsHidden
            />
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.addrText}>
              {truncateAddress(d.end_address, 30)}
            </AppText>
          </View>
        </View>
      ) : null}

      {/* Right column: battery + date */}
      <View style={styles.rightCol}>
        <View style={styles.batteryRow}>
          <AppText
            variant="caption"
            tone="muted"
            accessibilityElementsHidden
            style={styles.metaGlyph}>
            {BATTERY_GLYPH}
          </AppText>
          <AppText variant="caption" tone="secondary" style={styles.batteryText}>
            {`${startSoc}% ${ARROW_RIGHT} ${endSoc}%`}
          </AppText>
        </View>
        <View style={[styles.dateRow, styles.rowGapTop]}>
          {batteryUsed != null && dist > 0 ? (
            <AppText variant="caption" style={styles.batteryUsed}>
              {`${fmtInt(batteryUsed)}%`}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted" style={styles.dateText}>
            {formatDateShort(d.start_ts)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

/* ─── RecentDrivesListWidget ──────────────────────────────────────────────── */

export default function RecentDrivesListWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const driveLimit = isWide ? 10 : isTall ? 7 : 5;

  const {
    data: drives,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['drives', id, `recent-list-${driveLimit}`],
    queryFn: () =>
      request<Drive[]>(`/drives?vehicle_id=${id}&limit=${driveLimit}`),
    enabled: id > 0,
  });

  const items = useMemo(() => drives ?? [], [drives]);

  return (
    <WidgetShell
      title={t('widget.recentDrivesList', 'Recent Drives')}
      icon={<RouteGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={<ViewAllLink />}
      testID="recent-drives-list-widget">
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {items.length > 0 ? (
          items.map(d => (
            <DriveRow
              key={d.id}
              drive={d}
              isWide={isWide}
              unit={unitPrefs.distance}
            />
          ))
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <View testID="recent-drives-list-empty">
            <EmptyState
              title={t('widget.noDrivesList', 'No recent drives recorded')}
              message=""
            />
          </View>
        )}
      </ScrollView>
    </WidgetShell>
  );
}

RecentDrivesListWidget.displayName = 'RecentDrivesListWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    flexShrink: 0,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  headerGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
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
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 2,
    flexShrink: 0,
  },
  viewAllText: {
    fontSize: 10,
    lineHeight: 14,
  },
  viewAllArrow: {
    fontSize: 10,
    lineHeight: 14,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    flexGrow: 1,
    rowGap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.md,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  leftCol: {
    flexShrink: 0,
    minWidth: 72,
  },
  distance: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    marginTop: 2,
  },
  metaGlyph: {
    fontSize: 9,
    lineHeight: 12,
  },
  metaText: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  centerCol: {
    flex: 1,
    minWidth: 0,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  rowGapTop: {
    marginTop: 2,
  },
  mapDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  addrText: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  rightCol: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: 4,
  },
  batteryText: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: 4,
  },
  batteryUsed: {
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(53, 213, 255, 0.6)',
    fontVariant: ['tabular-nums'],
  },
  dateText: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
});
