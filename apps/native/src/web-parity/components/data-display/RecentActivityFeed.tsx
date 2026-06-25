// Native parity port of web/src/components/data-display/RecentActivityFeed.tsx.
//
// Renders a chronological list of audit_logs entries scoped to a single user.
// Each entry maps to an icon + i18n title, an entity_type/entity_id + detail
// subtitle, a relative timestamp, and an optional click-through to the entity.
//
// The web component leans on browser-only deps that have no place in the native
// parity tree, so they are reproduced natively and self-contained here:
//   - react-router-dom `<Link>`        -> a Pressable that calls the new
//     `onNavigate(href)` bridge prop (href still computed by the verbatim
//     `entityHref`, preserving every route path).
//   - react-i18next `useTranslation`   -> the shared native fallback hook.
//   - `@/lib/icons` lucide `Icons`     -> the native SemanticIcon glyph table.
//   - `@/lib/activityIcons`            -> the registry is ported inline, mapping
//     each action to a SemanticIconName (the lucide color stays as data for
//     source parity; like the web feed it is not applied — `color` is undefined,
//     so dots render in the uniform muted tone).
//   - `@/lib/dateFormat` formatRelative-> ported inline with identical buckets.
//   - `./Timeline`                     -> an internal RN timeline mirroring the
//     dot/connector/title/time/subtitle structure.
//   - `@/types/admin` UserActivityEntry-> ported inline (snake_case preserved).
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

/** Universal placeholder returned by the relative-time formatter. */
const EM_DASH = '—';

/**
 * Per-user activity entry returned by `GET /users/me/activity`.
 * Ported from web `@/types/admin`; snake_case remains canonical.
 */
export interface UserActivityEntry {
  id: number;
  ts: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
}

// ---- Ported activity visuals (web/src/lib/activityIcons.ts) -----------------

interface ActivityVisual {
  /** Icon glyph rendered in the timeline dot (native SemanticIcon name). */
  icon: SemanticIconName;
  /**
   * Web Tailwind text/border color class retained as data for source parity.
   * Like the web feed it is not applied to native dots (color stays undefined).
   */
  color: string;
  /** i18n key (no namespace) used to look up a translated label. */
  i18nKey: string;
  /** English fallback when the i18n key is missing. */
  fallback: string;
}

const REGISTRY: Record<string, ActivityVisual> = {
  // Vehicle commands
  'vehicle.command': {
    icon: 'gamepad',
    color: 'text-fuchsia-400',
    i18nKey: 'activity.action.vehicleCommand',
    fallback: 'Vehicle command',
  },
  'vehicle.command.wake': {
    icon: 'power',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandWake',
    fallback: 'Wake vehicle',
  },
  'vehicle.command.honk': {
    icon: 'notificationsActive',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandHonk',
    fallback: 'Honk horn',
  },
  'vehicle.command.flash': {
    icon: 'power',
    color: 'text-yellow-300',
    i18nKey: 'activity.action.vehicleCommandFlash',
    fallback: 'Flash lights',
  },
  'vehicle.command.lock': {
    icon: 'locked',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandLock',
    fallback: 'Lock vehicle',
  },
  'vehicle.command.unlock': {
    icon: 'unlocked',
    color: 'text-amber-300',
    i18nKey: 'activity.action.vehicleCommandUnlock',
    fallback: 'Unlock vehicle',
  },
  'vehicle.command.climate': {
    icon: 'climate',
    color: 'text-sky-300',
    i18nKey: 'activity.action.vehicleCommandClimate',
    fallback: 'Climate command',
  },
  'vehicle.command.charge': {
    icon: 'bolt',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.vehicleCommandCharge',
    fallback: 'Charging command',
  },

  // Settings / preferences
  'settings.update': {
    icon: 'settings',
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settingsUpdate',
    fallback: 'Settings updated',
  },
  settings: {
    icon: 'settings',
    color: 'text-indigo-300',
    i18nKey: 'activity.action.settings',
    fallback: 'Settings change',
  },

  // Alerts
  'alert.rule.create': {
    icon: 'notificationsAdd',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleCreate',
    fallback: 'Alert rule created',
  },
  'alert.rule.update': {
    icon: 'notifications',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleUpdate',
    fallback: 'Alert rule updated',
  },
  'alert.rule.delete': {
    icon: 'notificationsMuted',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alertRuleDelete',
    fallback: 'Alert rule deleted',
  },
  alert: {
    icon: 'notifications',
    color: 'text-rose-300',
    i18nKey: 'activity.action.alert',
    fallback: 'Alert change',
  },

  // Automations
  'automation.create': {
    icon: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationCreate',
    fallback: 'Automation created',
  },
  'automation.update': {
    icon: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationUpdate',
    fallback: 'Automation updated',
  },
  'automation.delete': {
    icon: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automationDelete',
    fallback: 'Automation deleted',
  },
  automation: {
    icon: 'workflow',
    color: 'text-cyan-300',
    i18nKey: 'activity.action.automation',
    fallback: 'Automation change',
  },

  // Dashboard / layout
  'dashboard.layout.save': {
    icon: 'layoutGrid',
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboardLayoutSave',
    fallback: 'Dashboard layout saved',
  },
  dashboard: {
    icon: 'layoutDashboard',
    color: 'text-violet-300',
    i18nKey: 'activity.action.dashboard',
    fallback: 'Dashboard change',
  },

  // Data exports
  'data_export.create': {
    icon: 'download',
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExportCreate',
    fallback: 'Data export requested',
  },
  data_export: {
    icon: 'download',
    color: 'text-teal-300',
    i18nKey: 'activity.action.dataExport',
    fallback: 'Data export',
  },

  // API keys
  'api_key.create': {
    icon: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyCreate',
    fallback: 'API key created',
  },
  'api_key.update': {
    icon: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyUpdate',
    fallback: 'API key updated',
  },
  'api_key.delete': {
    icon: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKeyDelete',
    fallback: 'API key revoked',
  },
  api_key: {
    icon: 'key',
    color: 'text-amber-300',
    i18nKey: 'activity.action.apiKey',
    fallback: 'API key change',
  },

  // Auth
  'auth.login': {
    icon: 'user',
    color: 'text-emerald-300',
    i18nKey: 'activity.action.authLogin',
    fallback: 'Signed in',
  },
  'auth.logout': {
    icon: 'user',
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.authLogout',
    fallback: 'Signed out',
  },
  auth: {
    icon: 'user',
    color: 'text-[var(--text-muted)]',
    i18nKey: 'activity.action.auth',
    fallback: 'Authentication',
  },
};

const FALLBACK_VISUAL: ActivityVisual = {
  icon: 'history',
  color: 'text-[var(--text-muted)]',
  i18nKey: 'activity.action.unknown',
  fallback: 'Activity',
};

/**
 * Resolves an action string to its visual descriptor, falling back to
 * progressively shorter prefixes. `vehicle.command.wake` matches first;
 * if absent, `vehicle.command`, then `vehicle`, then the generic fallback.
 */
export function getActivityVisual(action: string): ActivityVisual {
  if (!action) {
    return FALLBACK_VISUAL;
  }
  const normalized = action.trim();
  if (REGISTRY[normalized]) {
    return REGISTRY[normalized];
  }

  const parts = normalized.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (REGISTRY[prefix]) {
      return REGISTRY[prefix];
    }
  }
  return FALLBACK_VISUAL;
}

// ---- Ported relative-time formatter (web/src/lib/dateFormat.ts) -------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return EM_DASH;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago", else a date. */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return EM_DASH;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return EM_DASH;
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/**
 * Maps an entity_type to a frontend route prefix when click-through makes
 * sense. Returning null means "render the subtitle/title as plain text".
 */
function entityHref(
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (!entityType || !entityId) {
    return null;
  }
  switch (entityType) {
    case 'vehicle':
      return `/vehicles/${encodeURIComponent(entityId)}`;
    case 'drive':
      return `/drives/${encodeURIComponent(entityId)}`;
    case 'charging_session':
    case 'charge':
      return `/charging/${encodeURIComponent(entityId)}`;
    case 'alert_rule':
      return `/notifications/alerts`;
    case 'automation':
      return `/automations`;
    case 'geofence':
      return `/geofences`;
    case 'data_export':
    case 'export':
      return `/data-export`;
    case 'api_key':
      return `/api-keys`;
    default:
      return null;
  }
}

// ---- Internal timeline (web/src/components/data-display/Timeline.tsx) --------

interface TimelineItemData {
  /** Stable React key (native add; web Timeline keyed by array index). */
  id: string | number;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  time: string;
  color?: string;
}

interface ActivityTimelineProps {
  items: TimelineItemData[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

function renderTitle(title: ReactNode): ReactNode {
  if (typeof title === 'string' || typeof title === 'number') {
    return <AppText style={styles.titleText}>{title}</AppText>;
  }
  return title;
}

function renderSubtitle(subtitle: ReactNode): ReactNode {
  if (typeof subtitle === 'string' || typeof subtitle === 'number') {
    return <AppText style={styles.subtitleText}>{subtitle}</AppText>;
  }
  return subtitle;
}

function ActivityTimeline({
  items,
  style,
  testID,
  accessibilityLabel,
}: ActivityTimelineProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.timeline, style]}
      testID={testID}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.gutter}>
              {!isLast ? <View style={styles.connector} /> : null}
              <View
                style={[
                  styles.dot,
                  item.color ? {borderColor: item.color} : styles.dotDefault,
                ]}>
                {item.icon ?? (
                  <View
                    style={[
                      styles.dotInner,
                      item.color
                        ? {backgroundColor: item.color}
                        : styles.dotInnerDefault,
                    ]}
                  />
                )}
              </View>
            </View>
            <View style={styles.content}>
              <View style={styles.headerRow}>
                {renderTitle(item.title)}
                <AppText style={styles.time}>{item.time}</AppText>
              </View>
              {item.subtitle != null ? renderSubtitle(item.subtitle) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---- Component --------------------------------------------------------------

export interface RecentActivityFeedProps {
  entries: UserActivityEntry[];
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Override the empty-state message (i18n-translated by the caller). */
  emptyMessage?: string;
  /**
   * Native click-through bridge. Invoked with the computed entity href
   * (e.g. `/vehicles/123`) when a linkable title is pressed. Replaces the
   * web `<Link to={href}>` navigation. No-op when omitted.
   */
  onNavigate?: (href: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

export function RecentActivityFeed({
  entries,
  className: _className,
  emptyMessage,
  onNavigate,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: RecentActivityFeedProps) {
  const t = useNativeTranslationFallback();
  const list = entries ?? [];

  if (list.length === 0) {
    const message =
      emptyMessage ??
      t('activity.myActivity.empty', 'No recent activity in this window.');
    return (
      <View
        accessible
        accessibilityLabel={accessibilityLabel ?? message}
        style={[styles.empty, style]}
        testID={testID ?? dataTestID ?? 'recent-activity-empty'}>
        <View style={styles.emptyIcon}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.emptyGlyph}
            weight="bold">
            {getSemanticIconDefinition('history').glyph}
          </AppText>
        </View>
        <AppText style={styles.emptyMessage} tone="muted">
          {message}
        </AppText>
      </View>
    );
  }

  const items: TimelineItemData[] = list.map(entry => {
    const visual = getActivityVisual(entry.action);
    const title = t(visual.i18nKey, visual.fallback);

    const href = entityHref(entry.entity_type, entry.entity_id);
    const subtitleParts: string[] = [];
    if (entry.entity_type) {
      subtitleParts.push(
        entry.entity_id
          ? `${entry.entity_type} · ${entry.entity_id}`
          : entry.entity_type,
      );
    }
    if (entry.detail) {
      subtitleParts.push(entry.detail);
    }
    const subtitleText = subtitleParts.join(' — ');

    return {
      id: entry.id,
      icon: (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.iconGlyph}
          weight="bold">
          {getSemanticIconDefinition(visual.icon).glyph}
        </AppText>
      ),
      title: href ? (
        // Render the title as a link so users can jump to the entity. We surface
        // the link in the title (rather than wrapping the whole row) so the
        // relative timestamp on the right stays visually anchored.
        <Pressable
          accessibilityHint={t('activity.openEntity', 'Opens the linked item')}
          accessibilityRole="link"
          hitSlop={6}
          onPress={() => onNavigate?.(href)}>
          <AppText style={[styles.titleText, styles.linkText]}>{title}</AppText>
        </Pressable>
      ) : (
        title
      ),
      subtitle: subtitleText || undefined,
      time: formatRelative(entry.ts),
      color: undefined,
    };
  });

  return (
    <ActivityTimeline
      accessibilityLabel={accessibilityLabel}
      items={items}
      style={style}
      testID={testID ?? dataTestID ?? 'recent-activity-feed'}
    />
  );
}

RecentActivityFeed.displayName = 'RecentActivityFeed';

const styles = StyleSheet.create({
  connector: {
    backgroundColor: colors.border,
    bottom: 0,
    left: 10,
    position: 'absolute',
    top: 24,
    width: 1,
  },
  content: {
    flex: 1,
    paddingTop: 2,
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
  dotDefault: {
    borderColor: colors.border,
  },
  dotInner: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotInnerDefault: {
    backgroundColor: colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 11,
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
  gutter: {
    alignItems: 'center',
    position: 'relative',
    width: 22,
  },
  headerRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  iconGlyph: {
    color: colors.textMuted,
    fontSize: 9,
    letterSpacing: 0.2,
    lineHeight: 12,
    textAlign: 'center',
  },
  linkText: {
    color: colors.accent,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  subtitleText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  time: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 12,
  },
  timeline: {
    gap: 16,
  },
  titleText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
  },
});
