// Native parity port of web/src/components/layout/NotificationBellPopover.tsx.
//
// The web source is an in-place notification triage panel that opens from a
// header bell: a lucide Bell trigger + unread-count badge (`useUnreadCount`,
// polled every 30s), a portaled `role="dialog"` popover anchored to the
// trigger's bbox, and a body that mounts `useUnreadNotifications({ limit: 10 })`
// only while open. Each row joins `useAlertRules` + `useVehicles` for a
// severity dot, title, vehicle name, and relative time; the footer offers
// `useBulkMarkRead({ all: true })` and a "View all" escape hatch. Every
// browser-only piece is adapted to React Native primitives (see the parity
// sidecar for the full line-by-line mapping):
//   • <button>/<div>/<ul>/<li>     -> Pressable / View / AppText.
//   • createPortal(document.body)  -> a React Native <Modal> overlay; the modal
//                                     renders above everything, so no portal.
//   • getBoundingClientRect coords -> dropped; a bbox-anchored fixed popover has
//                                     no RN analog. The panel pins to the
//                                     top-right of the modal overlay (the same
//                                     "dropdown under the bell" visual intent),
//                                     clamped to a 360px max width.
//   • scroll/resize re-position    -> dropped; the modal overlay is viewport
//                                     fixed by construction.
//   • document mousedown/keydown   -> backdrop Pressable (outside-tap close) +
//                                     Modal onRequestClose (Android back / esc).
//   • DOM focus trap + useId       -> dropped; RN <Modal> owns focus + the back
//                                     button. The dialog intent maps to
//                                     accessibilityViewIsModal + accessibilityLabel.
//   • useNavigate (react-router)   -> an `onNavigate(to)` callback prop.
//   • useIsMobile mobile-fallback  -> a `navigateOnTrigger` prop (default false):
//                                     a RN <Modal> popover never clips on narrow
//                                     viewports, so the popover is the default
//                                     path; set it true to mirror the web
//                                     navigate-instead-of-popover branch.
//   • lucide-react icons           -> text-glyph stand-ins (native ships no SVG
//                                     icon set): Bell 🔔, X ✕, AlertTriangle ⚠,
//                                     Check ✓, ChevronRight ›.
//   • cn() Tailwind classes        -> StyleSheet + dynamic style arrays.
//   • formatRelative (@/lib)       -> an inlined native formatRelative with the
//                                     same just-now / m / h / d thresholds and an
//                                     absolute-date fallback past 7 days.
//   • react-i18next t()            -> an inline English-default t(key, fallback)
//                                     (no i18next provider ships in native); all
//                                     keys + fallbacks preserved verbatim.
//
// Behavior, state names (open/count/logs/isLoading/error/rules/vehicles/
// ruleMap/vehicleMap/hasLogs/showSpinner), API paths ('/notifications/inbox'),
// the { all: true } bulk mutation, the limit-10 preview, and the severity
// visual intent are all preserved. No DOM modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {
  useAlertRules,
  useBulkMarkRead,
  useUnreadCount,
  useUnreadNotifications,
} from '../../api/hooks/useNotifications';
import {useVehicles} from '../../api/hooks/useVehicles';
import type {AlertRule, Vehicle} from '../../api/types';

const PREVIEW_LIMIT = 10;
const POPOVER_WIDTH_PX = 360;

/** Native parity ships no react-i18next provider; return the English default. */
function t(_key: string, fallback: string, vars?: Record<string, unknown>): string {
  if (vars) {
    return fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  }
  return fallback;
}

/**
 * Inlined native analog of web/src/lib/dateFormat.ts `formatRelative`. Same
 * just-now / `${m}m ago` / `${h}h ago` / `${d}d ago` thresholds; past 7 days
 * it falls back to a short absolute date instead of an ISO timestamp.
 */
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
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
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Text-glyph stand-ins for the lucide icons (native ships no SVG icon set). */
const GLYPH = {
  bell: '\uD83D\uDD14', // Bell (Icons.notifications)
  close: '\u2715', // X (Icons.close)
  warning: '\u26A0', // AlertTriangle (Icons.warning)
  confirm: '\u2713', // Check (Icons.confirm)
  next: '\u203A', // ChevronRight (Icons.next)
} as const;

type Severity = 'info' | 'warn' | 'critical';

const SEVERITY_TONE: Record<Severity, {dot: string; ring: string; label: string}> = {
  info: {dot: colors.accent, ring: 'rgba(53, 213, 255, 0.3)', label: 'Info'},
  warn: {dot: colors.warning, ring: 'rgba(251, 191, 36, 0.3)', label: 'Warning'},
  critical: {dot: colors.danger, ring: 'rgba(251, 113, 133, 0.4)', label: 'Critical'},
};

function severityOf(rule?: AlertRule): Severity {
  const sev = (rule?.severity ?? 'info') as Severity;
  if (sev === 'warn' || sev === 'critical') {
    return sev;
  }
  return 'info';
}

export interface NotificationBellPopoverProps {
  /**
   * Native navigation hook replacing react-router-dom's `useNavigate`. Fires
   * with a route path on row tap, "View all", and (when `navigateOnTrigger`)
   * the bell trigger. No-op if unwired.
   */
  onNavigate?: (to: string) => void;
  /**
   * Native analog of the web `useIsMobile()` mobile-fallback. When true, tapping
   * the bell navigates straight to `/notifications/inbox` instead of opening the
   * popover (mirrors the web narrow-viewport branch). Defaults to false because a
   * React Native <Modal> popover doesn't clip on small screens.
   */
  navigateOnTrigger?: boolean;
  /**
   * Extra paddingTop for the modal overlay so the panel clears a host header /
   * notch (the native stand-in for the web bbox `top` anchor). Defaults to 56.
   */
  topOffset?: number;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * NotificationBellPopover — a header bell with an unread-count badge that opens
 * a latest-10-unread triage panel. The panel offers "Mark all read" and a
 * "View all" escape hatch to the full inbox; tapping a row navigates to the
 * inbox and closes the panel.
 */
export function NotificationBellPopover({
  onNavigate,
  navigateOnTrigger = false,
  topOffset = 56,
  style,
  testID,
}: NotificationBellPopoverProps = {}) {
  const {data: count = 0} = useUnreadCount();
  const [open, setOpen] = useState(false);

  const handleTriggerPress = useCallback(() => {
    if (navigateOnTrigger) {
      // Blocked Path fallback — mirror the web mobile branch and jump to the
      // full inbox instead of opening the popover.
      onNavigate?.('/notifications/inbox');
      return;
    }
    setOpen(v => !v);
  }, [navigateOnTrigger, onNavigate]);

  const close = useCallback(() => setOpen(false), []);
  const navigateAndClose = useCallback(
    (to: string) => {
      setOpen(false);
      onNavigate?.(to);
    },
    [onNavigate],
  );

  const display = count > 99 ? '99+' : String(count);
  const triggerLabel =
    count > 0
      ? t('nav.notificationsUnread', '{{count}} unread notifications', {count})
      : t('nav.notifications', 'Notifications');

  return (
    <View
      style={[styles.root, style]}
      testID={testID ?? 'notification-bell-popover'}>
      <Pressable
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleTriggerPress}
        style={({pressed}) => [styles.trigger, pressed && styles.triggerPressed]}
        testID="notification-bell-trigger">
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.triggerGlyph}>
          {GLYPH.bell}
        </AppText>
        {count > 0 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.badge}
            testID="notification-bell-badge">
            <AppText style={styles.badgeText} weight="bold">
              {display}
            </AppText>
          </View>
        ) : null}
      </Pressable>

      {open ? (
        <Modal
          animationType="fade"
          onRequestClose={close}
          transparent
          visible={open}>
          <View style={[styles.overlay, {paddingTop: topOffset}]}>
            <Pressable
              accessibilityElementsHidden
              accessibilityLabel={t('common.close', 'Close')}
              importantForAccessibility="no-hide-descendants"
              onPress={close}
              style={styles.backdrop}
            />
            <NotificationBellPanel
              unreadBadgeCount={count}
              onClose={close}
              onNavigate={navigateAndClose}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

NotificationBellPopover.displayName = 'NotificationBellPopover';

interface NotificationBellPanelProps {
  unreadBadgeCount: number;
  onClose: () => void;
  onNavigate: (to: string) => void;
}

function NotificationBellPanel({
  unreadBadgeCount,
  onClose,
  onNavigate,
}: NotificationBellPanelProps) {
  const {data: logs = [], isLoading, error} = useUnreadNotifications({
    limit: PREVIEW_LIMIT,
  });
  const {data: rules = []} = useAlertRules();
  const {data: vehicles = []} = useVehicles();
  const bulkMarkRead = useBulkMarkRead();

  const ruleMap = useMemo(() => {
    const m: Record<number, AlertRule> = {};
    for (const r of rules ?? []) {
      if (r?.id != null) {
        m[r.id] = r;
      }
    }
    return m;
  }, [rules]);

  const vehicleMap = useMemo(() => {
    const m: Record<number, Vehicle> = {};
    for (const v of vehicles ?? []) {
      if (v?.id != null) {
        m[v.id] = v;
      }
    }
    return m;
  }, [vehicles]);

  const hasLogs = logs.length > 0;
  const showSpinner = isLoading && !hasLogs;

  const handleMarkAllRead = useCallback(() => {
    // Empty preview means there's nothing to mark — the badge can still be > 0
    // transiently after a manual mark, but firing the mutation in that window
    // is a harmless no-op server-side.
    if (logs.length === 0) {
      return;
    }
    bulkMarkRead.mutate({all: true});
  }, [bulkMarkRead, logs.length]);

  return (
    <View
      accessibilityLabel={t('notifications.bellPopover.title', 'Notifications')}
      accessibilityViewIsModal
      accessible={false}
      style={styles.panel}
      testID="notification-bell-panel">
      <View style={styles.header}>
        <View style={styles.headerTitles}>
          <AppText style={styles.title} weight="semibold">
            {t('notifications.bellPopover.title', 'Notifications')}
          </AppText>
          <AppText style={styles.subtitle}>
            {unreadBadgeCount > 0
              ? t('notifications.bellPopover.unreadCount', '{{count}} unread', {
                  count: unreadBadgeCount,
                })
              : t('notifications.bellPopover.allRead', 'All caught up')}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel={t('common.close', 'Close')}
          accessibilityRole="button"
          onPress={onClose}
          style={({pressed}) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
          ]}
          testID="notification-bell-close">
          <AppText style={styles.iconButtonGlyph}>{GLYPH.close}</AppText>
        </Pressable>
      </View>

      <ScrollView
        bounces={false}
        keyboardShouldPersistTaps="handled"
        style={styles.body}>
        {showSpinner ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            style={styles.stateBlock}>
            <AppText style={styles.mutedState} variant="caption">
              {t('notifications.bellPopover.loading', 'Loading\u2026')}
            </AppText>
          </View>
        ) : null}

        {!showSpinner && error ? (
          <View
            accessibilityRole="alert"
            style={[styles.stateBlock, styles.stateBlockTight]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.errorGlyph}>
              {GLYPH.warning}
            </AppText>
            <AppText style={styles.errorText} variant="caption">
              {t(
                'notifications.bellPopover.error',
                'Could not load notifications',
              )}
            </AppText>
          </View>
        ) : null}

        {!showSpinner && !error && !hasLogs ? (
          <View style={[styles.stateBlock, styles.emptyBlock]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.emptyGlyph}>
              {GLYPH.bell}
            </AppText>
            <AppText style={styles.emptyTitle} weight="semibold">
              {t(
                'notifications.bellPopover.emptyTitle',
                "You're all caught up",
              )}
            </AppText>
            <AppText style={styles.emptyMessage} variant="caption">
              {t(
                'notifications.bellPopover.emptyMessage',
                'No unread notifications right now.',
              )}
            </AppText>
          </View>
        ) : null}

        {!showSpinner && !error && hasLogs ? (
          <View testID="bell-popover-list">
            {logs.map((log, index) => {
              const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
              const vehicle =
                rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
              const tone = SEVERITY_TONE[severityOf(rule)];
              return (
                <Pressable
                  accessibilityRole="button"
                  key={log.id}
                  onPress={() => onNavigate('/notifications/inbox')}
                  style={({pressed}) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  testID={`bell-popover-row-${log.id}`}>
                  <View
                    accessibilityLabel={tone.label}
                    style={[
                      styles.severityDot,
                      {backgroundColor: tone.dot, borderColor: tone.ring},
                    ]}
                  />
                  <View style={styles.rowBody}>
                    <AppText
                      numberOfLines={1}
                      style={styles.rowTitle}
                      weight="semibold">
                      {log.title ||
                        rule?.name ||
                        t('notifications.bellPopover.untitled', 'Notification')}
                    </AppText>
                    {log.message ? (
                      <AppText
                        numberOfLines={1}
                        style={styles.rowMessage}
                        variant="caption">
                        {log.message}
                      </AppText>
                    ) : null}
                    <View style={styles.rowMeta}>
                      <AppText style={styles.rowMetaText} variant="caption">
                        {formatRelative(log.created_at)}
                      </AppText>
                      {vehicle ? (
                        <>
                          <AppText
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            style={styles.rowMetaText}
                            variant="caption">
                            {'\u00B7'}
                          </AppText>
                          <AppText
                            numberOfLines={1}
                            style={styles.rowMetaText}
                            variant="caption">
                            {vehicle.display_name || `#${vehicle.id}`}
                          </AppText>
                        </>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityLabel={t(
            'notifications.bellPopover.markAllRead',
            'Mark all read',
          )}
          accessibilityRole="button"
          accessibilityState={{disabled: !hasLogs || bulkMarkRead.isPending}}
          disabled={!hasLogs || bulkMarkRead.isPending}
          onPress={handleMarkAllRead}
          style={({pressed}) => [
            styles.footerButton,
            (!hasLogs || bulkMarkRead.isPending) && styles.footerButtonDisabled,
            pressed && hasLogs && !bulkMarkRead.isPending && styles.footerButtonPressed,
          ]}
          testID="notification-bell-mark-all-read">
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.footerSecondaryGlyph}>
            {GLYPH.confirm}
          </AppText>
          <AppText style={styles.footerSecondaryText} weight="semibold">
            {t('notifications.bellPopover.markAllRead', 'Mark all read')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel={t('notifications.bellPopover.viewAll', 'View all')}
          accessibilityRole="button"
          onPress={() => onNavigate('/notifications/inbox')}
          style={({pressed}) => [
            styles.footerButton,
            pressed && styles.footerButtonPressed,
          ]}
          testID="notification-bell-view-all">
          <AppText style={styles.footerPrimaryText} weight="semibold">
            {t('notifications.bellPopover.viewAll', 'View all')}
          </AppText>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.footerPrimaryGlyph}>
            {GLYPH.next}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

NotificationBellPanel.displayName = 'NotificationBellPanel';

export default NotificationBellPopover;

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    position: 'relative',
    width: 36,
  },
  triggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  triggerGlyph: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 22,
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: 'rgba(253, 164, 175, 0.6)',
    borderRadius: 999,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    minWidth: 16,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -2,
    top: -2,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 12,
  },
  overlay: {
    alignItems: 'flex-end',
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: '82%',
    maxWidth: '100%',
    overflow: 'hidden',
    width: POPOVER_WIDTH_PX,
    ...shadows.panel,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTitles: {
    flex: 1,
    flexDirection: 'column',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconButtonGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  body: {
    flexGrow: 0,
  },
  stateBlock: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 32,
  },
  stateBlockTight: {
    paddingVertical: 32,
  },
  mutedState: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorGlyph: {
    color: colors.danger,
    fontSize: 18,
    lineHeight: 22,
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },
  emptyBlock: {
    paddingVertical: 40,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 28,
    lineHeight: 34,
    opacity: 0.6,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyMessage: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    borderTopWidth: 1,
  },
  rowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  severityDot: {
    borderRadius: 999,
    borderWidth: 2,
    height: 8,
    marginTop: 6,
    width: 8,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  rowMessage: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  rowMetaText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  footerButton: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  footerButtonDisabled: {
    opacity: 0.5,
  },
  footerButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  footerSecondaryGlyph: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 16,
  },
  footerSecondaryText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  footerPrimaryText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  footerPrimaryGlyph: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },
});
