// CommandHistoryWidget — native parity port of
// web/src/features/dashboard/widgets/CommandHistoryWidget.tsx.
//
// The dashboard "Command History" widget. It resolves a vehicle from the
// explicit `vehicleId` prop, falling back to the first vehicle (`useVehicles`),
// then reads that vehicle's command log (`GET /vehicles/{id}/commands/history`
// via useCommandHistory). A 1-column layout renders a compact "last command +
// status badge" row; wider layouts render the full chronological event feed
// (max 10). Every state name (vehicles, vid, vidStr, commands, list, feedItems,
// lastEntry, isCompact), API path, status→visual mapping, command-name builder,
// i18n key + English fallback and render branch is preserved verbatim from the
// web source; all 140 source lines are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - lucide-react Terminal/CheckCircle/XCircle/Clock (web L3) -> the native
//     SemanticIcon glyph table (terminal / success / error / clock) rendered via
//     getSemanticIconDefinition; lucide is browser-only. The status hex palette
//     stored on STATUS_MAP/DEFAULT_STATUS (#22c55e / #ef4444 / #f59e0b / #6b7280)
//     is carried over VERBATIM and applied to the glyph + timeline dot. The web
//     stored a ready-made lucide node on STATUS_MAP.icon; the native map stores
//     the equivalent SemanticIconName + color + severity and builds the glyph
//     node at feed-map time (identical visual result, same severity tag).
//   - react-i18next useTranslation('dashboard') (web L2) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — no i18n runtime in RN); the `t` handed to
//     CompactView keeps the exact (key, fallback) => string signature.
//   - @/components/ui Badge (web L4) -> an inline native Badge pill that maps the
//     web variant prop values (success / danger / warning) to the success /
//     danger / warning surface+border+text theme tokens — the ui barrel Badge is
//     a DOM <span> and is not in the native parity manifest.
//   - @/components/feedback EmptyState (web L5) -> an inline native EmptyState
//     (centered icon chip + muted message) — the feedback barrel is not in the
//     native parity manifest, so it is reproduced self-contained per the
//     AuditLogWidget precedent.
//   - @/api/hooks useCommandHistory/useVehicles (web L6-7) -> imported from their
//     canonical converted native hooks (../../../api/hooks/*) — same query keys,
//     same /vehicles + /vehicles/{id}/commands/history paths, same select: data
//     ?? [] behaviour.
//   - ./WidgetShell + ./shared WidgetEventFeed + ./types WidgetProps + ./shared
//     EventFeedItem (web L8-11) -> reproduced self-contained here: these sibling
//     widget primitives have their own (later) manifest entries and are not yet
//     in the native tree, so the shell chrome, the event-feed timeline, and the
//     WidgetProps/WidgetSize/EventFeedItem types are ported inline (AuditLogWidget
//     established this inline-reproduction pattern). WidgetShell's browser-only
//     DataFreshness/PinButton/HelpTooltip/Skeleton/QueryError chrome becomes a
//     native-safe freshness pill (relative "updated" time + a refresh Pressable
//     wired to onRefresh, with stale/error/fetching markers) and a dimmed
//     skeleton box; the full DataFreshness surface stays owned by its own turn.
//   - the web `<div className="flex-1 min-h-0 overflow-y-auto">` feed wrapper
//     (web L128) -> a flex View; per-widget scrolling is delegated to the outer
//     native dashboard container (the same choice AuditLogWidget's native feed
//     makes), so no nested ScrollView / open timer is introduced.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon, the parity hooks, and theme tokens.

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
import {useCommandHistory} from '../../../api/hooks/useCommands';
import {useVehicles} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps, ./shared EventFeedItem) ─────

type Severity = 'info' | 'warning' | 'critical';

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
 * type's optional `href` drill-through is omitted: the command-history widget
 * never sets a per-item href, so no native navigation bridge is needed here.
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

// ── Status → visual mapping (web STATUS_MAP / DEFAULT_STATUS) ─────────────────

/**
 * Status -> {SemanticIcon glyph name, hex color, severity}. Native translation
 * of the web lucide STATUS_MAP (success=CheckCircle #22c55e info, failed=XCircle
 * #ef4444 critical, pending=Clock #f59e0b warning). The hex colors are carried
 * over VERBATIM and applied to the glyph + timeline dot.
 */
const STATUS_MAP: Record<
  string,
  {iconName: SemanticIconName; color: string; severity: Severity}
> = {
  success: {iconName: 'success', color: '#22c55e', severity: 'info'},
  failed: {iconName: 'error', color: '#ef4444', severity: 'critical'},
  pending: {iconName: 'clock', color: '#f59e0b', severity: 'warning'},
};

/** Web DEFAULT_STATUS: Terminal glyph, #6b7280, 'info'. */
const DEFAULT_STATUS = {
  iconName: 'terminal' as SemanticIconName,
  color: '#6b7280',
  severity: 'info' as const,
};

function formatCommandName(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Inline native Badge (web @/components/ui Badge) ──────────────────────────

type BadgeVariant = 'success' | 'danger' | 'warning';

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
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? t('widget.noEvents', 'No events yet')}
      />
    );
  }

  return (
    <View style={styles.feed}>
      {sorted.map((item, i) => {
        const isLast = i === sorted.length - 1;
        return (
          <View key={item.id} style={styles.feedRow}>
            <View style={styles.gutter}>
              {!isLast ? <View style={styles.connector} /> : null}
              <View style={[styles.dot, {borderColor: item.color}]}>
                {item.icon}
              </View>
            </View>
            <View style={styles.feedContent}>
              <View style={styles.feedHeaderRow}>
                <AppText numberOfLines={1} style={styles.feedTitle}>
                  {item.title}
                </AppText>
                <AppText style={styles.feedTime}>
                  {formatRelativeTime(item.timestamp)}
                </AppText>
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
  lastCommand,
  lastStatus,
  t,
}: {
  lastCommand: string;
  lastStatus: string;
  t: (key: string, fallback: string) => string;
}) {
  const variant: BadgeVariant =
    lastStatus === 'success'
      ? 'success'
      : lastStatus === 'failed'
        ? 'danger'
        : 'warning';
  const label =
    lastStatus === 'success'
      ? t('widget.commandSuccess', 'Success')
      : lastStatus === 'failed'
        ? t('widget.commandFailed', 'Failed')
        : t('widget.commandPending', 'Pending');

  return (
    <View style={styles.compactRow}>
      <View style={styles.compactLeft}>
        {glyphNode('terminal', colors.accent, styles.compactGlyph)}
        <AppText numberOfLines={1} style={styles.compactCommand}>
          {lastCommand}
        </AppText>
      </View>
      <Badge variant={variant}>{label}</Badge>
    </View>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export default function CommandHistoryWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: commands,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCommandHistory(vidStr);

  const isCompact = size.cols <= 1;
  // web: `const list = commands ?? []` — wrapped in useMemo so the value is a
  // stable reference for the feedItems memo deps (react-hooks/exhaustive-deps),
  // preserving the exact `commands ?? []` semantics.
  const list = useMemo(() => commands ?? [], [commands]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map(cmd => {
        const mapped = STATUS_MAP[cmd.status] ?? DEFAULT_STATUS;
        return {
          id: cmd.id,
          icon: glyphNode(mapped.iconName, mapped.color, styles.iconGlyph),
          title: formatCommandName(cmd.command ?? '—'),
          subtitle: cmd.status ?? '—',
          timestamp: cmd.created_at ?? new Date(0).toISOString(),
          color: mapped.color,
          severity: mapped.severity,
        };
      }),
    [list],
  );

  const lastEntry = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.commandHistory', 'Command History')}
      icon={glyphNode('terminal', colors.accent, styles.headerGlyph)}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {isCompact ? (
        lastEntry ? (
          <CompactView
            lastCommand={formatCommandName(lastEntry.command ?? '—')}
            lastStatus={lastEntry.status ?? '—'}
            t={t}
          />
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <EmptyState
            icon={glyphNode('terminal', colors.textMuted, styles.emptyGlyph)}
            message={t('widget.noCommands', 'No commands sent')}
          />
        )
      ) : (
        <View style={styles.feedScroll}>
          <WidgetEventFeed
            items={feedItems}
            maxItems={10}
            compact={false}
            emptyMessage={t('widget.noCommands', 'No commands sent')}
            emptyIcon={glyphNode('terminal', colors.textMuted, styles.emptyGlyph)}
          />
        </View>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  compactCommand: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  compactGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  compactLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 44,
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
  headerGlyph: {
    fontSize: 11,
    lineHeight: 14,
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
    justifyContent: 'center',
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
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
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
  danger: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
