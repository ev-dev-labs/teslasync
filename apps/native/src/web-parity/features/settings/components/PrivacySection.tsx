// Native parity port of web/src/features/settings/components/PrivacySection.tsx.
//
// Privacy section — surfaces the two user-controllable client-side privacy
// switches the web original owns (web L1-21 doc comment), preserved verbatim in
// intent:
//
//   1. "Clear recently viewed pages" — wipes the LRU maintained by the
//      recentPages store. Gated behind a ConfirmDialog because it is
//      irreversible; the dialog reuses the silenceKey ("don't ask again")
//      machinery so a confirmed user can opt into a one-click flow.
//   2. Cookie / GDPR consent management — shows the current consent state and
//      lets the user withdraw / re-grant / reset to "unknown". Always rendered
//      (even when the deployment-wide require_cookie_consent flag is off) so
//      operators can preview the user-facing flow.
//
// All component state (confirmOpen, count, consent), the API path
// (/system/version via useVersionInfo -> require_cookie_consent, web L41/L64),
// the i18n keys + English fallbacks, the data-testid hooks, and the handler
// wiring (handleConfirm / handleAccept|Decline|ResetConsent) are kept 1:1.
//
// Web -> native dependency mapping (every web import documented here + sidecar):
//   - react useEffect/useState (web L23) -> + useCallback/useRef for the inlined
//     animation + memoized helpers. No behavioural change.
//   - react-i18next useTranslation (web L24) -> inlined useNativeTranslationFallback():
//     a (key, fallbackOrOptions) => string shim that returns the English
//     fallback string, or options.defaultValue for the interpolated
//     recentPages.storedCount call (web L144). Every translation key + default
//     is preserved verbatim (matches the NotificationFilterBar parity pattern).
//   - lucide-react ShieldCheck / Trash2 (web L25) -> inline text glyphs (the
//     QueryError / Toast / Drawer inline-glyph precedent): ShieldCheck -> 🛡 in
//     the header IconBox, Trash2 -> 🗑 as the clear button's leading affix.
//   - @/components/ui GlassPanel (web L26) -> the ported native GlassPanel
//     primitive (components/ui/GlassPanel). IconBox/Button/ConfirmDialog from
//     @/components/ui are not ported to the native parity tree yet, so
//     native-safe equivalents are inlined below (the FadeIn/PageContainer
//     per-page inline precedent): IconBox -> a fixed accent-tinted rounded box
//     (NeonColor 'cyan' collapses to the accent token set); Button -> a
//     Pressable with the web primary/secondary/ghost (+ danger/warning for the
//     dialog) variants, disabled + leading-icon support; ConfirmDialog -> a
//     Modal-based confirm prompt that preserves the variant/title/message/
//     confirm+cancel labels AND the silenceKey "don't ask again" gate
//     (auto-resolve-when-silenced, persist-before-confirm) from the web
//     @/components/ui ConfirmDialog. The web requireTypedConfirmation + loading
//     branches are not exercised by PrivacySection and are left for the full
//     ConfirmDialog port; the typed-confirm Input is therefore not inlined.
//   - @/components/motion FadeIn (web L27) -> inline FadeIn: an Animated.View
//     opacity 0->1 + translateY 12->0 mount fade (the web slide-up), 400ms,
//     honouring the OS reduced-motion preference via AccessibilityInfo (the
//     useMotionPreference(400) analogue used by the Toast port).
//   - @/components/feedback/Toast useToast (web L28) -> the ported native
//     web-parity Toast useToast (success/error/info/warning queue).
//   - @/lib/recentPages clearRecentPages/getRecentPages/subscribeRecentPages
//     (web L29-33) -> inline native-safe store: localStorage + the window
//     storage / custom-event bus have no RN analogue, so the LRU degrades to a
//     module-scoped in-process list + listener set. The get/clear/subscribe
//     contracts (and the same-tab change notification) are preserved; only
//     cross-tab + cold-restart persistence is lost (the in-process store
//     precedent set by useKioskMode / useVehiclePaint). Nothing records pages
//     inside this isolated component, so count reads 0 and the Clear button
//     stays disabled until a host records visits through the same store.
//   - @/lib/cookieConsent ConsentState + clear/get/set/subscribeConsent
//     (web L34-40) -> inline native-safe store: the tri-state value lives in a
//     module-scoped variable (unknown = absence, mirroring the web) + a listener
//     set replacing the cookie-consent-changed window event. get/set/clear/
//     subscribe keep their exact contracts; persistence is in-process only.
//   - @/api/hooks/useSettings useVersionInfo (web L41) -> the ported native
//     web-parity useVersionInfo (GET /system/version, require_cookie_consent).
//   - @/lib/confirmSilence isSilenced/silence (transitive, used by the web
//     @/components/ui ConfirmDialog) -> inline native-safe Set<string> store.
//
// No DOM-only modules, browser HTML elements, react-i18next, lucide-react,
// Recharts, Leaflet, framer-motion, or web UI components are imported — only
// react, react-native primitives, and ported native parity modules.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';
import {useToast} from '../../../components/feedback/Toast';
import {useVersionInfo} from '../../../api/hooks/useSettings';

// ── Inline glyphs (web lucide-react icons) ──
const SHIELD_GLYPH = '\u{1F6E1}'; // 🛡 — web ShieldCheck (privacy header).
const TRASH_GLYPH = '\u{1F5D1}'; // 🗑 — web Trash2 (clear button affix).
const WARNING_GLYPH = '\u26A0'; // ⚠ — web AlertTriangle (warning confirm icon).
const CHECK_GLYPH = '\u2713'; // ✓ — silence checkbox tick.

// ---------------------------------------------------------------------------
// useNativeTranslationFallback — inlined react-i18next fallback. Returns the
// web English fallback verbatim, or options.defaultValue for the interpolated
// recentPages.storedCount call, preserving every key + default.
// ---------------------------------------------------------------------------

type NativeTOptions = {count?: number; defaultValue?: string};
type NativeTFunction = (key: string, defaultOrOptions?: string | NativeTOptions) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, defaultOrOptions?: string | NativeTOptions) => {
    if (typeof defaultOrOptions === 'string') {
      return defaultOrOptions;
    }
    if (defaultOrOptions && typeof defaultOrOptions.defaultValue === 'string') {
      return defaultOrOptions.defaultValue;
    }
    return key;
  }, []);
}

// ---------------------------------------------------------------------------
// recentPages native-safe store (web @/lib/recentPages). localStorage + the
// window storage / custom-event bus have no RN analogue, so the LRU degrades to
// a module-scoped in-process list + listener set. get/clear/subscribe keep
// their exact contracts; cross-tab + cold-restart persistence is unavailable.
// ---------------------------------------------------------------------------

interface RecentEntry {
  path: string;
  title: string;
  visited_at: number;
}

const recentPagesStore: RecentEntry[] = [];
const recentPagesListeners = new Set<() => void>();

function notifyRecentPages(): void {
  recentPagesListeners.forEach(fn => {
    try {
      fn();
    } catch {
      // Never let a subscriber crash the bus (web onLocal/onStorage swallow).
    }
  });
}

function getRecentPages(): RecentEntry[] {
  return recentPagesStore.slice();
}

function clearRecentPages(): void {
  recentPagesStore.length = 0;
  notifyRecentPages();
}

function subscribeRecentPages(handler: () => void): () => void {
  recentPagesListeners.add(handler);
  return () => {
    recentPagesListeners.delete(handler);
  };
}

// ---------------------------------------------------------------------------
// cookieConsent native-safe store (web @/lib/cookieConsent). The tri-state
// value lives in a module-scoped variable (unknown = absence, mirroring the
// web) + a listener set replacing the cookie-consent-changed window event.
// ---------------------------------------------------------------------------

type ConsentState = 'unknown' | 'accepted' | 'declined';

let consentValue: ConsentState = 'unknown';
const consentListeners = new Set<(state: ConsentState) => void>();

function dispatchConsentChange(state: ConsentState): void {
  consentListeners.forEach(cb => {
    try {
      cb(state);
    } catch {
      // A broken subscriber must not break consent mutation (web parity).
    }
  });
}

function getConsent(): ConsentState {
  return consentValue;
}

function setConsent(state: 'accepted' | 'declined'): void {
  consentValue = state;
  dispatchConsentChange(state);
}

function clearConsent(): void {
  consentValue = 'unknown';
  dispatchConsentChange('unknown');
}

function subscribeConsent(cb: (state: ConsentState) => void): () => void {
  consentListeners.add(cb);
  return () => {
    consentListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// confirmSilence native-safe store (web @/lib/confirmSilence, used transitively
// by the @/components/ui ConfirmDialog). localStorage-backed "don't ask again"
// keys degrade to an in-process Set.
// ---------------------------------------------------------------------------

const silencedConfirmKeys = new Set<string>();

function isConfirmSilenced(key: string): boolean {
  return silencedConfirmKeys.has(key);
}

function silenceConfirm(key: string): void {
  silencedConfirmKeys.add(key);
}

// ---------------------------------------------------------------------------
// FadeIn — web @/components/motion FadeIn. Animated.View opacity 0->1 +
// translateY 12->0 mount fade (the web slide-up), 400ms, honouring the OS
// reduced-motion preference via AccessibilityInfo (useMotionPreference analogue).
// ---------------------------------------------------------------------------

function FadeIn({children}: {children: ReactNode}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduce]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// IconBox — web @/components/ui IconBox. Colored rounded icon container. The
// only call site uses color="cyan" size="md", so the NeonColor map collapses to
// the accent token set (accentSoft fill + borderAccent ring) at the md size.
// ---------------------------------------------------------------------------

function IconBox({glyph}: {glyph: string}): React.ReactElement {
  return (
    <View style={styles.iconBox}>
      <AppText style={styles.iconGlyph}>{glyph}</AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button — web @/components/ui Button. Pressable with the web variants
// (primary/secondary/ghost + danger/warning for the dialog confirm), a disabled
// state (web disabled:opacity-50), and an optional leading glyph icon.
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        buttonVariantStyles[variant],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {icon ? (
        <AppText style={[styles.buttonIcon, buttonTextStyles[variant]]}>
          {icon}
        </AppText>
      ) : null}
      <AppText style={buttonTextStyles[variant]} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog — web @/components/ui ConfirmDialog. Modal-based confirm prompt
// preserving the variant/title/message/confirm+cancel labels AND the silenceKey
// "don't ask again" gate: when previously silenced (and honoured — non-danger),
// onConfirm fires immediately and the dialog never renders; the choice is
// persisted before bubbling to the parent. Escape/back -> onCancel; backdrop tap
// -> onCancel (web Modal onClose). The web requireTypedConfirmation + loading
// branches are not used by PrivacySection and are left for the full port.
// ---------------------------------------------------------------------------

function ConfirmDialog({
  open,
  variant = 'danger',
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  silenceKey,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  variant?: 'danger' | 'warning';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Silencing is only honoured for non-destructive prompts (web L89-91).
  const silenceHonored = Boolean(silenceKey && variant !== 'danger');

  // Reset the checkbox each time the dialog reopens (web L96-101).
  useEffect(() => {
    if (open) {
      setDontAskAgain(false);
    }
  }, [open]);

  // Auto-resolve when previously silenced: fire confirm as soon as open flips
  // true (web L107-111). The early return null below avoids a flash.
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isConfirmSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  // Persist the silence choice BEFORE bubbling to the parent (web L139-144).
  const handleConfirmClick = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silenceConfirm(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  // Suppress the dialog entirely when silenced — the effect above resolves it
  // on the next tick (web L151-153).
  if (open && silenceHonored && silenceKey && isConfirmSilenced(silenceKey)) {
    return null;
  }

  const isWarning = variant === 'warning';

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
        <View style={styles.dialog} testID="privacy-confirm-dialog">
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageRow,
              isWarning ? styles.dialogWarningRow : styles.dialogDangerRow,
            ]}>
            <AppText
              style={[
                styles.dialogIcon,
                isWarning ? styles.dialogWarningIcon : styles.dialogDangerIcon,
              ]}>
              {WARNING_GLYPH}
            </AppText>
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          {silenceHonored ? (
            <Pressable
              accessibilityLabel={t(
                'confirm.silence.checkbox',
                "Don't ask again for this action",
              )}
              accessibilityRole="checkbox"
              accessibilityState={{checked: dontAskAgain}}
              onPress={() => setDontAskAgain(prev => !prev)}
              style={styles.silenceRow}>
              <View
                style={[
                  styles.checkbox,
                  dontAskAgain && styles.checkboxChecked,
                ]}>
                {dontAskAgain ? (
                  <AppText style={styles.checkboxGlyph}>{CHECK_GLYPH}</AppText>
                ) : null}
              </View>
              <AppText style={styles.silenceLabel} tone="secondary">
                {t('confirm.silence.checkbox', "Don't ask again for this action")}
              </AppText>
            </Pressable>
          ) : null}
          <View style={styles.dialogActions}>
            <Button
              label={cancelLabel}
              onPress={onCancel}
              testID="privacy-confirm-cancel"
              variant="secondary"
            />
            <Button
              label={confirmLabel}
              onPress={handleConfirmClick}
              testID="privacy-confirm-confirm"
              variant={isWarning ? 'warning' : 'danger'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// consentLabel — web L45-55, verbatim. Resolves the human-readable consent line.
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

const CONFIRM_SILENCE_KEY = 'clear-recent-pages'; // web L43.

export function PrivacySection(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [count, setCount] = useState<number>(() => getRecentPages().length);
  const [consent, setConsentLocal] = useState<ConsentState>(() => getConsent());
  const versionQuery = useVersionInfo();
  const requireConsent = Boolean(versionQuery.data?.require_cookie_consent);

  // Live-update the row counter so a clear in either subscriber drops the count
  // here (web L66-71).
  useEffect(() => {
    setCount(getRecentPages().length);
    return subscribeRecentPages(() => setCount(getRecentPages().length));
  }, []);

  // Keep the consent control in sync with banner-driven mutations (web L73-79).
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
        <View style={styles.headerRow}>
          <IconBox glyph={SHIELD_GLYPH} />
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
              icon={TRASH_GLYPH}
              label={t('recentPages.clearButton', 'Clear recent pages')}
              onPress={() => setConfirmOpen(true)}
              testID="privacy-clear-recent-pages"
              variant="secondary"
            />
          </View>
        </View>

        {/* Cookie / GDPR consent management. Always rendered so operators can
            preview the user-facing flow even when require_cookie_consent is
            off (web L159-162). */}
        <View
          style={[styles.card, styles.cardSpacing]}
          testID="privacy-consent-section">
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
                accessibilityValue={{text: consent}}
                style={styles.cardMeta}
                testID="privacy-consent-state"
                tone="muted">
                {consentLabel(consent, t)}
              </AppText>
            </View>
            <View style={styles.consentActions}>
              <Button
                disabled={consent === 'accepted'}
                label={t('consent.action.accept', 'Re-grant consent')}
                onPress={handleAcceptConsent}
                testID="privacy-consent-accept"
                variant="primary"
              />
              <Button
                disabled={consent === 'declined'}
                label={t('consent.action.decline', 'Withdraw consent')}
                onPress={handleDeclineConsent}
                testID="privacy-consent-decline"
                variant="secondary"
              />
              <Button
                disabled={consent === 'unknown'}
                label={t('consent.action.reset', 'Reset')}
                onPress={handleResetConsent}
                testID="privacy-consent-reset"
                variant="ghost"
              />
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

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  cardBody: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  cardMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  cardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  cardSpacing: {
    marginTop: spacing.md,
  },
  cardText: {
    flex: 1,
    minWidth: 224,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 14,
  },
  consentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 420,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialogDangerIcon: {
    color: colors.danger,
  },
  dialogDangerRow: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogIcon: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  dialogMessage: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dialogMessageRow: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  dialogWarningIcon: {
    color: colors.warning,
  },
  dialogWarningRow: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
  },
  panel: {
    padding: spacing.lg,
  },
  silenceLabel: {
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  silenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  danger: {backgroundColor: colors.danger},
  ghost: {backgroundColor: 'transparent'},
  primary: {backgroundColor: colors.accent},
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  warning: {backgroundColor: colors.warning},
});

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  danger: {color: colors.textPrimary},
  ghost: {color: colors.textPrimary},
  primary: {color: colors.background},
  secondary: {color: colors.textPrimary},
  warning: {color: colors.background},
});

export default PrivacySection;
