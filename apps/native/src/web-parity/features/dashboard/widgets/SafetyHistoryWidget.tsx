// Native parity port of
// web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx.
//
// A dashboard widget that summarises a vehicle's recent ADAS / safety-system
// snapshots. In the wide (>1 col) layout it shows three stat cards (30-day
// event total, most-common event type, trend arrow) over a scrollable event
// feed of the latest classified safety events; in the compact (1 col) layout it
// collapses to a single inline row ("N events (30d)" + most-common/trend, or
// "No safety events" when the 30-day count is zero), with an EmptyState when
// there is no history at all. The shell renders the title, an alert icon, and a
// query-freshness chip wired to refetch.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (MediaHistoryWidget /
// AutomationHistoryWidget / GlancePage / RateLimitStatusPanel) — every such
// dependency is reproduced inline with React Native primitives + the shared
// native building blocks and documented in the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell` here: loading -> a skeleton block;
//     otherwise a header (icon + uppercase muted title + freshness chip) over
//     the children. Its DOM <Skeleton>/<QueryError> and HelpTooltip/PinButton
//     extras are out of scope for this widget (it never passes help/widgetId/
//     error), so only the props this widget uses (title, icon, loading,
//     updatedAt, isFetching, isStale, isError, onRefresh) are honoured.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip WidgetShell renders — is reproduced inline as
//     `WidgetFreshness`: same isError>fetching>stale>fresh precedence, the same
//     dot colour tiers, "just now / Nm/Nh/Nd/Nw ago" ladder, "updating\u2026"/
//     "error" labels, the 30s re-render tick, and onRefresh wired to a
//     Pressable (role=button) exactly like the web chip.
//   - WidgetEventFeed + EventFeedItem (web .../shared) -> inline
//     `WidgetEventFeed` + local `EventFeedItem` type: same maxItems/compact
//     default (maxItems ?? (compact ? 3 : 10)), the same timestamp-descending
//     sort + slice, the same EmptyState fallback, and TimelineItem (web
//     data-display) reproduced as `TimelineRow` (status-coloured icon chip +
//     connector + title/subtitle/relative-time). The web `icon` ReactNode field
//     becomes a `glyph` string; the unused web `href` field is dropped (native
//     has no router and this widget never sets it). `severity` is carried for
//     type parity though, as in web, only `color` drives the rendering.
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `size.cols` is read here).
//   - @/components/data-display StatCard -> local `StatCard` reproducing the
//     label / value / optional sublabel rows (the web icon/unit/trend/loading
//     props are unused by this widget so they are omitted).
//   - feedback.EmptyState -> shared native EmptyState (web single `message`
//     -> native EmptyState `title`, empty `message`); its `emptyIcon`/`icon`
//     ReactNode has no native EmptyState slot, so it is dropped.
//   - @/lib/numberFormat fmtInt is inlined verbatim (safeNumber + fmtNumber at
//     the web default precision, then 0 decimals) without Intl/useSettings.
//   - @/lib/safetyEnum cleanSafetyEnum/isSafetyEnumActive + their @/lib/
//     typeGuards deps (asNonEmptyString/asFiniteNumber) are inlined verbatim so
//     the boolean/number/typed-enum/stripped-suffix normalisation is preserved.
//   - lucide-react AlertOctagon/ShieldAlert/AlertTriangle/CarFront/Navigation
//     have no native icon font; the header + per-event icons collapse to short
//     glyphs (AEB->"AEB", FCW->"FCW", lane->"LD", BSW->"BSW", ELDA->"ELD",
//     general/header->"!") while the meaningful per-event hex colour is
//     preserved verbatim and tints the glyph.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.*/freshness.* key + {{var}} interpolation intact.
//
// The data hooks are called unchanged: useVehicles() + useSafetyHistory(vidStr)
// via the native web-parity hooks, so the API paths (/vehicles, /safety?
// vehicle_id=), snake_case-derived vehicle id selection, and select(safeArray)
// are preserved. State names (vehicles, vid, vidStr, history, isLoading,
// isFetching, isStale, isError, dataUpdatedAt, refetch, isCompact, list,
// feedItems, stats) are preserved. No DOM, react-router, framer-motion,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useSafetyHistory,
  type SafetySnapshot,
} from '../../../api/hooks/useVehicleSystems';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t`.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

// Universal em-dash placeholder used by the web widget ('\u2014').
const FALLBACK = '\u2014';

/* ─── Inlined formatter (web @/lib/numberFormat fmtInt) ───────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision (web global precision default
// is 2; this widget only ever calls fmtInt so precision collapses to 0).
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer with locale separators.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined type guards (web @/lib/typeGuards) ──────────────────────────── */

// Returns `v` only when it is a non-empty string; `null` otherwise.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Returns `v` when it is a finite number; `null` otherwise.
function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ─── Inlined safety-enum helpers (web @/lib/safetyEnum) ──────────────────── */

// Tesla raw enum prefixes that need stripping for old signal_log rows.
const SAFETY_ENUM_PREFIXES = {
  forward_collision_warning: 'ForwardCollisionSensitivity',
  lane_departure_avoidance: 'LaneAssistLevel',
  speed_limit_warning: 'SpeedAssistLevel',
  cruise_follow_distance: 'FollowDistance',
} as const;

type SafetyEnumField = keyof typeof SAFETY_ENUM_PREFIXES;

// Convert a raw safety-enum value into a human-renderable, prefix-stripped
// string. Accepts `unknown`. Returns `fallback` for null/undefined/empty.
// Booleans render as "On" / "Off". Numbers render as their decimal form.
function cleanSafetyEnum(
  value: unknown,
  field: SafetyEnumField,
  fallback = FALLBACK,
): string {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }

  const num = asFiniteNumber(value);
  if (num !== null) {
    return String(num);
  }

  const raw = asNonEmptyString(value);
  if (!raw) {
    return fallback;
  }

  const prefix = SAFETY_ENUM_PREFIXES[field];
  if (prefix && raw.startsWith(prefix)) {
    const stripped = raw.slice(prefix.length);
    if (field === 'speed_limit_warning' && stripped === 'None') {
      return 'Off';
    }
    return stripped || raw;
  }
  return raw;
}

// Whether a safety-enum value represents an ENABLED feature. Centralises the
// "off / none / disabled / 0" classification so callers don't reinvent it (and
// don't reinvent it WRONG via String() coercion).
function isSafetyEnumActive(value: unknown, field: SafetyEnumField): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const cleaned = cleanSafetyEnum(value, field, '');
  if (cleaned === '') {
    return false;
  }
  const lower = cleaned.toLowerCase();
  if (
    lower === 'off' ||
    lower === 'none' ||
    lower === 'disabled' ||
    lower === '0'
  ) {
    return false;
  }
  return true;
}

/* ─── Inlined date formatters (web WidgetEventFeed.formatRelativeTime) ─────── */

// web formatDateTime — "Apr 4, 2026, 2:30 AM" (the absolute fallback the feed's
// relative-time helper rolls over to past 24h).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// web WidgetEventFeed.formatRelativeTime — "Just now", "5m ago", "2h ago", else
// the absolute date-time.
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  return formatDateTime(iso);
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

/* ─── EventFeedItem (web .../shared WidgetEventFeed) ──────────────────────── */

interface EventFeedItem {
  id: string | number;
  glyph: string;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
}

/* ─── Safety classification (web .../SafetyHistoryWidget classifySnapshot) ── */

type Severity = 'info' | 'warning' | 'critical';

interface SafetyEvent {
  type: string;
  title: string;
  glyph: string;
  color: string;
  severity: Severity;
}

// web classifySnapshot — first-match cascade over the snapshot's ADAS flags.
// The lucide icon ReactNode becomes a short glyph; the hex colour is preserved
// verbatim and drives the per-row tint.
function classifySnapshot(snap: Record<string, unknown>): SafetyEvent {
  if (snap.automatic_emergency_braking_off === true) {
    return {
      type: 'aeb',
      title: 'AEB Activation',
      glyph: 'AEB',
      color: '#ef4444',
      severity: 'critical',
    };
  }
  if (
    isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning')
  ) {
    return {
      type: 'fcw',
      title: `FCW: ${cleanSafetyEnum(snap.forward_collision_warning, 'forward_collision_warning')}`,
      glyph: 'FCW',
      color: '#f59e0b',
      severity: 'warning',
    };
  }
  if (isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance')) {
    return {
      type: 'lane',
      title: `Lane Departure: ${cleanSafetyEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance')}`,
      glyph: 'LD',
      color: '#3b82f6',
      severity: 'warning',
    };
  }
  if (snap.blind_spot_collision_warning === true) {
    return {
      type: 'bsw',
      title: 'Blind Spot Warning',
      glyph: 'BSW',
      color: '#f59e0b',
      severity: 'warning',
    };
  }
  if (snap.emergency_lane_departure_avoidance === true) {
    return {
      type: 'elda',
      title: 'Emergency Lane Departure Avoidance',
      glyph: 'ELD',
      color: '#ef4444',
      severity: 'critical',
    };
  }
  return {
    type: 'general',
    title: 'Safety State Update',
    glyph: '!',
    color: '#6b7280',
    severity: 'info',
  };
}

// web buildSubtitle — joins the present speed-limit / follow-distance / PIN
// flags with " · "; empty -> em-dash.
function buildSubtitle(snap: Record<string, unknown>): string {
  const parts: string[] = [];
  if (snap.speed_limit_warning != null) {
    parts.push(`Speed Limit: ${String(snap.speed_limit_warning)}`);
  }
  if (snap.cruise_follow_distance != null) {
    parts.push(`Follow: ${String(snap.cruise_follow_distance)}`);
  }
  if (snap.pin_to_drive_enabled != null) {
    parts.push(snap.pin_to_drive_enabled ? 'PIN to Drive' : '');
  }
  return parts.filter(Boolean).join(' \u00B7 ') || FALLBACK;
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
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="safety-history-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="safety-history-freshness-dot"
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

/* ─── AlertOctagonGlyph (web header lucide AlertOctagon, text-red-400) ─────── */

function AlertOctagonGlyph() {
  return (
    <View style={styles.headerGlyph} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.headerGlyphText}>
        !
      </AppText>
    </View>
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
  children: React.ReactNode;
  testID?: string;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="safety-history-loading" />;
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
        <WidgetFreshness
          updatedAt={updatedAt}
          isFetching={isFetching}
          isStale={isStale}
          isError={isError}
          onRefresh={onRefresh}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── TimelineRow (web data-display TimelineItem) ─────────────────────────── */

function TimelineRow({item, isLast}: {item: EventFeedItem; isLast: boolean}) {
  return (
    <View style={styles.timelineRow} testID={`safety-event-${item.id}`}>
      <View style={styles.timelineRail}>
        <View style={[styles.timelineIcon, {backgroundColor: `${item.color}15`}]}>
          <AppText variant="caption" weight="bold" style={{color: item.color}}>
            {item.glyph}
          </AppText>
        </View>
        {!isLast ? <View style={styles.timelineConnector} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <AppText weight="semibold" numberOfLines={1} style={styles.timelineTitle}>
          {item.title}
        </AppText>
        {item.subtitle ? (
          <AppText
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={styles.timelineSubtitle}>
            {item.subtitle}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="muted" style={styles.timelineTime}>
          {formatRelativeTime(item.timestamp)}
        </AppText>
      </View>
    </View>
  );
}

/* ─── WidgetEventFeed (web .../shared WidgetEventFeed) ────────────────────── */

function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
}: {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
}) {
  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...items]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <View testID="safety-history-feed-empty">
        <EmptyState
          title={emptyMessage ?? t('widget.noEvents', 'No events yet')}
          message=""
        />
      </View>
    );
  }

  return (
    <View style={styles.feed} testID="safety-history-feed">
      {sorted.map((item, i) => (
        <TimelineRow key={item.id} item={item} isLast={i === sorted.length - 1} />
      ))}
    </View>
  );
}

/* ─── StatCard (web @/components/data-display StatCard) ───────────────────── */

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <View style={styles.statCard}>
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.statLabel}>
        {label}
      </AppText>
      <AppText weight="bold" numberOfLines={1} style={styles.statValue}>
        {value}
      </AppText>
      {sublabel ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.statSublabel}>
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── CompactView (web .../SafetyHistoryWidget CompactView, 1×N layout) ────── */

function CompactView({
  totalEvents,
  mostCommon,
  trend,
}: {
  totalEvents: number;
  mostCommon: string;
  trend: string;
}) {
  return (
    <View style={styles.compact} testID="safety-history-compact">
      <View style={styles.compactRow}>
        <View style={styles.compactIcon} accessibilityElementsHidden>
          <AppText variant="caption" weight="bold" style={styles.compactIconText}>
            !
          </AppText>
        </View>
        <View style={styles.compactBody}>
          <AppText numberOfLines={1} style={styles.compactPrimary}>
            {totalEvents > 0
              ? `${fmtInt(totalEvents)} ${t('widget.safetyEvents', 'events')} (30d)`
              : t('widget.noSafetyEvents', 'No safety events')}
          </AppText>
          {totalEvents > 0 ? (
            <AppText
              variant="caption"
              tone="muted"
              numberOfLines={1}
              style={styles.compactSecondary}>
              {mostCommon} {trend}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/* ─── SafetyHistoryWidget ─────────────────────────────────────────────────── */

export default function SafetyHistoryWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: history,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSafetyHistory(vidStr ?? '');

  const isCompact = size.cols <= 1;
  const list = useMemo<SafetySnapshot[]>(() => history ?? [], [history]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map(snap => {
        const event = classifySnapshot(snap as unknown as Record<string, unknown>);
        return {
          id: snap.id ?? Math.random(),
          glyph: event.glyph,
          title: event.title,
          subtitle: buildSubtitle(snap as unknown as Record<string, unknown>),
          timestamp: snap.created_at ?? new Date(0).toISOString(),
          color: event.color,
          severity: event.severity,
        };
      }),
    [list],
  );

  // Stats: 30-day total, most common type, trend.
  const stats = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

    const recent = list.filter(
      s => new Date(s.created_at ?? '').getTime() >= thirtyDaysAgo,
    );
    const prior = list.filter(s => {
      const ts = new Date(s.created_at ?? '').getTime();
      return ts >= sixtyDaysAgo && ts < thirtyDaysAgo;
    });

    const typeCounts: Record<string, number> = {};
    for (const snap of recent) {
      const ev = classifySnapshot(snap as unknown as Record<string, unknown>);
      typeCounts[ev.type] = (typeCounts[ev.type] ?? 0) + 1;
    }

    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const mostCommonType = sorted[0]?.[0] ?? FALLBACK;

    const typeLabels: Record<string, string> = {
      aeb: 'AEB',
      fcw: 'FCW',
      lane: 'Lane Departure',
      bsw: 'Blind Spot',
      elda: 'Emergency Lane',
      general: 'General',
    };

    const recentCount = recent.length;
    const priorCount = prior.length;
    let trend = FALLBACK;
    if (priorCount > 0 && recentCount > priorCount) {
      trend = '\u2191';
    } else if (priorCount > 0 && recentCount < priorCount) {
      trend = '\u2193';
    } else if (priorCount > 0 && recentCount === priorCount) {
      trend = '\u2192';
    }

    return {
      totalEvents: recentCount,
      mostCommon: typeLabels[mostCommonType] ?? mostCommonType,
      trend,
    };
  }, [list]);

  return (
    <WidgetShell
      title={t('widget.safetyHistory', 'Safety History')}
      icon={<AlertOctagonGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      testID="safety-history-widget">
      {isCompact ? (
        list.length > 0 ? (
          <CompactView
            totalEvents={stats.totalEvents}
            mostCommon={stats.mostCommon}
            trend={stats.trend}
          />
        ) : (
          <View testID="safety-history-empty">
            <EmptyState
              title={t('widget.noSafetyEvents', 'No safety events recorded')}
              message=""
            />
          </View>
        )
      ) : (
        <View style={styles.wideRoot}>
          <View style={styles.statRow} testID="safety-history-stats">
            <StatCard
              label={t('widget.safetyTotal', 'Events (30d)')}
              value={fmtInt(stats.totalEvents)}
            />
            <StatCard
              label={t('widget.safetyMostCommon', 'Most Common')}
              value={stats.mostCommon}
            />
            <StatCard
              label={t('widget.safetyTrend', 'Trend')}
              value={stats.trend}
              sublabel={
                stats.trend === '\u2191'
                  ? t('widget.trendUp', 'Increasing')
                  : stats.trend === '\u2193'
                    ? t('widget.trendDown', 'Decreasing')
                    : t('widget.trendFlat', 'Stable')
              }
            />
          </View>

          <ScrollView
            style={styles.feedScroll}
            contentContainerStyle={styles.feedScrollContent}
            showsVerticalScrollIndicator={false}>
            <WidgetEventFeed
              items={feedItems}
              maxItems={10}
              compact={false}
              emptyMessage={t('widget.noSafetyEvents', 'No safety events recorded')}
            />
          </ScrollView>
        </View>
      )}
    </WidgetShell>
  );
}

SafetyHistoryWidget.displayName = 'SafetyHistoryWidget';

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
  headerGlyphText: {
    color: '#f87171',
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
  wideRoot: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    columnGap: spacing.sm,
    flexShrink: 0,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    rowGap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  statLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  statValue: {
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  statSublabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  feedScroll: {
    flex: 1,
    minHeight: 0,
  },
  feedScrollContent: {
    flexGrow: 1,
  },
  feed: {
    flex: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    columnGap: spacing.md,
  },
  timelineRail: {
    alignItems: 'center',
  },
  timelineIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineConnector: {
    width: StyleSheet.hairlineWidth,
    flex: 1,
    marginTop: 4,
    backgroundColor: colors.surfaceRaised,
  },
  timelineBody: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.md,
  },
  timelineTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  timelineSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  timelineTime: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  compact: {
    rowGap: spacing.sm,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    minHeight: 44,
  },
  compactIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  compactIconText: {
    color: '#f87171',
  },
  compactBody: {
    flex: 1,
    minWidth: 0,
  },
  compactPrimary: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  compactSecondary: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
