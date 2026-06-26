// Native parity port of
// web/src/features/admin/components/UserImpersonateButton.tsx.
//
// The web component is a per-row "Impersonate" button mounted in the admin
// Subjects list. Click flow: open a warning ConfirmDialog, then on confirm fire
// the sudo-gated start mutation; on success the global ImpersonationBanner
// appears (driven by the status-poll cache invalidation inside the hook). The
// parent owns the open-mode visibility + disabled-row decisions, so this
// component intentionally does NOT re-check the mode. It is reproduced here with
// React Native primitives, preserving the `UserImpersonateButtonProps`
// (`subject`/`disabled`), the `open` useState, the `useStartImpersonation()`
// `startMut`, the `handleClick` (early-return on `disabled || isPending`, else
// open) + `handleConfirm` (close, then `startMut.mutate({ subject })`) logic,
// every `impersonation.*` i18n key + `{{subject}}` interpolation, and the
// `user-impersonate-button-${subject}` testID:
//
//   - `@/components/ui/Button` is the already-ported native parity Button;
//     `variant="ghost" size="sm" onClick -> onPress`, `loading`/`disabled`, and
//     the `icon` slot all carry over. The DOM-only `type="button"` is dropped
//     (the native Button is a Pressable) and `aria-label` becomes
//     `accessibilityLabel`, `data-testid` becomes `testID`.
//   - lucide-react `UserCog` (decorative h-4 aria-hidden glyph) has no native
//     icon dependency; it becomes a decorative Unicode user glyph in the Button
//     icon slot (importantForAccessibility="no"), the same lucide -> Unicode
//     approach the FlagsTable Pencil/Trash ports took. The visible label carries
//     the action meaning.
//   - `@/components/ui/ConfirmDialog` (a DOM Modal + Button dialog with Escape/
//     focus-trap, optional typed-confirmation, "don't ask again" silence, and a
//     loading state) is browser-only and is NOT yet ported, so its warning
//     surface is reproduced inline as a native `<Modal transparent
//     animationType="fade">` centered dialog — the same in-file reproduction the
//     QueueJobDrawer port used for the not-yet-ported Drawer. Only the props this
//     source passes (open/title/message/confirmLabel/cancelLabel/variant=warning/
//     onConfirm/onCancel) are wired; the unused ConfirmDialog features
//     (typed-confirmation, silenceKey, loading, Escape/focus-trap) belong to the
//     shared component's own future conversion. The lucide AlertTriangle/
//     AlertOctagon severity icons become ⚠ / 🛑 glyphs, the amber-500/red-500
//     severity tints become literal hex (matching the toned-down palette the
//     QueueJobDrawer port used), and the web confirm button's amber className
//     override becomes an amber background style on the native primary Button.
//   - react-i18next `useTranslation` is not a native-parity dependency; a local
//     t() shim returns the fallback and resolves `{{token}}` interpolation, so
//     every `impersonation.*` key + English copy + the `{{subject}}` substitution
//     are preserved verbatim.

import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows, spacing } from '../../../../theme/tokens';
import { useStartImpersonation } from '../../../api/hooks/useImpersonation';
import { Button } from '../../../components/ui/Button';

/* ─── i18n fallback shim with `{{token}}` interpolation ────────────────────── */

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/* ─── decorative glyphs (lucide UserCog + ConfirmDialog severity icons) ────── */

// 👤 stand-in for lucide UserCog — decorative, the label carries the meaning.
const USER_COG_GLYPH = '\uD83D\uDC64';
// ⚠ / 🛑 stand-ins for the web severity icons (AlertTriangle / AlertOctagon).
const WARNING_GLYPH = '\u26A0';
const DANGER_GLYPH = '\uD83D\uDED1';

/* ─── inline native ConfirmDialog (web `@/components/ui/ConfirmDialog`) ─────── */

// Toned-down severity tints, preserved as literals: the web warn tokens map to
// amber-500 (#f59e0b) surface/border with an amber-300 (#fcd34d) icon; the
// critical tokens map to red-500 (#ef4444) with a red-300 (#fca5a5) icon. The
// web confirm button's `bg-amber-500` className override carries over as the
// amber background on the native primary Button.
const AMBER_500 = '#f59e0b';
const AMBER_300 = '#fcd34d';
const AMBER_500_SURFACE = 'rgba(245, 158, 11, 0.1)';
const AMBER_500_BORDER = 'rgba(245, 158, 11, 0.3)';
const RED_300 = '#fca5a5';
const RED_500_SURFACE = 'rgba(239, 68, 68, 0.1)';
const RED_500_BORDER = 'rgba(239, 68, 68, 0.3)';

type ConfirmVariant = 'danger' | 'warning';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const isWarning = variant === 'warning';
  const boxStyle = isWarning ? styles.warningBox : styles.dangerBox;
  const iconStyle = isWarning ? styles.warningIcon : styles.dangerIcon;
  const glyph = isWarning ? WARNING_GLYPH : DANGER_GLYPH;
  const confirmStyle: StyleProp<ViewStyle> = isWarning
    ? styles.warningConfirm
    : undefined;

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
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />

        <View
          accessibilityViewIsModal
          style={styles.dialog}
          testID="user-impersonate-confirm">
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {title}
            </AppText>
          </View>

          <View style={[styles.messageBox, boxStyle]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.messageIcon, iconStyle]}>
              {glyph}
            </AppText>
            <AppText style={styles.messageText}>{message}</AppText>
          </View>

          <View style={styles.actionRow}>
            <Button onPress={onCancel} variant="secondary">
              {cancelLabel}
            </Button>
            <Button
              onPress={onConfirm}
              style={confirmStyle}
              variant={isWarning ? 'primary' : 'danger'}>
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

ConfirmDialog.displayName = 'ConfirmDialog';

/* ─── UserImpersonateButton ────────────────────────────────────────────────── */

export interface UserImpersonateButtonProps {
  /**
   * The opaque proxy-issued subject identifier to impersonate. The backend
   * validates this against the active subjects list, so the button does not
   * need to filter — it just submits.
   */
  subject: string;
  /**
   * Disable the button (e.g. when this row IS the current admin or when
   * impersonation is already active for someone else). The parent owns the
   * disabled-row decision.
   */
  disabled?: boolean;
}

export function UserImpersonateButton({
  subject,
  disabled,
}: UserImpersonateButtonProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);
  const startMut = useStartImpersonation();

  const handleClick = useCallback(() => {
    if (disabled || startMut.isPending) {
      return;
    }
    setOpen(true);
  }, [disabled, startMut.isPending]);

  const handleConfirm = useCallback(() => {
    setOpen(false);
    startMut.mutate({ subject });
  }, [startMut, subject]);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <Button
        disabled={disabled || startMut.isPending}
        icon={
          <AppText importantForAccessibility="no" style={styles.buttonIcon}>
            {USER_COG_GLYPH}
          </AppText>
        }
        accessibilityLabel={t(
          'impersonation.button.aria',
          'Impersonate {{subject}}',
          { subject },
        )}
        loading={startMut.isPending}
        onPress={handleClick}
        size="sm"
        testID={`user-impersonate-button-${subject}`}
        variant="ghost">
        {startMut.isPending
          ? t('impersonation.button.starting', 'Starting…')
          : t('impersonation.button.start', 'Impersonate')}
      </Button>
      <ConfirmDialog
        cancelLabel={t('impersonation.confirm.cancel', 'Cancel')}
        confirmLabel={t('impersonation.confirm.confirm', 'Start impersonation')}
        message={t(
          'impersonation.confirm.message',
          'You will see TeslaSync as {{subject}} for up to 15 minutes. The action is logged to the audit log. End the session from the banner when you are done.',
          { subject },
        )}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        open={open}
        title={t('impersonation.confirm.title', 'Start impersonation session?')}
        variant="warning"
      />
    </>
  );
}

UserImpersonateButton.displayName = 'UserImpersonateButton';

export default UserImpersonateButton;

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  buttonIcon: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 16,
  },
  dangerBox: {
    backgroundColor: RED_500_SURFACE,
    borderColor: RED_500_BORDER,
  },
  dangerIcon: {
    color: RED_300,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  header: {
    gap: spacing.sm,
  },
  messageBox: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  messageIcon: {
    fontSize: 18,
    lineHeight: 22,
    marginTop: 1,
  },
  messageText: {
    color: colors.textPrimary,
    flex: 1,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
  },
  warningBox: {
    backgroundColor: AMBER_500_SURFACE,
    borderColor: AMBER_500_BORDER,
  },
  warningConfirm: {
    backgroundColor: AMBER_500,
  },
  warningIcon: {
    color: AMBER_300,
  },
});
