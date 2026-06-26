// Native parity port of web/src/features/settings/components/TOTPEnrollmentSection.tsx.
//
// TOTP enrollment UI (web L1-29 doc comment), preserved verbatim in intent. The
// section renders a single GlassPanel with three mutually-exclusive states:
//
//   1. Open mode (no forward-auth header upstream) — an inline "feature requires
//      authenticated mode" placeholder. The Enroll/Disable buttons are NOT
//      rendered so no enroll endpoint is hit (web L206-230).
//   2. Forward-auth + not enrolled — a "Not enrolled" status pill + an "Enroll"
//      button. Clicking opens a modal with the QR data URI, the manual base32
//      secret + a CopyButton, and a 6-digit verify input; on success the modal
//      flips to a "Save these backup codes!" view with copy + download
//      (web L313-331, L335-409, L411-459).
//   3. Forward-auth + active credential — an "Active" pill, the last_used_at
//      time, the remaining backup-code count, plus Regenerate-Backup-Codes and
//      Disable buttons. Disable opens a ConfirmDialog with
//      requireTypedConfirmation="DISABLE" (web L268-312, L463-478).
//
// Every component state name (dialogStep, enrollment, revealedCodes, verifyCode,
// verifyError, showDisableConfirm), the API paths (via the ported useTOTP hooks),
// the i18n keys + English fallbacks, the data-testid hooks, and the handler
// wiring (closeDialog / handleEnroll / handleVerify / handleConfirmDisable /
// handleRegenerate / downloadCodes) are kept 1:1. The section never throws —
// every error path renders an inline ErrorText so the rest of Settings keeps
// working (web L27-28).
//
// Web -> native dependency mapping (every web import documented here + sidecar):
//   - react useCallback/useMemo/useState (web L30) -> + useEffect/useRef for the
//     inlined FadeIn animation, ConfirmDialog reset/auto-resolve effects, and
//     CopyButton reset timer. No behavioural change.
//   - react-i18next useTranslation('settings') (web L31) -> inlined
//     useNativeTranslationFallback(): a (key, fallback) => string shim returning
//     the English fallback verbatim (the PrivacySection / NotificationFilterBar
//     parity pattern). Every key + default preserved; namespace is irrelevant
//     to the returned literal.
//   - lucide-react ShieldCheck/KeyRound/Download/RefreshCw/Trash2/AlertTriangle
//     (web L32) -> inline text glyphs (the QueryError / Toast / PrivacySection
//     inline-glyph precedent): ShieldCheck->🛡, KeyRound->🔑, Download->⬇,
//     RefreshCw->↻, Trash2->🗑, AlertTriangle->⚠.
//   - @/components/ui GlassPanel/IconBox/Button/Badge/Input/Modal/ConfirmDialog/
//     CopyButton/Heading/Text/ErrorText/HelperText/Code (web L33-47) -> the
//     ported native GlassPanel primitive (components/ui/GlassPanel) + native-safe
//     inlined equivalents for the rest (the per-page inline precedent set by
//     PrivacySection / AuditLogPage): IconBox -> a colour-tinted rounded box
//     (NeonColor cyan/green/amber map to the accent/success/warning token sets);
//     Button -> a Pressable with the web primary/secondary/ghost/danger/warning
//     variants + disabled + loading (ActivityIndicator) + leading-glyph support;
//     Badge -> a pill with the success/neutral variants used here; Input -> a
//     labelled TextInput (numeric keyboard, maxLength gate); Modal -> an RN-Modal
//     overlay preserving the title bar + close button + size cap + backdrop-tap
//     close; ConfirmDialog -> a Modal-based confirm preserving variant/title/
//     message/labels AND the requireTypedConfirmation gate, typedConfirmationLabel,
//     the loading (disabled + spinner) branch, and the silenceKey "don't ask
//     again" machinery; CopyButton -> a feature-detected clipboard button;
//     Heading/Text/ErrorText/HelperText/Code -> AppText with role styles + a
//     monospace Code. Typography Tailwind classes resolve to native theme tokens.
//   - @/components/feedback Spinner (web L48) -> inline Spinner (ActivityIndicator).
//   - @/components/motion FadeIn (web L49) -> inline FadeIn: an Animated.View
//     opacity 0->1 + translateY 12->0 mount fade, 400ms, honouring the OS
//     reduced-motion preference via AccessibilityInfo (the PrivacySection FadeIn).
//   - @/api/client isApiError (web L50) -> the ported native web-parity isApiError.
//   - @/api/hooks/useTOTP useTOTPStatus/useTOTPEnroll/useTOTPVerify/useTOTPRevoke/
//     useTOTPRegenerateBackupCodes + the TOTP_* sentinel codes (web L51-60) ->
//     the already-ported native web-parity useTOTP hooks (same /auth/totp paths,
//     same toast-on-error contract via the ported useMutationToast).
//   - @/hooks/useDateFormat useDateFormat (web L61) -> inline native-safe
//     formatDateTime (host-default Intl, '—' for null/invalid) mirroring the
//     AlertFeedWidget / AuditLogPage formatDateTime ports; the locale + tz
//     preference plumbing has no isolated-component analogue and degrades to the
//     host default.
//   - @/api/types TOTPEnrollment (web L62) -> the ported native web-parity type.
//
// Two browser-only behaviours have no React Native analogue and degrade to an
// explicit unavailable state (documented in the sidecar, per the conversion
// contract):
//   - the <img src={qr_data_uri}> tag becomes an RN <Image source={{uri}}/> which
//     renders the same PNG/data-URI QR on react-native-web AND bare native.
//   - downloadCodes' Blob + URL.createObjectURL + <a download> path is
//     feature-detected via getTextFileDownloader(): present under
//     react-native-web, null on bare native, where the button surfaces a
//     "download unavailable — copy instead" helper line rather than failing
//     silently. Copy stays available on every platform.
//
// No DOM-only modules, browser HTML elements, react-i18next, lucide-react,
// Recharts, Leaflet, framer-motion, or web UI components are imported — only
// react, react-native primitives, and ported native parity modules.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';
import {isApiError} from '../../../api/client';
import {
  useTOTPStatus,
  useTOTPEnroll,
  useTOTPVerify,
  useTOTPRevoke,
  useTOTPRegenerateBackupCodes,
  TOTP_INVALID_CODE,
  TOTP_RATE_LIMITED_CODE,
  TOTP_ENROLLMENT_EXPIRED_CODE,
} from '../../../api/hooks/useTOTP';
import type {TOTPEnrollment} from '../../../api/types';

// ── Inline glyphs (web lucide-react icons) ──
const SHIELD_GLYPH = '\u{1F6E1}'; // 🛡 — web ShieldCheck (header).
const KEY_GLYPH = '\u{1F511}'; // 🔑 — web KeyRound (enroll button).
const DOWNLOAD_GLYPH = '\u2B07'; // ⬇ — web Download (backup-codes download).
const REFRESH_GLYPH = '\u21BB'; // ↻ — web RefreshCw (regenerate).
const TRASH_GLYPH = '\u{1F5D1}'; // 🗑 — web Trash2 (disable).
const WARNING_GLYPH = '\u26A0'; // ⚠ — web AlertTriangle (open mode + danger row).
const CHECK_GLYPH = '\u2713'; // ✓ — copy "Copied" + silence checkbox tick.
const COPY_GLYPH = '\u{1F4CB}'; // 📋 — web CopyButton Copy icon.
const CLOSE_GLYPH = '\u2715'; // ✕ — web Modal close (lucide X).

// Monospace family for the manual secret + backup codes (web <Code> mono role).
const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// ---------------------------------------------------------------------------
// useNativeTranslationFallback — inlined react-i18next useTranslation('settings').
// Returns the web English fallback verbatim (every key + default preserved). The
// namespace is irrelevant because only the literal default is surfaced.
// ---------------------------------------------------------------------------

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// ---------------------------------------------------------------------------
// formatDateTime — inlined @/hooks/useDateFormat formatDateTime. Host-default
// Intl ("Apr 4, 2026, 02:15 PM"); '—' for null/invalid. The locale + tz
// preference plumbing has no isolated-component analogue and degrades to the
// host default (the AlertFeedWidget / AuditLogPage formatDateTime precedent).
// ---------------------------------------------------------------------------

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '\u2014';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// clipboard (native-safe). Feature-detects the browser clipboard (present under
// react-native-web, absent on bare native). Returns null when unavailable so the
// CopyButton can surface an explicit unavailable state instead of failing
// silently (the ResponseViewer / AuditLogPage getClipboardWriter precedent).
// ---------------------------------------------------------------------------

type ClipboardWriter = (value: string) => Promise<boolean>;

function getClipboardWriter(): ClipboardWriter | null {
  const nav = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return null;
  }
  return async (value: string) => {
    try {
      await writeText.call(clipboard, value);
      return true;
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// text-file download (native-safe). Mirrors the web downloadCodes Blob +
// URL.createObjectURL + <a download> path. Feature-detected: present under
// react-native-web, null on bare native (no document/Blob/URL), where the
// backup-codes Download button surfaces an explicit "unavailable" helper line.
// ---------------------------------------------------------------------------

type TextFileDownloader = (filename: string, body: string) => void;

function getTextFileDownloader(): TextFileDownloader | null {
  const g = globalThis as {
    document?: {
      createElement?: (tag: string) => unknown;
      body?: {
        appendChild?: (n: unknown) => void;
        removeChild?: (n: unknown) => void;
      };
    };
    URL?: {
      createObjectURL?: (b: unknown) => string;
      revokeObjectURL?: (u: string) => void;
    };
    Blob?: new (parts: unknown[], opts?: {type?: string}) => unknown;
  };
  const doc = g.document;
  const url = g.URL;
  const BlobCtor = g.Blob;
  if (
    !doc ||
    typeof doc.createElement !== 'function' ||
    !doc.body ||
    typeof doc.body.appendChild !== 'function' ||
    typeof doc.body.removeChild !== 'function' ||
    !url ||
    typeof url.createObjectURL !== 'function' ||
    typeof BlobCtor !== 'function'
  ) {
    return null;
  }
  return (filename: string, body: string) => {
    const blob = new BlobCtor([body], {type: 'text/plain'});
    const objectUrl = url.createObjectURL!(blob);
    const link = doc.createElement!('a') as {
      href: string;
      download: string;
      style: {display: string};
      click: () => void;
    };
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    doc.body!.appendChild!(link);
    link.click();
    doc.body!.removeChild!(link);
    url.revokeObjectURL?.(objectUrl);
  };
}

// ---------------------------------------------------------------------------
// confirmSilence native-safe store (web @/lib/confirmSilence, used transitively
// by the @/components/ui ConfirmDialog). localStorage-backed "don't ask again"
// keys degrade to an in-process Set (the PrivacySection precedent). Inert for
// this section's only ConfirmDialog call (danger + requireTypedConfirmation
// always re-prompt), but ported for component fidelity.
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
// reduced-motion preference via AccessibilityInfo.
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
// Spinner — web @/components/feedback Spinner. The brand bolt collapses to an
// accent-tinted ActivityIndicator at the sm size used here.
// ---------------------------------------------------------------------------

function Spinner({size = 'md'}: {size?: 'sm' | 'md' | 'lg'}): React.ReactElement {
  return (
    <ActivityIndicator
      accessibilityLabel="Loading"
      color={colors.accent}
      size={size === 'sm' ? 'small' : 'large'}
    />
  );
}

// ---------------------------------------------------------------------------
// IconBox — web @/components/ui IconBox. Colour-tinted rounded icon container.
// The three call sites use color="cyan" (enroll), "green" (active) and "amber"
// (open mode), so the NeonColor map collapses to the accent/success/warning
// token sets at the md size.
// ---------------------------------------------------------------------------

type IconBoxColor = 'cyan' | 'green' | 'amber';

function IconBox({
  glyph,
  color,
}: {
  glyph: string;
  color: IconBoxColor;
}): React.ReactElement {
  return (
    <View style={[styles.iconBox, iconBoxBoxStyles[color]]}>
      <AppText style={[styles.iconGlyph, iconBoxGlyphStyles[color]]}>
        {glyph}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge — web @/components/ui Badge. Rounded-full pill. Only the success
// (active) and neutral (not enrolled) variants are used here.
// ---------------------------------------------------------------------------

function Badge({
  label,
  variant,
  testID,
}: {
  label: string;
  variant: 'success' | 'neutral';
  testID?: string;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeBoxStyles[variant]]} testID={testID}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button — web @/components/ui Button. Pressable with the web primary/secondary/
// ghost/danger/warning variants, a disabled state (web disabled:opacity-50), an
// optional leading glyph, and a loading branch (web spins an SVG; native swaps
// the glyph for an ActivityIndicator + disables press, web disabled={loading}).
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  testID?: string;
}): React.ReactElement {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        buttonVariantStyles[variant],
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={buttonTextStyles[variant].color} size="small" />
      ) : icon ? (
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
// Code — web @/components/ui Code. Monospace inline text used for the manual
// base32 secret and each backup code.
// ---------------------------------------------------------------------------

function Code({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: TextStyle | TextStyle[];
  testID?: string;
}): React.ReactElement {
  return (
    <AppText style={[styles.code, style]} testID={testID}>
      {children}
    </AppText>
  );
}

// ---------------------------------------------------------------------------
// CopyButton — web @/components/ui CopyButton. Feature-detected clipboard write
// with the web Copy/Copied label toggle (2s reset). When the clipboard is
// unavailable (bare native) the label surfaces "Unavailable" instead of failing
// silently. Defaults to the web ghost/sm affordance.
// ---------------------------------------------------------------------------

type CopyStatus = 'idle' | 'copied' | 'unavailable';

function CopyButton({text}: {text: string}): React.ReactElement {
  const t = useNativeTranslationFallback();
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current);
      }
    };
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
    }
    resetRef.current = setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const handleCopy = useCallback(() => {
    const writer = getClipboardWriter();
    if (!writer) {
      setStatus('unavailable');
      scheduleReset();
      return;
    }
    void writer(text).then(ok => {
      setStatus(ok ? 'copied' : 'unavailable');
      scheduleReset();
    });
  }, [scheduleReset, text]);

  const copyLabel = t('common.copyButton.copy', 'Copy');
  const copiedLabel = t('common.copyButton.copied', 'Copied');
  const unavailableLabel = t('common.copyButton.unavailable', 'Unavailable');
  const label =
    status === 'copied'
      ? copiedLabel
      : status === 'unavailable'
      ? unavailableLabel
      : copyLabel;
  const glyph = status === 'copied' ? CHECK_GLYPH : COPY_GLYPH;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={handleCopy}
      style={({pressed}) => [
        styles.button,
        styles.copyButton,
        pressed && styles.buttonPressed,
      ]}>
      <AppText style={[styles.buttonIcon, styles.copyText]}>{glyph}</AppText>
      <AppText style={styles.copyText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Modal — web @/components/ui Modal. RN-Modal overlay preserving the title bar
// (heading + 44px close button), the size cap (sm/md/lg/full -> maxWidth), and
// the backdrop-tap / hardware-back close (web onClose). Below the cap the dialog
// fills the width like the web mobile bottom sheet.
// ---------------------------------------------------------------------------

type ModalSize = 'sm' | 'md' | 'lg' | 'full';

const MODAL_MAX_WIDTH: Record<ModalSize, number> = {
  sm: 384,
  md: 512,
  lg: 672,
  full: 1100,
};

function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  testID,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  children: ReactNode;
  testID?: string;
}): React.ReactElement {
  return (
    <RNModal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View
          accessibilityRole="none"
          accessibilityViewIsModal
          style={[styles.modalDialog, {maxWidth: MODAL_MAX_WIDTH[size]}]}
          testID={testID}>
          {title ? (
            <View style={styles.modalHeader}>
              <AppText
                numberOfLines={1}
                style={styles.modalTitle}
                weight="semibold">
                {title}
              </AppText>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({pressed}) => [
                  styles.modalClose,
                  pressed && styles.buttonPressed,
                ]}>
                <AppText style={styles.modalCloseGlyph}>{CLOSE_GLYPH}</AppText>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.modalBody}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </RNModal>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog — web @/components/ui ConfirmDialog. Modal-based confirm prompt
// preserving variant/title/message/confirm+cancel labels, the loading branch
// (both buttons disabled + spinner on confirm), the requireTypedConfirmation
// gate (confirm stays disabled until the user types the exact string), the
// caller-supplied typedConfirmationLabel, and the silenceKey "don't ask again"
// machinery (honoured only for non-danger, non-typed prompts — so inert for the
// disable flow, ported for fidelity). Backdrop/back -> onCancel (swallowed while
// loading, web handleModalClose).
// ---------------------------------------------------------------------------

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  requireTypedConfirmation,
  typedConfirmationLabel,
  silenceKey,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  requireTypedConfirmation?: string;
  typedConfirmationLabel?: string;
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const [typed, setTyped] = useState('');
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Silencing is only honoured for non-destructive, non-typed prompts (web
  // L89-91). Danger + typed-confirmation always re-prompt.
  const silenceHonored = Boolean(
    silenceKey && variant !== 'danger' && !requireTypedConfirmation,
  );

  // Reset the typed input + checkbox each time the dialog reopens (web L96-101).
  useEffect(() => {
    if (open) {
      setTyped('');
      setDontAskAgain(false);
    }
  }, [open]);

  // Auto-resolve when previously silenced (web L107-111).
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isConfirmSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  const typedMatches =
    !requireTypedConfirmation || typed === requireTypedConfirmation;
  const confirmDisabled = loading || !typedMatches;

  // Swallow the backdrop close while a mutation is in flight (web L132-135).
  const handleModalClose = useCallback(() => {
    if (loading) {
      return;
    }
    onCancel();
  }, [loading, onCancel]);

  // Persist the silence choice BEFORE bubbling to the parent (web L139-144).
  const handleConfirmClick = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silenceConfirm(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  const inputLabel =
    typedConfirmationLabel ??
    (requireTypedConfirmation
      ? `Type "${requireTypedConfirmation}" to confirm`
      : '');

  // Suppress the dialog entirely when silenced — the effect above resolves it on
  // the next tick (web L151-153).
  if (open && silenceHonored && silenceKey && isConfirmSilenced(silenceKey)) {
    return null;
  }

  const isWarning = variant === 'warning';

  return (
    <Modal onClose={handleModalClose} open={open} size="sm" title={title}>
      <View style={styles.confirmBody}>
        <View
          style={[
            styles.confirmMessageRow,
            isWarning ? styles.confirmWarningRow : styles.confirmDangerRow,
          ]}>
          <AppText
            style={[
              styles.confirmIcon,
              isWarning ? styles.confirmWarningIcon : styles.confirmDangerIcon,
            ]}>
            {WARNING_GLYPH}
          </AppText>
          <AppText style={styles.confirmMessage}>{message}</AppText>
        </View>
        {requireTypedConfirmation ? (
          <Input
            autoCapitalize="characters"
            disabled={loading}
            label={inputLabel}
            onChangeText={setTyped}
            placeholder={requireTypedConfirmation}
            value={typed}
          />
        ) : null}
        {silenceHonored ? (
          <Pressable
            accessibilityLabel={t(
              'confirm.silence.checkbox',
              "Don't ask again for this action",
            )}
            accessibilityRole="checkbox"
            accessibilityState={{checked: dontAskAgain}}
            disabled={loading}
            onPress={() => setDontAskAgain(prev => !prev)}
            style={styles.silenceRow}>
            <View
              style={[styles.checkbox, dontAskAgain && styles.checkboxChecked]}>
              {dontAskAgain ? (
                <AppText style={styles.checkboxGlyph}>{CHECK_GLYPH}</AppText>
              ) : null}
            </View>
            <AppText style={styles.silenceLabel} tone="secondary">
              {t('confirm.silence.checkbox', "Don't ask again for this action")}
            </AppText>
          </Pressable>
        ) : null}
        <View style={styles.confirmActions}>
          <Button
            disabled={loading}
            label={cancelLabel}
            onPress={onCancel}
            variant="secondary"
          />
          <Button
            disabled={confirmDisabled}
            label={confirmLabel}
            loading={loading}
            onPress={handleConfirmClick}
            variant={isWarning ? 'warning' : 'danger'}
          />
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Input — web @/components/ui Input. Labelled TextInput. The single call here is
// a numeric 6-digit verify field; the ConfirmDialog reuses it for the typed
// "DISABLE" confirmation. Mirrors the web label + disabled:opacity-50.
// ---------------------------------------------------------------------------

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  disabled = false,
  autoFocus = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  maxLength,
  testID,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'characters';
  maxLength?: number;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.inputGroup}>
      {label ? <AppText style={styles.inputLabel}>{label}</AppText> : null}
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        editable={!disabled}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, disabled && styles.inputDisabled]}
        testID={testID}
        value={value}
      />
    </View>
  );
}

type DialogStep = 'enroll' | 'backupCodes' | 'closed';

export function TOTPEnrollmentSection(): React.ReactElement {
  const t = useNativeTranslationFallback();

  const status = useTOTPStatus();
  const enrollMut = useTOTPEnroll();
  const verifyMut = useTOTPVerify();
  const revokeMut = useTOTPRevoke();
  const regenMut = useTOTPRegenerateBackupCodes();

  const [dialogStep, setDialogStep] = useState<DialogStep>('closed');
  const [enrollment, setEnrollment] = useState<TOTPEnrollment | null>(null);
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [downloadUnavailable, setDownloadUnavailable] = useState(false);

  // Memoized i18n label — kept at the top of the component so it runs on every
  // render path (the early returns below would otherwise violate the rules of
  // hooks). Mirrors web L86-89.
  const disableTypedLabel = useMemo(
    () => t('totp.disable.typedLabel', 'Type DISABLE to confirm'),
    [t],
  );

  const closeDialog = useCallback(() => {
    setDialogStep('closed');
    setEnrollment(null);
    setRevealedCodes(null);
    setVerifyCode('');
    setVerifyError(null);
    setDownloadUnavailable(false);
  }, []);

  const handleEnroll = useCallback(async () => {
    try {
      const result = await enrollMut.mutateAsync();
      setEnrollment(result);
      setVerifyCode('');
      setVerifyError(null);
      setDialogStep('enroll');
    } catch {
      // toast already surfaced by useTOTPEnroll's onError; nothing else to do —
      // the dialog stays closed and the section's pill is unchanged.
    }
  }, [enrollMut]);

  const handleVerify = useCallback(async () => {
    setVerifyError(null);
    const code = verifyCode.replace(/\D/g, '');
    if (code.length !== 6) {
      setVerifyError(t('totp.errors.codeLength', 'Enter all 6 digits.'));
      return;
    }
    try {
      await verifyMut.mutateAsync({code});
      setRevealedCodes(enrollment?.backup_codes ?? []);
      setDialogStep('backupCodes');
    } catch (err) {
      const apiCode = isApiError(err) ? err.code : undefined;
      if (apiCode === TOTP_INVALID_CODE) {
        setVerifyError(
          t('totp.errors.invalidCode', 'Code did not match. Try the next one.'),
        );
      } else if (apiCode === TOTP_RATE_LIMITED_CODE) {
        setVerifyError(
          t(
            'totp.errors.rateLimited',
            'Too many incorrect attempts. Try again in 15 minutes.',
          ),
        );
      } else if (apiCode === TOTP_ENROLLMENT_EXPIRED_CODE) {
        setVerifyError(
          t(
            'totp.errors.enrollmentExpired',
            'Enrollment expired. Close and start over.',
          ),
        );
      } else {
        setVerifyError(
          err instanceof Error
            ? err.message
            : t('totp.errors.verifyGeneric', 'Verification failed.'),
        );
      }
    }
  }, [enrollment, verifyCode, verifyMut, t]);

  const handleConfirmDisable = useCallback(async () => {
    try {
      await revokeMut.mutateAsync();
    } catch {
      // toast already surfaced; dialog closes via finally below.
    } finally {
      setShowDisableConfirm(false);
    }
  }, [revokeMut]);

  const handleRegenerate = useCallback(async () => {
    try {
      const result = await regenMut.mutateAsync();
      setRevealedCodes(result.backup_codes);
      setEnrollment(null);
      setDialogStep('backupCodes');
    } catch {
      // toast already surfaced; nothing else to do.
    }
  }, [regenMut]);

  const downloadCodes = useCallback(() => {
    if (!revealedCodes || revealedCodes.length === 0) {
      return;
    }
    const header = t(
      'totp.backupCodes.fileHeader',
      '# TeslaSync TOTP backup codes — keep secret.',
    );
    const body = `${header}\n\n${revealedCodes.join('\n')}\n`;
    const downloader = getTextFileDownloader();
    if (!downloader) {
      // Bare-native has no Blob/anchor download — surface an explicit unavailable
      // state so the user falls back to the always-available Copy affordance.
      setDownloadUnavailable(true);
      return;
    }
    setDownloadUnavailable(false);
    downloader('teslasync-totp-backup-codes.txt', body);
  }, [revealedCodes, t]);

  // Render branches ────────────────────────────────────────────────

  if (status.isLoading) {
    return (
      <FadeIn>
        <GlassPanel style={[styles.panel, styles.loadingPanel]}>
          <Spinner size="sm" />
          <AppText style={styles.bodySm}>
            {t('totp.loading', 'Loading two-factor settings…')}
          </AppText>
        </GlassPanel>
      </FadeIn>
    );
  }

  // Open-mode placeholder. Mirrors what <RequiresAuth> will render; inline for
  // now because that gate is not available here (web L204-230).
  if (!status.data || status.data.mode === 'open') {
    return (
      <FadeIn>
        <GlassPanel
          style={[styles.panel, styles.openModePanel]}
          testID="totp-section-open-mode">
          <View style={styles.headerLeft}>
            <IconBox color="amber" glyph={WARNING_GLYPH} />
            <AppText style={styles.title} weight="semibold">
              {t('totp.title', 'Two-factor authentication')}
            </AppText>
          </View>
          <AppText style={styles.helper}>
            {t(
              'totp.openMode.message',
              'Per-user TOTP requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.',
            )}
          </AppText>
        </GlassPanel>
      </FadeIn>
    );
  }

  const sessionStatus = status.data;
  const activated = sessionStatus.activated === true;
  const lastUsedAt = activated ? sessionStatus.last_used_at : undefined;
  const backupRemaining = activated
    ? sessionStatus.backup_codes_remaining ?? 0
    : 0;

  return (
    <>
      <FadeIn>
        <GlassPanel style={[styles.panel, styles.mainPanel]} testID="totp-section">
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <IconBox
                color={activated ? 'green' : 'cyan'}
                glyph={SHIELD_GLYPH}
              />
              <View style={styles.headerText}>
                <AppText style={styles.title} weight="semibold">
                  {t('totp.title', 'Two-factor authentication')}
                </AppText>
                <AppText style={styles.helper}>
                  {t(
                    'totp.subtitle',
                    'TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions.',
                  )}
                </AppText>
              </View>
            </View>
            <Badge
              label={
                activated
                  ? t('totp.status.active', 'Active')
                  : t('totp.status.notEnrolled', 'Not enrolled')
              }
              testID="totp-status-pill"
              variant={activated ? 'success' : 'neutral'}
            />
          </View>

          {activated ? (
            <View style={styles.activeBlock}>
              <View style={styles.grid}>
                <View style={styles.gridCol}>
                  <AppText style={styles.fieldLabel}>
                    {t('totp.lastUsed.label', 'Last used')}
                  </AppText>
                  <AppText style={styles.bodySm}>
                    {lastUsedAt
                      ? formatDateTime(lastUsedAt)
                      : t('totp.lastUsed.never', 'Never')}
                  </AppText>
                </View>
                <View style={styles.gridCol}>
                  <AppText style={styles.fieldLabel}>
                    {t(
                      'totp.backupCodesRemaining.label',
                      'Backup codes remaining',
                    )}
                  </AppText>
                  <AppText style={styles.bodySm} testID="totp-backup-remaining">
                    {backupRemaining}
                  </AppText>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <Button
                  icon={REFRESH_GLYPH}
                  label={t('totp.actions.regenerate', 'Regenerate backup codes')}
                  loading={regenMut.isPending}
                  onPress={handleRegenerate}
                  testID="totp-regenerate"
                  variant="ghost"
                />
                <Button
                  icon={TRASH_GLYPH}
                  label={t('totp.actions.disable', 'Disable')}
                  onPress={() => setShowDisableConfirm(true)}
                  testID="totp-disable"
                  variant="danger"
                />
              </View>
            </View>
          ) : (
            <View style={styles.actionsRow}>
              <Button
                icon={KEY_GLYPH}
                label={t('totp.actions.enroll', 'Enable TOTP')}
                loading={enrollMut.isPending}
                onPress={handleEnroll}
                testID="totp-enroll"
                variant="primary"
              />
              <AppText style={styles.helper}>
                {t(
                  'totp.actions.enrollHint',
                  'Compatible with Google Authenticator, 1Password, Bitwarden, Authy and other RFC 6238 clients.',
                )}
              </AppText>
            </View>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Enroll modal — QR + manual code + 6-digit verify */}
      <Modal
        onClose={closeDialog}
        open={dialogStep === 'enroll' && enrollment != null}
        size="sm"
        testID="totp-enroll-modal"
        title={t('totp.modal.enrollTitle', 'Enable TOTP')}>
        {enrollment != null ? (
          <View style={styles.modalStack}>
            <AppText style={styles.bodySm}>
              {t(
                'totp.modal.scanInstructions',
                'Scan the QR code with your authenticator app, or enter the secret manually.',
              )}
            </AppText>
            <View style={styles.qrRow}>
              <Image
                accessibilityLabel={t('totp.modal.qrAlt', 'TOTP QR code')}
                resizeMode="contain"
                source={{uri: enrollment.qr_data_uri}}
                style={styles.qrImage}
                testID="totp-qr"
              />
            </View>
            <View>
              <AppText style={styles.fieldLabel}>
                {t('totp.modal.manualLabel', 'Manual entry secret')}
              </AppText>
              <View style={styles.secretRow}>
                <Code style={styles.secretCode} testID="totp-secret">
                  {enrollment.secret}
                </Code>
                <CopyButton text={enrollment.secret} />
              </View>
            </View>
            <Input
              autoCapitalize="none"
              disabled={verifyMut.isPending}
              autoFocus
              keyboardType="number-pad"
              label={t(
                'totp.modal.codeLabel',
                'Enter the 6-digit code from your app',
              )}
              maxLength={6}
              onChangeText={next =>
                setVerifyCode(next.replace(/\D/g, '').slice(0, 6))
              }
              testID="totp-verify-input"
              value={verifyCode}
            />
            {verifyError != null ? (
              <AppText style={styles.errorText} testID="totp-verify-error">
                {verifyError}
              </AppText>
            ) : null}
            <View style={styles.modalActions}>
              <Button
                disabled={verifyMut.isPending}
                label={t('totp.modal.cancel', 'Cancel')}
                onPress={closeDialog}
                variant="ghost"
              />
              <Button
                label={t('totp.modal.verify', 'Verify and activate')}
                loading={verifyMut.isPending}
                onPress={handleVerify}
                testID="totp-verify-submit"
                variant="primary"
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Backup-codes reveal modal — shown ONCE after enroll/regen */}
      <Modal
        onClose={closeDialog}
        open={dialogStep === 'backupCodes' && revealedCodes != null}
        size="sm"
        testID="totp-backup-modal"
        title={t('totp.backupCodes.title', 'Save your backup codes')}>
        {revealedCodes != null ? (
          <View style={styles.modalStack}>
            <AppText style={styles.bodySm}>
              {t(
                'totp.backupCodes.warning',
                'These codes will not be shown again. Store them in a password manager. Each code can be used once if you lose access to your authenticator app.',
              )}
            </AppText>
            <View style={styles.backupList} testID="totp-backup-list">
              {revealedCodes.map(code => (
                <View key={code} style={styles.backupItem}>
                  <Code>{code}</Code>
                </View>
              ))}
            </View>
            {downloadUnavailable ? (
              <AppText style={styles.helper}>
                {t(
                  'totp.backupCodes.downloadUnavailable',
                  'Download is unavailable on this device — copy the codes instead.',
                )}
              </AppText>
            ) : null}
            <View style={styles.modalActionsWrap}>
              <Button
                icon={DOWNLOAD_GLYPH}
                label={t('totp.backupCodes.download', 'Download .txt')}
                onPress={downloadCodes}
                testID="totp-backup-download"
                variant="ghost"
              />
              <CopyButton text={revealedCodes.join('\n')} />
              <Button
                label={t('totp.backupCodes.done', 'I saved them')}
                onPress={closeDialog}
                testID="totp-backup-done"
                variant="primary"
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Disable confirmation — typed-confirmation + RequireSudo interceptor on
          the network round-trip handles the step-up. */}
      <ConfirmDialog
        cancelLabel={t('totp.disable.cancel', 'Keep TOTP enabled')}
        confirmLabel={t('totp.disable.confirm', 'Disable')}
        loading={revokeMut.isPending}
        message={t(
          'totp.disable.message',
          'You will no longer be prompted for a TOTP code on the sudo step-up. Your backup codes will be invalidated.',
        )}
        onCancel={() => setShowDisableConfirm(false)}
        onConfirm={handleConfirmDisable}
        open={showDisableConfirm}
        requireTypedConfirmation="DISABLE"
        title={t('totp.disable.title', 'Disable two-factor authentication?')}
        typedConfirmationLabel={disableTypedLabel}
        variant="danger"
      />
    </>
  );
}

TOTPEnrollmentSection.displayName = 'TOTPEnrollmentSection';

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  activeBlock: {
    gap: spacing.md,
  },
  backupItem: {
    minWidth: '46%',
  },
  backupList: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  bodySm: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
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
  code: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
  },
  confirmActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  confirmBody: {
    gap: spacing.md,
  },
  confirmDangerIcon: {
    color: colors.danger,
  },
  confirmDangerRow: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  confirmIcon: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  confirmMessage: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmMessageRow: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  confirmWarningIcon: {
    color: colors.warning,
  },
  confirmWarningRow: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  copyButton: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  copyText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridCol: {
    flex: 1,
    minWidth: 150,
  },
  headerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  helper: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  loadingPanel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  mainPanel: {
    gap: spacing.lg,
  },
  modalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  modalActionsWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalBody: {
    padding: spacing.lg,
  },
  modalClose: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  modalCloseGlyph: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 18,
  },
  modalDialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '90%',
    width: '92%',
    ...shadows.panel,
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  modalStack: {
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  openModePanel: {
    gap: spacing.md,
  },
  panel: {
    padding: spacing.lg,
  },
  qrImage: {
    backgroundColor: '#ffffff',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 224,
    padding: spacing.sm,
    width: 224,
  },
  qrRow: {
    alignItems: 'center',
  },
  secretCode: {
    flex: 1,
  },
  secretRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
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

const iconBoxBoxStyles = StyleSheet.create<Record<IconBoxColor, ViewStyle>>({
  amber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  cyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const iconBoxGlyphStyles = StyleSheet.create<Record<IconBoxColor, TextStyle>>({
  amber: {color: colors.warning},
  cyan: {color: colors.accent},
  green: {color: colors.success},
});

const badgeBoxStyles = StyleSheet.create<
  Record<'success' | 'neutral', ViewStyle>
>({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create<
  Record<'success' | 'neutral', TextStyle>
>({
  neutral: {color: colors.textSecondary},
  success: {color: colors.success},
});

export default TOTPEnrollmentSection;
