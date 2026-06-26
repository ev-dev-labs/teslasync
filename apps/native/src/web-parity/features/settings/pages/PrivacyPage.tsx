// PrivacyPage — native parity port of
// web/src/features/settings/pages/PrivacyPage.tsx (`/account/privacy`).
//
// The web page (doc comment L1-14) is a thin shell: it sets the document title
// and renders <PrivacySection /> inside a PageContainer (title + subtitle +
// copyLink). Every page-level concern — the usePageTitle call, the two
// account.privacy.* i18n keys + English fallbacks, and the copyLink affordance —
// is preserved verbatim.
//
// PrivacySection (web/src/features/settings/components/PrivacySection.tsx) is not
// yet converted on its own, so — matching the self-contained-page precedent set
// by QuietHoursPage / AlertRulesPage in this repo and by the sibling
// AdvancedSettings native port — it is inline-ported here in full: the recent-
// pages clear flow (gated behind a ConfirmDialog with the `clear-recent-pages`
// silenceKey), the tri-state cookie/GDPR consent controls, the live count +
// consent subscriptions, and every privacy.*/recentPages.*/consent.*/common.*
// i18n key + fallback are ported verbatim.
//
// Native adaptations vs. the web sources (behaviour / state / keys / API kept):
//   - react-i18next useTranslation (page L16/22, section L24/58) -> a native-safe
//     useTranslation(namespace?) hook (no i18n runtime in this RN layer):
//     t(key, defaultValueOrOptions?) returns the string fallback verbatim, or the
//     options.defaultValue with {{var}} interpolation (the section's
//     `recentPages.storedCount` count-interpolation call shape). The 'settings'
//     namespace is accepted + ignored. Every key is preserved as the first arg.
//   - @/components/layout PageContainer + its `copyLink` prop (page L17/26-33) ->
//     an inline RN PageContainer (ScrollView header: title/subtitle + the
//     already-ported native <CopyLinkButton>; with no host url/clipboard bridge
//     it renders the documented disabled unavailable state — conversion rule 7).
//   - @/hooks usePageTitle (page L18/23) -> a native-safe no-op (RN has no
//     document.title); the call site + argument are preserved.
//   - section @/lib/recentPages get/clear/subscribe (section L29-33) +
//     @/lib/cookieConsent get/set/clear/subscribe (section L34-40) +
//     ConfirmDialog's @/lib/confirmSilence isSilenced/silence are localStorage /
//     window-event backed (browser-only). localStorage / DOM events have no RN
//     analog and no storage dependency is wired into this parity layer, so each
//     is backed by a native-safe in-memory store + listener Set mirroring the
//     read/write/subscribe contract (the AdvancedSettings precedent). Cross-tab
//     `storage` events + cross-restart persistence are therefore UNAVAILABLE on
//     native; within a session the get/clear/set/subscribe behaviour is
//     identical. recordPageView (the recent-list writer) is an App.tsx route
//     effect outside this page, so the native recent count starts at 0 — exactly
//     a fresh browser. Documented in the sidecar.
//   - @/api/hooks/useSettings useVersionInfo (section L41) -> the already-ported
//     native parity hook (../../../api/hooks/useSettings), same /system/version
//     path + require_cookie_consent flag.
//   - @/components/feedback/Toast useToast (section L28) -> an inline native
//     useToast shim backed by React Native Alert (the parity layer's documented
//     mutationFeedbackPrimitive), preserving the toast.success call sites +
//     strings.
//   - @/components/ui GlassPanel/IconBox/Button/ConfirmDialog (section L26) ->
//     the native GlassPanel + an inline cyan IconBox (the sole color="cyan" call,
//     reproduced with neon-cyan bg/ring + text-cyan-300, the AdvancedSettings
//     precedent) + an inline Button (primary/secondary/ghost) + an inline native
//     ConfirmDialog (Modal-based, with the warning/danger severity chrome, the
//     silenceKey "Don't ask again" checkbox, and the silence auto-resolve).
//   - @/components/motion FadeIn (section L27, framer-motion) -> an inline
//     passthrough View; the entrance has no parity-layer RN equivalent.
//   - lucide-react ShieldCheck/Trash2 + ConfirmDialog's AlertTriangle (section
//     L25) -> a decorative '✓' glyph inside the cyan IconBox (ShieldCheck), the
//     SemanticIcon `delete` button glyph (Trash2), and SemanticIcon
//     severityWarn/severityCritical for the dialog chrome.
//   - the web HTML <div>/<h2>/<p>/<button>/<label>/<input type="checkbox"> map to
//     RN View/AppText/Pressable; data-testid attributes are preserved as testID.
//
// No DOM / react-router / react-i18next / lucide / Recharts / Leaflet /
// framer-motion / old-web-UI import reaches this native output — only react,
// react-native primitives, the canonical AppText/GlassPanel/SemanticIcon + theme
// tokens, the native CopyLinkButton port, and the native useVersionInfo hook.
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useVersionInfo} from '../../../api/hooks/useSettings';
import {CopyLinkButton} from '../../../components/layout/CopyLinkButton';

// ─── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────
// Supports the two call shapes the web sources use: `t(key, 'fallback')` and
// `t(key, { count, defaultValue })` (the recentPages.storedCount count form).

interface TOptions {
  defaultValue?: string;
  [key: string]: string | number | undefined;
}
type NativeTFunction = (
  key: string,
  defaultValueOrOptions?: string | TOptions,
) => string;

function interpolate(template: string, options: TOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = options[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(_namespace?: string): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>((key, defaultValueOrOptions) => {
    if (typeof defaultValueOrOptions === 'string') {
      return defaultValueOrOptions;
    }
    if (defaultValueOrOptions && typeof defaultValueOrOptions === 'object') {
      return interpolate(defaultValueOrOptions.defaultValue ?? '', defaultValueOrOptions);
    }
    return key;
  }, []);
  return {t};
}

// ─── usePageTitle (web @/hooks/usePageTitle) — native no-op ───────────────────

function usePageTitle(title: string): void {
  useEffect(() => {
    // No document.title in React Native; intentional no-op.
  }, [title]);
}

// ─── useToast (web @/components/feedback/Toast) — native Alert shim ────────────

type ToastFn = (message: string) => void;

function useToast(): {success: ToastFn; error: ToastFn; info: ToastFn; warning: ToastFn} {
  return useMemo(() => {
    const show: ToastFn = message => Alert.alert(message);
    return {success: show, error: show, info: show, warning: show};
  }, []);
}

// ─── Native-safe recent-pages store (web @/lib/recentPages) ───────────────────
// localStorage LRU + window `storage`/local change events -> an in-memory array
// + listener Set. The section only observes `getRecentPages().length`, clears
// the list, and subscribes; that subset is preserved verbatim. recordPageView
// (the only writer, an App.tsx route effect) is outside this page, so the count
// starts at 0 — exactly a fresh browser. Cross-tab/cross-restart UNAVAILABLE.

interface RecentEntry {
  path: string;
  title: string;
  visited_at: number;
}

let recentPagesStore: RecentEntry[] = [];
const recentPagesListeners = new Set<() => void>();

function notifyRecentPages(): void {
  for (const listener of recentPagesListeners) {
    try {
      listener();
    } catch {
      // Never let a subscriber crash the bus (web parity).
    }
  }
}

function getRecentPages(limit?: number): RecentEntry[] {
  if (typeof limit === 'number') {
    return recentPagesStore.slice(0, Math.max(0, limit));
  }
  return recentPagesStore.slice();
}

function clearRecentPages(): void {
  recentPagesStore = [];
  notifyRecentPages();
}

function subscribeRecentPages(handler: () => void): () => void {
  recentPagesListeners.add(handler);
  return () => {
    recentPagesListeners.delete(handler);
  };
}

// ─── Native-safe cookie/GDPR consent store (web @/lib/cookieConsent) ──────────
// localStorage string cell + window events -> an in-memory tri-state cell +
// listener Set. get/set/clear/subscribe behave identically in-session;
// cross-tab `storage` + cross-restart persistence are UNAVAILABLE on native.

type ConsentState = 'unknown' | 'accepted' | 'declined';

let consentStore: ConsentState = 'unknown';
const consentListeners = new Set<(state: ConsentState) => void>();

function dispatchConsent(state: ConsentState): void {
  for (const listener of consentListeners) {
    try {
      listener(state);
    } catch {
      // swallow — the cell write already succeeded.
    }
  }
}

function getConsent(): ConsentState {
  return consentStore;
}

function setConsent(state: 'accepted' | 'declined'): void {
  consentStore = state;
  dispatchConsent(state);
}

function clearConsent(): void {
  consentStore = 'unknown';
  dispatchConsent('unknown');
}

function subscribeConsent(cb: (state: ConsentState) => void): () => void {
  consentListeners.add(cb);
  return () => {
    consentListeners.delete(cb);
  };
}

// ─── Native-safe confirm-silence store (web @/lib/confirmSilence) ─────────────
// The ConfirmDialog's silenceKey machinery: isSilenced/silence backed by an
// in-memory Set (the AdvancedSettings precedent). Cross-restart UNAVAILABLE.

const confirmSilenceStore = new Set<string>();

function isSilenced(key: string): boolean {
  return key ? confirmSilenceStore.has(key) : false;
}

function silence(key: string): void {
  if (key) {
    confirmSilenceStore.add(key);
  }
}

// ─── Constants + helpers (section L43-55) ─────────────────────────────────────

const CONFIRM_SILENCE_KEY = 'clear-recent-pages';

function consentLabel(state: ConsentState, t: NativeTFunction): string {
  switch (state) {
    case 'accepted':
      return t(
        'consent.state.accepted',
        'Accepted — performance & error reporting on',
      );
    case 'declined':
      return t(
        'consent.state.declined',
        'Declined — only essential storage in use',
      );
    case 'unknown':
    default:
      return t(
        'consent.state.unknown',
        'Not decided — banner will appear on next visit',
      );
  }
}

// ─── IconBox (web @/components/ui IconBox, color="cyan") ──────────────────────

function IconBox({children}: {children: ReactNode}): React.ReactElement {
  return <View style={styles.iconBox}>{children}</View>;
}

// ─── Button (web @/components/ui Button) ──────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

function Button({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        buttonVariantStyles[variant],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {icon ?? null}
      <AppText style={buttonTextStyles[variant]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

// ─── FadeIn (web @/components/motion FadeIn) — no RN entrance animation ────────

function FadeIn({children}: {children: ReactNode}): React.ReactElement {
  return <View>{children}</View>;
}

// ─── SilenceCheckbox (web ConfirmDialog <input type="checkbox">) ──────────────

function SilenceCheckbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      hitSlop={6}
      onPress={onToggle}
      style={styles.checkboxRow}>
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked ? (
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.checkboxGlyph}
            weight="bold">
            ✓
          </AppText>
        ) : null}
      </View>
      <AppText style={styles.checkboxLabel} tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

// ─── ConfirmDialog (web @/components/ui ConfirmDialog) ────────────────────────
// Ports the subset PrivacySection uses: variant warning/danger, the silenceKey
// "Don't ask again" flow (honored for non-danger variants), the silence
// auto-resolve, and confirm/cancel. The web requireTypedConfirmation/loading
// props are unused by this call site and intentionally omitted.

type ConfirmVariant = 'danger' | 'warning';

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  silenceKey,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  const {t} = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Silencing is only honored for non-destructive prompts (web parity).
  const silenceHonored = Boolean(silenceKey && variant !== 'danger');

  // Reset the "don't ask again" checkbox each time the dialog reopens so a
  // stale tick can't pre-silence the next invocation (web L96-101).
  useEffect(() => {
    if (open) {
      setDontAskAgain(false);
    }
  }, [open]);

  // Auto-resolve when the user previously silenced this action (web L107-111).
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  // Persist the silence choice BEFORE bubbling up so the next call sees it
  // (web L139-144).
  const handleConfirmClick = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silence(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  // Suppress the dialog entirely when silenced — the auto-resolve effect above
  // fires onConfirm on the next tick (web L151-153).
  if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
    return null;
  }

  const isDanger = variant === 'danger';
  const iconName = isDanger ? 'severityCritical' : 'severityWarn';

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.dialogOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.dialogBackdrop}
        />
        <View style={styles.dialog} testID="confirm-dialog">
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageBox,
              isDanger ? styles.dialogMessageDanger : styles.dialogMessageWarning,
            ]}>
            <SemanticIcon decorative name={iconName} size="sm" />
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          {silenceHonored ? (
            <SilenceCheckbox
              checked={dontAskAgain}
              label={t(
                'confirm.silence.checkbox',
                "Don't ask again for this action",
              )}
              onToggle={() => setDontAskAgain(prev => !prev)}
            />
          ) : null}
          <View style={styles.dialogActions}>
            <Button onPress={onCancel} variant="secondary">
              {cancelLabel}
            </Button>
            <Pressable
              accessibilityRole="button"
              onPress={handleConfirmClick}
              style={({pressed}) => [
                styles.confirmButton,
                isDanger ? styles.confirmButtonDanger : styles.confirmButtonWarning,
                pressed && styles.buttonPressed,
              ]}
              testID="confirm-dialog-confirm">
              <AppText style={styles.confirmButtonText} variant="caption" weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── PrivacySection (web @/features/settings/components/PrivacySection) ───────

function PrivacySection(): React.ReactElement {
  const {t} = useTranslation();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState<number>(() => getRecentPages().length);
  const [consent, setConsentLocal] = useState<ConsentState>(() => getConsent());
  const versionQuery = useVersionInfo();
  const requireConsent = Boolean(versionQuery.data?.require_cookie_consent);

  // Live-update the row counter so a clear (in either tab) drops the count.
  useEffect(() => {
    setCount(getRecentPages().length);
    return subscribeRecentPages(() => setCount(getRecentPages().length));
  }, []);

  // Keep the consent control in sync with banner-driven mutations.
  useEffect(() => {
    setConsentLocal(getConsent());
    return subscribeConsent(next => setConsentLocal(next));
  }, []);

  const handleConfirm = () => {
    clearRecentPages();
    setConfirmOpen(false);
    toast.success(t('recentPages.cleared', 'Recent pages cleared'));
  };

  const handleAcceptConsent = () => {
    setConsent('accepted');
    setConsentLocal('accepted');
    toast.success(t('consent.toast.accepted', 'Consent granted'));
  };
  const handleDeclineConsent = () => {
    setConsent('declined');
    setConsentLocal('declined');
    toast.success(t('consent.toast.declined', 'Consent withdrawn'));
  };
  const handleResetConsent = () => {
    clearConsent();
    setConsentLocal('unknown');
    toast.success(
      t('consent.toast.reset', 'Consent reset — banner will reappear'),
    );
  };

  return (
    <FadeIn>
      <GlassPanel style={styles.panel} testID="privacy-section">
        <View style={styles.header}>
          <IconBox>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.iconBoxGlyph}
              weight="bold">
              ✓
            </AppText>
          </IconBox>
          <View style={styles.headerText}>
            <AppText style={styles.title} weight="semibold">
              {t('privacy.title', 'Privacy')}
            </AppText>
            <AppText style={styles.subtitle} tone="muted">
              {t(
                'privacy.subtitle',
                'Manage local browsing history surfaces. These settings only affect this browser.',
              )}
            </AppText>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardText}>
              <AppText style={styles.cardTitle} weight="semibold">
                {t('recentPages.clearTitle', 'Recently viewed pages')}
              </AppText>
              <AppText style={styles.cardBody} tone="muted">
                {t(
                  'recentPages.clearBody',
                  'Wipe the list of pages used by the dashboard widget and the Recent section in the command palette.',
                )}
              </AppText>
              <AppText
                style={styles.cardMeta}
                testID="privacy-recent-count"
                tone="muted">
                {t('recentPages.storedCount', {
                  count,
                  defaultValue: `${count} entries stored`,
                })}
              </AppText>
            </View>
            <Button
              disabled={count === 0}
              icon={<SemanticIcon decorative name="delete" size="sm" />}
              onPress={() => setConfirmOpen(true)}
              testID="privacy-clear-recent-pages"
              variant="secondary">
              {t('recentPages.clearButton', 'Clear recent pages')}
            </Button>
          </View>
        </View>

        {/* Cookie / GDPR consent management. Always rendered so operators can
            preview the user-facing flow even when consent is gated off. */}
        <View style={styles.card} testID="privacy-consent-section">
          <View style={styles.cardRow}>
            <View style={styles.cardText}>
              <AppText style={styles.cardTitle} weight="semibold">
                {t('consent.section.title', 'Cookies & analytics consent')}
              </AppText>
              <AppText style={styles.cardBody} tone="muted">
                {requireConsent
                  ? t(
                      'consent.section.bodyOn',
                      'This deployment collects anonymous performance and error reports with your consent. Strictly necessary storage (auth, settings) is always on.',
                    )
                  : t(
                      'consent.section.bodyOff',
                      'This deployment does not require consent collection — these controls let you preview the user-facing flow.',
                    )}
              </AppText>
              <AppText
                style={styles.cardMeta}
                testID="privacy-consent-state"
                tone="muted">
                {consentLabel(consent, t)}
              </AppText>
            </View>
            <View style={styles.consentActions}>
              <Button
                disabled={consent === 'accepted'}
                onPress={handleAcceptConsent}
                testID="privacy-consent-accept"
                variant="primary">
                {t('consent.action.accept', 'Re-grant consent')}
              </Button>
              <Button
                disabled={consent === 'declined'}
                onPress={handleDeclineConsent}
                testID="privacy-consent-decline"
                variant="secondary">
                {t('consent.action.decline', 'Withdraw consent')}
              </Button>
              <Button
                disabled={consent === 'unknown'}
                onPress={handleResetConsent}
                testID="privacy-consent-reset"
                variant="ghost">
                {t('consent.action.reset', 'Reset')}
              </Button>
            </View>
          </View>
        </View>

        <ConfirmDialog
          cancelLabel={t('common.cancel', 'Cancel')}
          confirmLabel={t('recentPages.clearConfirmCta', 'Clear pages')}
          message={t(
            'recentPages.clearConfirmBody',
            'This will wipe the list immediately. The dashboard widget and palette Recent section will be empty until you visit new pages.',
          )}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
          open={confirmOpen}
          silenceKey={CONFIRM_SILENCE_KEY}
          title={t('recentPages.clearConfirmTitle', 'Clear recent pages?')}
          variant="warning"
        />
      </GlassPanel>
    </FadeIn>
  );
}

PrivacySection.displayName = 'PrivacySection';

// ─── Inline PageContainer (web @/components/layout PageContainer) ──────────────

function PageContainer({
  title,
  subtitle,
  copyLink,
  children,
}: {
  title: string;
  subtitle?: string;
  copyLink?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderRow}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          {copyLink ? <CopyLinkButton /> : null}
        </View>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// ─── Page (web L21-37) ────────────────────────────────────────────────────────

/**
 * PrivacyPage — `/account/privacy`. A thin shell that wraps PrivacySection in a
 * PageContainer so user-scoped privacy controls (recently viewed pages, GDPR /
 * cookie consent) live in their own surface. All browser-local state lives in
 * the inline-ported PrivacySection, so the page stays a thin shell.
 */
export default function PrivacyPage(): React.ReactElement {
  const {t} = useTranslation('settings');
  usePageTitle(t('account.privacy.title', 'Privacy'));

  return (
    <PageContainer
      copyLink
      subtitle={t(
        'account.privacy.subtitle',
        'Manage browser-local data: recently viewed pages and cookies / analytics consent.',
      )}
      title={t('account.privacy.title', 'Privacy')}>
      <PrivacySection />
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  // PageContainer.
  scroll: {
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageBody: {
    gap: spacing.lg,
  },

  // GlassPanel (web `p-5`) + header (web `flex items-start gap-4`).
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  // IconBox cyan (neon-cyan #00f0ff at 0.1/0.2 + text-cyan-300 #67e8f9).
  iconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    borderColor: 'rgba(0, 240, 255, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconBoxGlyph: {
    color: '#67e8f9',
    fontSize: 18,
    lineHeight: 22,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  // web h2 `text-base font-semibold`.
  title: {
    fontSize: 16,
    lineHeight: 22,
  },
  // web p `text-xs text-[var(--text-muted)]`.
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  // web card `rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4`.
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  // web `flex items-start justify-between gap-4 flex-wrap`.
  cardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  // web `flex-1 min-w-[14rem]`.
  cardText: {
    flexBasis: 224,
    flexGrow: 1,
    flexShrink: 1,
  },
  // web `text-sm font-medium`.
  cardTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  // web `text-xs text-[var(--text-muted)] mt-1`.
  cardBody: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  // web `text-[11px] text-[var(--text-muted)] mt-2`.
  cardMeta: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: spacing.sm,
  },
  // web consent buttons `flex flex-wrap gap-2`.
  consentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  // Button (web @/components/ui Button).
  button: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.82,
  },

  // ConfirmDialog.
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 440,
    padding: spacing.lg,
    width: '92%',
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  // web message box `flex items-start gap-3 rounded-lg border p-3`.
  dialogMessageBox: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  dialogMessageWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  dialogMessageDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogMessage: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  confirmButtonWarning: {
    backgroundColor: colors.warning,
  },
  confirmButtonDanger: {
    backgroundColor: colors.danger,
  },
  confirmButtonText: {
    color: colors.background,
  },

  // SilenceCheckbox.
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkboxBox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxGlyph: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
  ghost: {
    color: colors.textSecondary,
  },
});
