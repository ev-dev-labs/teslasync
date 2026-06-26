// Native parity port of web/src/features/settings/pages/ActiveSessionsPage.tsx.
//
// `ActiveSessionsPage` (route /account/sessions) is the thin route wrapper that
// promoted the old Settings `<section id="sessions">` into a first-class page
// under the new "Account" side-nav category (source header L1-11). Its whole job
// — set the page title, render a titled/subtitled PageContainer with a copy-link
// affordance, and mount `ActiveSessionsSection` inside (which lists every active
// browser/device session and offers per-row + bulk revoke, all step-up-gated by
// RequireSudo upstream) — is preserved. The title/subtitle i18n keys
// (`account.sessions.title` / 'Active sessions';
// `account.sessions.subtitle` / the "Devices currently signed in…" copy) and the
// `copyLink` flag are carried over byte-for-byte.
//
// Web-only / out-of-scope dependencies are mapped per the conversion contract
// (rules 4/5/6/7):
//   - react-i18next `useTranslation('settings')` (source L13) -> the established
//     local key-preserving shim. i18next resolves a missing translation to its
//     KEY, so `t(key)` -> key and `t(key, 'English')` -> the English fallback; no
//     translation catalog ships in apps/native, so the inline English copy shows.
//     The 'settings' namespace arg is accepted + ignored (single flat catalog).
//   - `PageContainer` from @/components/layout (source L14) -> the web-parity
//     layout PageContainer (reused 1:1; `title`/`subtitle`/`copyLink` match).
//   - `usePageTitle` from @/hooks/usePageTitle (source L15) -> a documented
//     native-safe no-op: the web hook writes `document.title`, which has no native
//     DOM analog. The translated title still flows into PageContainer's on-screen
//     header, so the user-visible intent survives.
//   - `ActiveSessionsSection` from ../components/ActiveSessionsSection (source
//     L16, L31): the 320-line sessions DataTable + dual ConfirmDialog revoke
//     surface is NOT part of the native conversion manifest and has no native
//     parity port. Rather than import a non-existent module, this file renders a
//     local native-safe `ActiveSessionsSection` placeholder that surfaces an
//     EXPLICIT unavailable state (contract rule 7) — it names the per-device and
//     "all other devices" sign-out actions and directs the user to the TeslaSync
//     web app. The page shell (title, subtitle, copy-link, breadcrumb) is fully
//     functional; only the embedded sessions table is unavailable, documented in
//     the sidecar. No DOM-only modules, browser HTML elements, Recharts, Leaflet,
//     framer-motion, lucide-react, or old web UI components are imported.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {PageContainer} from '../../../components/layout/PageContainer';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
// The optional namespace arg (`'settings'`) is accepted for source parity and
// ignored — apps/native ships a single flat fallback catalog.
type TFunc = (key: string, fallback?: string) => string;

const translate: TFunc = (key, fallback) =>
  typeof fallback === 'string' ? fallback : key;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  React.useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── ActiveSessionsSection placeholder ─────────────────────────── */
// The web `ActiveSessionsSection` (../components/ActiveSessionsSection) is a
// 320-line DataTable of active sessions with per-row "Sign out" + a footer "Sign
// out all other devices" button, each routed through a ConfirmDialog and gated by
// RequireSudo step-up auth. It is out of scope for this conversion (absent from
// the native manifest) and has no native port. Per contract rule 7 this local
// stand-in renders an explicit unavailable state while preserving the intent: it
// names the per-device and all-other-devices sign-out actions and points the user
// at the web app for session management. i18next returns the English fallback for
// these native-only keys.
function ActiveSessionsSection(): React.ReactElement {
  const {t} = useTranslation('settings');

  return (
    <GlassPanel style={styles.placeholder}>
      <View
        accessibilityRole="image"
        accessibilityLabel={t('account.sessions.icon.label', 'Active sessions')}
        style={styles.placeholderBadge}>
        <AppText style={styles.placeholderGlyph}>{'\u{1F4BB}'}</AppText>
      </View>
      <AppText
        accessibilityRole="header"
        style={styles.placeholderTitle}
        variant="title"
        weight="bold">
        {t(
          'account.sessions.unavailable.title',
          'Session management is on the web app',
        )}
      </AppText>
      <AppText style={styles.placeholderBody} tone="secondary">
        {t(
          'account.sessions.unavailable.body',
          'Reviewing the devices signed in to TeslaSync and signing them out — individually or all other devices at once — is not yet available in the mobile app. Manage your active sessions from the TeslaSync web app.',
        )}
      </AppText>
      <AppText style={styles.placeholderActions} tone="muted" variant="caption">
        {t(
          'account.sessions.unavailable.actions',
          'On the web you can sign out a single device, or sign out all other devices at once.',
        )}
      </AppText>
    </GlassPanel>
  );
}

export default function ActiveSessionsPage(): React.ReactElement {
  const {t} = useTranslation('settings');
  usePageTitle(t('account.sessions.title', 'Active sessions'));

  return (
    <PageContainer
      title={t('account.sessions.title', 'Active sessions')}
      subtitle={t(
        'account.sessions.subtitle',
        'Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.',
      )}
      copyLink>
      <ActiveSessionsSection />
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
  },
  placeholderBadge: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  placeholderGlyph: {
    fontSize: 24,
  },
  placeholderTitle: {
    color: colors.textPrimary,
  },
  placeholderBody: {
    lineHeight: 20,
  },
  placeholderActions: {
    lineHeight: 18,
  },
});
