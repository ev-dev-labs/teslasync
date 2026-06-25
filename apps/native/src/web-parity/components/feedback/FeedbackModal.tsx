// Native parity port of web/src/components/feedback/FeedbackModal.tsx.
//
// In-app feedback and bug-report modal. Captures category + title + body,
// optionally attaches the most-recent frontend error reports (from an error
// ring buffer) and the last few console messages, and POSTs the result to
// /api/v1/feedback via useSubmitFeedback.
//
// Auto-collected (visible to the user before submit so nothing is shipped
// without consent):
//  - page_route   — supplied by the caller (web: useLocation().pathname)
//  - user_agent   — derived from React Native Platform (web: navigator.userAgent)
//  - app_version  — native-safe constant (web: import.meta.env.VITE_APP_VERSION)
//  - recent_errors — error ring buffer (toggleable, default ON)
//  - console_tail — last N console.* messages (toggleable, default OFF for
//                   privacy — console output may include tokens/route data)
//
// Native-safe adaptations (documented in the sidecar):
//  - zod is not a native dependency, so the schema is replaced by a hand-rolled
//    validateFeedback that reproduces the same min/max field errors and the
//    enum/boolean shape; FEEDBACK_* constants and FeedbackFormValues are
//    preserved verbatim.
//  - react-i18next is not wired in native; the i18n keys + English fallbacks are
//    preserved through a native translation fallback that also interpolates the
//    `{{count}}` placeholder.
//  - react-router-dom has no native equivalent, so `page_route` is taken from an
//    optional `pageRoute` prop (defaults to '').
//  - The browser-only `@/lib/errorReporter` is not ported, so this file inlines
//    a native-safe in-memory FeedbackErrorReport ring + getRecentReportsForFeedback.
//  - The console tail wraps the global RN `console` (not `window.console`).
//  - Shared web ui (Modal/Select/Input/Textarea/Toggle/Button/Caption/HelperText)
//    and DOM form/elements are replaced by RN Modal/ScrollView/TextInput/Pressable
//    + AppText and theme tokens; `data-testid` -> `testID`.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {
  useSubmitFeedback,
  type FeedbackCategory,
  type FeedbackSubmitInput,
} from '../../api/hooks/useFeedback';

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Native-safe replacement for the web `useLocation().pathname`. React Native
   * has no global router location, so the active route is supplied by the
   * caller and attached as `page_route`. Defaults to '' when unknown.
   */
  pageRoute?: string;
}

const FEEDBACK_TITLE_MIN = 5;
const FEEDBACK_TITLE_MAX = 120;
const FEEDBACK_BODY_MIN = 20;
const FEEDBACK_BODY_MAX = 4000;
const CONSOLE_TAIL_MAX = 4000;

interface FeedbackFormValues {
  category: FeedbackCategory;
  title: string;
  body: string;
  includeRecentErrors: boolean;
  includeConsoleTail: boolean;
}

type ErrorSource = 'window' | 'promise' | 'react' | 'query';

/**
 * A captured frontend error in the shape the in-app feedback modal attaches to
 * a user report. snake_case keys match the JSONB column the backend persists
 * into `user_feedback.recent_errors`. The browser errorReporter is not ported,
 * so this native ring stays empty until a native error reporter populates it.
 */
export interface FeedbackErrorReport {
  name: string;
  message: string;
  stack?: string;
  route: string;
  occurred_at: string;
  source: ErrorSource;
}

const feedbackErrorRing: FeedbackErrorReport[] = [];

function getRecentReportsForFeedback(): FeedbackErrorReport[] {
  return feedbackErrorRing.slice();
}

// In-memory console.* tail. Populated lazily (and only once) when the user
// actually opens the modal so unrelated startup paths pay nothing. The wrapper
// is installed on first open and left in place for the rest of the session —
// re-installing on every open would either duplicate writes or risk losing the
// pre-open buffer.
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';
const consoleTailBuffer: string[] = [];
const CONSOLE_TAIL_BUFFER_MAX = 50;
let consoleTailInstalled = false;

function installConsoleTail(): void {
  if (consoleTailInstalled) {
    return;
  }
  consoleTailInstalled = true;
  if (typeof console === 'undefined') {
    return;
  }
  const sink = console as unknown as Record<
    ConsoleMethod,
    (...args: unknown[]) => void
  >;
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error'];
  for (const method of methods) {
    const original = sink[method].bind(console);
    sink[method] = (...args: unknown[]) => {
      try {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${method}] ${args
          .map(a => {
            if (a instanceof Error) {
              return `${a.name}: ${a.message}`;
            }
            if (typeof a === 'string') {
              return a;
            }
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(' ')}`;
        consoleTailBuffer.push(line);
        if (consoleTailBuffer.length > CONSOLE_TAIL_BUFFER_MAX) {
          consoleTailBuffer.splice(
            0,
            consoleTailBuffer.length - CONSOLE_TAIL_BUFFER_MAX,
          );
        }
      } catch {
        // Never break console.* itself.
      }
      original(...args);
    };
  }
}

function getConsoleTail(): string {
  // Render newest-last so the operator reading the issue sees the failure
  // context at the bottom.
  const joined = consoleTailBuffer.join('\n');
  if (joined.length <= CONSOLE_TAIL_MAX) {
    return joined;
  }
  return joined.slice(joined.length - CONSOLE_TAIL_MAX);
}

interface FeedbackValidation {
  success: boolean;
  errors: Partial<Record<keyof FeedbackFormValues, string>>;
}

// Native-safe stand-in for the web zod schema. Reproduces the same min/max
// length gating and the category enum / boolean shape.
function validateFeedback(values: FeedbackFormValues): FeedbackValidation {
  const errors: Partial<Record<keyof FeedbackFormValues, string>> = {};
  if (
    values.category !== 'bug' &&
    values.category !== 'feature' &&
    values.category !== 'other'
  ) {
    errors.category = "Invalid enum value. Expected 'bug' | 'feature' | 'other'";
  }
  if (values.title.length < FEEDBACK_TITLE_MIN) {
    errors.title = `String must contain at least ${FEEDBACK_TITLE_MIN} character(s)`;
  } else if (values.title.length > FEEDBACK_TITLE_MAX) {
    errors.title = `String must contain at most ${FEEDBACK_TITLE_MAX} character(s)`;
  }
  if (values.body.length < FEEDBACK_BODY_MIN) {
    errors.body = `String must contain at least ${FEEDBACK_BODY_MIN} character(s)`;
  } else if (values.body.length > FEEDBACK_BODY_MAX) {
    errors.body = `String must contain at most ${FEEDBACK_BODY_MAX} character(s)`;
  }
  return {success: Object.keys(errors).length === 0, errors};
}

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TranslationVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = vars[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

const initialValues: FeedbackFormValues = {
  category: 'bug',
  title: '',
  body: '',
  includeRecentErrors: true,
  includeConsoleTail: false,
};

const initialTouched: Record<keyof FeedbackFormValues, boolean> = {
  category: false,
  title: false,
  body: false,
  includeRecentErrors: false,
  includeConsoleTail: false,
};

// Native-safe app version. The web build injects import.meta.env.VITE_APP_VERSION
// at bundle time; React Native has no such build env, so this stays '' (the UI
// then renders the existing "unknown" fallback) until a native version is wired.
const APP_VERSION = '';

function getNativeUserAgent(): string {
  return `TeslaSyncNative/${Platform.OS} ${String(Platform.Version)}`;
}

export function FeedbackModal({open, onClose, pageRoute = ''}: FeedbackModalProps) {
  const t = useNativeTranslationFallback();
  const submit = useSubmitFeedback();
  const [values, setValues] = useState<FeedbackFormValues>(initialValues);
  const [touched, setTouched] =
    useState<Record<keyof FeedbackFormValues, boolean>>(initialTouched);

  useEffect(() => {
    if (open) {
      installConsoleTail();
    }
  }, [open]);

  // Clear the form on close so a stale draft doesn't leak between submissions /
  // different bug reports. We intentionally exclude `submit` from the dep array:
  // TanStack Query re-creates the mutation object on every internal state change
  // — including the `reset()` call below — which would re-fire this effect and
  // create an infinite render loop while the modal is closed. The reset only
  // needs to run on the open->closed transition, so depending on `open` alone is
  // correct.
  useEffect(() => {
    if (!open) {
      setValues(initialValues);
      setTouched(initialTouched);
      submit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validation = useMemo(() => validateFeedback(values), [values]);
  const errors = validation.errors;

  const categoryOptions = useMemo(
    () =>
      [
        {value: 'bug', label: t('feedback.category.bug', 'Bug report')},
        {value: 'feature', label: t('feedback.category.feature', 'Feature request')},
        {value: 'other', label: t('feedback.category.other', 'Other / question')},
      ] as Array<{value: FeedbackCategory; label: string}>,
    [t],
  );

  const appVersion = APP_VERSION;
  const userAgent = useMemo(() => getNativeUserAgent(), []);

  const recentErrors = useMemo(() => {
    if (!open || !values.includeRecentErrors) {
      return [];
    }
    return getRecentReportsForFeedback();
  }, [open, values.includeRecentErrors]);

  const handleChange = <K extends keyof FeedbackFormValues>(
    key: K,
    value: FeedbackFormValues[K],
  ) => {
    setValues(prev => ({...prev, [key]: value}));
  };

  const handleBlur = (key: keyof FeedbackFormValues) => {
    setTouched(prev => ({...prev, [key]: true}));
  };

  const onSubmit = useCallback(async () => {
    setTouched({
      category: true,
      title: true,
      body: true,
      includeRecentErrors: true,
      includeConsoleTail: true,
    });
    if (!validation.success) {
      return;
    }
    const payload: FeedbackSubmitInput = {
      category: values.category,
      title: values.title.trim(),
      body: values.body.trim(),
      page_route: pageRoute,
      user_agent: userAgent,
      app_version: appVersion,
    };
    if (values.includeRecentErrors && recentErrors.length > 0) {
      payload.recent_errors = recentErrors;
    }
    if (values.includeConsoleTail) {
      const tail = getConsoleTail();
      if (tail.length > 0) {
        payload.console_tail = tail;
      }
    }
    try {
      await submit.mutateAsync(payload);
      onClose();
    } catch {
      // Toast is rendered by useSubmitFeedback's onError; surface inline error
      // in the form via submit.isError below.
    }
  }, [
    appVersion,
    onClose,
    pageRoute,
    recentErrors,
    submit,
    userAgent,
    validation.success,
    values,
  ]);

  const isSubmitting = submit.isPending;
  const submitDisabled = isSubmitting || !validation.success;

  const titleError = touched.title ? errors.title : undefined;
  const bodyError = touched.body ? errors.body : undefined;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog}>
          <AppText style={styles.title} variant="title" weight="bold">
            {t('feedback.title', 'Report a bug / Send feedback')}
          </AppText>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            style={styles.scroll}
            testID="feedback-form">
            <View
              accessibilityLabel={t(
                'feedback.form.category.label',
                'What kind of feedback?',
              )}
              accessibilityRole="radiogroup"
              style={styles.field}>
              <AppText style={styles.label} variant="caption" weight="semibold">
                {t('feedback.form.category.label', 'What kind of feedback?')}
              </AppText>
              <View style={styles.segmented}>
                {categoryOptions.map(opt => {
                  const selected = values.category === opt.value;
                  return (
                    <Pressable
                      accessibilityLabel={opt.label}
                      accessibilityRole="radio"
                      accessibilityState={{selected}}
                      key={opt.value}
                      onPress={() => handleChange('category', opt.value)}
                      style={({pressed}) => [
                        styles.categoryOption,
                        selected && styles.categoryOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <AppText
                        style={
                          selected
                            ? styles.categoryOptionTextSelected
                            : styles.categoryOptionText
                        }
                        weight="semibold">
                        {opt.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <AppText style={styles.label} variant="caption" weight="semibold">
                {t('feedback.form.title.label', 'Title')}
              </AppText>
              <TextInput
                accessibilityLabel={t('feedback.form.title.label', 'Title')}
                maxLength={FEEDBACK_TITLE_MAX}
                onBlur={() => handleBlur('title')}
                onChangeText={text => handleChange('title', text)}
                placeholder={t(
                  'feedback.form.title.placeholder',
                  'Short summary (e.g. "Battery widget shows NaN")',
                )}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, titleError ? styles.inputError : null]}
                value={values.title}
              />
              {titleError ? (
                <AppText style={styles.fieldError} variant="caption">
                  {titleError}
                </AppText>
              ) : null}
            </View>

            <View style={styles.field}>
              <AppText style={styles.label} variant="caption" weight="semibold">
                {t('feedback.form.body.label', 'Details')}
              </AppText>
              <TextInput
                accessibilityLabel={t('feedback.form.body.label', 'Details')}
                maxLength={FEEDBACK_BODY_MAX}
                multiline
                numberOfLines={6}
                onBlur={() => handleBlur('body')}
                onChangeText={text => handleChange('body', text)}
                placeholder={t(
                  'feedback.form.body.placeholder',
                  'What happened? What did you expect to happen? Steps to reproduce help a lot.',
                )}
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  styles.textarea,
                  bodyError ? styles.inputError : null,
                ]}
                textAlignVertical="top"
                value={values.body}
              />
              {bodyError ? (
                <AppText style={styles.fieldError} variant="caption">
                  {bodyError}
                </AppText>
              ) : null}
            </View>

            <View style={styles.contextPanel}>
              <AppText
                style={styles.sectionCaption}
                tone="muted"
                variant="caption"
                weight="semibold">
                {t('feedback.context.title', 'Auto-attached context')}
              </AppText>

              <View style={styles.contextList}>
                <ContextRow
                  label={t('feedback.context.page', 'Page')}
                  mono
                  value={pageRoute}
                />
                <ContextRow
                  label={t('feedback.context.appVersion', 'App version')}
                  mono
                  value={appVersion || t('feedback.context.unknown', 'unknown')}
                />
                <ContextRow
                  label={t('feedback.context.userAgent', 'Browser')}
                  value={userAgent || t('feedback.context.unknown', 'unknown')}
                />
              </View>

              <View style={styles.toggleGroup}>
                <FeedbackToggle
                  checked={values.includeRecentErrors}
                  label={t(
                    'feedback.form.includeErrors',
                    'Attach recent errors ({{count}})',
                    {count: getRecentReportsForFeedback().length},
                  )}
                  onChange={v => handleChange('includeRecentErrors', v)}
                />
                <AppText style={styles.helperText} tone="muted" variant="caption">
                  {t(
                    'feedback.form.includeErrorsHint',
                    'Includes the most recent uncaught errors from this session. Helps reproduce the bug.',
                  )}
                </AppText>
              </View>

              <View style={styles.toggleGroup}>
                <FeedbackToggle
                  checked={values.includeConsoleTail}
                  label={t(
                    'feedback.form.includeConsole',
                    'Attach recent console messages',
                  )}
                  onChange={v => handleChange('includeConsoleTail', v)}
                />
                <AppText style={styles.helperText} tone="muted" variant="caption">
                  {t(
                    'feedback.form.includeConsoleHint',
                    'Privacy: console output may include URLs and data you saw. Off by default.',
                  )}
                </AppText>
              </View>
            </View>

            {submit.isError ? (
              <AppText
                accessibilityRole="alert"
                style={styles.submitError}
                testID="feedback-submit-error"
                tone="danger"
                variant="caption">
                {t(
                  'feedback.submitError',
                  'Failed to submit feedback. Please try again.',
                )}
              </AppText>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <FeedbackButton
              disabled={isSubmitting}
              label={t('common.cancel', 'Cancel')}
              onPress={onClose}
              variant="ghost"
            />
            <FeedbackButton
              disabled={submitDisabled}
              label={
                isSubmitting
                  ? t('feedback.form.submitting', 'Submitting…')
                  : t('feedback.form.submit', 'Send feedback')
              }
              onPress={onSubmit}
              testID="feedback-submit"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

FeedbackModal.displayName = 'FeedbackModal';

function ContextRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <View style={styles.contextRow}>
      <AppText style={styles.contextKey} weight="semibold">
        {`${label}: `}
      </AppText>
      <AppText style={[styles.contextValue, mono && styles.contextCode]}>
        {value}
      </AppText>
    </View>
  );
}

function FeedbackToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{checked}}
      onPress={() => onChange(!checked)}
      style={({pressed}) => [styles.toggleRow, pressed && styles.pressed]}>
      <View style={[styles.toggleTrack, checked && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, checked && styles.toggleThumbOn]} />
      </View>
      <AppText style={styles.toggleLabel}>{label}</AppText>
    </Pressable>
  );
}

function FeedbackButton({
  disabled = false,
  label,
  onPress,
  testID,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID?: string;
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
        styles.actionButton,
        variant === 'primary'
          ? styles.actionButtonPrimary
          : styles.actionButtonGhost,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.actionButtonTextPrimary
            : styles.actionButtonTextGhost
        }
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
    minWidth: 112,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionButtonDisabled: {
    opacity: 0.48,
  },
  actionButtonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  actionButtonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.borderAccent,
  },
  actionButtonTextGhost: {
    color: colors.textPrimary,
  },
  actionButtonTextPrimary: {
    color: colors.background,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  categoryOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryOptionSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  categoryOptionText: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  categoryOptionTextSelected: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  contextCode: {
    fontFamily: 'monospace',
  },
  contextKey: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  contextList: {
    gap: spacing.xs,
  },
  contextPanel: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  contextRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  contextValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '88%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  field: {
    gap: spacing.xs,
  },
  fieldError: {
    color: colors.danger,
  },
  helperText: {
    lineHeight: 16,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  label: {
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing.md,
  },
  sectionCaption: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  submitError: {
    color: colors.danger,
  },
  textarea: {
    minHeight: 120,
    paddingTop: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
  },
  toggleGroup: {
    gap: spacing.xs,
  },
  toggleLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleThumb: {
    backgroundColor: colors.textPrimary,
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  toggleThumbOn: {
    transform: [{translateX: 18}],
  },
  toggleTrack: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 44,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
});

export default FeedbackModal;
