// Native parity port of web/src/features/system/components/CommandConfirmDialog.tsx.
//
// Confirmation gate shown before a dangerous Tesla vehicle command runs. The web
// source guards execution two ways that are both preserved here verbatim: an
// optional countdown timer (the confirm button stays disabled and shows "(Ns)"
// until `remaining` reaches 0) and an optional typed-confirmation word (the user
// must retype `def.confirmInput`, compared case-insensitively, before confirm
// enables). Every state name (remaining, inputValue, inputRef), the
// `countdown`/`confirmInput` derivations, both effects (the 1s setInterval
// countdown with the prev<=1 clear, and the 50ms focus), and the `canConfirm`
// predicate are ported 1:1.
//
// Browser-only dependencies are replaced per conversion rules 4/5/7 (recorded in
// the sidecar):
//   - @/components/ui `Modal` (createPortal/document, size="sm", red-tinted glass
//     classes) -> the RN core `Modal` (transparent fade, backdrop-tap +
//     hardware-back close via onRequestClose) with the same overlay/backdrop/
//     dialog scaffold as the sibling ConfirmDialog / ReauthDialog ports; the red
//     border is kept via colors.dangerBorder.
//   - @/components/ui `Input` (<input ref>) -> RN `TextInput`. The
//     HTMLInputElement ref + setTimeout(() => inputRef.current?.focus(), 50)
//     autofocus is kept against a TextInput ref; `onChange(e => e.target.value)`
//     becomes `onChangeText`; autoComplete="off" is preserved (autoCorrect/
//     autoCapitalize disabled so typed text is compared exactly as on web).
//   - @/components/ui `Button` (variant ghost/danger, loading, disabled) -> a
//     local DialogAction Pressable mirroring the AiConfirmDialog port (spinner
//     while loading, disabled + opacity gating, danger styling).
//   - lucide-react `AlertTriangle` SVG (react-native-svg is not a dependency) ->
//     a decorative "⚠" glyph stand-in flagged aria-hidden (the AutomationCard /
//     KioskSettingsModal glyph precedent).
//   - react-i18next `useTranslation` -> a local useNativeTranslationFallback that
//     returns the inline English fallback AND interpolates {{token}} options, so
//     every t(key, fallback[, opts]) call site + its i18n key survive (the
//     ReauthDialog precedent). The web `typeToConfirm` call's `defaultValue`
//     becomes the fallback argument and its `{ word }` option is interpolated.
//   - the web `div onKeyDown` Escape/Enter handler has no native analog: Escape
//     maps to the Modal `onRequestClose` (hardware back), and Enter maps to the
//     confirm TextInput `onSubmitEditing`, which replays the identical
//     `canConfirm && !loading -> onConfirm()` guard.
//   - `cn(remaining > 0 && 'opacity-50')` -> the styles.dimmed opacity style.
//   - `CommandDef` is imported in the web source from ../commands; only the six
//     fields this dialog reads are modeled locally so the port stays
//     self-contained (the full command catalog, which carries lucide icon
//     fields, is a separate source file in the conversion queue).

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';

type NativeTOptions = Record<string, string>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next has no native parity module; resolve to the inline English
// fallback and interpolate {{token}} options so the i18n key + copy intent
// survive (same pattern as the ReauthDialog / KioskSettingsModal ports).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.entries(options).reduce(
        (text, [token, value]) => text.split(`{{${token}}}`).join(value),
        fallback,
      );
    },
    [],
  );
}

/**
 * Structural subset of the web `CommandDef` (web/src/features/system/commands.ts).
 * Only the fields the confirmation dialog actually reads are modeled here so this
 * port has no dependency on the (DOM-icon-carrying) command catalog module.
 */
export interface CommandDef {
  labelKey: string;
  labelFallback: string;
  confirmKey?: string;
  confirmFallback?: string;
  countdown?: number;
  confirmInput?: string;
}

interface CommandConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  def: CommandDef;
  loading?: boolean;
}

export function CommandConfirmDialog({
  open,
  onClose,
  onConfirm,
  def,
  loading,
}: CommandConfirmDialogProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const countdown = def.countdown ?? 0;
  const confirmInput = def.confirmInput;

  const [remaining, setRemaining] = useState(countdown);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRemaining(countdown);
    setInputValue('');

    if (countdown > 0) {
      const interval = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [open, countdown]);

  useEffect(() => {
    if (open && confirmInput) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, confirmInput]);

  const canConfirm =
    remaining === 0 &&
    (!confirmInput ||
      inputValue.trim().toUpperCase() === confirmInput.toUpperCase());

  // The web `div onKeyDown` Enter branch: confirm only when allowed and idle.
  const handleSubmitEditing = () => {
    if (canConfirm && !loading) {
      onConfirm();
    }
  };

  const title = t(def.labelKey, def.labelFallback);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="command-confirm-dialog">
          <View style={styles.header}>
            <View style={styles.iconBadge}>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.iconGlyph}>
                {'\u26A0'}
              </AppText>
            </View>
            <AppText style={styles.title} weight="semibold">
              {title}
            </AppText>
          </View>

          <AppText style={styles.body} tone="secondary">
            {t(def.confirmKey ?? '', def.confirmFallback ?? 'Are you sure?')}
          </AppText>

          {confirmInput ? (
            <View style={styles.inputSection}>
              <AppText style={styles.inputHint} tone="muted" variant="caption">
                {t(
                  'commands.confirm.typeToConfirm',
                  'Type "{{word}}" to confirm:',
                  {word: confirmInput},
                )}
              </AppText>
              <TextInput
                accessibilityLabel={title}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                onChangeText={setInputValue}
                onSubmitEditing={handleSubmitEditing}
                placeholder={confirmInput}
                placeholderTextColor={colors.textMuted}
                ref={inputRef}
                style={styles.input}
                testID="command-confirm-input"
                value={inputValue}
              />
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <DialogAction
              disabled={false}
              label={t('common.cancel', 'Cancel')}
              onPress={onClose}
              testID="command-confirm-cancel"
              variant="ghost"
            />
            <DialogAction
              dimmed={remaining > 0}
              disabled={!canConfirm}
              label={
                remaining > 0
                  ? `${t('common.confirm', 'Confirm')} (${remaining}s)`
                  : t('common.confirm', 'Confirm')
              }
              loading={loading}
              onPress={onConfirm}
              testID="command-confirm-submit"
              variant="danger"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
CommandConfirmDialog.displayName = 'CommandConfirmDialog';

function DialogAction({
  dimmed = false,
  disabled,
  label,
  loading = false,
  onPress,
  testID,
  variant,
}: {
  dimmed?: boolean;
  disabled: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID: string;
  variant: 'ghost' | 'danger';
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'danger' ? styles.dangerButton : styles.ghostButton,
        dimmed && styles.dimmed,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <AppText
          style={
            variant === 'danger'
              ? styles.dangerButtonText
              : styles.ghostButtonText
          }
          weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  dangerButtonText: {
    color: colors.textPrimary,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.dangerBorder,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 420,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dimmed: {
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.48,
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostButtonText: {
    color: colors.textSecondary,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.danger,
    fontSize: 20,
    lineHeight: 24,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputHint: {
    color: colors.textMuted,
  },
  inputSection: {
    gap: spacing.sm,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
  },
});
