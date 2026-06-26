// AuditLogWidget — native parity port of
// web/src/features/dashboard/widgets/AuditLogWidget.tsx.
//
// The dashboard "Audit Log" widget. It merges two API feeds — admin audit_logs
// (`GET /system/audit` via useAuditLogs) and per-vehicle security events
// (`GET /security?vehicle_id=` via useSecurityEvents) — into a single severity-
// tagged event feed. The vehicle is resolved from the explicit `vehicleId`
// prop, falling back to the first vehicle (`useVehicles`). A 1-column layout
// renders a compact 24h count + worst-severity badge; wider layouts render the
// full chronological feed (max 15). Every state name, API path, derived value,
// inferred-severity rule, security-title builder, i18n key + English fallback
// and render branch is preserved verbatim from the web source; all 206 source
// lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - lucide-react FileSearch/Info/AlertTriangle/AlertOctagon/ShieldAlert
//     (web L3) -> the native SemanticIcon glyph table (scanSearch / info /
//     warning / severityCritical / securityAlert); lucide is browser-only. The
//     severity hex palette (SEVERITY_COLOR) is carried over verbatim and applied
//     to the glyph + timeline dot.
//   - react-i18next useTranslation('dashboard') (web L2/L92) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — no i18n runtime in RN); the `t` handed to
//     CompactView keeps the exact (key, fallback) => string signature.
//   - @/components/feedback EmptyState (web L4) -> an inline native EmptyState
//     (centered icon + muted message) — the feedback barrel is not in the native
//     parity manifest, so it is reproduced self-contained per the DashboardGrid
//     precedent.
//   - ./WidgetShell + ./shared WidgetEventFeed/WidgetBigNumber + ./types
//     WidgetProps / EventFeedItem (web L7-10) -> reproduced self-contained here:
//     these sibling widget primitives have their own (later) manifest entries
//     and are not yet in the native tree, so the shell chrome, the event-feed
//     timeline, the big-number+badge, and the WidgetProps/EventFeedItem types
//     are ported inline (DashboardGrid established this inline-reproduction
//     pattern for not-yet-converted siblings). WidgetShell's browser-only
//     DataFreshness/PinButton/HelpTooltip/Skeleton/QueryError chrome becomes a
//     native-safe freshness pill (relative "updated" time + a refresh Pressable
//     wired to onRefresh, with stale/error/fetching markers) and a dimmed
//     skeleton box; the full DataFreshness surface stays owned by its own turn.
//   - @/api/hooks useAuditLogs/useSecurityEvents/useVehicles (web L5-6) ->
//     imported from their canonical converted native hooks (../../../api/hooks/*)
//     — same query keys, same API paths, same select: safeArray behaviour.
//   - @/components/data-display AnimatedNumber (web, via WidgetBigNumber) ->
//     the canonical converted native AnimatedNumber component.
//   - the web `<div className="flex-1 min-h-0 overflow-y-auto">` feed wrapper
//     (web L194) -> a flex View; per-widget scrolling is delegated to the outer
//     native dashboard container (the same choice DashboardGrid's native stack
//     makes), so no nested ScrollView / open timer is introduced.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + AnimatedNumber + SemanticIcon, the parity hooks, and
// theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useAuditLogs, useSecurityEvents} from '../../../api/hooks/useAdmin';
import {useVehicles} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps, ./shared EventFeedItem) ─────

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

/**
 * A single severity-tagged feed row (web `./shared` EventFeedItem). The shared
 * type's optional `href` drill-through is omitted: the audit widget never sets
 * a per-item href, so no native navigation bridge is needed here.
 */
interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: Severity;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Severity → visual mapping ────────────────────────────────────────────────

/**
 * Severity -> SemanticIcon glyph name (native translation of the web lucide
 * SEVERITY_ICON map: info=Info, warning=AlertTriangle, critical=AlertOctagon).
 */
const SEVERITY_ICON_NAME: Record<Severity, SemanticIconName> = {
  info: 'info',
  warning: 'warning',
  critical: 'severityCritical',
} as const;

/** Severity -> hex color (web SEVERITY_COLOR, carried over verbatim). */
const SEVERITY_COLOR = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

type Severity = 'info' | 'warning' | 'critical';

/**
 * Renders a decorative severity/entity glyph in the given color, replacing the
 * web lucide `<Icon className="h-3.5 w-3.5" />` icon nodes stored on each
 * EventFeedItem / passed to the shell + empty states.
 */
function glyphNode(name: SemanticIconName, color: string): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.iconGlyph, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

function inferAuditSeverity(action: string): Severity {
  const lower = (action ?? '').toLowerCase();
  if (lower.includes('delete') || lower.includes('revoke') || lower.includes('fail')) return 'critical';
  if (lower.includes('update') || lower.includes('change') || lower.includes('modify')) return 'warning';
  return 'info';
}

function inferSecuritySeverity(event: {locked: boolean | null; sentryMode: string | boolean | null}): Severity {
  if (event.locked === false) return 'critical';
  if (event.sentryMode === 'active' || event.sentryMode === true) return 'warning';
  return 'info';
}

function buildSecurityTitle(event: {
  locked: boolean | null;
  sentryMode: string | boolean | null;
  doorState: string | boolean | null;
  guestMode: boolean | null;
  valetModeEnabled: boolean | null;
}): string {
  const parts: string[] = [];
  if (event.locked !== null) parts.push(event.locked ? 'Vehicle locked' : 'Vehicle unlocked');
  if (event.sentryMode) {
    const sentryLabel = typeof event.sentryMode === 'string' ? event.sentryMode : 'On';
    parts.push(`Sentry: ${sentryLabel}`);
  }
  if (event.doorState) {
    const doorLabel = typeof event.doorState === 'string' ? event.doorState : 'Open';
    parts.push(`Door: ${doorLabel}`);
  }
  if (event.guestMode !== null) parts.push(event.guestMode ? 'Guest mode on' : 'Guest mode off');
  if (event.valetModeEnabled !== null) parts.push(event.valetModeEnabled ? 'Valet mode on' : 'Valet mode off');
  return parts.length > 0 ? parts[0] : 'Security event';
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

// ── Inline native WidgetBigNumber (web ./shared WidgetBigNumber) ──────────────

type BigNumberBadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

function WidgetBigNumber({
  value,
  label,
  badge,
}: {
  value: number | null;
  label?: string;
  badge?: {text: string; variant: BigNumberBadgeVariant};
}) {
  return (
    <View style={styles.bigNumberWrap}>
      {value !== null ? (
        <AnimatedNumber value={value} style={styles.bigNumber} />
      ) : (
        <AppText style={styles.bigNumberNull}>—</AppText>
      )}
      {label ? <AppText style={styles.bigNumberLabel}>{label}</AppText> : null}
      {badge ? (
        <View style={[styles.badge, badgeVariantStyles[badge.variant]]}>
          <AppText style={[styles.badgeText, badgeTextStyles[badge.variant]]}>{badge.text}</AppText>
        </View>
      ) : null}
    </View>
  );
}

// ── Inline native WidgetEventFeed (web ./shared WidgetEventFeed) ──────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Web WidgetEventFeed.formatRelativeTime: <1m "Just now", <60m "Xm ago",
 *  <24h "Xh ago", else the absolute date-time. */
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

function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
}: {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}) {
  const t = useNativeTranslationFallback();

  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...items]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage ?? t('widget.noEvents', 'No events yet')} />;
  }

  return (
    <View style={styles.feed}>
      {sorted.map((item, i) => {
        const isLast = i === sorted.length - 1;
        return (
          <View key={item.id} style={styles.feedRow}>
            <View style={styles.gutter}>
              {!isLast ? <View style={styles.connector} /> : null}
              <View style={[styles.dot, {borderColor: item.color}]}>{item.icon}</View>
            </View>
            <View style={styles.feedContent}>
              <View style={styles.feedHeaderRow}>
                <AppText numberOfLines={1} style={styles.feedTitle}>
                  {item.title}
                </AppText>
                <AppText style={styles.feedTime}>{formatRelativeTime(item.timestamp)}</AppText>
              </View>
              {item.subtitle != null ? (
                <AppText numberOfLines={2} style={styles.feedSubtitle}>
                  {item.subtitle}
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
  else if (updatedAt > 0) label = formatRelativeTime(new Date(updatedAt).toISOString());
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
          isError ? styles.freshnessError : isStale ? styles.freshnessStale : null,
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

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
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

// ── Compact layout (1×2) ──────────────────────────────────────────────────────

function CompactView({
  totalEvents24h,
  worstSeverity,
  t,
}: {
  totalEvents24h: number;
  worstSeverity: Severity;
  t: (key: string, fallback: string) => string;
}) {
  const badgeLabel =
    worstSeverity === 'critical'
      ? t('widget.auditCritical', 'Critical')
      : worstSeverity === 'warning'
        ? t('widget.auditWarning', 'Warning')
        : t('widget.auditInfo', 'Info');

  return (
    <WidgetBigNumber
      value={totalEvents24h}
      label={t('widget.auditEvents24h', 'Events (24h)')}
      badge={{
        text: badgeLabel,
        variant: worstSeverity === 'critical' ? 'error' : worstSeverity === 'warning' ? 'warning' : 'neutral',
      }}
    />
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function AuditLogWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : '';

  const {
    data: auditLogs,
    isLoading: auditLoading,
    isFetching: auditFetching,
    isStale: auditStale,
    isError: auditIsError,
    dataUpdatedAt: auditUpdatedAt,
    refetch: auditRefetch,
  } = useAuditLogs();

  const {
    data: securityEvents,
    isLoading: secLoading,
    isFetching: secFetching,
    isStale: secStale,
    isError: secIsError,
    dataUpdatedAt: secUpdatedAt,
    refetch: secRefetch,
  } = useSecurityEvents(vidStr);

  const isLoading = auditLoading || secLoading;
  const isFetching = auditFetching || secFetching;
  const isStale = auditStale || secStale;
  const isError = auditIsError || secIsError;
  const updatedAt = Math.max(auditUpdatedAt ?? 0, secUpdatedAt ?? 0);

  const isCompact = size.cols <= 1;

  const feedItems = useMemo<EventFeedItem[]>(() => {
    const logs = (auditLogs ?? []).map((entry) => {
      const sev = inferAuditSeverity(entry.action);
      return {
        id: `audit-${entry.id}`,
        icon: glyphNode(SEVERITY_ICON_NAME[sev], SEVERITY_COLOR[sev]),
        title: entry.action ?? '—',
        subtitle: [entry.resource, entry.details].filter(Boolean).join(' · ') || '—',
        timestamp: entry.createdAt ?? new Date(0).toISOString(),
        color: SEVERITY_COLOR[sev],
        severity: sev,
      } satisfies EventFeedItem;
    });

    const events = (securityEvents ?? []).map((event) => {
      const sev = inferSecuritySeverity(event);
      return {
        id: `sec-${event.id}`,
        icon: glyphNode('securityAlert', SEVERITY_COLOR[sev]),
        title: buildSecurityTitle(event),
        subtitle: t('widget.auditSecurityEvent', 'Security event'),
        timestamp: event.createdAt ?? new Date(0).toISOString(),
        color: SEVERITY_COLOR[sev],
        severity: sev,
      } satisfies EventFeedItem;
    });

    return [...logs, ...events];
  }, [auditLogs, securityEvents, t]);

  // Compute 24h stats for compact view
  const {totalEvents24h, worstSeverity} = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const recent = feedItems.filter((item) => new Date(item.timestamp).getTime() >= dayAgo);
    let worst: Severity = 'info';
    for (const item of recent) {
      if (item.severity === 'critical') {
        worst = 'critical';
        break;
      }
      if (item.severity === 'warning') worst = 'warning';
    }
    return {totalEvents24h: recent.length, worstSeverity: worst};
  }, [feedItems]);

  return (
    <WidgetShell
      title={t('widget.auditLog', 'Audit Log')}
      icon={glyphNode('scanSearch', colors.accent)}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        auditRefetch();
        secRefetch();
      }}>
      {isCompact ? (
        feedItems.length > 0 ? (
          <CompactView totalEvents24h={totalEvents24h} worstSeverity={worstSeverity} t={t} />
        ) : (
          <EmptyState
            icon={glyphNode('scanSearch', colors.textMuted)}
            message={t('widget.noAuditEvents', 'No audit events')}
          />
        )
      ) : (
        <View style={styles.feedScroll}>
          <WidgetEventFeed
            items={feedItems}
            maxItems={15}
            compact={false}
            emptyMessage={t('widget.noAuditEvents', 'No audit events')}
            emptyIcon={glyphNode('scanSearch', colors.textMuted)}
          />
        </View>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  bigNumber: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
  },
  bigNumberLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  bigNumberNull: {
    color: colors.textMuted,
    fontSize: 30,
    fontWeight: '700',
  },
  bigNumberWrap: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  connector: {
    backgroundColor: colors.border,
    bottom: 0,
    left: 10,
    position: 'absolute',
    top: 24,
    width: 1,
  },
  dot: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
    zIndex: 1,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
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
  feed: {
    gap: 12,
  },
  feedContent: {
    flex: 1,
    paddingTop: 2,
  },
  feedHeaderRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  feedRow: {
    flexDirection: 'row',
    gap: 12,
  },
  feedScroll: {
    flex: 1,
  },
  feedSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  feedTime: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 12,
  },
  feedTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
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
  gutter: {
    alignItems: 'center',
    position: 'relative',
    width: 22,
  },
  iconGlyph: {
    fontSize: 9,
    letterSpacing: 0.2,
    lineHeight: 12,
    textAlign: 'center',
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
});

const badgeVariantStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
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
  error: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
