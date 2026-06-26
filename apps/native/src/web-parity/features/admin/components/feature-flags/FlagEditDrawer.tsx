// Native parity port of web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx.
//
// The web module is the Feature Flags edit/create drawer: a single component
// that powers BOTH "edit existing flag" (initial provided, key read-only) AND
// "create new flag" (initial === null). The value editor is a free-form JSON
// <Textarea> — any valid JSON (object/array/scalar) is accepted; invalid JSON
// disables Save and surfaces a parse-error helper; `reason` is required by the
// backend audit row. It is built from the shared web UI kit (Drawer, GlassPanel,
// Input, Textarea, Button) + the Typography <Text>, react-i18next, and the
// admin-diagnostics types.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback?, values?) returns the English fallback and interpolates
//     {{token}} placeholders, so the drawer title ('Edit flag "{{key}}"') and the
//     'Invalid JSON: {{msg}}' helper resolve exactly as the web copy. A stable
//     useCallback identity keeps the `parsed` useMemo dependency [valueInput, t]
//     honest, matching the source.
//   • The shared web <Drawer> (createPortal + framer-motion slide-in + DOM focus
//     trap / Escape / Tab cycling) -> a native <Modal animationType="slide">. RN
//     has no portal/DOM focus model, so the focus trap + Tab cycling are dropped;
//     Escape/back-dismiss is served by Modal onRequestClose + a backdrop Pressable,
//     and the panel carries accessibilityViewIsModal + the aria-label. `side`
//     ('left'|'right', default 'right') is preserved and anchors the panel via
//     flexDirection row/row-reverse with the matching inner border.
//   • The shared web <Button> (DOM <button> + animated SVG spinner) -> a native
//     Pressable Button with primary/secondary tones (accent / surfaceRaised) and
//     an ActivityIndicator while `loading`, mirroring the existing native admin
//     Button precedent (FleetApiSection). disabled + loading both block onPress.
//   • The shared web <Textarea> (DOM <textarea> + Label + error <p>) -> an inlined
//     native Textarea: a multiline <TextInput> with a label row (visible `*` +
//     required folded into accessibilityLabel), a focus accent border, an error
//     border, and an error caption — preserving label/value/rows/required/
//     placeholder/error, the same inline-Textarea precedent the sibling devtools
//     ports use.
//   • The web GlassPanel className="p-4" -> the shared native GlassPanel with a
//     padded style; the already-ported native Input is reused as-is (web
//     onChange={e=>set(e.target.value)} becomes onChangeText={set}).
//   • Typography <Text variant="bodySm" as="p" text-muted> -> <AppText
//     variant="caption" tone="muted">; the admin-diagnostics FeatureFlagValue /
//     FeatureFlagEntry types (not yet ported) are inlined verbatim.
// No DOM elements, framer-motion, lucide-react, Recharts, Leaflet, or web UI kit
// modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Input } from '../../../../components/ui/Input';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';

/* ─── inlined @/types/admin-diagnostics ───────────────────────────────── */

/** Flag value is stored as JSON in Postgres and surfaces here as `unknown`. */
type FeatureFlagValue = unknown;

interface FeatureFlagEntry {
  key: string;
  value: FeatureFlagValue;
}

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site and interpolating {{token}} placeholders. The stable
// useCallback identity keeps the `parsed` useMemo dependency array honest.
function useTranslation(): { t: TFunc } {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return { t };
}

/* ─── inlined @/components/ui Button ───────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary';

interface ButtonProps {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: ReactNode;
}

function Button({
  variant = 'primary',
  loading,
  disabled,
  onPress,
  children,
}: ButtonProps) {
  const isDisabled = !!disabled || !!loading;
  const tone = BTN_VARIANT_STYLES[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        tone.container,
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={tone.text.color}
          size="small"
          style={styles.btnSpinner}
        />
      ) : null}
      <AppText
        numberOfLines={1}
        style={[styles.btnText, tone.text]}
        weight="semibold"
      >
        {children}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined @/components/ui Textarea ─────────────────────────────────── */

interface TextareaProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string;
  error?: string;
}

function Textarea({
  label,
  value,
  onChangeText,
  rows = 3,
  required,
  placeholder,
  error,
}: TextareaProps) {
  const [focused, setFocused] = useState(false);
  const fieldId = label ? label.toLowerCase().replace(/\s+/g, '-') : undefined;
  // RN has no label/for association, so the web Label's screen-reader "required"
  // text is folded into the control's accessibilityLabel.
  const accessibilityLabel = label
    ? required
      ? `${label}, required`
      : label
    : undefined;

  return (
    <View style={styles.textareaWrap}>
      {label ? (
        <View style={styles.textareaLabelRow}>
          <AppText style={styles.textareaLabel}>
            {label}
            {required ? (
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.requiredMark}
              >
                {' *'}
              </AppText>
            ) : null}
          </AppText>
        </View>
      ) : null}
      <TextInput
        accessibilityHint={error}
        accessibilityLabel={accessibilityLabel}
        multiline
        nativeID={fieldId}
        numberOfLines={rows}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.textarea,
          { minHeight: rows * 20 + 16 },
          focused ? styles.textareaFocused : null,
          error ? styles.textareaError : null,
        ]}
        textAlignVertical="top"
        value={value}
      />
      {error ? (
        <AppText
          accessibilityLiveRegion="polite"
          nativeID={fieldId ? `${fieldId}-error` : undefined}
          style={styles.textareaErrorText}
          tone="danger"
          variant="caption"
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/ui Drawer ───────────────────────────────────── */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'left' | 'right';
}

// Slide-in side panel. Web renders a portal overlay + framer-motion slide-in with
// a DOM focus trap; the native port uses a <Modal> (Escape/back -> onRequestClose,
// backdrop tap -> onClose) anchored left/right via flexDirection.
function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
}: DrawerProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <View
        style={[
          styles.drawerRoot,
          side === 'left' ? styles.drawerRootLeft : styles.drawerRootRight,
        ]}
      >
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.drawerBackdrop}
        />
        <View
          accessibilityLabel={title || 'Panel'}
          accessibilityViewIsModal
          style={[
            styles.drawerPanel,
            side === 'left' ? styles.drawerPanelLeft : styles.drawerPanelRight,
          ]}
        >
          {title ? (
            <View style={styles.drawerHeader}>
              <AppText
                numberOfLines={1}
                style={styles.drawerTitle}
                weight="semibold"
              >
                {title}
              </AppText>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={styles.drawerClose}
              >
                <AppText style={styles.drawerCloseGlyph} weight="bold">
                  {'\u2715'}
                </AppText>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.drawerBody}
            style={styles.drawerBodyScroll}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.drawerFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ─── FlagEditDrawer ───────────────────────────────────────────────────── */

interface FlagEditDrawerProps {
  open: boolean;
  /** When null/undefined, the drawer is in "create new" mode. */
  initial: FeatureFlagEntry | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    key: string;
    value: FeatureFlagValue;
    reason: string;
  }) => void;
}

function defaultValueJson(initial: FeatureFlagEntry | null): string {
  if (!initial) {
    return '';
  }
  try {
    return JSON.stringify(initial.value, null, 2);
  } catch {
    return '';
  }
}

export function FlagEditDrawer({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: FlagEditDrawerProps) {
  const { t } = useTranslation();
  const editing = initial !== null;

  const [keyInput, setKeyInput] = useState<string>(initial?.key ?? '');
  const [valueInput, setValueInput] = useState<string>(
    defaultValueJson(initial),
  );
  const [reason, setReason] = useState<string>('');

  // Re-seed the form whenever the drawer opens with a different flag. Without
  // this the previous flag's value stays visible on the next open and the
  // operator would clobber an unrelated row.
  useEffect(() => {
    if (open) {
      setKeyInput(initial?.key ?? '');
      setValueInput(defaultValueJson(initial));
      setReason('');
    }
  }, [open, initial]);

  const parsed = useMemo<{
    ok: boolean;
    value?: FeatureFlagValue;
    error?: string;
  }>(() => {
    if (valueInput.trim() === '') {
      return {
        ok: false,
        error: t('admin.flags.editor.valueEmpty', 'Value is required.'),
      };
    }
    try {
      return { ok: true, value: JSON.parse(valueInput) as FeatureFlagValue };
    } catch (e) {
      return {
        ok: false,
        error: t('admin.flags.editor.valueInvalid', 'Invalid JSON: {{msg}}', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [valueInput, t]);

  const keyValid = keyInput.trim().length > 0;
  const reasonValid = reason.trim().length > 0;
  const canSave = parsed.ok && keyValid && reasonValid && !saving;

  const handleSave = () => {
    if (!canSave || !parsed.ok) {
      return;
    }
    onSave({
      key: keyInput.trim(),
      value: parsed.value as FeatureFlagValue,
      reason: reason.trim(),
    });
  };

  return (
    <Drawer
      onClose={onClose}
      open={open}
      title={
        editing
          ? t('admin.flags.drawer.editTitle', 'Edit flag "{{key}}"', {
              key: initial?.key ?? '',
            })
          : t('admin.flags.drawer.createTitle', 'Create flag')
      }
      footer={
        <View style={styles.footerRow}>
          <Button disabled={saving} onPress={onClose} variant="secondary">
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={!canSave}
            loading={saving}
            onPress={handleSave}
            variant="primary"
          >
            {t('admin.flags.drawer.save', 'Save flag')}
          </Button>
        </View>
      }
    >
      <View style={styles.body}>
        <GlassPanel style={styles.panel}>
          <View style={styles.fieldStack}>
            <Input
              disabled={editing}
              label={t('admin.flags.editor.keyLabel', 'Flag key')}
              onChangeText={setKeyInput}
              placeholder={t(
                'admin.flags.editor.keyPlaceholder',
                'feature.dlq.replay_enabled',
              )}
              required
              value={keyInput}
            />
            {editing ? (
              <AppText
                style={styles.keyImmutable}
                tone="muted"
                variant="caption"
              >
                {t(
                  'admin.flags.editor.keyImmutable',
                  'Flag keys are immutable once created. Delete + re-create to rename.',
                )}
              </AppText>
            ) : null}
          </View>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <Textarea
            error={parsed.ok ? undefined : parsed.error}
            label={t('admin.flags.editor.valueLabel', 'Value (JSON)')}
            onChangeText={setValueInput}
            placeholder={'{\n  "enabled": true\n}'}
            required
            rows={8}
            value={valueInput}
          />
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <Input
            label={t('admin.flags.editor.reasonLabel', 'Reason')}
            onChangeText={setReason}
            placeholder={t(
              'admin.flags.editor.reasonPlaceholder',
              'Why this change? (logged in audit)',
            )}
            required
            value={reason}
          />
        </GlassPanel>
      </View>
    </Drawer>
  );
}

const BTN_VARIANT_STYLES: Record<
  ButtonVariant,
  { container: ViewStyle; text: TextStyle }
> = {
  primary: {
    container: { backgroundColor: colors.accent },
    text: { color: colors.background },
  },
  secondary: {
    container: { backgroundColor: colors.surfaceRaised },
    text: { color: colors.textPrimary },
  },
};

const styles = StyleSheet.create({
  body: {
    gap: 16,
  },
  panel: {
    padding: 16,
  },
  fieldStack: {
    gap: spacing.md,
  },
  keyImmutable: {
    color: colors.textMuted,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  btn: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnSpinner: {
    marginRight: spacing.xs,
  },
  btnText: {
    fontSize: 14,
    lineHeight: 18,
  },
  textareaWrap: {
    gap: spacing.xs,
  },
  textareaLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  textareaLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  requiredMark: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '500',
  },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textareaFocused: {
    borderColor: colors.accent,
  },
  textareaError: {
    borderColor: colors.danger,
  },
  textareaErrorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  drawerRoot: {
    flex: 1,
  },
  drawerRootRight: {
    flexDirection: 'row',
  },
  drawerRootLeft: {
    flexDirection: 'row-reverse',
  },
  drawerBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
  },
  drawerPanel: {
    backgroundColor: colors.background,
    flex: 0,
    maxWidth: 448,
    width: '100%',
  },
  drawerPanelRight: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
  },
  drawerPanelLeft: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
  },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  drawerTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  drawerClose: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  drawerCloseGlyph: {
    color: colors.textMuted,
    fontSize: 16,
  },
  drawerBodyScroll: {
    flex: 1,
  },
  drawerBody: {
    padding: 24,
  },
  drawerFooter: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
});
