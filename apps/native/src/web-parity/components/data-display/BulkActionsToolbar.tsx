// Native parity port of web/src/components/data-display/BulkActionsToolbar.tsx.
// Converts the sticky DOM toolbar and shared web ConfirmDialog hook to
// React Native primitives while preserving selection, confirmation, and
// per-action pending behavior.

import React, {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';

type TranslationOptions = {
  count?: number;
  defaultValue?: string;
  total?: number;
};

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | TranslationOptions,
) => string;

type ConfirmVariant = 'danger' | 'warning';

interface NativeConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  variant: ConfirmVariant;
}

/**
 * Shared bulk-action toolbar.
 *
 * Renders a native toolbar at the top of a list-page content area when one or
 * more rows/cards are selected. Each `BulkAction` may declare a `confirm`
 * payload that routes its onClick through the native confirmation modal before
 * mutating, satisfying the destructive-action contract.
 *
 * Per-action loading state is local to the toolbar so the page does not need
 * to wire a separate `pending` flag for each action -- it just returns a
 * `Promise` from `onClick`.
 *
 * Keyboard:
 *   `Escape` clears the selection on web; native consumers should wire the
 *   hardware/back affordance at the screen level when needed.
 *
 * The toolbar renders nothing when `selectedIds.length === 0` so consumers can
 * always mount it unconditionally.
 */
export interface BulkAction {
  /** Stable id used as React key and for action telemetry. */
  id: string;
  /** Already-translated button label. */
  label: string;
  /** Optional leading icon supplied by the native caller. */
  icon?: ReactNode;
  /** Visual intent. `danger` switches the underlying button variant. */
  variant?: 'default' | 'danger';
  /** When provided, route the onClick through the confirmation modal first. */
  confirm?: {
    title: string;
    description: string;
    confirmLabel?: string;
  };
  /**
   * Invoked with the current selection. Should resolve when the mutation
   * completes; toolbar uses the returned Promise to drive a per-action
   * spinner. Throwing leaves the selection intact so the user can retry.
   */
  onClick: (selectedIds: Array<string | number>) => Promise<void>;
  /** Disable the action regardless of selection (e.g., feature gate). */
  disabled?: boolean;
}

export interface BulkActionsToolbarProps {
  /** Currently selected row identifiers. */
  selectedIds: Array<string | number>;
  /** Total visible rows -- used by the count label, e.g. "3 selected of 27". */
  total?: number;
  /** Clears the selection. Wired to the "Clear" button. */
  onClear: () => void;
  /** Per-page action definitions, rendered in array order. */
  actions: BulkAction[];
  /** Optional override for the count noun (e.g., "drive(s)"). */
  itemNoun?: {one: string; other: string};
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallbackOrOptions) => {
    const fallback =
      typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : fallbackOrOptions?.defaultValue ?? _key;

    if (!fallbackOrOptions || typeof fallbackOrOptions === 'string') {
      return fallback;
    }

    return interpolate(fallback, fallbackOrOptions);
  }, []);
}

function interpolate(template: string, values: TranslationOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as keyof TranslationOptions];
    return value === undefined ? '' : String(value);
  });
}

export function BulkActionsToolbar({
  selectedIds,
  total,
  onClear,
  actions,
  itemNoun,
  className: _className,
}: BulkActionsToolbarProps) {
  const t = useNativeTranslationFallback();
  const [confirmRequest, setConfirmRequest] =
    useState<NativeConfirmRequest | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const count = selectedIds.length;

  const noun = itemNoun
    ? count === 1
      ? itemNoun.one
      : itemNoun.other
    : t('bulk.itemDefault', {count, defaultValue: 'item'});

  const confirm = useCallback((request: NativeConfirmRequest) => {
    return new Promise<boolean>(resolve => {
      confirmResolver.current = resolve;
      setConfirmRequest(request);
    });
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    const resolver = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmRequest(null);
    resolver?.(ok);
  }, []);

  const runAction = useCallback(
    async (action: BulkAction) => {
      if (pending[action.id]) {
        return;
      }

      if (action.confirm) {
        const ok = await confirm({
          title: action.confirm.title,
          message: action.confirm.description,
          confirmLabel: action.confirm.confirmLabel,
          variant: action.variant === 'danger' ? 'danger' : 'warning',
        });
        if (!ok) {
          return;
        }
      }

      setPending(prev => ({...prev, [action.id]: true}));
      try {
        await action.onClick(selectedIds);
      } finally {
        setPending(prev => {
          const next = {...prev};
          delete next[action.id];
          return next;
        });
      }
    },
    [confirm, pending, selectedIds],
  );

  if (count === 0) {
    return null;
  }

  const countLabel = t('bulk.selected', {
    count,
    defaultValue: '{{count}} selected',
  });

  return (
    <>
      <GlassPanel
        accessibilityLabel={t(
          'bulk.toolbarLabel',
          'Bulk actions for selected items',
        )}
        accessibilityRole="toolbar"
        accessible
        style={styles.root}
        testID="bulk-actions-toolbar">
        <View style={styles.summaryRow}>
          <View
            accessibilityLiveRegion="polite"
            style={styles.countBadge}
            testID="bulk-actions-count">
            <AppText
              style={styles.countBadgeText}
              variant="caption"
              weight="semibold">
              {countLabel}
            </AppText>
          </View>

          {itemNoun ? (
            <AppText
              numberOfLines={2}
              style={styles.nounText}
              variant="caption">
              {noun}
              {typeof total === 'number' ? (
                <AppText style={styles.totalText} variant="caption">
                  {` ${t('bulk.ofTotal', {
                    total,
                    defaultValue: 'of {{total}}',
                  })}`}
                </AppText>
              ) : null}
            </AppText>
          ) : null}
        </View>

        <View style={styles.actionsRow}>
          {actions.map(action => {
            const loading = Boolean(pending[action.id]);
            return (
              <ToolbarActionButton
                key={action.id}
                disabled={action.disabled || loading}
                icon={action.icon}
                label={action.label}
                loading={loading}
                onPress={() => {
                  void runAction(action);
                }}
                testID={`bulk-action-${action.id}`}
                variant={action.variant === 'danger' ? 'danger' : 'secondary'}
              />
            );
          })}
          <ToolbarActionButton
            label={t('bulk.clear', 'Clear selection')}
            onPress={onClear}
            testID="bulk-action-clear"
            variant="ghost"
          />
        </View>
      </GlassPanel>

      {confirmRequest ? (
        <NativeConfirmDialog
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
          request={confirmRequest}
        />
      ) : null}
    </>
  );
}

BulkActionsToolbar.displayName = 'BulkActionsToolbar';

type ToolbarButtonVariant = 'danger' | 'ghost' | 'secondary';

interface ToolbarActionButtonProps {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID: string;
  variant: ToolbarButtonVariant;
}

function ToolbarActionButton({
  disabled = false,
  icon,
  label,
  loading = false,
  onPress,
  testID,
  variant,
}: ToolbarActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled}}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        buttonVariantStyles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <View style={styles.buttonContent}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'danger' ? colors.danger : colors.accent}
            size="small"
            style={styles.buttonSpinner}
          />
        ) : (
          renderActionIcon(icon)
        )}
        <AppText
          numberOfLines={1}
          style={[styles.buttonText, buttonTextVariantStyles[variant]]}
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

function renderActionIcon(icon: ReactNode): ReactNode {
  if (icon === null || icon === undefined || typeof icon === 'boolean') {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.buttonIcon}>
      {typeof icon === 'string' || typeof icon === 'number' ? (
        <AppText style={styles.inlineIconText} variant="caption" weight="bold">
          {icon}
        </AppText>
      ) : (
        icon
      )}
    </View>
  );
}

function NativeConfirmDialog({
  onCancel,
  onConfirm,
  request,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  request: NativeConfirmRequest;
}) {
  const t = useNativeTranslationFallback();
  const confirmLabel = request.confirmLabel ?? t('bulk.confirm', 'Confirm');

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible>
      <View
        accessibilityLabel={request.title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="bulk-action-confirm-dialog">
          <View style={styles.dialogHeader}>
            <View
              pointerEvents="none"
              style={[
                styles.dialogMarker,
                request.variant === 'danger'
                  ? styles.dialogMarkerDanger
                  : styles.dialogMarkerWarning,
              ]}
            />
            <View style={styles.dialogCopy}>
              <AppText style={styles.dialogTitle} variant="title" weight="bold">
                {request.title}
              </AppText>
              <AppText style={styles.dialogMessage} tone="secondary">
                {request.message}
              </AppText>
            </View>
          </View>

          <View style={styles.dialogActions}>
            <DialogButton
              label={t('bulk.cancel', 'Cancel')}
              onPress={onCancel}
              testID="bulk-action-confirm-cancel"
              variant="secondary"
            />
            <DialogButton
              label={confirmLabel}
              onPress={onConfirm}
              testID="bulk-action-confirm-ok"
              variant={request.variant === 'danger' ? 'danger' : 'warning'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DialogButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'danger' | 'secondary' | 'warning';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.dialogButton,
        dialogButtonVariantStyles[variant],
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={[styles.dialogButtonText, dialogButtonTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  buttonIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSpinner: {
    height: 16,
    width: 16,
  },
  buttonText: {
    maxWidth: 180,
  },
  countBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  countBadgeText: {
    color: colors.accent,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 520,
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
  dialogButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: spacing.lg,
  },
  dialogButtonText: {
    textAlign: 'center',
  },
  dialogCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  dialogHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  dialogMarker: {
    borderRadius: 999,
    height: 14,
    marginTop: 8,
    width: 14,
  },
  dialogMarkerDanger: {
    backgroundColor: colors.danger,
  },
  dialogMarkerWarning: {
    backgroundColor: colors.warning,
  },
  dialogMessage: {
    lineHeight: 22,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  disabled: {
    opacity: 0.48,
  },
  inlineIconText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  nounText: {
    color: colors.textSecondary,
    flexShrink: 1,
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
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: spacing.sm,
    minWidth: 0,
  },
  totalText: {
    color: colors.textMuted,
  },
});

const buttonVariantStyles = StyleSheet.create<
  Record<ToolbarButtonVariant, ViewStyle>
>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const buttonTextVariantStyles = StyleSheet.create<
  Record<ToolbarButtonVariant, TextStyle>
>({
  danger: {
    color: colors.danger,
  },
  ghost: {
    color: colors.textSecondary,
  },
  secondary: {
    color: colors.textPrimary,
  },
});

const dialogButtonVariantStyles = StyleSheet.create<
  Record<'danger' | 'secondary' | 'warning', ViewStyle>
>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  secondary: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const dialogButtonTextStyles = StyleSheet.create<
  Record<'danger' | 'secondary' | 'warning', TextStyle>
>({
  danger: {
    color: colors.danger,
  },
  secondary: {
    color: colors.textPrimary,
  },
  warning: {
    color: colors.warning,
  },
});
