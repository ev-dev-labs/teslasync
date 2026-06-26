// Native parity port of
// web/src/features/dashboard/widgets/GuardModeWidget.tsx.
//
// A dashboard widget that surfaces a vehicle's Guard Mode (armed/disarmed)
// status plus a feed of recent guard/security events. In the compact (1 col)
// layout it collapses to an armed/disarmed status chip + a "{n} events" chip;
// in the standard (>1 col) layout it shows a status card (shield + Armed/
// Disarmed + "Sensitivity: x · Auto-panic" subtitle + ON/OFF badge) above a
// scrollable event feed. When the config has not loaded yet it renders an
// EmptyState. The shell renders the title, a shield icon, and a query-freshness
// chip wired to refetch both queries.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (AutomationHistoryWidget /
// ChargingOptimizerWidget) — every such dependency is reproduced inline with
// React Native primitives + the shared native building blocks and documented in
// the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block;
//     otherwise a header (icon + uppercase muted title + freshness chip) over
//     the children. Only the props this widget actually passes (title, icon,
//     loading, updatedAt, isFetching, isStale, isError, onRefresh) are honoured;
//     the DOM Skeleton/QueryError/HelpTooltip/PinButton extras are out of scope.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/
//     error) chip WidgetShell renders — is reproduced inline as
//     `WidgetFreshness`: same isError>fetching>stale>fresh precedence, same dot
//     colour tiers, the "just now / Nm/Nh/Nd/Nw ago" relative ladder,
//     "updating…"/"error" labels, a 30s re-render tick, and onRefresh wired to a
//     Pressable (role=button) exactly like the web chip.
//   - WidgetEventFeed + EventFeedItem (web .../shared) -> inline `WidgetEventFeed`
//     + local `EventFeedItem` type: same `limit = maxItems ?? (compact ? 3 : 10)`,
//     the same timestamp-descending sort + slice, the same EmptyState fallback,
//     and TimelineItem (web data-display) reproduced as `TimelineRow` (a
//     status-coloured icon chip + connector + title/subtitle/relative-time).
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `size.cols` is read here).
//   - @/components/ui Badge -> local `StatusBadge` reproducing the success/
//     warning/neutral variant tints used here.
//   - @/components/feedback EmptyState -> shared native EmptyState (web's single
//     `message` becomes the native `title`, native `message=''`; the web
//     `icon`/`className` have no native EmptyState slot and are dropped — the
//     shield signal is kept in the header glyph).
//   - lucide-react Shield/ShieldAlert/ShieldCheck/ShieldOff/CarFront/Unlock/
//     Siren/Eye/FlaskConical/Move have no native icon font; the header/status
//     shields become small accent/muted shield glyphs and the per-event icons
//     collapse to short glyphs (Move->MV, Unlock->UL, CarFront->CR, Eye->EY,
//     Siren->SR, FlaskConical->FL, ShieldCheck->SC, ShieldAlert->SA) while the
//     meaningful signal — the exact per-event hex colour + severity — is
//     preserved verbatim.
//   - @/lib/numberFormat fmtInt is inlined verbatim (safeNumber guard + en-US
//     integer grouping) without useSettings locale wiring.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.*/freshness.* key + {{var}} interpolation intact.
//
// The data hooks are called unchanged: useGuardConfig(id) / useGuardEvents(id)
// and useVehicles() via the native web-parity hooks, so the API paths
// (/vehicles/{id}/guard, /vehicles/{id}/guard/events, /vehicles), the
// snake_case fields (enabled, sensitivity, auto_panic; event_type, ts,
// acknowledged_at), and refetch intervals are preserved. State names (config,
// configLoading, configFetching, configStale, configError, configUpdatedAt,
// refetchConfig, events, eventsLoading, eventsFetching, eventsStale,
// eventsError, eventsUpdatedAt, refetchEvents, isCompact, feedItems, isLoading,
// isFetching, isStale, isError, updatedAt, enabled, sensitivity, autoPanic,
// eventCount) are preserved. No DOM, react-router, lucide-react, Recharts,
// Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  isGuardEventAcknowledged,
  useGuardConfig,
  useGuardEvents,
  type GuardEvent,
} from '../../../api/hooks/useGuard';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;
type TFunction = (key: string, fallback: string, vars?: TVars) => string;

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

/* ─── Inlined formatter (web @/lib/numberFormat fmtInt) ────────────────────── */

const FALLBACK = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtInt — integer with locale separators (precision 0). The web global
// locale defaults to en-US (set by useSettings, which native does not wire).
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
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

/* ─── Event type → visual mapping (web EVENT_TYPE_MAP) ─────────────────────── */

// Lookup-with-fallback so unknown backend event types render with a neutral
// glyph instead of crashing or rendering as `undefined`. Legacy alert shapes
// are preserved so historic rows still resolve. lucide icons collapse to short
// glyphs; the exact hex colour + severity are the preserved web values.
interface EventVisual {
  glyph: string;
  label: string;
  color: string;
  severity: EventFeedItem['severity'];
}

const EVENT_TYPE_MAP: Record<string, EventVisual> = {
  vehicle_moved: {glyph: 'MV', label: 'Vehicle Moved', color: '#f59e0b', severity: 'warning'},
  unauthorized_unlock: {glyph: 'UL', label: 'Unauthorized Unlock', color: '#ef4444', severity: 'critical'},
  unauthorized_drive: {glyph: 'CR', label: 'Unauthorized Drive', color: '#ef4444', severity: 'critical'},
  sentry_triggered: {glyph: 'EY', label: 'Sentry Triggered', color: '#06b6d4', severity: 'warning'},
  manual_panic: {glyph: 'SR', label: 'Panic Alert', color: '#ef4444', severity: 'critical'},
  test_alert: {glyph: 'FL', label: 'Test Alert', color: '#8b5cf6', severity: 'info'},
  locked: {glyph: 'SC', label: 'Lock State Changed', color: '#06b6d4', severity: 'info'},
  sentry_mode: {glyph: 'EY', label: 'Sentry Mode', color: '#f59e0b', severity: 'warning'},
  valet_mode_enabled: {glyph: 'SA', label: 'Valet Mode', color: '#06b6d4', severity: 'info'},
};

function mapEventToFeedItem(ev: GuardEvent, translate: TFunction): EventFeedItem {
  const mapped: EventVisual = EVENT_TYPE_MAP[ev.event_type] ?? {
    glyph: 'SA',
    label: ev.event_type ?? FALLBACK,
    color: '#6b7280',
    severity: 'info',
  };

  return {
    id: ev.id,
    glyph: mapped.glyph,
    title: translate(`widget.guardEvent.${ev.event_type}`, mapped.label),
    subtitle: isGuardEventAcknowledged(ev)
      ? translate('widget.guardAcknowledged', 'Acknowledged')
      : translate('widget.guardUnacknowledged', 'Unacknowledged'),
    timestamp: ev.ts,
    color: mapped.color,
    severity: mapped.severity,
  };
}

/* ─── Inlined date helpers (web WidgetEventFeed formatRelativeTime) ────────── */

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

/* ─── StatusBadge (web @/components/ui Badge: success/warning/neutral) ─────── */

type BadgeVariant = 'success' | 'warning' | 'neutral';

const BADGE_TINTS: Record<BadgeVariant, {bg: string; color: string}> = {
  success: {bg: colors.successSurface, color: colors.success},
  warning: {bg: colors.warningSurface, color: colors.warning},
  neutral: {bg: colors.surfaceRaised, color: colors.textSecondary},
};

function StatusBadge({
  variant,
  children,
  testID,
}: {
  variant: BadgeVariant;
  children: string;
  testID?: string;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tint.bg}]} testID={testID}>
      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={[styles.badgeText, {color: tint.color}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── ShieldGlyph (web lucide Shield/ShieldCheck/ShieldOff bare icon) ──────── */

function ShieldGlyph({
  glyph,
  color,
  large,
}: {
  glyph: string;
  color: string;
  large?: boolean;
}) {
  return (
    <View style={styles.shieldGlyph} accessibilityElementsHidden>
      <AppText
        variant="caption"
        weight="bold"
        style={[large ? styles.shieldGlyphTextLg : styles.shieldGlyphTextSm, {color}]}>
        {glyph}
      </AppText>
    </View>
  );
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
      testID="guard-mode-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="guard-mode-freshness-dot"
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
    return <View style={styles.skeleton} testID="guard-mode-loading" />;
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
    <View style={styles.timelineRow} testID={`guard-event-${item.id}`}>
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
      <View testID="guard-mode-feed-empty">
        <EmptyState
          title={emptyMessage ?? t('widget.noEvents', 'No events yet')}
          message=""
        />
      </View>
    );
  }

  return (
    <View style={styles.feed} testID="guard-mode-feed">
      {sorted.map((item, i) => (
        <TimelineRow key={item.id} item={item} isLast={i === sorted.length - 1} />
      ))}
    </View>
  );
}

/* ─── CompactView (web .../GuardModeWidget CompactView) ───────────────────── */

function CompactView({
  enabled,
  eventCount,
  t: translate,
}: {
  enabled: boolean;
  eventCount: number;
  t: TFunction;
}) {
  return (
    <View style={styles.compactRow} testID="guard-mode-compact">
      <View style={styles.compactLeft}>
        <ShieldGlyph
          glyph={enabled ? 'SC' : 'SO'}
          color={enabled ? colors.success : colors.textMuted}
        />
        <StatusBadge
          variant={enabled ? 'success' : 'neutral'}
          testID="guard-mode-armed-badge">
          {enabled
            ? translate('widget.guardArmed', 'Armed')
            : translate('widget.guardDisarmed', 'Disarmed')}
        </StatusBadge>
      </View>
      <StatusBadge
        variant={eventCount > 0 ? 'warning' : 'neutral'}
        testID="guard-mode-events-badge">
        {`${fmtInt(eventCount)} ${translate('widget.guardEvents', 'events')}`}
      </StatusBadge>
    </View>
  );
}

/* ─── StandardView (web .../GuardModeWidget StandardView) ─────────────────── */

function StandardView({
  enabled,
  sensitivity,
  autoPanic,
  feedItems,
  isCompact,
  t: translate,
}: {
  enabled: boolean;
  sensitivity: string;
  autoPanic: boolean;
  feedItems: EventFeedItem[];
  isCompact: boolean;
  t: TFunction;
}) {
  return (
    <View style={styles.standard} testID="guard-mode-standard">
      {/* Status card */}
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <ShieldGlyph
            glyph={enabled ? 'SC' : 'SO'}
            color={enabled ? colors.success : colors.textMuted}
            large
          />
          <View style={styles.statusText}>
            <AppText weight="semibold" numberOfLines={1} style={styles.statusTitle}>
              {enabled
                ? translate('widget.guardArmed', 'Armed')
                : translate('widget.guardDisarmed', 'Disarmed')}
            </AppText>
            <AppText
              variant="caption"
              tone="muted"
              numberOfLines={1}
              style={styles.statusSubtitle}>
              {`${translate('widget.guardSensitivity', 'Sensitivity')}: ${
                sensitivity ?? FALLBACK
              }${
                autoPanic
                  ? ` \u00b7 ${translate('widget.guardAutoPanic', 'Auto-panic')}`
                  : ''
              }`}
            </AppText>
          </View>
        </View>
        <StatusBadge
          variant={enabled ? 'success' : 'neutral'}
          testID="guard-mode-onoff-badge">
          {enabled
            ? translate('widget.guardOn', 'ON')
            : translate('widget.guardOff', 'OFF')}
        </StatusBadge>
      </View>

      {/* Event feed */}
      <ScrollView
        style={styles.feedScroll}
        contentContainerStyle={styles.feedScrollContent}
        showsVerticalScrollIndicator={false}>
        <WidgetEventFeed
          items={feedItems}
          maxItems={isCompact ? 3 : 5}
          compact={isCompact}
          emptyMessage={translate('widget.guardNoEvents', 'No guard events')}
        />
      </ScrollView>
    </View>
  );
}

/* ─── GuardModeWidget ─────────────────────────────────────────────────────── */

export default function GuardModeWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: config,
    isLoading: configLoading,
    isFetching: configFetching,
    isStale: configStale,
    isError: configError,
    dataUpdatedAt: configUpdatedAt,
    refetch: refetchConfig,
  } = useGuardConfig(id);

  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useGuardEvents(id);

  const isCompact = size.cols <= 1;

  const feedItems = useMemo<EventFeedItem[]>(
    () => (events ?? []).map(ev => mapEventToFeedItem(ev, t)),
    [events],
  );

  const isLoading = configLoading || eventsLoading;
  const isFetching = configFetching || eventsFetching;
  const isStale = configStale || eventsStale;
  const isError = configError || eventsError;
  const updatedAt = Math.max(configUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const enabled = config?.enabled ?? false;
  const sensitivity = config?.sensitivity ?? FALLBACK;
  const autoPanic = config?.auto_panic ?? false;
  const eventCount = (events ?? []).length;

  return (
    <WidgetShell
      title={t('widget.guardMode', 'Guard Mode')}
      icon={<ShieldGlyph glyph="SH" color={colors.success} />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        refetchConfig();
        refetchEvents();
      }}
      testID="guard-mode-widget">
      {config ? (
        isCompact ? (
          <CompactView enabled={enabled} eventCount={eventCount} t={t} />
        ) : (
          <StandardView
            enabled={enabled}
            sensitivity={sensitivity}
            autoPanic={autoPanic}
            feedItems={feedItems}
            isCompact={isCompact}
            t={t}
          />
        )
      ) : (
        <View style={styles.emptyWrap} testID="guard-mode-empty">
          <EmptyState
            title={t('widget.noGuardData', 'No guard data')}
            message=""
          />
        </View>
      )}
    </WidgetShell>
  );
}

GuardModeWidget.displayName = 'GuardModeWidget';

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
  shieldGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldGlyphTextSm: {
    fontSize: 11,
    lineHeight: 14,
  },
  shieldGlyphTextLg: {
    fontSize: 13,
    lineHeight: 16,
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
  badge: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    minHeight: 44,
  },
  compactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    flexShrink: 1,
  },
  standard: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    flexShrink: 0,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    flexShrink: 1,
  },
  statusText: {
    flexShrink: 1,
  },
  statusTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  statusSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
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
  emptyWrap: {
    paddingVertical: spacing.xs,
  },
});
