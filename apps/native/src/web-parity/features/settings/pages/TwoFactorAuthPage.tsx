/**
 * Native parity port of
 * web/src/features/settings/pages/TwoFactorAuthPage.tsx.
 *
 * The web file (35 lines) is a thin page shell for `/account/2fa`: it promotes
 * the user-level security surface out of `<section id="security">` on the dense
 * Settings page into a first-class page under the new "Account" side-nav
 * category. It resolves a translated title (`account.twoFactor.title`), pushes
 * it through `usePageTitle`, and renders a `<PageContainer>` (title + subtitle +
 * copyLink) whose only child is the shared `<TOTPEnrollmentSection />` — so the
 * page stays a thin shell with no behavior drift (all auth/forward-mode state,
 * the dialog flow, and the step-up gating live inside that section). This native
 * port preserves that contract 1:1 — the same `account.twoFactor.title` /
 * `account.twoFactor.subtitle` keys, the same usePageTitle call, and the same
 * scaffold-wraps-section structure — using React Native primitives + the
 * existing native AppText / GlassPanel / IconBox + design tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation('settings')` (web L14/L20): no native
 *     i18next runtime, so a native-safe `t(key, fallback?)` returns the English
 *     default else the key (the ArchivedPage / TeslaRegionPage precedent). The
 *     'settings' namespace is informational on native; every web key is
 *     preserved verbatim.
 *   - `@/components/layout` `PageContainer` (web L15): no native parity port
 *     exists yet, so a minimal native-safe `PageContainer` (ScrollView scaffold
 *     reproducing title / subtitle / copyLink — the only props this page uses)
 *     is reproduced locally (the ArchivedPage precedent). The web `copyLink`
 *     CopyLinkButton copies `window.location` to the clipboard (browser only);
 *     native has no shareable browser URL, so `copyLink` renders a
 *     non-interactive labelled stand-in (explicit unavailable state).
 *   - `@/hooks/usePageTitle` (web L16/L21): `document.title` is browser-only, so
 *     the native hook is a documented no-op (the native navigator owns the
 *     header title); the resolved title is still computed at the call site.
 *   - `../components/TOTPEnrollmentSection` (web L17/L32): the TOTP enrollment
 *     section is a large sibling component (484 lines: TOTP status/enroll/verify/
 *     revoke/regenerate hooks, a QR + manual-secret + 6-digit-verify Modal, a
 *     one-time backup-codes reveal Modal, and a typed-confirmation Disable
 *     ConfirmDialog gated by the sudo step-up) with its own conversion lifecycle
 *     — NOT this page's responsibility. Following the ArchivedPage `InboxBody` /
 *     ClientUtilitiesSection precedent (unconverted bodies represented as an
 *     explicit status panel, not imported), a native-safe `TOTPEnrollmentSection`
 *     stand-in preserves the section's `totp.title` / `totp.subtitle` intent, its
 *     status pill, and an explicit "not yet available in native" state describing
 *     the enroll / backup-codes / disable capabilities it provides.
 */
import React, {useMemo, type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {IconBox} from '../../../components/ui/IconBox';

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

const ICON_SHIELD = '\uD83D\uDEE1'; // 🛡 lucide ShieldCheck
const ICON_LINK = '\u26D3'; // ⛓ lucide-style link glyph for the copy-link chip

/* ── native CopyLinkButton (web `copyLink`, clipboard is browser-only) ── */

function CopyLinkButton({t}: {t: NativeTFunction}) {
  return (
    <View
      accessibilityLabel={t(
        'common.copyLinkNativeUnavailable',
        'Copy link is unavailable on native (no shareable browser URL)',
      )}
      accessibilityRole="text"
      style={styles.copyLink}
      testID="two-factor-auth-copy-link">
      <AppText style={styles.copyLinkIcon} tone="secondary">
        {ICON_LINK}
      </AppText>
      <AppText style={styles.copyLinkText} tone="secondary" variant="caption">
        {t('common.copyLink', 'Copy link')}
      </AppText>
    </View>
  );
}

/* ── native PageContainer (web `@/components/layout` PageContainer) ── */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  copyLink?: boolean;
  children: ReactNode;
  t: NativeTFunction;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  copyLink,
  children,
  t,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'two-factor-auth-page'}>
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
        {copyLink ? (
          <View style={styles.headerActions}>
            <CopyLinkButton t={t} />
          </View>
        ) : null}
      </View>

      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

/* ── TOTPEnrollmentSection stand-in (web `../components/TOTPEnrollmentSection`,
   a large sibling component with its own conversion lifecycle) ── */

function TOTPEnrollmentSection({t}: {t: NativeTFunction}) {
  return (
    <GlassPanel style={styles.section} testID="totp-section">
      <View style={styles.sectionHeader}>
        <IconBox color="cyan">{ICON_SHIELD}</IconBox>
        <View style={styles.sectionHeaderText}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('totp.title', 'Two-factor authentication')}
          </AppText>
          <AppText style={styles.sectionSubtitle} tone="muted">
            {t(
              'totp.subtitle',
              'TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions.',
            )}
          </AppText>
        </View>
        <View style={styles.statusPill} testID="totp-status-pill">
          <AppText style={styles.statusPillText} tone="secondary">
            {t('totp.status.nativeUnavailable', 'Unavailable on native')}
          </AppText>
        </View>
      </View>

      <AppText style={styles.sectionBody} tone="muted">
        {t(
          'totp.nativeUnavailable',
          'TOTP enrollment (QR code + manual secret + 6-digit verification), one-time backup codes, and disabling two-factor authentication with typed confirmation are provided by a dedicated native security module and are not yet available in this native build.',
        )}
      </AppText>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TwoFactorAuthPage — `/account/2fa` thin shell
   ═══════════════════════════════════════════════════════════════════════ */

export default function TwoFactorAuthPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('account.twoFactor.title', 'Two-factor authentication'));

  return (
    <PageContainer
      copyLink
      subtitle={t(
        'account.twoFactor.subtitle',
        'Add a second factor to your sign-in. Required for sensitive admin actions.',
      )}
      t={t}
      title={t('account.twoFactor.title', 'Two-factor authentication')}>
      <TOTPEnrollmentSection t={t} />
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
  body: {
    gap: spacing.lg,
  },
  section: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.body,
  },
  sectionSubtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  statusPillText: {
    fontSize: typography.caption,
  },
  sectionBody: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
});
