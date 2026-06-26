// Native parity port of web/src/components/ui/ConfirmDialog.tsx.
//
// A confirm/cancel dialog with three escalating safety gates, faithfully
// reproduced for React Native:
//   1. variant ('danger' | 'warning') drives the severity icon + confirm
//      button colour.
//   2. requireTypedConfirmation forces the user to type an exact string before
//      the confirm button enables (delete-vehicle / wipe-database actions).
//   3. silenceKey + a "Don't ask again" checkbox lets NON-destructive prompts
//      be skipped on future calls — ignored for danger / typed-confirmation
//      prompts exactly as the web does.
//
// Every browser-only dependency is reduced to an explicit native-safe analog
// and documented in the .parity.json sidecar:
//   - react-i18next useTranslation (L3): React Native has no i18n provider wired
//     yet, so a useNativeTranslationFallback() returns the English default
//     (useRef pattern matching the sibling SessionExpiredModal / DraftRestorePrompt
//     ports). The 'confirm.silence.checkbox' key + default copy are preserved.
//   - @/lib/cn (L4): Tailwind class merging is irrelevant on native; styling is
//     StyleSheet objects merged via arrays, dynamic severity colours inline.
//   - @/lib/tokens severityTokens + Severity (L5): the web token map is Tailwind
//     class strings; here it becomes a native colour map (surface / border / fg)
//     keyed by the same Severity values, retaining the lucide icon NAME for
//     traceability and mapping it to a decorative glyph.
//   - @/lib/confirmSilence isSilenced/silence (L6): localStorage doesn't exist on
//     React Native and AsyncStorage is not a dependency of this app, so the
//     persistent allowlist becomes an in-memory Set living for the JS runtime's
//     lifetime. Same key namespace, dedupe-on-add, and full API surface
//     (isSilenced/silence/unsilence/listSilenced/clearAllSilenced) are preserved
//     so callers are unchanged — the only lost behaviour is cross-restart
//     persistence, documented as the explicit unavailable state.
//   - lucide-react AlertOctagon / AlertTriangle (L2): decorative AppText glyphs
//     (no-entry / warning-triangle) tinted with the severity fg colour, marked
//     importantForAccessibility="no" to mirror the web aria-hidden.
//   - ./Modal (L7): React Native's <Modal> (transparent, fade) + a backdrop
//     Pressable. The web Modal closes on backdrop click AND Esc; here both route
//     through handleModalClose (which no-ops while loading). size="sm" -> a
//     max-width dialog card.
//   - ./Button (L8): Pressable primary/danger/secondary buttons styled from the
//     design tokens, with an ActivityIndicator standing in for the web spinner.
//   - ./Input (L9): a labelled <TextInput> for the typed-confirmation gate.
//   - window keydown Escape -> onCancel (L116-125): no hardware-keyboard analog
//     on native; the Android back button / system dismiss is delivered through
//     the Modal onRequestClose, routed through handleModalClose so it still
//     cancels only when not loading.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTFunction = (key: string, defaultValue: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue) => defaultValue).current;
}

// ── confirm-silence registry (native-safe port of @/lib/confirmSilence) ──
// The web lib persists silenced action ids in localStorage under a single
// versioned allowlist key. React Native has no localStorage (and AsyncStorage
// is not a dependency), so the store is an in-memory Set that lives only for
// the JS runtime's lifetime. The key namespace, dedupe-on-add semantics, and
// the full helper surface are preserved so call sites are unchanged.
const CONFIRM_SILENCE_STORAGE_KEY = 'teslasync:confirm-silence:v1';
const silencedActions = new Set<string>();

/** Returns true when the user previously opted to silence this action id. */
export function isSilenced(key: string): boolean {
  if (!key) {
    return false;
  }
  return silencedActions.has(key);
}

/** Persist that the user no longer wants to be asked about this action. */
export function silence(key: string): void {
  if (!key) {
    return;
  }
  silencedActions.add(key);
}

/** Re-enable the prompt for a single action id. */
export function unsilence(key: string): void {
  if (!key) {
    return;
  }
  silencedActions.delete(key);
}

/** All currently-silenced action ids, sorted for stable rendering. */
export function listSilenced(): string[] {
  return [...silencedActions].sort();
}

/** Wipe every silenced action id ("Restore all confirmation prompts"). */
export function clearAllSilenced(): void {
  silencedActions.clear();
}

/** Test-only escape hatch matching the web lib helper. */
export const _STORAGE_KEY_INTERNAL = CONFIRM_SILENCE_STORAGE_KEY;

// ── severity tokens (native-safe port of @/lib/tokens severityTokens) ──
export type Severity = 'info' | 'warn' | 'critical' | 'success';

interface SeverityVisual {
  /** Soft background tint for the alert chip. */
  surface: string;
  /** Alert chip border colour. */
  border: string;
  /** Icon/foreground colour (NOT body text). */
  fg: string;
  /** Lucide icon name, retained for traceability against the web token map. */
  icon: 'AlertOctagon' | 'AlertTriangle';
  /** Decorative glyph standing in for the lucide line icon. */
  glyph: string;
}

// Only `warn` and `critical` are reachable from ConfirmDialog's two variants,
// but the icon name mirrors the web severityTokens map for both.
const severityVisuals: Record<'warn' | 'critical', SeverityVisual> = {
  warn: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
    icon: 'AlertTriangle',
    glyph: '\u26A0', // ⚠
  },
  critical: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
    icon: 'AlertOctagon',
    glyph: '\u26D4', // ⛔
  },
};

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  /**
   * When true, both buttons are disabled and the confirm button shows a spinner.
   * Use this when the parent keeps the dialog open while a mutation is in flight.
   */
  loading?: boolean;
  /**
   * For extra-dangerous actions (delete vehicle, wipe database). The confirm
   * button stays disabled until the user types this exact string into the
   * confirmation input.
   */
  requireTypedConfirmation?: string;
  /**
   * Optional caller-supplied label for the typed-confirmation input. Keep
   * configurable so callers can localize via `t()`. Defaults to an English
   * fallback containing the required string.
   */
  typedConfirmationLabel?: string;
  /**
   * Stable action id that, when set, lets the user opt out of future
   * prompts via a "Don't ask again" checkbox. The choice is persisted in
   * the in-memory silence registry (see the native port above) and
   * short-circuits the dialog on subsequent calls — `onConfirm` fires
   * immediately and the dialog never renders.
   *
   * **Ignored** for `variant === 'danger'` and any prompt that sets
   * `requireTypedConfirmation` — destructive actions must always confirm.
   * Callers may still pass `silenceKey` on those without effect, which
   * keeps call sites simple when the variant is dynamic.
   */
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantToSeverity: Record<
  NonNullable<ConfirmDialogProps['variant']>,
  'warn' | 'critical'
> = {
  danger: 'critical',
  warning: 'warn',
};

export function ConfirmDialog({
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
}: ConfirmDialogProps) {
  const t = useNativeTranslationFallback();
  const sev = variantToSeverity[variant];
  const tokens = severityVisuals[sev];
  const [typed, setTyped] = useState('');
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Silencing is only honored for non-destructive prompts. Danger variant
  // and typed-confirmation gates always re-prompt regardless of caller.
  const silenceHonored = Boolean(
    silenceKey && variant !== 'danger' && !requireTypedConfirmation,
  );

  // Reset typed input AND the "don't ask again" checkbox each time the
  // dialog reopens so a stale value from a previous invocation can't
  // bypass the typed-confirmation gate or pre-tick the silence checkbox.
  useEffect(() => {
    if (open) {
      setTyped('');
      setDontAskAgain(false);
    }
  }, [open]);

  // Auto-resolve when the user previously silenced this action: fire the
  // confirm callback as soon as `open` flips true. The early `return null`
  // below prevents any flash of the dialog before the parent commits the
  // resulting `open=false`.
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  // The web suppresses Escape -> cancel while loading. There is no hardware
  // keyboard analog on native; the Android back button / system dismiss is
  // delivered through the Modal onRequestClose below, routed through
  // handleModalClose so it preserves the "suppressed while loading" rule.

  const typedMatches =
    !requireTypedConfirmation || typed === requireTypedConfirmation;
  const confirmDisabled = loading || !typedMatches;

  // While loading we swallow the backdrop / system-dismiss close handler to
  // keep the dialog mounted until the mutation resolves; otherwise cancel.
  const handleModalClose = useCallback(() => {
    if (loading) {
      return;
    }
    onCancel();
  }, [loading, onCancel]);

  // Persist the silence choice BEFORE bubbling up to the parent so the
  // next call sees the updated registry value.
  const handleConfirmClick = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silence(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  const inputLabel =
    typedConfirmationLabel ??
    (requireTypedConfirmation
      ? `Type "${requireTypedConfirmation}" to confirm`
      : '');

  // Suppress the dialog entirely when silenced — the auto-resolve effect
  // above will fire `onConfirm` on the next tick.
  if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
    return null;
  }

  const confirmTextColor = colors.background;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleModalClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        {/* Backdrop with a press handler — the native analog of the web
            Modal closing on backdrop click (no-op while loading). */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleModalClose}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel={title}
          accessibilityViewIsModal
          accessible
          style={styles.dialog}
          testID="confirm-dialog">
          <View style={styles.header}>
            <AppText
              numberOfLines={1}
              style={styles.title}
              variant="title"
              weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleModalClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              testID="confirm-dialog-close">
              <AppText style={styles.closeGlyph} tone="secondary">
                {'\u2715'}
              </AppText>
            </Pressable>
          </View>

          <View style={styles.body}>
            <View
              style={[
                styles.alert,
                {backgroundColor: tokens.surface, borderColor: tokens.border},
              ]}>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[styles.alertGlyph, {color: tokens.fg}]}>
                {tokens.glyph}
              </AppText>
              <AppText style={styles.message}>{message}</AppText>
            </View>

            {requireTypedConfirmation ? (
              <View style={styles.field}>
                {inputLabel ? (
                  <AppText style={styles.label} tone="secondary">
                    {inputLabel}
                  </AppText>
                ) : null}
                <TextInput
                  accessibilityLabel={inputLabel || undefined}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  editable={!loading}
                  onChangeText={setTyped}
                  placeholder={requireTypedConfirmation}
                  placeholderTextColor={colors.textMuted}
                  spellCheck={false}
                  style={[styles.input, loading && styles.inputDisabled]}
                  testID="confirm-dialog-input"
                  value={typed}
                />
              </View>
            ) : null}

            {silenceHonored ? (
              <Pressable
                accessibilityHint={undefined}
                accessibilityLabel={t(
                  'confirm.silence.checkbox',
                  "Don't ask again for this action",
                )}
                accessibilityRole="checkbox"
                accessibilityState={{checked: dontAskAgain, disabled: loading}}
                disabled={loading}
                onPress={() => setDontAskAgain(value => !value)}
                style={styles.silenceRow}
                testID="confirm-dialog-silence-toggle">
                <View
                  style={[
                    styles.checkbox,
                    dontAskAgain && styles.checkboxChecked,
                  ]}>
                  {dontAskAgain ? (
                    <AppText style={styles.checkboxMark}>{'\u2713'}</AppText>
                  ) : null}
                </View>
                <AppText style={styles.silenceLabel} tone="secondary">
                  {t(
                    'confirm.silence.checkbox',
                    "Don't ask again for this action",
                  )}
                </AppText>
              </Pressable>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityLabel={cancelLabel}
                accessibilityRole="button"
                accessibilityState={{disabled: loading}}
                disabled={loading}
                onPress={onCancel}
                style={({pressed}) => [
                  styles.button,
                  styles.cancelButton,
                  loading && styles.buttonDisabled,
                  pressed && !loading && styles.pressed,
                ]}
                testID="confirm-dialog-cancel">
                <AppText style={styles.cancelLabel} weight="semibold">
                  {cancelLabel}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityLabel={confirmLabel}
                accessibilityRole="button"
                accessibilityState={{busy: loading, disabled: confirmDisabled}}
                disabled={confirmDisabled}
                onPress={handleConfirmClick}
                style={({pressed}) => [
                  styles.button,
                  variant === 'danger'
                    ? styles.dangerButton
                    : styles.warningButton,
                  confirmDisabled && styles.buttonDisabled,
                  pressed && !confirmDisabled && styles.pressed,
                ]}
                testID="confirm-dialog-confirm">
                {loading ? (
                  <ActivityIndicator
                    color={confirmTextColor}
                    size="small"
                    style={styles.spinner}
                  />
                ) : null}
                <AppText
                  style={[styles.confirmLabel, {color: confirmTextColor}]}
                  weight="semibold">
                  {confirmLabel}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 4, 10, 0.72)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  body: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  alert: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  alertGlyph: {
    fontSize: 18,
    lineHeight: 22,
    marginTop: 1,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  silenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxMark: {
    color: colors.background,
    fontSize: 13,
    lineHeight: 16,
  },
  silenceLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  cancelButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  cancelLabel: {
    color: colors.textPrimary,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  warningButton: {
    backgroundColor: colors.warning,
  },
  confirmLabel: {
    color: colors.background,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
  spinner: {
    marginRight: spacing.xs,
  },
});

export default ConfirmDialog;
