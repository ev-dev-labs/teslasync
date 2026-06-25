// Native parity port of web/src/components/ai/ConfirmDialog.tsx.
//
// Presents the dispatcher-paused AI tool approval prompt with React Native
// primitives while preserving explicit confirm/cancel gating and verbatim args.

import React, {useCallback} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

export interface AiToolPreview {
  name: string;
  description?: string;
  mutates: boolean;
}

export interface AiConfirmDialogProps {
  /**
   * Whether the dialog is visible. When false the native Modal receives
   * visible=false and renders no user-facing prompt.
   */
  open: boolean;

  /**
   * Tool metadata as supplied by the dispatcher's confirm_request
   * SSE frame. The name/description are surfaced to the user.
   */
  tool: AiToolPreview;

  /**
   * Tool arguments as proposed by the LLM. Rendered verbatim in a
   * monospaced block so the user can verify exactly what will
   * happen. May be null/undefined for tools with no input.
   */
  args?: Record<string, unknown> | null;

  /**
   * Confirm handler. Parent component is responsible for forwarding
   * the decision to the continuation endpoint.
   */
  onConfirm: () => void;

  /**
   * Cancel handler. Parent component MUST close the dialog AND
   * notify the continuation endpoint that the user denied so the
   * dispatcher can release the paused state.
   */
  onCancel: () => void;

  /**
   * When true, both buttons disable and the confirm button shows a
   * spinner -- used while the continuation POST is in flight.
   */
  loading?: boolean;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function AiConfirmDialog({
  open,
  tool,
  args,
  onConfirm,
  onCancel,
  loading = false,
}: AiConfirmDialogProps): React.ReactElement {
  const t = useNativeTranslationFallback();

  const title = t('ai.confirm.title', 'Approve Helix action');
  const intro = tool.mutates
    ? t(
        'ai.confirm.intro.mutates',
        'The assistant wants to make a change to your data. Review what it will do, then approve or cancel.',
      )
    : t(
        'ai.confirm.intro.read',
        'The assistant wants to run a tool. Review the inputs, then approve or cancel.',
      );
  const argsLabel = t('ai.confirm.argsLabel', 'Arguments');
  const toolLabel = t('ai.confirm.toolLabel', 'Tool');
  const confirmLabel = t('ai.confirm.run', 'Approve');
  const cancelLabel = t('ai.confirm.cancel', 'Cancel');

  const argsJson = JSON.stringify(args ?? {}, null, 2);
  const handleCancel = loading ? undefined : onCancel;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={handleCancel}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="ai-confirm-dialog">
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {title}
            </AppText>
            <AppText style={styles.intro} tone="secondary">
              {intro}
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText style={styles.label} variant="caption" weight="semibold">
              {toolLabel}
            </AppText>
            <AppText
              style={styles.toolName}
              testID="ai-confirm-tool-name"
              weight="semibold">
              {tool.name}
            </AppText>
            {tool.description ? (
              <AppText style={styles.description} tone="secondary">
                {tool.description}
              </AppText>
            ) : null}
          </View>

          <View style={styles.section}>
            <AppText style={styles.label} variant="caption" weight="semibold">
              {argsLabel}
            </AppText>
            <ScrollView
              horizontal
              style={styles.argsBox}
              testID="ai-confirm-args">
              <AppText style={styles.argsText}>{argsJson}</AppText>
            </ScrollView>
          </View>

          <View style={styles.actionRow}>
            <DialogAction
              disabled={loading}
              label={cancelLabel}
              onPress={onCancel}
              testID="ai-confirm-cancel"
              variant="secondary"
            />
            <DialogAction
              disabled={loading}
              label={confirmLabel}
              loading={loading}
              onPress={onConfirm}
              testID="ai-confirm-approve"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
AiConfirmDialog.displayName = 'AiConfirmDialog';

function DialogAction({
  disabled,
  label,
  loading = false,
  onPress,
  testID,
  variant,
}: {
  disabled: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText
          style={
            variant === 'primary'
              ? styles.primaryButtonText
              : styles.secondaryButtonText
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
  },
  argsBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 220,
    padding: spacing.md,
  },
  argsText: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    lineHeight: 18,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: spacing.lg,
  },
  description: {
    lineHeight: 22,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 560,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  header: {
    gap: spacing.sm,
  },
  intro: {
    lineHeight: 22,
  },
  label: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
  secondaryButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
  },
  toolName: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
});
