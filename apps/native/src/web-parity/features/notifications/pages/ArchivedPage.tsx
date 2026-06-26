/**
 * Native parity port of
 * web/src/features/notifications/pages/ArchivedPage.tsx.
 *
 * The web file is the Notifications inbox scoped to archived items only: it
 * fetches the vehicle + alert-rule filter context, renders a `PageContainer`
 * (title / subtitle / copyLink / a "Back to inbox" action) and delegates the
 * actual list to `<InboxBody archived={true} … />` so the bulk-action set swaps
 * Archive for Restore. This port preserves that page's own responsibilities 1:1
 * — the two data hooks, the page title intent, the header (title + subtitle +
 * copy-link affordance + back-to-inbox link), and the `archived` scoping passed
 * to the inbox body — using React Native primitives + the existing native
 * AppText / GlassPanel / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L7): no native i18next runtime, so a
 *     native-safe `t(key, fallback?)` returns the English default (preserving
 *     every translation key + i18n intent).
 *   - react-router-dom `Link to="/notifications/inbox"` (web L8/L28-34): no DOM
 *     router on native → a `Pressable` with `accessibilityRole="link"` whose
 *     destination path is preserved as `INBOX_ROUTE`; navigation is owned by the
 *     native navigator shell, not this web-parity page (matching the GuardedLink
 *     port precedent).
 *   - lucide-react `ArrowLeft` (web L9): DOM SVG icons are unavailable on native
 *     → decorative `AppText` glyph `ICON_ARROW_LEFT` (the established native
 *     approach for inline lucide icons).
 *   - `@/components/layout/PageContainer` (web L10) + its `copyLink` feature:
 *     no native parity port yet, so a minimal native-safe `PageContainer`
 *     (ScrollView scaffold) is reproduced locally — matching the inline
 *     PageContainer convention of the already-ported EnergyProductsPage. The
 *     web `CopyLinkButton` copies `window.location` to the clipboard (browser
 *     only); native has no shareable browser URL, so the `copyLink` prop renders
 *     a non-interactive labelled stand-in (explicit unavailable state).
 *   - `@/hooks/usePageTitle` (web L11): `document.title` is browser-only → a
 *     native-safe no-op that still consumes the resolved title.
 *   - `@/api/hooks/useVehicles` `useVehicles` (web L12) + `@/api/hooks/
 *     useNotifications` `useAlertRules` (web L13): imported from the already
 *     ported native hook modules; `data` defaults to `[]` exactly like the web.
 *   - `../components/InboxBody` (web L14/L37): the inbox body is a large sibling
 *     component with its own conversion lifecycle and is NOT this page's
 *     responsibility. Mirroring the App.tsx / ClientUtilitiesSection parity
 *     precedent (unconverted bodies represented as an explicit status panel,
 *     not imported), a native-safe `InboxBody` stand-in keeps the same prop
 *     shape (`archived` / `vehicles` / `rules`), preserves the `archived`
 *     Restore-scope title, surfaces the wired filter context (vehicle + rule
 *     counts), and renders an explicit "not yet available in native" state.
 */
import React, {useMemo, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {type AlertRule, useAlertRules} from '../../../api/hooks/useNotifications';
import {type Vehicle, useVehicles} from '../../../api/hooks/useVehicles';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── native-safe usePageTitle (web `document.title` is browser-only) ── */

function usePageTitle(_title: string): void {
  // Web `usePageTitle` writes `document.title`, which does not exist on native.
  // The resolved title is still computed by the caller; this is a deliberate
  // no-op so the call site stays identical to the web page.
}

/* ── decorative glyph stand-ins for the lucide-react icons ── */

const ICON_ARROW_LEFT = '\u2190'; // ← lucide ArrowLeft
const ICON_LINK = '\u26D3'; // ⛓ lucide-style link glyph for the copy-link chip

/** Web `Link to="/notifications/inbox"` destination, preserved verbatim. */
const INBOX_ROUTE = '/notifications/inbox';

/* ── native CopyLinkButton (web `./CopyLinkButton`, clipboard is browser-only) ── */

function CopyLinkButton({t}: {t: NativeTFunction}) {
  return (
    <View
      accessibilityLabel={t(
        'common.copyLinkNativeUnavailable',
        'Copy link is unavailable on native (no shareable browser URL)',
      )}
      accessibilityRole="text"
      style={styles.copyLink}
      testID="notifications-archived-copy-link">
      <AppText style={styles.copyLinkIcon} tone="secondary">
        {ICON_LINK}
      </AppText>
      <AppText style={styles.copyLinkText} tone="secondary" variant="caption">
        {t('common.copyLink', 'Copy link')}
      </AppText>
    </View>
  );
}

/* ── native PageContainer (web `@/components/layout/PageContainer`) ── */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  copyLink?: boolean;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
  t: NativeTFunction;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  copyLink,
  actions,
  loading,
  error,
  children,
  t,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'notifications-archived-page'}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {copyLink || actions ? (
          <View style={styles.headerActions}>
            {copyLink ? <CopyLinkButton t={t} /> : null}
            {actions}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="notifications-archived-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="notifications-archived-error">
          <AppText style={styles.errorText} tone="danger" variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ── back-to-inbox link (web react-router `Link` + lucide `ArrowLeft`) ── */

interface BackToInboxLinkProps {
  label: string;
  hint: string;
}

function BackToInboxLink({label, hint}: BackToInboxLinkProps) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityRole="link"
      // Destination `INBOX_ROUTE` is preserved from the web Link; the native
      // navigator shell owns the actual transition, so this parity page does
      // not wire a handler.
      style={({pressed}) => [styles.backLink, pressed && styles.backLinkPressed]}
      testID="notifications-archived-back-link">
      <AppText style={styles.backLinkIcon} tone="secondary">
        {ICON_ARROW_LEFT}
      </AppText>
      <AppText style={styles.backLinkText} tone="secondary" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── InboxBody stand-in (web `../components/InboxBody`, separate conversion) ── */

interface InboxBodyProps {
  archived: boolean;
  vehicles: Vehicle[];
  rules: AlertRule[];
  t: NativeTFunction;
}

function InboxBody({archived, vehicles, rules, t}: InboxBodyProps) {
  return (
    <GlassPanel
      style={styles.inboxBody}
      testID="notifications-archived-inbox-body">
      <AppText style={styles.inboxBodyTitle} weight="semibold">
        {archived
          ? t('notifications.archived.bodyTitle', 'Archived inbox')
          : t('notifications.inbox.bodyTitle', 'Inbox')}
      </AppText>
      <AppText style={styles.inboxBodyText} tone="muted">
        {t(
          'notifications.archived.nativeUnavailable',
          'The full notifications inbox — grouped rows, vehicle and rule filters, and the bulk Restore action — is provided by its own native module and is not yet available in this native build.',
        )}
      </AppText>
      <AppText style={styles.inboxBodyMeta} tone="secondary" variant="caption">
        {t('notifications.archived.filterContext', 'Filter context wired:')}{' '}
        {vehicles.length}{' '}
        {t('notifications.archived.vehiclesLabel', 'vehicles')} · {rules.length}{' '}
        {t('notifications.archived.rulesLabel', 'rules')}
      </AppText>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ArchivedPage — archived-only notifications inbox
   ═══════════════════════════════════════════════════════════════════════ */

export default function ArchivedPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('notifications.archived.title', 'Archived notifications'));
  const {data: vehicles = []} = useVehicles();
  const {data: rules = []} = useAlertRules();

  return (
    <PageContainer
      actions={
        <BackToInboxLink
          hint={t(
            'notifications.archived.backToInboxHint',
            `Go to the notifications inbox (${INBOX_ROUTE})`,
          )}
          label={t('notifications.archived.backToInbox', 'Back to inbox')}
        />
      }
      copyLink
      subtitle={t(
        'notifications.archived.subtitle',
        'Notifications you previously archived. Restore to bring them back.',
      )}
      t={t}
      title={t('notifications.archived.title', 'Archived notifications')}>
      <InboxBody archived={true} rules={rules} t={t} vehicles={vehicles} />
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  headerText: {
    flex: 1,
    minWidth: 200,
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  copyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  copyLinkIcon: {
    fontSize: 14,
  },
  copyLinkText: {
    fontSize: typography.caption,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  backLinkPressed: {
    backgroundColor: colors.surfaceHover,
  },
  backLinkIcon: {
    fontSize: 15,
  },
  backLinkText: {
    fontSize: typography.caption,
  },
  loading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    lineHeight: 18,
  },
  body: {
    gap: spacing.lg,
  },
  inboxBody: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  inboxBodyTitle: {
    fontSize: typography.body,
  },
  inboxBodyText: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  inboxBodyMeta: {
    marginTop: spacing.xs,
  },
});
