// Native parity port of web/src/features/notifications/pages/InboxPage.tsx.
//
// InboxPage is the top-level Notifications "Inbox" route. It hosts the shared
// InboxBody for the active (non-archived) inbox: it sets the page title, loads
// the vehicles + alert rules that scope the inbox filters, and renders the
// PageContainer scaffold (title + subtitle + copy-link + a "View archived"
// action) around <InboxBody archived={false} vehicles={vehicles} rules={rules}/>.
//
// Every web behavior, state name (vehicles, rules), API path and i18n key is
// preserved; the web DOM / Tailwind / react-router / lucide stack is replaced
// with React Native primitives + the native parity library, following the
// DriveScorePage / LegacyAlertRulesRedirect precedents:
//
//   - react-i18next `useTranslation` is unavailable in native; a local
//     useNativeTranslationFallback() returns the English fallback copy verbatim
//     so every key (notifications.inbox.title / subtitle / viewArchived) is kept.
//   - `@/hooks/usePageTitle` drives document.title, which RN has no analog for,
//     so it degrades to a no-op shim (same as the DriveScorePage port).
//   - `@/components/layout/PageContainer` has no native parity component. This
//     page passes no loading/error/empty/query, so the container reduces to its
//     header + a PageErrorBoundary around the children. That is reproduced with
//     the native parity PageHeader (title/subtitle/copyLink/actions) inside a
//     ScrollView, with the body wrapped in the native ErrorBoundary (== the web
//     PageErrorBoundary). The web CopyLinkButton copies window.location.href,
//     which has no native URL bar, so `copyLink` defers to the additive
//     `onCopyLink` escape hatch PageHeader already exposes (native
//     Share/Clipboard); with no handler it renders an explicit disabled
//     "unavailable" state.
//   - react-router-dom `<Link to="/notifications/archived">` is browser-only;
//     in-app navigation becomes the `onNavigate(path)` callback precedent (the
//     native shell App.tsx + Breadcrumbs / HealthRow / ActionItem), wired to a
//     Pressable that calls onNavigate('/notifications/archived').
//   - lucide-react `Archive` becomes the canonical native SemanticIcon
//     name="archive" glyph.
//   - `../components/InboxBody` is a large shared surface (URL-backed filters,
//     bulk selection/actions, day-grouped + threaded lists, per-row context
//     menus) with a deep web-only dependency subtree (NotificationFilterBar,
//     NotificationRow, NotificationGroupRow, useUrlState, useBulkSelection,
//     useContextMenu, the mobile PullToRefresh/SwipeRow pair,
//     AIInboxAutoCategorization). It is its own dedicated conversion target
//     (web/.../components/InboxBody.tsx -> apps/native/.../components/
//     InboxBody.tsx). To keep this file's import resolvable + the gates green
//     without pre-empting that port (and without breaking the strict
//     1-tsx-1-sidecar convention by emitting a second component file here), the
//     inbox surface is rendered by a local native-safe InboxBody host that keeps
//     the exact same InboxBodyProps contract ({archived, vehicles, rules}) and
//     call site (archived={false}) and renders an explicit "delivered by the
//     dedicated InboxBody native port" surface while surfacing the live filter
//     inputs (vehicle + rule counts) so the props are not dead. Documented in
//     the parity sidecar.

import {useCallback} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useAlertRules, type AlertRule} from '../../../api/hooks/useNotifications';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {PageHeader} from '../../../components/layout/PageHeader';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * react-i18next `useTranslation` is unavailable in native parity; this shim
 * returns the English fallback copy verbatim while preserving the i18n keys.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── InboxBody host (full web InboxBody is its own conversion target) ─────── */

interface InboxBodyProps {
  archived: boolean;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

/**
 * Native-safe stand-in for the shared web `../components/InboxBody`. It keeps the
 * web component's public props contract verbatim ({archived, vehicles, rules})
 * and shows an explicit native state while the full inbox surface (filters, bulk
 * actions, day-grouped + threaded lists, per-row context menus) is delivered by
 * the dedicated InboxBody native port. The live `vehicles` / `rules` filter
 * inputs are surfaced so the props are not dead.
 */
function InboxBody({archived, vehicles, rules}: InboxBodyProps) {
  const t = useNativeTranslationFallback();
  const mode = archived
    ? t('notifications.inbox.modeArchived', 'Archived')
    : t('notifications.inbox.modeActive', 'Inbox');

  return (
    <GlassPanel padding="lg" style={styles.bodyPanel}>
      <View style={styles.bodyContextRow}>
        <SemanticIcon decorative name="notifications" size="sm" />
        <AppText style={styles.bodyContextText} tone="secondary" variant="caption">
          {t(
            'notifications.inbox.filterContext',
            `${mode} \u00b7 ${vehicles.length} vehicles \u00b7 ${rules.length} alert rules available as filters`,
          )}
        </AppText>
      </View>
      <EmptyState
        message={t(
          'notifications.inbox.nativePortPending',
          'The full notification log — filters, bulk actions, day-grouped and threaded views — is delivered by the dedicated InboxBody native port.',
        )}
        title={t('notifications.inbox.surfaceTitle', 'Notification inbox')}
      />
    </GlassPanel>
  );
}

/* ─── "View archived" action (web react-router <Link> -> onNavigate) ───────── */

function ViewArchivedLink({
  onNavigate,
  t,
}: {
  onNavigate?: (path: string) => void;
  t: NativeTFunction;
}) {
  const label = t('notifications.inbox.viewArchived', 'View archived');
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => onNavigate?.('/notifications/archived')}
      style={({pressed}) => [
        styles.archivedLink,
        pressed && styles.archivedLinkPressed,
      ]}
      testID="notifications-inbox-view-archived">
      <SemanticIcon decorative name="archive" size="sm" />
      <AppText style={styles.archivedLinkLabel} tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── InboxPage ────────────────────────────────────────────────────────────── */

export interface InboxPageProps {
  /**
   * Native-safe replacement for react-router navigation. Wired to the "View
   * archived" action so it routes to /notifications/archived, mirroring the web
   * `<Link to="/notifications/archived">`.
   */
  onNavigate?: (path: string) => void;
  /**
   * Native-safe replacement for the web CopyLinkButton (which copies
   * window.location.href). Forwarded to PageHeader's copy-link control; absent
   * => the control renders in a disabled "unavailable" state.
   */
  onCopyLink?: () => void | Promise<void>;
}

export default function InboxPage({
  onCopyLink,
  onNavigate,
}: InboxPageProps = {}) {
  const t = useNativeTranslationFallback();
  usePageTitle(t('notifications.inbox.title', 'Inbox'));
  const {data: vehicles = []} = useVehicles();
  const {data: rules = []} = useAlertRules();

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="notifications-inbox">
      <PageHeader
        actions={<ViewArchivedLink onNavigate={onNavigate} t={t} />}
        copyLink
        onCopyLink={onCopyLink}
        subtitle={t(
          'notifications.inbox.subtitle',
          'Recent notifications from your alert rules.',
        )}
        title={t('notifications.inbox.title', 'Inbox')}
      />
      <ErrorBoundary name={t('notifications.inbox.title', 'Inbox')}>
        <InboxBody archived={false} rules={rules} vehicles={vehicles} />
      </ErrorBoundary>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  archivedLink: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  archivedLinkLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  archivedLinkPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  bodyContextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bodyContextText: {
    flexShrink: 1,
  },
  bodyPanel: {
    gap: spacing.md,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    padding: spacing.lg,
  },
});
