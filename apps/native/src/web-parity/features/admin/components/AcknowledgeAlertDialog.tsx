/**
 * AcknowledgeAlertDialog — native parity port of
 * web/src/features/admin/components/AcknowledgeAlertDialog.tsx.
 *
 * Modal opened from the alert row's "Acknowledge" button. Lets the user record
 * an optional free-text note (<=1000 chars after trimming) before firing the
 * ack mutation. Empty/whitespace notes are accepted — the backend treats them
 * as "ack with no note" so the audit timeline still captures who+when.
 *
 * Submit + Cancel both close the dialog. The actual mutation is owned by the
 * parent (AlertsPage) so that hook/cache wiring stays colocated with the page
 * that uses it.
 *
 * Native adaptations vs. the web source (behavior/state/keys preserved):
 *   - web <Modal open onClose title size="md"> -> RN <Modal visible transparent
 *     onRequestClose>; the backdrop press + hardware-back dismiss honor the same
 *     `if (!submitting)` guard as the web onClose.
 *   - web <Textarea> -> multiline <TextInput> with the same maxLength
 *     (NOTE_MAX + 50), 4 rows, disabled-while-submitting, label, placeholder,
 *     and the tooLong error surfaced as a danger AppText. `aria-describedby`
 *     intent is kept via nativeID + accessibilityLabelledBy.
 *   - web <Button variant="ghost"> / default <Button> -> Pressable DialogAction
 *     buttons (ghost + primary) with the same disabled gating.
 *   - HTMLTextAreaElement ref -> TextInput ref; the `window.setTimeout` focus
 *     defer is kept as setTimeout so focus lands after the Modal mounts.
 *   - react-i18next useTranslation -> a native-safe t(key, fallback, options?)
 *     fallback preserving every key, English default, and {{max}} interpolation.
 */

import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {Modal, Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';

const NOTE_MAX = 1000;

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return interpolate(fallback, options);
  }, []);
}

export interface AcknowledgeAlertDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the trimmed note (which may be the empty string when the user
   * leaves the textarea blank). The parent is responsible for firing the
   * mutation and showing toast / undo affordances.
   */
  onSubmit: (note: string) => void;
  /** When true, disables Submit/Cancel and shows an in-button busy hint. */
  submitting?: boolean;
  /** Title of the alert being acked, shown as a subtitle for context. */
  alertTitle?: string;
}

export function AcknowledgeAlertDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
  alertTitle,
}: AcknowledgeAlertDialogProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const [note, setNote] = useState('');
  const textareaRef = useRef<TextInput | null>(null);
  const hintId = useId();

  // Reset the note whenever the dialog reopens — stale text from a previous
  // alert would be confusing if the user opens, cancels, then opens again for a
  // different row.
  useEffect(() => {
    if (open) {
      setNote('');
      // Defer focus to the textarea after the Modal mounts and moves focus into
      // the dialog.
      const id = setTimeout(() => textareaRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const trimmed = note.trim();
  const tooLong = trimmed.length > NOTE_MAX;

  const handleSubmit = () => {
    if (submitting || tooLong) {
      return;
    }
    onSubmit(trimmed);
  };

  const handleRequestClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  const title = t('alerts.ack.dialogTitle', 'Acknowledge alert');
  const noteLabel = t('alerts.ack.noteLabel', 'Note (optional)');
  const notePlaceholder = t(
    'alerts.ack.notePlaceholder',
    "Optional: what's being done?",
  );
  const noteHint = t(
    'alerts.ack.noteHint',
    'Up to {{max}} characters. Shared in the audit timeline.',
    {max: NOTE_MAX},
  );
  const cancelLabel = t('alerts.ack.cancel', 'Cancel');
  const submitLabel = t('alerts.ack.submit', 'Acknowledge');

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleRequestClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={submitting}
          importantForAccessibility="no-hide-descendants"
          onPress={handleRequestClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="acknowledge-alert-dialog">
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>

          {alertTitle ? (
            <AppText style={styles.subtitle} tone="secondary">
              {alertTitle}
            </AppText>
          ) : null}

          <View style={styles.field}>
            <AppText style={styles.label} variant="caption" weight="semibold">
              {noteLabel}
            </AppText>
            <TextInput
              accessibilityLabel={noteLabel}
              accessibilityLabelledBy={[hintId]}
              accessibilityState={{disabled: submitting}}
              editable={!submitting}
              maxLength={NOTE_MAX + 50}
              multiline
              numberOfLines={4}
              onChangeText={setNote}
              placeholder={notePlaceholder}
              placeholderTextColor={colors.textMuted}
              ref={textareaRef}
              style={[styles.textarea, tooLong && styles.textareaError]}
              testID="acknowledge-alert-note"
              value={note}
            />
            {tooLong ? (
              <AppText
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.errorText}
                tone="danger"
                variant="caption">
                {noteHint}
              </AppText>
            ) : null}
          </View>

          <AppText
            nativeID={hintId}
            style={styles.hint}
            tone="muted"
            variant="caption">
            {noteHint}
          </AppText>

          <View style={styles.actionRow}>
            <DialogAction
              disabled={submitting}
              label={cancelLabel}
              onPress={onClose}
              testID="acknowledge-alert-cancel"
              variant="ghost"
            />
            <DialogAction
              disabled={submitting || tooLong}
              label={submitLabel}
              onPress={handleSubmit}
              testID="acknowledge-alert-submit"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
AcknowledgeAlertDialog.displayName = 'AcknowledgeAlertDialog';

function DialogAction({
  disabled,
  label,
  onPress,
  testID,
  variant,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        weight="semibold">
        {label}
      </AppText>
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
    paddingTop: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 520,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  errorText: {
    color: colors.danger,
  },
  field: {
    gap: spacing.xs,
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostButtonText: {
    color: colors.textSecondary,
  },
  hint: {
    color: colors.textMuted,
  },
  label: {
    color: colors.textSecondary,
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
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  subtitle: {
    lineHeight: 20,
  },
  textarea: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 104,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
  textareaError: {
    borderColor: colors.dangerBorder,
  },
  title: {
    color: colors.textPrimary,
  },
});

export default AcknowledgeAlertDialog;
