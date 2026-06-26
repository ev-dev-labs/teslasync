/**
 * IncidentForm — native parity port of
 * web/src/features/system/components/status/IncidentForm.tsx.
 *
 * Manual incident logging dialog.
 *
 * Operator UX:
 *   1. Tap "Log incident" on the system-status surface -> open this modal.
 *   2. Fill title (required) + severity + status + initial message.
 *   3. On submit, POST /api/v1/status/incidents and close. The list query is
 *      invalidated automatically by useCreateIncident.
 *
 * Validation: title length 3-200 enforced both client-side (here) and
 * server-side (database/status_incidents_repo.go). Mirror keeps both surfaces
 * consistent without a round-trip.
 *
 * Native adaptations vs. the web source (behavior/state/keys preserved):
 *   - web <Modal open onClose title size="md"> (DOM portal) -> RN <Modal
 *     visible transparent onRequestClose>; the title bar + close ✕ and the
 *     unconditional backdrop dismiss mirror the web Modal's onClose contract.
 *   - web <Input> / <Textarea> -> single-line / multiline <TextInput> keeping
 *     value/onChange->onChangeText, placeholder, maxLength, rows->numberOfLines,
 *     autoFocus, and disabled-while-pending (editable).
 *   - web <Select onChange={e=>set(e.target.value)}> -> native <Select
 *     onValueChange={v=>set(v)}> (no DOM event); options/label/value preserved.
 *   - web useToast() (@/components/feedback/Toast) -> inline native useToast
 *     backed by Alert.alert (the parity layer's documented feedback primitive);
 *     the toast.error/toast.success call sites + English strings are preserved.
 *   - useId() title/components/message ids -> kept; wired as label nativeID +
 *     TextInput accessibilityLabelledBy to preserve the htmlFor/id linkage.
 *   - The source uses literal English (no react-i18next); strings are kept
 *     verbatim to preserve i18n intent.
 */

import React, {useId, useMemo, useState} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../../../theme/tokens';
import {
  useCreateIncident,
  type IncidentSeverity,
  type IncidentStatus,
} from '../../../../api/hooks/useIncidents';
import {Select} from '../../../../components/ui/Select';

// ---- useToast (web @/components/feedback/Toast) -----------------------------
// No native Toast provider exists; the parity layer's documented feedback
// primitive is React Native Alert. The web `toast.error`/`toast.success`
// contract is preserved (info/warning kept for shape parity).
type ToastFn = (title: string, message?: string) => void;
function useToast(): {
  info: ToastFn;
  success: ToastFn;
  error: ToastFn;
  warning: ToastFn;
} {
  return useMemo(() => {
    const show: ToastFn = (title, message) => Alert.alert(title, message);
    return {info: show, success: show, error: show, warning: show};
  }, []);
}

interface IncidentFormProps {
  onClose: () => void;
}

export function IncidentForm({onClose}: IncidentFormProps): React.ReactElement {
  const toast = useToast();
  const titleId = useId();
  const componentsId = useId();
  const messageId = useId();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('minor');
  const [status, setStatus] = useState<IncidentStatus>('investigating');
  const [message, setMessage] = useState('');
  const [components, setComponents] = useState('');
  const create = useCreateIncident();

  const handleSubmit = async () => {
    const t = title.trim();
    if (t.length < 3) {
      toast.error('Title must be at least 3 characters.');
      return;
    }
    try {
      await create.mutateAsync({
        title: t,
        severity,
        status,
        initial_message: message.trim() || undefined,
        affected_components: components
          .split(',')
          .map(c => c.trim())
          .filter(Boolean),
      });
      toast.success('Incident logged.');
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to log incident',
      );
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View
        accessibilityLabel="Log an incident"
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="incident-form">
          <View style={styles.headerRow}>
            <AppText style={styles.headerTitle} variant="title" weight="bold">
              Log an incident
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              testID="incident-form-close">
              <AppText accessible={false} style={styles.closeIcon}>
                ✕
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}>
            <View style={styles.field}>
              <AppText
                nativeID={titleId}
                style={styles.label}
                variant="caption"
                weight="semibold">
                Title
              </AppText>
              <TextInput
                accessibilityLabel="Title"
                accessibilityLabelledBy={[titleId]}
                autoFocus
                editable={!create.isPending}
                maxLength={200}
                onChangeText={setTitle}
                placeholder="e.g. Wall connector restart at 14:00"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="incident-form-title"
                value={title}
              />
            </View>

            <View style={styles.grid}>
              <View style={styles.gridItem}>
                <Select
                  label="Severity"
                  onValueChange={v => setSeverity(v as IncidentSeverity)}
                  options={[
                    {value: 'minor', label: 'Minor'},
                    {value: 'major', label: 'Major'},
                    {value: 'critical', label: 'Critical'},
                  ]}
                  value={severity}
                />
              </View>
              <View style={styles.gridItem}>
                <Select
                  label="Status"
                  onValueChange={v => setStatus(v as IncidentStatus)}
                  options={[
                    {value: 'investigating', label: 'Investigating'},
                    {value: 'identified', label: 'Identified'},
                    {value: 'monitoring', label: 'Monitoring'},
                    {value: 'resolved', label: 'Resolved'},
                  ]}
                  value={status}
                />
              </View>
            </View>

            <View style={styles.field}>
              <AppText
                nativeID={componentsId}
                style={styles.label}
                variant="caption"
                weight="semibold">
                Affected components{' '}
                <AppText style={styles.labelMuted} variant="caption">
                  (comma-separated, optional)
                </AppText>
              </AppText>
              <TextInput
                accessibilityLabel="Affected components"
                accessibilityLabelledBy={[componentsId]}
                editable={!create.isPending}
                onChangeText={setComponents}
                placeholder="e.g. tesla, telemetry"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="incident-form-components"
                value={components}
              />
            </View>

            <View style={styles.field}>
              <AppText
                nativeID={messageId}
                style={styles.label}
                variant="caption"
                weight="semibold">
                Initial timeline message{' '}
                <AppText style={styles.labelMuted} variant="caption">
                  (optional)
                </AppText>
              </AppText>
              <TextInput
                accessibilityLabel="Initial timeline message"
                accessibilityLabelledBy={[messageId]}
                editable={!create.isPending}
                maxLength={4000}
                multiline
                numberOfLines={3}
                onChangeText={setMessage}
                placeholder="What's the situation?"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textarea]}
                testID="incident-form-message"
                value={message}
              />
            </View>

            <View style={styles.actionRow}>
              <DialogAction
                disabled={create.isPending}
                label="Cancel"
                onPress={onClose}
                testID="incident-form-cancel"
                variant="ghost"
              />
              <DialogAction
                disabled={create.isPending}
                label={create.isPending ? 'Logging…' : 'Log incident'}
                onPress={handleSubmit}
                testID="incident-form-submit"
                variant="primary"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
IncidentForm.displayName = 'IncidentForm';

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
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: 16, // space-y-4
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  closeIcon: {
    color: colors.textSecondary,
    fontSize: 20,
    lineHeight: 22,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    margin: spacing.lg,
    maxHeight: '90%',
    maxWidth: 520,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
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
  grid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  gridItem: {
    flex: 1,
  },
  headerRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
  },
  labelMuted: {
    color: colors.textMuted,
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
  scroll: {
    flexShrink: 1,
  },
  textarea: {
    minHeight: 88,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
});

export default IncidentForm;
