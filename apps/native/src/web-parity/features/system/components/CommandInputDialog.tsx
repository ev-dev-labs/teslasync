// Native parity port of web/src/features/system/components/CommandInputDialog.tsx.
//
// The web component is a small modal form used to collect a command's input
// parameter(s) (a single param like a PIN/limit, or a multi-field config) before
// dispatching a Tesla vehicle command. It is built from the shared `<Modal>`,
// `<Input>` and `<Button>` DOM components, a native `<form onSubmit>`, the lucide
// command icon, and react-i18next. It owns `values`/`errors`/`touched` state with
// per-field `validateField` (pin = 4 digits, number = whole + min/max, decimal =
// numeric + min/max), validate-on-blur + validate-on-change-after-touch, a
// validate-all-on-submit, autofocus of the first field on open, and Esc-to-close.
// It is reproduced here with React Native primitives:
//
//   - The shared web `<Modal>` (a `createPortal` overlay with a click backdrop +
//     Esc/Tab focus trap) becomes a React Native `<Modal transparent
//     animationType="fade">` — the same approach the Lightbox port took. The
//     Modal provides the portal-to-root and `onRequestClose` wires the Android
//     hardware back button as the native analog of the web `Esc` close (the
//     `handleKeyDown` Escape handler + its wrapping `onKeyDown` div, and the DOM
//     Tab focus-trap, have no native model and are dropped). A full-screen
//     `<Pressable onPress={onClose}>` backdrop reproduces the click-outside close.
//   - The shared web `<Input>` is reproduced inline as a small `LabeledInput`
//     (label + `TextInput` + error text). `onChange={e => …e.target.value}` ->
//     `onChangeText`; `type='password'` (pin) -> `secureTextEntry`; the web
//     `inputMode` ('numeric'|'decimal'|'text') maps 1:1 to the RN `inputMode`
//     prop; `error` border (border-red-500) + `autoComplete='off'` are preserved.
//     A `forwardRef<TextInput>` keeps the `firstInputRef` autofocus-on-open.
//   - The shared web `<Button>` -> the already-converted native parity `<Button>`
//     (PressableProps); the DOM `onClick` -> `onPress`, the `type='button'`/
//     `type='submit'` HTML semantics -> a plain `onPress={handleSubmit}` (there is
//     no native `<form>`; submit is a button press). The web neon-cyan submit
//     styling + text-secondary cancel styling are preserved via a `style` override
//     and a styled `AppText` child (rendered verbatim by the parity Button).
//   - `def.icon` is a lucide component on web but the native `CommandDef.icon` is a
//     `SemanticIconName` (see commands.ts), so it renders via `<SemanticIcon>`.
//   - react-i18next is unavailable in native parity; a local `t()` shim returns the
//     English fallback verbatim while preserving every i18n key. The CSS-var colors
//     (--surface-2, --border-subtle, --text-*, neon-cyan) are preserved as theme
//     tokens / literals. The hardcoded English validation messages ('Required',
//     'Enter a 4-digit PIN', …) are kept verbatim (they are literals on web too).
//   - `validateField`, `buildInitialValues`, `handleChange`, `handleBlur`,
//     `isValid` and `handleSubmit` are ported with identical logic (handleSubmit
//     loses the DOM `FormEvent`/`preventDefault` since there is no native form).

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {Button} from '../../../components/ui/Button';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import type {CommandDef} from '../commands';

interface CommandInputDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  def: CommandDef;
  vehicle?: {display_name: string};
  loading?: boolean;
}

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys.
type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

function validateField(
  value: string,
  validation?: string,
  min?: number,
  max?: number,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Required';
  }

  switch (validation) {
    case 'pin':
      return /^\d{4}$/.test(trimmed) ? null : 'Enter a 4-digit PIN';
    case 'number': {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || String(num) !== trimmed) {
        return 'Enter a whole number';
      }
      if (min != null && num < min) {
        return `Minimum: ${min}`;
      }
      if (max != null && num > max) {
        return `Maximum: ${max}`;
      }
      return null;
    }
    case 'decimal': {
      const num = parseFloat(trimmed);
      if (isNaN(num)) {
        return 'Enter a valid number';
      }
      if (min != null && num < min) {
        return `Minimum: ${min}`;
      }
      if (max != null && num > max) {
        return `Maximum: ${max}`;
      }
      return null;
    }
    default:
      return null;
  }
}

// type='password' (pin) -> secureTextEntry; everything else is a plain text field.
const resolveInputType = (v?: string) => (v === 'pin' ? 'password' : 'text');

// The web inputMode values map 1:1 onto the RN TextInput `inputMode` prop.
const resolveInputMode = (v?: string): 'numeric' | 'decimal' | 'text' =>
  v === 'pin' || v === 'number'
    ? 'numeric'
    : v === 'decimal'
    ? 'decimal'
    : 'text';

interface LabeledInputProps {
  label?: string;
  placeholder?: string;
  secureTextEntry: boolean;
  inputMode: 'numeric' | 'decimal' | 'text';
  value: string;
  onChangeText: (value: string) => void;
  onBlur: () => void;
  error?: string;
  testID?: string;
}

// Inline reproduction of the shared web <Input> (label + control + error text).
const LabeledInput = forwardRef<TextInput, LabeledInputProps>(
  function LabeledInput(
    {
      label,
      placeholder,
      secureTextEntry,
      inputMode,
      value,
      onChangeText,
      onBlur,
      error,
      testID,
    },
    ref,
  ) {
    return (
      <View style={styles.field}>
        {label ? <AppText style={styles.label}>{label}</AppText> : null}
        <TextInput
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          inputMode={inputMode}
          onBlur={onBlur}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          ref={ref}
          secureTextEntry={secureTextEntry}
          style={[styles.input, error ? styles.inputError : null]}
          testID={testID}
          value={value}
        />
        {error ? <AppText style={styles.errorText}>{error}</AppText> : null}
      </View>
    );
  },
);

export function CommandInputDialog({
  open,
  onClose,
  onSubmit,
  def,
  vehicle,
  loading,
}: CommandInputDialogProps) {
  const t = useNativeTranslationFallback();
  const ic = def.inputConfig!;
  const fields = ic.fields;
  const firstInputRef = useRef<TextInput>(null);

  const buildInitialValues = (): Record<string, string> => {
    if (fields) {
      const vals: Record<string, string> = {};
      for (const f of fields) {
        vals[f.name] = '';
      }
      return vals;
    }
    const defaultVal = ic.getDefaultValue
      ? ic.getDefaultValue({vehicle})
      : ic.defaultValue ?? '';
    return {[ic.paramName]: defaultVal};
  };

  const [values, setValues] =
    useState<Record<string, string>>(buildInitialValues);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setValues(buildInitialValues());
      setErrors({});
      setTouched({});
      const timer = setTimeout(() => firstInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleChange = (name: string, value: string) => {
    setValues(prev => ({...prev, [name]: value}));
    if (touched[name]) {
      const field = fields?.find(f => f.name === name);
      const v = field?.validation ?? ic.validation;
      const mn = field?.min ?? ic.min;
      const mx = field?.max ?? ic.max;
      setErrors(prev => ({...prev, [name]: validateField(value, v, mn, mx)}));
    }
  };

  const handleBlur = (name: string) => {
    setTouched(prev => ({...prev, [name]: true}));
    const field = fields?.find(f => f.name === name);
    const v = field?.validation ?? ic.validation;
    const mn = field?.min ?? ic.min;
    const mx = field?.max ?? ic.max;
    setErrors(prev => ({
      ...prev,
      [name]: validateField(values[name] ?? '', v, mn, mx),
    }));
  };

  const isValid = (): boolean => {
    if (fields) {
      return fields.every(
        f =>
          validateField(values[f.name] ?? '', f.validation, f.min, f.max) ===
          null,
      );
    }
    return (
      validateField(
        values[ic.paramName] ?? '',
        ic.validation,
        ic.min,
        ic.max,
      ) === null
    );
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string | null> = {};
    const newTouched: Record<string, boolean> = {};
    let valid = true;

    if (fields) {
      for (const f of fields) {
        const err = validateField(
          values[f.name] ?? '',
          f.validation,
          f.min,
          f.max,
        );
        newErrors[f.name] = err;
        newTouched[f.name] = true;
        if (err) {
          valid = false;
        }
      }
    } else {
      const err = validateField(
        values[ic.paramName] ?? '',
        ic.validation,
        ic.min,
        ic.max,
      );
      newErrors[ic.paramName] = err;
      newTouched[ic.paramName] = true;
      if (err) {
        valid = false;
      }
    }

    setErrors(newErrors);
    setTouched(newTouched);
    if (valid) {
      onSubmit(values);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.root}>
        {/* Backdrop — tapping it closes the dialog (web backdrop onClick). Hidden
            from screen readers; the Cancel button is the SR close affordance. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
          testID="command-input-backdrop"
        />

        <View
          accessibilityViewIsModal
          style={styles.dialog}
          testID="command-input-dialog">
          <View style={styles.header}>
            <SemanticIcon decorative name={def.icon} size="sm" />
            <View style={styles.headerText}>
              <AppText style={styles.title}>
                {t(def.labelKey, def.labelFallback)}
              </AppText>
              <AppText style={styles.prompt}>
                {t(ic.promptKey, ic.promptFallback)}
              </AppText>
            </View>
          </View>

          <View style={styles.form}>
            {fields ? (
              fields.map((field, i) => (
                <LabeledInput
                  error={
                    touched[field.name]
                      ? errors[field.name] ?? undefined
                      : undefined
                  }
                  inputMode={resolveInputMode(field.validation)}
                  key={field.name}
                  label={t(field.labelKey, field.labelFallback)}
                  onBlur={() => handleBlur(field.name)}
                  onChangeText={text => handleChange(field.name, text)}
                  placeholder={field.placeholder}
                  ref={i === 0 ? firstInputRef : undefined}
                  secureTextEntry={
                    resolveInputType(field.validation) === 'password'
                  }
                  testID={`command-input-field-${field.name}`}
                  value={values[field.name] ?? ''}
                />
              ))
            ) : (
              <LabeledInput
                error={
                  touched[ic.paramName]
                    ? errors[ic.paramName] ?? undefined
                    : undefined
                }
                inputMode={resolveInputMode(ic.validation)}
                label={
                  def.sublabelFallback
                    ? t(def.sublabelKey ?? '', def.sublabelFallback)
                    : undefined
                }
                onBlur={() => handleBlur(ic.paramName)}
                onChangeText={text => handleChange(ic.paramName, text)}
                placeholder={ic.defaultValue ?? ''}
                ref={firstInputRef}
                secureTextEntry={resolveInputType(ic.validation) === 'password'}
                testID={`command-input-field-${ic.paramName}`}
                value={values[ic.paramName] ?? ''}
              />
            )}

            <View style={styles.actions}>
              <Button
                onPress={onClose}
                size="sm"
                testID="command-input-cancel"
                variant="ghost">
                <AppText style={styles.cancelLabel}>
                  {t('common.cancel', 'Cancel')}
                </AppText>
              </Button>
              <Button
                disabled={!isValid()}
                loading={loading}
                onPress={handleSubmit}
                size="sm"
                style={styles.submitButton}
                testID="command-input-submit"
                variant="primary">
                <AppText style={styles.submitLabel}>
                  {t('common.send', 'Send')}
                </AppText>
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 16, 0.7)',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  prompt: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  form: {
    gap: 16,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  input: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  submitButton: {
    backgroundColor: 'rgba(53, 213, 255, 0.2)',
    borderColor: 'rgba(53, 213, 255, 0.3)',
    borderWidth: 1,
  },
  submitLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.accent,
  },
  cancelLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
