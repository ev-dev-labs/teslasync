// Native parity port of web/src/features/notifications/pages/ChannelsPage.tsx.
//
// `ChannelsPage` is the thin route wrapper for the notification delivery
// channels CRUD surface (Discord, Slack, Telegram, email, generic webhook,
// ntfy, Pushover). The wrapper exists so the channels view lives at its own
// /notifications/channels route with a real page title + breadcrumb instead of
// being a tab inside another page (source header L1-7). The wrapper's whole job
// — set the page title, render a titled/subtitled PageContainer with a copy-link
// affordance, and mount the channels view inside — is preserved verbatim:
//   - title  i18n key `notifications.channels.title` / 'Notification channels'
//   - subtitle key `notifications.channels.subtitle` / the Discord…webhook copy
//   - `copyLink` flag on PageContainer
// are all carried over unchanged.
//
// Web-only / out-of-scope dependencies are mapped per the conversion contract
// (rules 4/5/6/7):
//   - react-i18next `useTranslation` (source L9) -> the established local
//     key-preserving shim. i18next resolves a missing translation to its KEY, so
//     `t(key)` -> key and `t(key, 'English')` -> the English fallback; no
//     translation catalog ships in apps/native, so the inline English copy shows.
//   - `PageContainer` from @/components/layout (source L10) -> the web-parity
//     layout PageContainer (reused 1:1; `title`/`subtitle`/`copyLink` match).
//   - `usePageTitle` from @/hooks (source L11) -> a documented native-safe no-op:
//     the web hook writes `document.title`, which has no native DOM analog. The
//     translated title is still computed at the call site and rendered by
//     PageContainer as the on-screen header, so the user-visible intent survives.
//   - `NotificationChannelsView` from ../components (source L12, L24): the full
//     512-line channels CRUD view (modals, forms, toggles, toasts, per-provider
//     credential fields) is NOT part of the native conversion manifest and has no
//     native parity port. Rather than import a non-existent module, this file
//     renders a local native-safe `NotificationChannelsView` placeholder that
//     surfaces an EXPLICIT unavailable state — it names every supported channel
//     type and directs the user to manage channels from the web app. The page
//     shell (title, subtitle, copy-link, breadcrumb) is fully functional; only
//     the embedded CRUD body is unavailable, and that is documented in the
//     sidecar. No DOM-only modules, browser HTML elements, Recharts, Leaflet,
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
type TFunc = (key: string, fallback?: string) => string;

const translate: TFunc = (key, fallback) =>
  typeof fallback === 'string' ? fallback : key;

function useTranslation(): {t: TFunc} {
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

/* ── NotificationChannelsView placeholder ──────────────────────── */
// The web `NotificationChannelsView` (../components/NotificationChannelsView) is
// a 512-line channels CRUD surface that is out of scope for this conversion (not
// in the native manifest) and has no native port. Per contract rule 7 this local
// stand-in renders an explicit unavailable state while preserving the intent:
// it enumerates the supported delivery channels and points the user at the web
// app for channel management. i18next returns the English fallback for these
// native-only keys.
function NotificationChannelsView(): React.ReactElement {
  const {t} = useTranslation();

  const channels = t(
    'notifications.channels.supported',
    'Discord, Slack, Telegram, email, ntfy, Pushover, and custom webhooks',
  );

  return (
    <GlassPanel style={styles.placeholder}>
      <View
        accessibilityRole="image"
        accessibilityLabel={t(
          'notifications.channels.icon.label',
          'Notification channels',
        )}
        style={styles.placeholderBadge}>
        <AppText style={styles.placeholderGlyph}>{'\u{1F514}'}</AppText>
      </View>
      <AppText
        accessibilityRole="header"
        style={styles.placeholderTitle}
        variant="title"
        weight="bold">
        {t(
          'notifications.channels.unavailable.title',
          'Channel management is on the web app',
        )}
      </AppText>
      <AppText style={styles.placeholderBody} tone="secondary">
        {t(
          'notifications.channels.unavailable.body',
          'Adding, editing, testing, and removing delivery channels is not yet available in the mobile app. Manage your channels from the TeslaSync web app.',
        )}
      </AppText>
      <AppText style={styles.placeholderChannels} tone="muted" variant="caption">
        {t('notifications.channels.supported.label', 'Supported channels')}: {channels}
      </AppText>
    </GlassPanel>
  );
}

export default function ChannelsPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('notifications.channels.title', 'Notification channels'));

  return (
    <PageContainer
      title={t('notifications.channels.title', 'Notification channels')}
      subtitle={t(
        'notifications.channels.subtitle',
        'Where to send notifications: Discord, Slack, Telegram, email, ntfy, Pushover, or a custom webhook.',
      )}
      copyLink>
      <NotificationChannelsView />
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
  placeholderChannels: {
    lineHeight: 18,
  },
});
