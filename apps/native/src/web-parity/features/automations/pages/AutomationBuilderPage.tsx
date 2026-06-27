import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/automations/pages/AutomationBuilderPage.tsx.
//
// The web module is the typed Automation builder: a PageContainer wrapping a
// <form> with a Back button, an EditConflictBanner, an optional
// DraftRecoveryBanner, two AI panels (AINLAutomationBuilder +
// AIGeofenceAwareAutomationSuggestions), then four FormSections — General
// (name/description/vehicle/enabled), When (Trigger) with a typed
// TriggerConfigurator, Only If (Conditions) with a ConditionBuilder, Then
// (Actions) with an ActionBuilder — plus ConflictWarnings, a save-error
// AlertBanner, the Save/Create + Test Run + Cancel button row, and a preset
// hint. It supports create / edit (GET-hydrated) / preset-install modes, draft
// autosave, dirty-form + navigation guards, a per-automation edit lease, and a
// discard ConfirmDialog. Create -> POST /api/v1/automations, edit -> PUT
// /api/v1/automations/{id}, test -> POST /api/v1/automations/{id}/test-run, all
// via the ported useAutomations hooks.
//
// The web sibling builders (TriggerConfigurator / ConditionBuilder /
// ActionBuilder / ConflictWarnings) and the lib/signals + lib/constants tables
// are NOT yet ported, so they are inlined here faithfully (rule 7 / the
// GasPriceAutoPollPage precedent). Already-ported native deps are imported:
// the useAutomations / useVehicles / useNotifications / useLocations hooks, the
// two AI panels, FadeIn, EmptyState, AlertBanner, AppText, GlassPanel, tokens.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?, vars?) returns the English fallback with {{token}}
//     interpolation, preserving every key + copy verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (RN has no document.title).
//   • react-router-dom useParams/useSearchParams/useNavigate -> optional page
//     props {id, presetId, onNavigate}; the id/presetId values still drive the
//     edit/preset modes and navigate('/automations') -> onNavigate('/automations').
//   • @/hooks/useSelectedVehicle -> a native hook over the ported useVehicles()
//     that defaults to the first vehicle (RN has no URL/store precedence).
//   • @/hooks/useFormDraft -> an in-memory React-state draft (the parity bundle
//     ships no localStorage); the value/setValue/hasDraft/draftSavedAt/discardDraft
//     contract is preserved but hasDraft is always false (no persisted restore).
//   • @/hooks/useDirtyForm -> the localized title/message/discard/keepEditing
//     strings only (RN has no beforeunload).
//   • @/hooks/useNavigationGuard + @/hooks/useEditLease + EditConflictBanner ->
//     no-ops / a null banner (a single RN app instance has no cross-tab race).
//   • @/hooks/useConfirm + ConfirmDialog -> a native RN-Modal-driven confirm
//     (confirm() returns Promise<boolean>); the silenceKey persistence is dropped.
//   • DraftRecoveryBanner -> inlined (never rendered since hasDraft is false).
//   • @/components/ui Input/Textarea/Select/Toggle/Button + @/components/layout
//     PageContainer + @/components/forms FormSection -> inlined RN equivalents
//     covering exactly the props these call sites use (TextInput, option chips,
//     a switch, Pressables, a ScrollView page shell).
//   • lucide-react glyphs -> small unicode text glyphs (the AlertBanner "✕"
//     precedent); semantics are carried by accessibilityLabel.
//   • @/lib/signals SIGNAL_FIELD_OPTIONS/BOOL_FIELD_KEYS + @/lib/constants
//     DAYS/COMMON_TIMEZONES -> inlined verbatim.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys); every API path / query key flows through the ported hooks. No
// DOM elements, react-i18next, lucide-react, framer-motion, Recharts, Leaflet,
// react-dom, or web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  useAutomation,
  useAutomationPreset,
  useCreateAutomationFull,
  useTestRunAutomation,
  useUpdateAutomationFull,
  type AutomationActionKind,
  type AutomationActionStep,
  type AutomationConditionKind,
  type AutomationConditionSignalOp,
  type AutomationConditionStep,
  type AutomationConflict,
  type AutomationEventType,
  type AutomationFull,
  type AutomationFullInput,
  type AutomationGeofenceEvent,
  type AutomationGeofenceState,
  type AutomationOtherAutomationState,
  type AutomationTriggerKind,
  type AutomationTriggerSignalOp,
  type AutomationTriggerStep,
} from '../../../api/hooks/useAutomations';
import {useGeofences} from '../../../api/hooks/useLocations';
import {
  useNotificationChannels,
  type NotificationChannel,
} from '../../../api/hooks/useNotifications';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AIGeofenceAwareAutomationSuggestions} from '../../../components/ai/AIGeofenceAwareAutomationSuggestions';
import {AINLAutomationBuilder} from '../../../components/ai/AINLAutomationBuilder';
import {AlertBanner} from '../../../components/feedback/AlertBanner';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                  */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number | null | undefined>;
type TOptions = TVars & {defaultValue?: string};
type TFunc = (key: string, arg2?: string | TOptions, arg3?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the `defaultValue`)
// while preserving every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, arg2, arg3) => {
    let fallback = key;
    let vars: TVars | undefined;
    if (typeof arg2 === 'string') {
      fallback = arg2;
      vars = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      const {defaultValue, ...rest} = arg2;
      fallback = defaultValue ?? key;
      vars = rest as TVars;
    }
    return interpolate(fallback, vars);
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  Inlined web/src/features/automations/components/stepInputTypes     */
/* ------------------------------------------------------------------ */

type StepInput<T> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>
  : never;

type AutomationTriggerStepInput = StepInput<AutomationTriggerStep>;
type AutomationConditionStepInput = StepInput<AutomationConditionStep>;
type AutomationActionStepInput = StepInput<AutomationActionStep>;

type AutomationActionCommandStepInput = Extract<
  AutomationActionStepInput,
  {kind: 'action_command'}
>;
type AutomationActionSetSettingStepInput = Extract<
  AutomationActionStepInput,
  {kind: 'action_set_setting'}
>;

/* ------------------------------------------------------------------ */
/*  Inlined @/lib/signals + @/lib/constants tables                    */
/* ------------------------------------------------------------------ */

interface SignalField {
  key: string;
  label: string;
  type: 'numeric' | 'boolean' | 'string';
  unit?: string;
}

const SIGNAL_FIELDS: SignalField[] = [
  {key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%'},
  {key: 'inside_temp', label: 'Inside Temperature', type: 'numeric', unit: '°C'},
  {key: 'outside_temp', label: 'Outside Temperature', type: 'numeric', unit: '°C'},
  {key: 'speed', label: 'Speed', type: 'numeric', unit: 'mph'},
  {key: 'is_locked', label: 'Is Locked', type: 'boolean'},
  {key: 'is_charging', label: 'Is Charging', type: 'boolean'},
  {key: 'is_climate_on', label: 'Climate On', type: 'boolean'},
  {key: 'sentry_mode', label: 'Sentry Mode', type: 'boolean'},
  {key: 'state', label: 'Vehicle State', type: 'string'},
];

const BOOL_FIELD_KEYS = new Set(
  SIGNAL_FIELDS.filter(f => f.type === 'boolean').map(f => f.key),
);

const SIGNAL_FIELD_OPTIONS = SIGNAL_FIELDS.map(f => ({
  value: f.key,
  label: f.label,
}));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const COMMON_TIMEZONES: {value: string; label: string}[] = [
  {value: '', label: 'UTC (Default)'},
  {value: 'America/New_York', label: 'Eastern (US)'},
  {value: 'America/Chicago', label: 'Central (US)'},
  {value: 'America/Denver', label: 'Mountain (US)'},
  {value: 'America/Los_Angeles', label: 'Pacific (US)'},
  {value: 'Europe/London', label: 'London (UK)'},
  {value: 'Europe/Berlin', label: 'Berlin (EU)'},
  {value: 'Europe/Paris', label: 'Paris (EU)'},
  {value: 'Asia/Tokyo', label: 'Tokyo (JP)'},
  {value: 'Asia/Shanghai', label: 'Shanghai (CN)'},
  {value: 'Australia/Sydney', label: 'Sydney (AU)'},
];

/* ------------------------------------------------------------------ */
/*  Small unicode glyphs (web lucide-react icons)                     */
/* ------------------------------------------------------------------ */

const GLYPHS = {
  back: '\u2039', // ‹  (ArrowLeft)
  save: '\u2913', // ⤓  (Save)
  play: '\u25B6', // ▶  (PlayCircle)
  close: '\u2715', // ✕ (X)
  zap: '\u26A1', // ⚡ (Zap)
  alert: '\u26A0', // ⚠ (AlertTriangle)
  info: '\u2139', // ℹ (Info)
  plus: '+', // (Plus)
  trash: '\u2715', // ✕ (Trash2)
  up: '\u2191', // ↑ (ChevronUp)
  down: '\u2193', // ↓ (ChevronDown)
} as const;

const GLYPH_TONE_COLORS: Record<
  'primary' | 'secondary' | 'danger' | 'accent' | 'success',
  string
> = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  danger: colors.danger,
  accent: colors.accent,
  success: colors.success,
};

function GlyphLegacyUnused({
  char,
  tone = 'secondary',
}: {
  char: string;
  tone?: 'primary' | 'secondary' | 'danger' | 'accent' | 'success';
}): React.ReactElement {
  return (
    <AppText style={[styles.glyph, {color: GLYPH_TONE_COLORS[tone]}]} weight="bold">
      {char}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Button                                     */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  active?: boolean;
  children?: ReactNode;
}

const BUTTON_TONES: Record<ButtonVariant, {bg: string; border: string; text: string}> = {
  primary: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
  secondary: {bg: colors.surfaceRaised, border: colors.border, text: colors.textPrimary},
  ghost: {bg: 'transparent', border: 'transparent', text: colors.textSecondary},
};

function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  onPress,
  accessibilityLabel,
  active,
  children,
}: ButtonProps): React.ReactElement {
  const isDisabled = !!disabled || !!loading;
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: !!loading, selected: !!active}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        size === 'sm' ? styles.btnSm : styles.btnMd,
        !hasLabel ? styles.btnIconOnly : null,
        {backgroundColor: tone.bg, borderColor: tone.border},
        active ? styles.btnActive : null,
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}>
      {loading ? (
        <ActivityIndicator color={tone.text} size="small" />
      ) : icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText style={[styles.btnText, {color: tone.text}]} weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Input + Textarea                          */
/* ------------------------------------------------------------------ */

interface InputProps {
  label?: string;
  value: string | number;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  hint?: string;
  error?: string;
  required?: boolean;
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  hint,
  error,
  required,
}: InputProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary">
          {label}
          {required ? <AppText tone="danger">{' *'}</AppText> : null}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          focused ? styles.inputFocused : null,
          error ? styles.inputError : null,
        ]}
        value={String(value)}
      />
      {error ? (
        <AppText style={styles.fieldError} tone="danger" variant="caption">
          {error}
        </AppText>
      ) : hint ? (
        <AppText style={styles.fieldHint} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

interface TextareaProps {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
}

function Textarea({
  label,
  value,
  onChangeText,
  placeholder,
  rows = 2,
  error,
}: TextareaProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        multiline
        numberOfLines={rows}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          styles.textarea,
          {minHeight: rows * 20 + 16},
          focused ? styles.inputFocused : null,
          error ? styles.inputError : null,
        ]}
        textAlignVertical="top"
        value={value}
      />
      {error ? (
        <AppText style={styles.fieldError} tone="danger" variant="caption">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Select (native <select> -> option chips)  */
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

function Select({
  label,
  options,
  value,
  onChange,
}: SelectProps): React.ReactElement {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
      <View style={styles.optionRow}>
        {options.map(opt => {
          const active = opt.value === value;
          const disabled = !!opt.disabled;
          return (
            <Pressable
              key={opt.value || '__blank__'}
              accessibilityRole="button"
              accessibilityState={{selected: active, disabled}}
              disabled={disabled}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.option,
                active ? styles.optionActive : null,
                disabled ? styles.optionDisabled : null,
                pressed && !disabled ? styles.optionPressed : null,
              ]}>
              <AppText
                style={active ? styles.optionTextActive : styles.optionText}
                weight={active ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Toggle                                     */
/* ------------------------------------------------------------------ */

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({label, checked, onChange}: ToggleProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      onPress={() => onChange(!checked)}
      style={styles.toggleRow}>
      <View style={[styles.toggleTrack, checked ? styles.toggleTrackOn : null]}>
        <View style={[styles.toggleThumb, checked ? styles.toggleThumbOn : null]} />
      </View>
      {label ? (
        <AppText style={styles.toggleLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/forms FormSection                            */
/* ------------------------------------------------------------------ */

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function FormSection({
  title,
  description,
  children,
}: FormSectionProps): React.ReactElement {
  return (
    <GlassPanel style={styles.formSection}>
      <AppText style={styles.sectionTitle} weight="semibold">
        {title}
      </AppText>
      {description ? (
        <AppText style={styles.sectionDescription} tone="muted" variant="caption">
          {description}
        </AppText>
      ) : null}
      <View style={styles.formSectionBody}>{children}</View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer                         */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Native-safe stand-ins for browser-only hooks/banners              */
/* ------------------------------------------------------------------ */

// Web DraftRecoveryBanner restores localStorage autosaves. The native parity
// bundle keeps drafts in memory only, so hasDraft is always false and this is
// never rendered — kept for call-site parity.
function DraftRecoveryBanner({
  draftSavedAt,
  onDiscard,
  itemNoun,
}: {
  hasDraft: boolean;
  draftSavedAt: number | null;
  onDiscard: () => void;
  itemNoun: string;
}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <AlertBanner
      onClose={onDiscard}
      title={t('draft.recovery.title', 'Recovered {{noun}} draft', {noun: itemNoun})}
      variant="info">
      {t('draft.recovery.body', 'An unsaved draft was restored.') +
        (draftSavedAt ? ` (${new Date(draftSavedAt).toLocaleString('en-US')})` : '')}
    </AlertBanner>
  );
}

// Web EditConflictBanner surfaces a cross-tab edit-lease conflict. A single RN
// app instance has no second tab racing the same automation, so it renders null.
function EditConflictBanner(_props: {
  resourceKey: string;
  resourceLabel: string;
}): null {
  return null;
}

// Web useEditLease claims a localStorage/BroadcastChannel lease so a second tab
// editing the SAME automation surfaces a conflict. No cross-tab surface in RN.
function useEditLease(_leaseKey: string): void {
  // intentionally empty — single app instance, no cross-tab lease.
}

// Web useNavigationGuard blocks in-app router navigation while dirty. RN
// navigation is owned by the host navigator; this is a documented no-op.
function useNavigationGuard(_dirty: boolean, _message: string): void {
  // intentionally empty — no react-router navigation to block.
}

interface SelectedVehicleResult {
  vehicleId: number | undefined;
}

// Web useSelectedVehicle precedence is URL > store > first vehicle. RN has no
// URL/store, so it collapses to "first vehicle in the fleet".
function useSelectedVehicle(): SelectedVehicleResult {
  const {data: vehicles} = useVehicles();
  const vehicleId =
    vehicles && vehicles.length > 0 ? vehicles[0].id : undefined;
  return {vehicleId};
}

interface UseDirtyFormResult {
  isDirty: boolean;
  message: string;
  title: string;
  discardLabel: string;
  keepEditingLabel: string;
}

// Web useDirtyForm also installs a beforeunload listener; RN has none, so the
// native hook returns only the localized confirm-dialog copy.
function useDirtyForm(isDirty: boolean): UseDirtyFormResult {
  const {t} = useTranslation();
  return {
    isDirty,
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t('forms.unsavedWarning', 'You have unsaved changes. Discard them?'),
    discardLabel: t('forms.discard', 'Discard changes'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  };
}

interface FormDraftResult<T> {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  hasDraft: boolean;
  draftSavedAt: number | null;
  discardDraft: () => void;
}

// Web useFormDraft autosaves to localStorage (per-key, debounced). The parity
// bundle has no localStorage, so drafts live in React state only: the
// value/setValue/discardDraft contract is preserved, hasDraft is always false
// (no persisted restore), and skipPersist is accepted + ignored.
function useFormDraft<T>(
  _key: string,
  initial: T,
  _opts?: {version?: number; debounceMs?: number; skipPersist?: () => boolean},
): FormDraftResult<T> {
  const [value, setValue] = useState<T>(initial);
  const discardDraft = useCallback(() => {
    // no persisted draft to clear in the native bundle.
  }, []);
  return {value, setValue, hasDraft: false, draftSavedAt: null, discardDraft};
}

/* ------------------------------------------------------------------ */
/*  Inlined @/hooks/useConfirm + @/components/ui ConfirmDialog        */
/* ------------------------------------------------------------------ */

interface ConfirmOptions {
  title: string;
  message: string;
  variant?: 'warning' | 'danger' | 'info';
  confirmLabel?: string;
  cancelLabel?: string;
  silenceKey?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Web useConfirm returns an imperative confirm() that resolves when the user
// answers a ConfirmDialog. The native hook drives an RN Modal; the silenceKey
// "don't ask again" persistence (localStorage) is dropped (documented).
function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialogProps: ConfirmDialogProps | null;
} {
  const [dialogProps, setDialogProps] = useState<ConfirmDialogProps | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialogProps(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        resolverRef.current = resolve;
        setDialogProps({
          ...opts,
          open: true,
          onConfirm: () => settle(true),
          onCancel: () => settle(false),
        });
      }),
    [settle],
  );

  return {confirm, dialogProps};
}

function ConfirmDialog({
  open,
  title,
  message,
  variant = 'warning',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const {t} = useTranslation();
  return (
    <RNModal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <Pressable
        accessibilityLabel={cancelLabel ?? t('common.cancel', 'Cancel')}
        onPress={onCancel}
        style={styles.modalOverlay}>
        <Pressable onPress={() => undefined} style={styles.modalPanel}>
          <AppText style={styles.modalTitle} weight="bold">
            {title}
          </AppText>
          <AppText style={styles.modalMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.modalActions}>
            <Button onPress={onCancel} variant="ghost">
              {cancelLabel ?? t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onPress={onConfirm}
              variant={variant === 'danger' ? 'secondary' : 'primary'}>
              {confirmLabel ?? t('common.confirm', 'Confirm')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

/* ================================================================== */
/*  Inlined sibling: TriggerConfigurator                              */
/* ================================================================== */

type TriggerTypeOption = {
  value: AutomationTriggerKind;
  labelKey: string;
  fallback: string;
};

const TRIGGER_TYPES: TriggerTypeOption[] = [
  {
    value: 'trigger_schedule',
    labelKey: 'automations.builder.triggerSchedule',
    fallback: 'Schedule',
  },
  {
    value: 'trigger_event',
    labelKey: 'automations.builder.triggerEvent',
    fallback: 'Vehicle Event',
  },
  {
    value: 'trigger_geofence',
    labelKey: 'automations.builder.triggerGeofence',
    fallback: 'Geofence',
  },
  {
    value: 'trigger_signal',
    labelKey: 'automations.builder.triggerSignal',
    fallback: 'Signal Threshold',
  },
];

const VEHICLE_EVENTS: {value: AutomationEventType; labelKey: string; fallback: string}[] = [
  {value: 'drive_start', labelKey: 'automations.events.driveStart', fallback: 'Drive Starts'},
  {value: 'drive_end', labelKey: 'automations.events.driveEnd', fallback: 'Drive Ends'},
  {value: 'charge_start', labelKey: 'automations.events.chargeStart', fallback: 'Charging Starts'},
  {value: 'charge_end', labelKey: 'automations.events.chargeEnd', fallback: 'Charging Ends'},
  {value: 'sleep_start', labelKey: 'automations.events.sleepStart', fallback: 'Sleep Starts'},
  {value: 'sleep_end', labelKey: 'automations.events.sleepEnd', fallback: 'Sleep Ends'},
  {value: 'online', labelKey: 'automations.events.online', fallback: 'Comes Online'},
  {value: 'offline', labelKey: 'automations.events.offline', fallback: 'Goes Offline'},
  {value: 'sentry_alert', labelKey: 'automations.events.sentryAlert', fallback: 'Sentry Alert'},
];

const GEOFENCE_EVENTS: {value: AutomationGeofenceEvent; labelKey: string; fallback: string}[] = [
  {value: 'enter', labelKey: 'automations.geofence.enter', fallback: 'Enter'},
  {value: 'exit', labelKey: 'automations.geofence.exit', fallback: 'Exit'},
  {value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell'},
];

const SIGNAL_OPERATORS: {value: AutomationTriggerSignalOp; labelKey: string; fallback: string}[] = [
  {value: '=', labelKey: 'automations.operators.equals', fallback: '='},
  {value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!='},
  {value: '<', labelKey: 'automations.operators.lessThan', fallback: '<'},
  {value: '<=', labelKey: 'automations.operators.lessThanOrEqual', fallback: '<='},
  {value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>'},
  {value: '>=', labelKey: 'automations.operators.greaterThanOrEqual', fallback: '>='},
  {value: 'changed', labelKey: 'automations.operators.changed', fallback: 'Changed'},
  {value: 'crossed_above', labelKey: 'automations.operators.crossedAbove', fallback: 'Crossed Above'},
  {value: 'crossed_below', labelKey: 'automations.operators.crossedBelow', fallback: 'Crossed Below'},
];

interface TriggerConfiguratorProps {
  trigger: AutomationTriggerStepInput;
  onChange: (trigger: AutomationTriggerStepInput) => void;
}

function buildCronExpr(hour: number, minute: number, days: number[]): string {
  const dow = days.length === 0 || days.length === 7 ? '*' : days.join(',');
  return `${minute} ${hour} * * ${dow}`;
}

function parseCronExpr(
  expr: string,
): {hour: number; minute: number; days: number[]} | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [min, hr, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') {
    return null;
  }
  const minute = Number.parseInt(min, 10);
  const hour = Number.parseInt(hr, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return null;
  }
  const days =
    dow === '*'
      ? []
      : dow.split(',').map(Number).filter(day => !Number.isNaN(day));
  return {hour, minute, days};
}

function createDefaultTrigger(
  kind: AutomationTriggerKind,
): AutomationTriggerStepInput {
  switch (kind) {
    case 'trigger_schedule':
      return {kind, cron_expr: '0 8 * * *', timezone: 'UTC'};
    case 'trigger_event':
      return {kind, event_type: 'online'};
    case 'trigger_geofence':
      return {kind, place_id: 0, event: 'enter'};
    case 'trigger_signal':
      return {kind, signal: 'battery_level', op: '<', value_num: 20};
  }
}

function signalValueFromInput(
  trigger: Extract<AutomationTriggerStepInput, {kind: 'trigger_signal'}>,
  value: string,
): AutomationTriggerStepInput {
  if (trigger.op === 'changed') {
    return {kind: 'trigger_signal', signal: trigger.signal, op: trigger.op};
  }
  if (BOOL_FIELD_KEYS.has(trigger.signal)) {
    return {
      kind: 'trigger_signal',
      signal: trigger.signal,
      op: trigger.op,
      value_bool: value === 'true',
    };
  }
  if (trigger.signal === 'state') {
    return {
      kind: 'trigger_signal',
      signal: trigger.signal,
      op: trigger.op,
      value_text: value,
    };
  }
  return {
    kind: 'trigger_signal',
    signal: trigger.signal,
    op: trigger.op,
    value_num: Number.parseFloat(value) || 0,
  };
}

function DayToggleRow({
  selectedDays,
  allActiveWhenEmpty,
  onToggle,
}: {
  selectedDays: number[];
  allActiveWhenEmpty: boolean;
  onToggle: (day: number) => void;
}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <View style={styles.daysRow}>
      {DAYS.map((label, index) => {
        const active = allActiveWhenEmpty
          ? selectedDays.length === 0 || selectedDays.includes(index)
          : selectedDays.includes(index);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={label}
            onPress={() => onToggle(index)}
            style={({pressed}) => [
              styles.dayChip,
              active ? styles.dayChipActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              style={active ? styles.dayChipTextActive : styles.dayChipText}
              weight="semibold">
              {t(`common.days.short.${index}`, label)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function TriggerConfigurator({
  trigger,
  onChange,
}: TriggerConfiguratorProps): React.ReactElement {
  const {t} = useTranslation();
  const {data: geofences} = useGeofences();

  const geofenceOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectGeofence', 'Select geofence...')},
      ...(geofences ?? []).map(g => ({value: String(g.id), label: g.name})),
    ],
    [geofences, t],
  );

  const eventOptions = useMemo(
    () =>
      VEHICLE_EVENTS.map(event => ({
        value: event.value,
        label: t(event.labelKey, event.fallback),
      })),
    [t],
  );

  const geofenceEventOptions = useMemo(
    () =>
      GEOFENCE_EVENTS.map(event => ({
        value: event.value,
        label: t(event.labelKey, event.fallback),
      })),
    [t],
  );

  const signalOperatorOptions = useMemo(
    () =>
      SIGNAL_OPERATORS.map(operator => ({
        value: operator.value,
        label: t(operator.labelKey, operator.fallback),
      })),
    [t],
  );

  const handleDayToggle = useCallback((days: number[], day: number) => {
    if (days.length === 0) {
      return DAYS.map((_, index) => index).filter(index => index !== day);
    }
    const next = days.includes(day)
      ? days.filter(current => current !== day)
      : [...days, day].sort();
    return next.length === 7 ? [] : next;
  }, []);

  switch (trigger.kind) {
    case 'trigger_schedule': {
      const parsed = parseCronExpr(trigger.cron_expr);
      const isSimple = parsed !== null;
      const hour = parsed?.hour ?? 8;
      const minute = parsed?.minute ?? 0;
      const selectedDays = parsed?.days ?? [];

      const updateCron = (h: number, m: number, d: number[]) => {
        onChange({...trigger, cron_expr: buildCronExpr(h, m, d)});
      };

      return (
        <View style={styles.stack4}>
          {isSimple ? (
            <>
              <Input
                label={t('automations.builder.time', 'Time')}
                onChangeText={next => {
                  const [nextHour, nextMinute] = next.split(':').map(Number);
                  updateCron(nextHour ?? hour, nextMinute ?? minute, selectedDays);
                }}
                placeholder="HH:MM"
                value={`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
              />
              <View>
                <AppText style={styles.fieldLabel} tone="secondary">
                  {t('automations.builder.days', 'Days')}
                </AppText>
                <DayToggleRow
                  allActiveWhenEmpty
                  onToggle={day => updateCron(hour, minute, handleDayToggle(selectedDays, day))}
                  selectedDays={selectedDays}
                />
              </View>
            </>
          ) : (
            <Input
              hint={t('automations.builder.cronHint', 'minute hour day-of-month month day-of-week')}
              label={t('automations.builder.cronExpr', 'Cron Expression')}
              onChangeText={next => onChange({...trigger, cron_expr: next})}
              placeholder={t('automations.builder.cronPlaceholder', '0 8 * * 1-5')}
              value={trigger.cron_expr}
            />
          )}
          <Button
            onPress={() =>
              onChange({
                ...trigger,
                cron_expr: isSimple ? trigger.cron_expr : '0 8 * * *',
              })
            }
            size="sm"
            variant="ghost">
            {isSimple
              ? t('automations.builder.advancedCron', 'Use advanced cron expression')
              : t('automations.builder.simpleCron', 'Switch to simple mode')}
          </Button>
          <Select
            label={t('automations.builder.timezone', 'Timezone')}
            onChange={next => onChange({...trigger, timezone: next})}
            options={COMMON_TIMEZONES.map(option => ({
              value: option.value,
              label: t(`timezones.${option.value || 'utc'}`, option.label),
            }))}
            value={trigger.timezone}
          />
        </View>
      );
    }

    case 'trigger_event':
      return (
        <View style={styles.stack4}>
          <Select
            label={t('automations.builder.event', 'Event')}
            onChange={next =>
              onChange({...trigger, event_type: next as AutomationEventType})
            }
            options={eventOptions}
            value={trigger.event_type}
          />
        </View>
      );

    case 'trigger_geofence':
      return (
        <View style={styles.stack4}>
          <Select
            label={t('automations.builder.geofence', 'Geofence')}
            onChange={next =>
              onChange({...trigger, place_id: next ? Number(next) : 0})
            }
            options={geofenceOptions}
            value={trigger.place_id > 0 ? String(trigger.place_id) : ''}
          />
          <Select
            label={t('automations.builder.geofenceEvent', 'Event')}
            onChange={next =>
              onChange({
                ...trigger,
                event: next as AutomationGeofenceEvent,
                dwell_minutes:
                  next === 'dwell' ? trigger.dwell_minutes ?? 5 : undefined,
              })
            }
            options={geofenceEventOptions}
            value={trigger.event}
          />
          {trigger.event === 'dwell' ? (
            <Input
              hint={t('automations.builder.dwellHint', 'Required for dwell triggers')}
              keyboardType="numeric"
              label={t('automations.builder.dwellMinutes', 'Dwell Minutes')}
              onChangeText={next =>
                onChange({
                  ...trigger,
                  dwell_minutes: Number.parseInt(next, 10) || 1,
                })
              }
              value={trigger.dwell_minutes ?? 5}
            />
          ) : null}
        </View>
      );

    case 'trigger_signal': {
      const isBool = BOOL_FIELD_KEYS.has(trigger.signal);
      const value = isBool
        ? String(trigger.value_bool ?? true)
        : trigger.signal === 'state'
          ? trigger.value_text ?? 'online'
          : String(trigger.value_num ?? 20);

      return (
        <View style={styles.stack4}>
          <Select
            label={t('automations.builder.signal', 'Signal')}
            onChange={signal => {
              const next: AutomationTriggerStepInput = BOOL_FIELD_KEYS.has(signal)
                ? {kind: 'trigger_signal', signal, op: '=', value_bool: true}
                : signal === 'state'
                  ? {kind: 'trigger_signal', signal, op: '=', value_text: 'online'}
                  : {kind: 'trigger_signal', signal, op: '<', value_num: 20};
              onChange(next);
            }}
            options={SIGNAL_FIELD_OPTIONS}
            value={trigger.signal}
          />
          <Select
            label={t('automations.builder.operator', 'Operator')}
            onChange={nextOp => {
              const op = nextOp as AutomationTriggerSignalOp;
              if (op === 'changed') {
                onChange({kind: 'trigger_signal', signal: trigger.signal, op});
                return;
              }
              onChange(signalValueFromInput({...trigger, op}, value));
            }}
            options={signalOperatorOptions}
            value={trigger.op}
          />
          {trigger.op !== 'changed' ? (
            isBool ? (
              <Select
                label={t('automations.builder.value', 'Value')}
                onChange={next => onChange(signalValueFromInput(trigger, next))}
                options={[
                  {value: 'true', label: t('common.true', 'True')},
                  {value: 'false', label: t('common.false', 'False')},
                ]}
                value={value}
              />
            ) : (
              <Input
                keyboardType={trigger.signal === 'state' ? 'default' : 'numeric'}
                label={t('automations.builder.value', 'Value')}
                onChangeText={next => onChange(signalValueFromInput(trigger, next))}
                placeholder={
                  trigger.signal === 'state'
                    ? t('automations.builder.statePlaceholder', 'online')
                    : undefined
                }
                value={value}
              />
            )
          ) : null}
          <Toggle
            checked={trigger.op === 'changed'}
            label={t('automations.builder.changedOnly', 'Fire on any change')}
            onChange={checked =>
              onChange(
                checked
                  ? {kind: 'trigger_signal', signal: trigger.signal, op: 'changed'}
                  : signalValueFromInput({...trigger, op: '='}, value),
              )
            }
          />
        </View>
      );
    }
  }
}

/* ================================================================== */
/*  Inlined sibling: ConditionBuilder                                */
/* ================================================================== */

type ConditionKindOption = {
  value: AutomationConditionKind;
  labelKey: string;
  fallback: string;
};

const CONDITION_TYPES: ConditionKindOption[] = [
  {
    value: 'condition_signal',
    labelKey: 'automations.conditions.signal',
    fallback: 'Signal Check',
  },
  {
    value: 'condition_time_window',
    labelKey: 'automations.conditions.timeWindow',
    fallback: 'Time Window',
  },
  {
    value: 'condition_geofence',
    labelKey: 'automations.conditions.geofence',
    fallback: 'Geofence State',
  },
  {
    value: 'condition_other_automation',
    labelKey: 'automations.conditions.otherAutomation',
    fallback: 'Other Automation',
  },
];

const CONDITION_SIGNAL_OPERATORS: {
  value: AutomationConditionSignalOp;
  labelKey: string;
  fallback: string;
  numericOnly?: boolean;
}[] = [
  {value: '=', labelKey: 'automations.operators.equals', fallback: '='},
  {value: '!=', labelKey: 'automations.operators.notEquals', fallback: '!='},
  {value: '<', labelKey: 'automations.operators.lessThan', fallback: '<', numericOnly: true},
  {value: '<=', labelKey: 'automations.operators.lessThanOrEqual', fallback: '<=', numericOnly: true},
  {value: '>', labelKey: 'automations.operators.greaterThan', fallback: '>', numericOnly: true},
  {value: '>=', labelKey: 'automations.operators.greaterThanOrEqual', fallback: '>=', numericOnly: true},
  {value: 'between', labelKey: 'automations.operators.between', fallback: 'Between', numericOnly: true},
  {value: 'in', labelKey: 'automations.operators.in', fallback: 'In'},
];

const GEOFENCE_STATES: {value: AutomationGeofenceState; labelKey: string; fallback: string}[] = [
  {value: 'inside', labelKey: 'automations.geofence.inside', fallback: 'Inside'},
  {value: 'outside', labelKey: 'automations.geofence.outside', fallback: 'Outside'},
  {value: 'dwell', labelKey: 'automations.geofence.dwell', fallback: 'Dwell'},
];

const OTHER_AUTOMATION_STATES: {
  value: AutomationOtherAutomationState;
  labelKey: string;
  fallback: string;
}[] = [
  {value: 'enabled', labelKey: 'automations.otherAutomation.enabled', fallback: 'Enabled'},
  {value: 'disabled', labelKey: 'automations.otherAutomation.disabled', fallback: 'Disabled'},
  {
    value: 'recently_triggered',
    labelKey: 'automations.otherAutomation.recentlyTriggered',
    fallback: 'Recently Triggered',
  },
];

interface ConditionBuilderProps {
  conditions: AutomationConditionStepInput[];
  onChange: (conditions: AutomationConditionStepInput[]) => void;
}

interface ConditionFieldsProps {
  condition: AutomationConditionStepInput;
  onChange: (condition: AutomationConditionStepInput) => void;
  geofenceOptions: {value: string; label: string}[];
}

function createDefaultCondition(
  kind: AutomationConditionKind,
): AutomationConditionStepInput {
  switch (kind) {
    case 'condition_signal':
      return {kind, signal: 'battery_level', op: '<', value_num: 20};
    case 'condition_time_window':
      return {
        kind,
        start_time: '06:00',
        end_time: '09:00',
        timezone: 'UTC',
        days_of_week: [1, 2, 3, 4, 5],
      };
    case 'condition_geofence':
      return {kind, place_id: 0, state: 'inside'};
    case 'condition_other_automation':
      return {kind, other_automation_id: 0, state: 'enabled'};
  }
}

function conditionValueFromInput(
  condition: Extract<AutomationConditionStepInput, {kind: 'condition_signal'}>,
  value: string,
): AutomationConditionStepInput {
  if (BOOL_FIELD_KEYS.has(condition.signal)) {
    return {
      kind: 'condition_signal',
      signal: condition.signal,
      op: condition.op,
      value_bool: value === 'true',
    };
  }
  if (condition.signal === 'state' || condition.op === 'in') {
    return {
      kind: 'condition_signal',
      signal: condition.signal,
      op: condition.op,
      value_text: value,
    };
  }
  return {
    kind: 'condition_signal',
    signal: condition.signal,
    op: condition.op,
    value_num: Number.parseFloat(value) || 0,
  };
}

function numericValue(
  value: number | null | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ConditionBuilder({
  conditions,
  onChange,
}: ConditionBuilderProps): React.ReactElement {
  const {t} = useTranslation();
  const {data: geofences} = useGeofences();

  const geofenceOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectGeofence', 'Select geofence...')},
      ...(geofences ?? []).map(g => ({value: String(g.id), label: g.name})),
    ],
    [geofences, t],
  );

  const conditionTypeOptions = useMemo(
    () =>
      CONDITION_TYPES.map(condition => ({
        value: condition.value,
        label: t(condition.labelKey, condition.fallback),
      })),
    [t],
  );

  const addCondition = useCallback(() => {
    onChange([...conditions, createDefaultCondition('condition_signal')]);
  }, [conditions, onChange]);

  const removeCondition = useCallback(
    (index: number) =>
      onChange(conditions.filter((_, currentIndex) => currentIndex !== index)),
    [conditions, onChange],
  );

  const replaceCondition = useCallback(
    (index: number, nextCondition: AutomationConditionStepInput) => {
      onChange(
        conditions.map((condition, currentIndex) =>
          currentIndex === index ? nextCondition : condition,
        ),
      );
    },
    [conditions, onChange],
  );

  return (
    <View style={styles.stack3}>
      {conditions.map((condition, index) => (
        <GlassPanel key={`${condition.kind}-${index}`} style={styles.stepCard}>
          <View style={styles.stepRow}>
            <View style={styles.stepBody}>
              <Select
                label={
                  index === 0
                    ? t('automations.builder.conditionType', 'Condition Type')
                    : undefined
                }
                onChange={next =>
                  replaceCondition(
                    index,
                    createDefaultCondition(next as AutomationConditionKind),
                  )
                }
                options={conditionTypeOptions}
                value={condition.kind}
              />
              <ConditionFields
                condition={condition}
                geofenceOptions={geofenceOptions}
                onChange={nextCondition => replaceCondition(index, nextCondition)}
              />
            </View>
            <Button
              accessibilityLabel={t('automations.builder.removeCondition', 'Remove condition')}
              icon={<Glyph char={GLYPHS.trash} tone="danger" />}
              onPress={() => removeCondition(index)}
              size="sm"
              variant="ghost"
            />
          </View>
        </GlassPanel>
      ))}

      <Button
        icon={<Glyph char={GLYPHS.plus} tone="accent" />}
        onPress={addCondition}
        size="sm"
        variant="ghost">
        {t('automations.builder.addCondition', 'Add Condition')}
      </Button>
    </View>
  );
}

function ConditionFields({
  condition,
  onChange,
  geofenceOptions,
}: ConditionFieldsProps): React.ReactElement {
  const {t} = useTranslation();

  const operatorOptions = useMemo(() => {
    const isBool =
      condition.kind === 'condition_signal' && BOOL_FIELD_KEYS.has(condition.signal);
    return CONDITION_SIGNAL_OPERATORS.filter(
      operator => !isBool || !operator.numericOnly,
    ).map(operator => ({
      value: operator.value,
      label: t(operator.labelKey, operator.fallback),
    }));
  }, [condition, t]);

  const timezoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.map(option => ({
        value: option.value,
        label: t(`timezones.${option.value || 'utc'}`, option.label),
      })),
    [t],
  );

  switch (condition.kind) {
    case 'condition_signal': {
      const isBool = BOOL_FIELD_KEYS.has(condition.signal);
      const isRange = condition.op === 'between';
      const value = isBool
        ? String(condition.value_bool ?? true)
        : condition.signal === 'state' || condition.op === 'in'
          ? condition.value_text ?? ''
          : String(condition.value_num ?? 20);

      return (
        <View style={styles.stack3}>
          <Select
            label={t('automations.builder.signal', 'Signal')}
            onChange={signal => {
              const nextCondition: AutomationConditionStepInput = BOOL_FIELD_KEYS.has(signal)
                ? {kind: 'condition_signal', signal, op: '=', value_bool: true}
                : signal === 'state'
                  ? {kind: 'condition_signal', signal, op: '=', value_text: 'online'}
                  : {kind: 'condition_signal', signal, op: '<', value_num: 20};
              onChange(nextCondition);
            }}
            options={SIGNAL_FIELD_OPTIONS}
            value={condition.signal}
          />
          <Select
            label={t('automations.builder.operator', 'Operator')}
            onChange={nextOp => {
              const op = nextOp as AutomationConditionSignalOp;
              if (op === 'between') {
                onChange({
                  kind: 'condition_signal',
                  signal: condition.signal,
                  op,
                  value_min: numericValue(condition.value_min ?? condition.value_num, 0),
                  value_max: numericValue(condition.value_max, 100),
                });
                return;
              }
              onChange(conditionValueFromInput({...condition, op}, value));
            }}
            options={operatorOptions}
            value={condition.op}
          />
          {isRange ? (
            <>
              <Input
                keyboardType="numeric"
                label={t('automations.builder.minValue', 'Min')}
                onChangeText={next =>
                  onChange({
                    ...condition,
                    value_min: Number.parseFloat(next) || 0,
                  })
                }
                value={numericValue(condition.value_min, 0)}
              />
              <Input
                keyboardType="numeric"
                label={t('automations.builder.maxValue', 'Max')}
                onChangeText={next =>
                  onChange({
                    ...condition,
                    value_max: Number.parseFloat(next) || 0,
                  })
                }
                value={numericValue(condition.value_max, 100)}
              />
            </>
          ) : isBool ? (
            <Select
              label={t('automations.builder.value', 'Value')}
              onChange={next => onChange(conditionValueFromInput(condition, next))}
              options={[
                {value: 'true', label: t('common.true', 'True')},
                {value: 'false', label: t('common.false', 'False')},
              ]}
              value={value}
            />
          ) : (
            <Input
              keyboardType={
                condition.signal === 'state' || condition.op === 'in'
                  ? 'default'
                  : 'numeric'
              }
              label={t('automations.builder.value', 'Value')}
              onChangeText={next => onChange(conditionValueFromInput(condition, next))}
              placeholder={
                condition.signal === 'state'
                  ? t('automations.builder.statePlaceholder', 'online')
                  : undefined
              }
              value={value}
            />
          )}
        </View>
      );
    }

    case 'condition_time_window':
      return (
        <View style={styles.stack3}>
          <Input
            label={t('automations.builder.startTime', 'Start')}
            onChangeText={next => onChange({...condition, start_time: next})}
            placeholder="HH:MM"
            value={condition.start_time}
          />
          <Input
            label={t('automations.builder.endTime', 'End')}
            onChangeText={next => onChange({...condition, end_time: next})}
            placeholder="HH:MM"
            value={condition.end_time}
          />
          <Select
            label={t('automations.builder.timezone', 'Timezone')}
            onChange={next => onChange({...condition, timezone: next})}
            options={timezoneOptions}
            value={condition.timezone}
          />
          <View>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('automations.builder.days', 'Days')}
            </AppText>
            <DayToggleRow
              allActiveWhenEmpty={false}
              onToggle={day => {
                const active = condition.days_of_week.includes(day);
                const days = active
                  ? condition.days_of_week.filter(currentDay => currentDay !== day)
                  : [...condition.days_of_week, day].sort();
                onChange({...condition, days_of_week: days});
              }}
              selectedDays={condition.days_of_week}
            />
          </View>
        </View>
      );

    case 'condition_geofence':
      return (
        <View style={styles.stack3}>
          <Select
            label={t('automations.builder.geofence', 'Geofence')}
            onChange={next =>
              onChange({...condition, place_id: next ? Number(next) : 0})
            }
            options={geofenceOptions}
            value={condition.place_id > 0 ? String(condition.place_id) : ''}
          />
          <Select
            label={t('automations.builder.state', 'State')}
            onChange={next =>
              onChange({...condition, state: next as AutomationGeofenceState})
            }
            options={GEOFENCE_STATES.map(state => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            value={condition.state}
          />
        </View>
      );

    case 'condition_other_automation':
      return (
        <View style={styles.stack3}>
          <Input
            keyboardType="numeric"
            label={t('automations.builder.otherAutomationId', 'Automation ID')}
            onChangeText={next =>
              onChange({
                ...condition,
                other_automation_id: Number.parseInt(next, 10) || 0,
              })
            }
            value={condition.other_automation_id || ''}
          />
          <Select
            label={t('automations.builder.state', 'State')}
            onChange={next =>
              onChange({
                ...condition,
                state: next as AutomationOtherAutomationState,
              })
            }
            options={OTHER_AUTOMATION_STATES.map(state => ({
              value: state.value,
              label: t(state.labelKey, state.fallback),
            }))}
            value={condition.state}
          />
        </View>
      );
  }
}

/* ================================================================== */
/*  Inlined sibling: ActionBuilder                                   */
/* ================================================================== */

type ActionKindOption = {
  value: AutomationActionKind;
  labelKey: string;
  fallback: string;
};

type CommandParams = NonNullable<AutomationActionCommandStepInput['command_params']>;
type SettingValueKind = 'text' | 'number' | 'boolean';

const ACTION_TYPES: ActionKindOption[] = [
  {value: 'action_command', labelKey: 'automations.actions.command', fallback: 'Vehicle Command'},
  {value: 'action_notify', labelKey: 'automations.actions.notify', fallback: 'Send Notification'},
  {value: 'action_set_setting', labelKey: 'automations.actions.setSetting', fallback: 'Set Setting'},
  {
    value: 'action_call_automation',
    labelKey: 'automations.actions.callAutomation',
    fallback: 'Call Automation',
  },
];

const COMMAND_GROUPS: {
  labelKey: string;
  fallback: string;
  commands: {value: string; labelKey: string; fallback: string}[];
}[] = [
  {
    labelKey: 'automations.commandGroups.security',
    fallback: 'Security & Access',
    commands: [
      {value: 'lock', labelKey: 'automations.commands.lock', fallback: 'Lock Doors'},
      {value: 'unlock', labelKey: 'automations.commands.unlock', fallback: 'Unlock Doors'},
      {value: 'sentry_on', labelKey: 'automations.commands.sentryOn', fallback: 'Sentry Mode On'},
      {value: 'sentry_off', labelKey: 'automations.commands.sentryOff', fallback: 'Sentry Mode Off'},
      {value: 'valet_on', labelKey: 'automations.commands.valetOn', fallback: 'Valet Mode On'},
      {value: 'valet_off', labelKey: 'automations.commands.valetOff', fallback: 'Valet Mode Off'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.climate',
    fallback: 'Climate',
    commands: [
      {value: 'climate_on', labelKey: 'automations.commands.climateOn', fallback: 'Climate On'},
      {value: 'climate_off', labelKey: 'automations.commands.climateOff', fallback: 'Climate Off'},
      {value: 'set_temps', labelKey: 'automations.commands.setTemps', fallback: 'Set Temperature'},
      {value: 'seat_heater', labelKey: 'automations.commands.seatHeater', fallback: 'Seat Heater'},
      {value: 'seat_cooler', labelKey: 'automations.commands.seatCooler', fallback: 'Seat Cooler'},
      {
        value: 'steering_wheel_heat',
        labelKey: 'automations.commands.steeringWheelHeat',
        fallback: 'Steering Wheel Heater',
      },
      {value: 'dog_mode', labelKey: 'automations.commands.dogMode', fallback: 'Dog Mode'},
      {value: 'camp_mode', labelKey: 'automations.commands.campMode', fallback: 'Camp Mode'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.charging',
    fallback: 'Charging',
    commands: [
      {value: 'charge_start', labelKey: 'automations.commands.chargeStart', fallback: 'Start Charging'},
      {value: 'charge_stop', labelKey: 'automations.commands.chargeStop', fallback: 'Stop Charging'},
      {
        value: 'set_charge_limit',
        labelKey: 'automations.commands.setChargeLimit',
        fallback: 'Set Charge Limit',
      },
      {
        value: 'set_charging_amps',
        labelKey: 'automations.commands.setChargingAmps',
        fallback: 'Set Charging Amps',
      },
      {
        value: 'open_charge_port',
        labelKey: 'automations.commands.openChargePort',
        fallback: 'Open Charge Port',
      },
      {
        value: 'close_charge_port',
        labelKey: 'automations.commands.closeChargePort',
        fallback: 'Close Charge Port',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.doors',
    fallback: 'Doors & Trunk',
    commands: [
      {value: 'frunk_open', labelKey: 'automations.commands.frunkOpen', fallback: 'Open Frunk'},
      {value: 'trunk_open', labelKey: 'automations.commands.trunkOpen', fallback: 'Open Trunk'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.alerts',
    fallback: 'Alerts',
    commands: [
      {value: 'honk', labelKey: 'automations.commands.honk', fallback: 'Honk Horn'},
      {value: 'flash', labelKey: 'automations.commands.flash', fallback: 'Flash Lights'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.navigation',
    fallback: 'Navigation',
    commands: [
      {
        value: 'navigation_request',
        labelKey: 'automations.commands.navigationRequest',
        fallback: 'Navigate to Address',
      },
      {
        value: 'navigation_gps_request',
        labelKey: 'automations.commands.navigationGpsRequest',
        fallback: 'Navigate to GPS',
      },
      {
        value: 'trigger_homelink',
        labelKey: 'automations.commands.triggerHomelink',
        fallback: 'Trigger HomeLink',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.driveSoftware',
    fallback: 'Drive & Software',
    commands: [
      {
        value: 'remote_start_drive',
        labelKey: 'automations.commands.remoteStartDrive',
        fallback: 'Remote Start',
      },
      {value: 'wake_up', labelKey: 'automations.commands.wakeUp', fallback: 'Wake Up'},
    ],
  },
];

interface ActionBuilderProps {
  actions: AutomationActionStepInput[];
  channels: NotificationChannel[];
  onChange: (actions: AutomationActionStepInput[]) => void;
}

interface ActionFieldsProps {
  action: AutomationActionStepInput;
  channelOptions: {value: string; label: string; disabled?: boolean}[];
  onChange: (action: AutomationActionStepInput) => void;
}

function isCommandParams(value: unknown): value is CommandParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createDefaultAction(
  kind: AutomationActionKind,
  channelId = 0,
): AutomationActionStepInput {
  switch (kind) {
    case 'action_command':
      return {kind, command_name: 'climate_on'};
    case 'action_notify':
      return {kind, channel_id: channelId, template: ''};
    case 'action_set_setting':
      return {kind, setting_key: '', value_text: ''};
    case 'action_call_automation':
      return {kind, target_automation_id: 0};
  }
}

function settingValueKind(
  action: AutomationActionSetSettingStepInput,
): SettingValueKind {
  if (action.value_num != null) {
    return 'number';
  }
  if (action.value_bool != null) {
    return 'boolean';
  }
  return 'text';
}

function actionWithSettingValue(
  action: AutomationActionSetSettingStepInput,
  kind: SettingValueKind,
  value: string,
): AutomationActionStepInput {
  if (kind === 'number') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_num: Number.parseFloat(value) || 0,
    };
  }
  if (kind === 'boolean') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_bool: value === 'true',
    };
  }
  return {
    kind: 'action_set_setting',
    setting_key: action.setting_key,
    value_text: value,
  };
}

function ActionBuilder({
  actions,
  channels,
  onChange,
}: ActionBuilderProps): React.ReactElement {
  const {t} = useTranslation();

  const defaultChannelId = useMemo(
    () => channels.find(channel => channel.enabled)?.id ?? channels[0]?.id ?? 0,
    [channels],
  );

  const actionTypeOptions = useMemo(
    () =>
      ACTION_TYPES.map(action => ({
        value: action.value,
        label: t(action.labelKey, action.fallback),
      })),
    [t],
  );

  const channelOptions = useMemo(
    () =>
      channels.map(channel => ({
        value: String(channel.id),
        label: `${channel.name} (${channel.kind})`,
        disabled: !channel.enabled,
      })),
    [channels],
  );

  const addAction = useCallback(() => {
    onChange([...actions, createDefaultAction('action_command', defaultChannelId)]);
  }, [actions, defaultChannelId, onChange]);

  const removeAction = useCallback(
    (index: number) =>
      onChange(actions.filter((_, currentIndex) => currentIndex !== index)),
    [actions, onChange],
  );

  const replaceAction = useCallback(
    (index: number, nextAction: AutomationActionStepInput) => {
      onChange(
        actions.map((action, currentIndex) =>
          currentIndex === index ? nextAction : action,
        ),
      );
    },
    [actions, onChange],
  );

  const moveAction = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= actions.length) {
        return;
      }
      const next = [...actions];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [actions, onChange],
  );

  return (
    <View style={styles.stack3}>
      {actions.map((action, index) => (
        <GlassPanel key={`${action.kind}-${index}`} style={styles.stepCard}>
          <View style={styles.stepRow}>
            <AppText style={styles.stepIndex} tone="muted" variant="caption">
              {index + 1}.
            </AppText>
            <View style={styles.stepBody}>
              <Select
                label={
                  index === 0
                    ? t('automations.builder.actionType', 'Action Type')
                    : undefined
                }
                onChange={next =>
                  replaceAction(
                    index,
                    createDefaultAction(
                      next as AutomationActionKind,
                      defaultChannelId,
                    ),
                  )
                }
                options={actionTypeOptions}
                value={action.kind}
              />
              <ActionFields
                action={action}
                channelOptions={channelOptions}
                onChange={nextAction => replaceAction(index, nextAction)}
              />
            </View>
            <View style={styles.stepControls}>
              <Button
                accessibilityLabel={t('automations.builder.moveUp', 'Move up')}
                disabled={index === 0}
                icon={<Glyph char={GLYPHS.up} />}
                onPress={() => moveAction(index, -1)}
                size="sm"
                variant="ghost"
              />
              <Button
                accessibilityLabel={t('automations.builder.moveDown', 'Move down')}
                disabled={index === actions.length - 1}
                icon={<Glyph char={GLYPHS.down} />}
                onPress={() => moveAction(index, 1)}
                size="sm"
                variant="ghost"
              />
              <Button
                accessibilityLabel={t('automations.builder.removeAction', 'Remove action')}
                icon={<Glyph char={GLYPHS.trash} tone="danger" />}
                onPress={() => removeAction(index)}
                size="sm"
                variant="ghost"
              />
            </View>
          </View>
        </GlassPanel>
      ))}

      <Button
        icon={<Glyph char={GLYPHS.plus} tone="accent" />}
        onPress={addAction}
        size="sm"
        variant="ghost">
        {t('automations.builder.addAction', 'Add Action')}
      </Button>
    </View>
  );
}

function ActionFields({
  action,
  channelOptions,
  onChange,
}: ActionFieldsProps): React.ReactElement {
  const {t} = useTranslation();
  const [paramsText, setParamsText] = useState('');
  const [paramsError, setParamsError] = useState<string | null>(null);

  const commandOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectCommand', 'Select command...')},
      ...COMMAND_GROUPS.flatMap(group => {
        const groupLabel = t(group.labelKey, group.fallback);
        return group.commands.map(command => ({
          value: command.value,
          label: `${groupLabel} - ${t(command.labelKey, command.fallback)}`,
        }));
      }),
    ],
    [t],
  );

  useEffect(() => {
    if (action.kind !== 'action_command') {
      setParamsText('');
      setParamsError(null);
      return;
    }
    setParamsText(
      action.command_params ? JSON.stringify(action.command_params, null, 2) : '',
    );
    setParamsError(null);
  }, [action]);

  switch (action.kind) {
    case 'action_command':
      return (
        <View style={styles.stack3}>
          <Select
            label={t('automations.builder.command', 'Command')}
            onChange={next => onChange({...action, command_name: next})}
            options={commandOptions}
            value={action.command_name}
          />
          <Textarea
            error={paramsError ?? undefined}
            label={t('automations.builder.commandParams', 'Params (JSON, optional)')}
            onChangeText={nextText => {
              setParamsText(nextText);
              if (!nextText.trim()) {
                setParamsError(null);
                onChange({...action, command_params: undefined});
                return;
              }
              try {
                const parsed: unknown = JSON.parse(nextText);
                if (!isCommandParams(parsed)) {
                  setParamsError(
                    t(
                      'automations.builder.commandParamsObjectError',
                      'Params must be a JSON object.',
                    ),
                  );
                  return;
                }
                setParamsError(null);
                onChange({...action, command_params: parsed});
              } catch (error) {
                setParamsError(
                  error instanceof Error
                    ? error.message
                    : t('automations.builder.invalidJson', 'Invalid JSON'),
                );
              }
            }}
            placeholder={t('automations.builder.commandParamsPlaceholder', '{"temp": 21}')}
            rows={2}
            value={paramsText}
          />
        </View>
      );

    case 'action_notify':
      return (
        <View style={styles.stack3}>
          <Select
            label={t('automations.builder.channel', 'Channel')}
            onChange={next =>
              onChange({
                ...action,
                channel_id: Number.parseInt(next, 10) || 0,
              })
            }
            options={
              channelOptions.length > 0
                ? channelOptions
                : [
                    {
                      value: '0',
                      label: t('automations.builder.noChannels', 'No channels configured'),
                    },
                  ]
            }
            value={String(action.channel_id)}
          />
          <Textarea
            label={t('automations.builder.notifyMessage', 'Message')}
            onChangeText={next => onChange({...action, template: next})}
            placeholder={t('automations.builder.notifyPlaceholder', 'Car is warming up!')}
            rows={2}
            value={action.template}
          />
        </View>
      );

    case 'action_set_setting': {
      const valueKind = settingValueKind(action);
      const value =
        valueKind === 'number'
          ? String(action.value_num ?? 0)
          : valueKind === 'boolean'
            ? String(action.value_bool ?? false)
            : action.value_text ?? '';

      return (
        <View style={styles.stack3}>
          <Input
            label={t('automations.builder.settingKey', 'Setting Key')}
            onChangeText={next => onChange({...action, setting_key: next})}
            placeholder={t('automations.builder.settingKeyPlaceholder', 'charge_limit')}
            value={action.setting_key}
          />
          <Select
            label={t('automations.builder.valueType', 'Value Type')}
            onChange={next =>
              onChange(
                actionWithSettingValue(action, next as SettingValueKind, value),
              )
            }
            options={[
              {value: 'text', label: t('automations.builder.valueText', 'Text')},
              {value: 'number', label: t('automations.builder.valueNumber', 'Number')},
              {value: 'boolean', label: t('automations.builder.valueBoolean', 'Boolean')},
            ]}
            value={valueKind}
          />
          {valueKind === 'boolean' ? (
            <Select
              label={t('automations.builder.value', 'Value')}
              onChange={next =>
                onChange(actionWithSettingValue(action, valueKind, next))
              }
              options={[
                {value: 'true', label: t('common.true', 'True')},
                {value: 'false', label: t('common.false', 'False')},
              ]}
              value={value}
            />
          ) : (
            <Input
              keyboardType={valueKind === 'number' ? 'numeric' : 'default'}
              label={t('automations.builder.value', 'Value')}
              onChangeText={next =>
                onChange(actionWithSettingValue(action, valueKind, next))
              }
              placeholder={
                valueKind === 'number'
                  ? t('automations.builder.valueNumberPlaceholder', '80')
                  : t('automations.builder.valueTextPlaceholder', 'enabled')
              }
              value={value}
            />
          )}
        </View>
      );
    }

    case 'action_call_automation':
      return (
        <View style={styles.stack3}>
          <Input
            keyboardType="numeric"
            label={t('automations.builder.targetAutomationId', 'Target Automation ID')}
            onChangeText={next =>
              onChange({
                ...action,
                target_automation_id: Number.parseInt(next, 10) || 0,
              })
            }
            value={action.target_automation_id || ''}
          />
        </View>
      );
  }
}

/* ================================================================== */
/*  Inlined sibling: ConflictWarnings                                */
/* ================================================================== */

function ConflictWarnings({
  conflicts,
}: {
  conflicts: AutomationConflict[];
}): React.ReactElement | null {
  const {t} = useTranslation();
  if (conflicts.length === 0) {
    return null;
  }
  return (
    <View style={styles.stack2}>
      {conflicts.map((c, i) => (
        <AlertBanner
          icon={
            <Glyph
              char={c.severity === 'warning' ? GLYPHS.alert : GLYPHS.info}
              tone={c.severity === 'warning' ? 'primary' : 'accent'}
            />
          }
          key={`${c.automation_id}-${i}`}
          title={t('automations.builder.conflict', 'Potential Conflict')}
          variant={c.severity === 'warning' ? 'warning' : 'info'}>
          {`"${c.automation_name}": ${c.reason}`}
        </AlertBanner>
      ))}
    </View>
  );
}

/* ================================================================== */
/*  Page-level helpers (web AutomationBuilderPage module scope)       */
/* ================================================================== */

interface FormState {
  name: string;
  description: string;
  vehicle_id: number | null;
  enabled: boolean;
  triggers: AutomationTriggerStepInput[];
  conditions: AutomationConditionStepInput[];
  actions: AutomationActionStepInput[];
}

function getInitialForm(): FormState {
  return {
    name: '',
    description: '',
    vehicle_id: null,
    enabled: true,
    triggers: [],
    conditions: [],
    actions: [{kind: 'action_command', command_name: 'climate_on'}],
  };
}

function normalizeTriggerInput(
  trigger: AutomationTriggerStepInput | AutomationTriggerStep,
): AutomationTriggerStepInput {
  switch (trigger.kind) {
    case 'trigger_schedule':
      return {
        kind: 'trigger_schedule',
        cron_expr: trigger.cron_expr,
        timezone: trigger.timezone,
      };
    case 'trigger_event':
      return {
        kind: 'trigger_event',
        event_type: trigger.event_type,
      };
    case 'trigger_geofence':
      return {
        kind: 'trigger_geofence',
        place_id: trigger.place_id,
        event: trigger.event,
        ...(trigger.dwell_minutes != null ? {dwell_minutes: trigger.dwell_minutes} : {}),
      };
    case 'trigger_signal': {
      const input: AutomationTriggerStepInput = {
        kind: 'trigger_signal',
        signal: trigger.signal,
        op: trigger.op,
      };
      if (trigger.value_num != null) {
        input.value_num = trigger.value_num;
      }
      if (trigger.value_text != null) {
        input.value_text = trigger.value_text;
      }
      if (trigger.value_bool != null) {
        input.value_bool = trigger.value_bool;
      }
      return input;
    }
  }
}

function normalizeConditionInput(
  condition: AutomationConditionStepInput | AutomationConditionStep,
): AutomationConditionStepInput {
  switch (condition.kind) {
    case 'condition_signal': {
      const input: AutomationConditionStepInput = {
        kind: 'condition_signal',
        signal: condition.signal,
        op: condition.op,
      };
      if (condition.value_num != null) {
        input.value_num = condition.value_num;
      }
      if (condition.value_text != null) {
        input.value_text = condition.value_text;
      }
      if (condition.value_bool != null) {
        input.value_bool = condition.value_bool;
      }
      if (condition.value_min != null) {
        input.value_min = condition.value_min;
      }
      if (condition.value_max != null) {
        input.value_max = condition.value_max;
      }
      return input;
    }
    case 'condition_time_window':
      return {
        kind: 'condition_time_window',
        start_time: condition.start_time,
        end_time: condition.end_time,
        timezone: condition.timezone,
        days_of_week: [...condition.days_of_week],
      };
    case 'condition_geofence':
      return {
        kind: 'condition_geofence',
        place_id: condition.place_id,
        state: condition.state,
      };
    case 'condition_other_automation':
      return {
        kind: 'condition_other_automation',
        other_automation_id: condition.other_automation_id,
        state: condition.state,
      };
  }
}

function normalizeActionInput(
  action: AutomationActionStepInput | AutomationActionStep,
): AutomationActionStepInput {
  switch (action.kind) {
    case 'action_command':
      return {
        kind: 'action_command',
        command_name: action.command_name,
        ...(action.command_params ? {command_params: action.command_params} : {}),
      };
    case 'action_notify':
      return {
        kind: 'action_notify',
        channel_id: action.channel_id,
        template: action.template,
      };
    case 'action_set_setting': {
      const input: AutomationActionStepInput = {
        kind: 'action_set_setting',
        setting_key: action.setting_key,
      };
      if (action.value_num != null) {
        input.value_num = action.value_num;
      }
      if (action.value_text != null) {
        input.value_text = action.value_text;
      }
      if (action.value_bool != null) {
        input.value_bool = action.value_bool;
      }
      return input;
    }
    case 'action_call_automation':
      return {
        kind: 'action_call_automation',
        target_automation_id: action.target_automation_id,
      };
  }
}

function automationToForm(automation: AutomationFull): FormState {
  return {
    name: automation.name,
    description: automation.description ?? '',
    vehicle_id: automation.vehicle_id,
    enabled: automation.enabled,
    triggers: automation.triggers.map(normalizeTriggerInput),
    conditions: automation.conditions.map(normalizeConditionInput),
    actions: automation.actions.map(normalizeActionInput),
  };
}

function formToPayload(form: FormState): AutomationFullInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    vehicle_id: form.vehicle_id,
    enabled: form.enabled,
    triggers: form.triggers.map(normalizeTriggerInput),
    conditions: form.conditions.map(normalizeConditionInput),
    actions: form.actions.map(normalizeActionInput),
  };
}

function triggerNeedsPlace(trigger: AutomationTriggerStepInput): boolean {
  return trigger.kind === 'trigger_geofence' && trigger.place_id <= 0;
}

function conditionNeedsPlace(condition: AutomationConditionStepInput): boolean {
  return condition.kind === 'condition_geofence' && condition.place_id <= 0;
}

function actionIsIncomplete(action: AutomationActionStepInput): boolean {
  switch (action.kind) {
    case 'action_command':
      return action.command_name.trim() === '';
    case 'action_notify':
      return action.channel_id <= 0 || action.template.trim() === '';
    case 'action_set_setting':
      return (
        action.setting_key.trim() === '' ||
        [action.value_text, action.value_num, action.value_bool].filter(
          value => value != null,
        ).length !== 1
      );
    case 'action_call_automation':
      return action.target_automation_id <= 0;
  }
}

/* ================================================================== */
/*  AutomationBuilderPage                                             */
/* ================================================================== */

export interface AutomationBuilderPageProps {
  // react-router-dom useParams() `:id` stand-in (edit mode when present).
  id?: string;
  // react-router-dom useSearchParams() `?preset=` stand-in (preset-install mode).
  presetId?: string;
  // react-router-dom useNavigate() stand-in; receives the same path strings the
  // web navigate() is called with (e.g. '/automations').
  onNavigate?: (to: string) => void;
}

export default function AutomationBuilderPage({
  id,
  presetId,
  onNavigate,
}: AutomationBuilderPageProps = {}): React.ReactElement {
  const {t} = useTranslation();
  const navigate = useCallback(
    (to: string) => onNavigate?.(to),
    [onNavigate],
  );
  const isEdit = id != null;
  const automationId = id ? Number.parseInt(id, 10) : undefined;

  // Per-automation edit lease so a second tab editing the SAME automation
  // surfaces a conflict banner. New-automation drafts are scoped per-preset (or
  // "new"). (Native: no cross-tab surface; lease + banner are no-ops.)
  const leaseKey = isEdit
    ? `automation/${automationId ?? 'unknown'}`
    : presetId
      ? `automation/preset/${presetId}`
      : 'automation/new';
  useEditLease(leaseKey);
  const {vehicleId: aiVehicleId} = useSelectedVehicle();

  usePageTitle(
    isEdit
      ? t('automations.builder.editTitle', 'Edit Automation')
      : presetId
        ? t('automations.builder.presetTitle', 'Install Preset')
        : t('automations.builder.createTitle', 'Create Automation'),
  );

  const {
    data: existingAutomation,
    isLoading: isLoadingAutomation,
    error: loadError,
  } = useAutomation(automationId);
  const {data: vehicles} = useVehicles();
  const {data: channels} = useNotificationChannels();
  const {data: preset} = useAutomationPreset(presetId);

  const createMutation = useCreateAutomationFull();
  const updateMutation = useUpdateAutomationFull();
  const testRunMutation = useTestRunAutomation();

  // `useFormDraft` autosaves the in-progress automation. Scoped per-automation
  // (or "new"/"preset:X"). (Native: in-memory only; never restores a draft.)
  const draftKey = isEdit
    ? `automation:edit:${automationId ?? 'unknown'}`
    : presetId
      ? `automation:preset:${presetId}`
      : 'automation:new';

  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicts, setConflicts] = useState<AutomationConflict[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const createMutation_isPendingRef = useRef(createMutation.isPending);
  createMutation_isPendingRef.current = createMutation.isPending;
  const updateMutation_isPendingRef = useRef(updateMutation.isPending);
  updateMutation_isPendingRef.current = updateMutation.isPending;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;

  const {
    value: form,
    setValue: setFormValue,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<FormState>(draftKey, getInitialForm(), {
    version: 1,
    debounceMs: 1500,
    skipPersist: () =>
      createMutation_isPendingRef.current ||
      updateMutation_isPendingRef.current ||
      !hydratedRef.current ||
      !dirtyRef.current,
  });

  // For edits and preset installs, the canonical source of truth is the server
  // payload / preset definition — drop any restored draft as soon as we know the
  // real source data.
  useEffect(() => {
    if (isEdit && existingAutomation && !hydrated) {
      discardDraft();
      setFormValue(automationToForm(existingAutomation));
      setConflicts([]);
      setHydrated(true);
    }
  }, [discardDraft, existingAutomation, hydrated, isEdit, setFormValue]);

  useEffect(() => {
    if (!isEdit && preset && !hydrated) {
      discardDraft();
      setFormValue({
        name: preset.name,
        description: preset.description,
        vehicle_id: null,
        enabled: true,
        triggers: preset.triggers.map(trigger =>
          normalizeTriggerInput(trigger as AutomationTriggerStepInput),
        ),
        conditions: (preset.conditions ?? []).map(condition =>
          normalizeConditionInput(condition as AutomationConditionStepInput),
        ),
        actions: preset.actions.map(action =>
          normalizeActionInput(action as AutomationActionStepInput),
        ),
      });
      setHydrated(true);
    }
  }, [discardDraft, hydrated, isEdit, preset, setFormValue]);

  // For brand-new automations, mark hydrated immediately so edits autosave. If a
  // draft was restored, surface the dirty flag. (Native: hasDraft is always false.)
  useEffect(() => {
    if (isEdit || presetId || hydrated) {
      return;
    }
    if (hasDraft) {
      setDirty(true);
    }
    setHydrated(true);
  }, [hasDraft, hydrated, isEdit, presetId]);

  useEffect(() => {
    setHydrated(false);
  }, [automationId, presetId]);

  const dirtyForm = useDirtyForm(dirty);
  useNavigationGuard(dirty, t('forms.unsavedAutomation', 'You have an unsaved automation.'));
  const {confirm: confirmDiscard, dialogProps: discardDialogProps} = useConfirm();

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const vehicleOptions = useMemo(() => {
    const options = (vehicles ?? []).map(vehicle => ({
      value: String(vehicle.id),
      label:
        vehicle.display_name ||
        t('automations.builder.vehicleFallback', 'Vehicle {{id}}', {
          id: vehicle.id,
        }),
    }));
    return [
      {value: '', label: t('automations.builder.allVehicles', 'All Vehicles')},
      ...options,
    ];
  }, [t, vehicles]);

  const triggerOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectTrigger', 'Select trigger type...')},
      ...TRIGGER_TYPES.map(trigger => ({
        value: trigger.value,
        label: t(trigger.labelKey, trigger.fallback),
      })),
    ],
    [t],
  );

  const selectedTrigger = form.triggers[0] ?? null;
  const notificationChannels = channels ?? [];

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setFormValue(previous => ({...previous, [key]: value}));
      setDirty(true);
    },
    [setFormValue],
  );

  const handleTriggerKindChange = useCallback(
    (nextKind: string) => {
      update(
        'triggers',
        nextKind ? [createDefaultTrigger(nextKind as AutomationTriggerKind)] : [],
      );
    },
    [update],
  );

  const validate = useCallback((): string | null => {
    if (!form.name.trim()) {
      return t('automations.builder.errorName', 'Name is required');
    }
    if (form.triggers.length === 0) {
      return t('automations.builder.errorTrigger', 'Trigger type is required');
    }
    if (form.triggers.some(triggerNeedsPlace)) {
      return t('automations.builder.errorTriggerPlace', 'Select a geofence for the trigger');
    }
    if (form.conditions.some(conditionNeedsPlace)) {
      return t(
        'automations.builder.errorConditionPlace',
        'Select a geofence for each geofence condition',
      );
    }
    if (form.actions.length === 0) {
      return t('automations.builder.errorActions', 'At least one action is required');
    }
    if (form.actions.some(actionIsIncomplete)) {
      return t('automations.builder.errorActionDetails', 'Complete every action before saving');
    }
    return null;
  }, [form, t]);

  const handleSave = useCallback(async () => {
    const error = validate();
    if (error) {
      setSaveError(error);
      return;
    }
    setSaveError(null);

    try {
      const payload = formToPayload(form);
      const result =
        isEdit && automationId
          ? await updateMutation.mutateAsync({id: automationId, input: payload})
          : await createMutation.mutateAsync(payload);
      setDirty(false);
      setSavedId(result.id);
      setConflicts([]);
      discardDraft();
      navigate('/automations');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [automationId, createMutation, discardDraft, form, isEdit, navigate, updateMutation, validate]);

  const handleBackToList = useCallback(async () => {
    if (dirty) {
      const ok = await confirmDiscard({
        title: dirtyForm.title,
        message: dirtyForm.message,
        variant: 'warning',
        confirmLabel: dirtyForm.discardLabel,
        cancelLabel: dirtyForm.keepEditingLabel,
        silenceKey: 'discard-draft',
      });
      if (!ok) {
        return;
      }
    }
    navigate('/automations');
  }, [
    dirty,
    confirmDiscard,
    dirtyForm.title,
    dirtyForm.message,
    dirtyForm.discardLabel,
    dirtyForm.keepEditingLabel,
    navigate,
  ]);

  const handleTestRun = useCallback(() => {
    const targetId = savedId ?? automationId;
    if (targetId) {
      testRunMutation.mutate(targetId);
    }
  }, [automationId, savedId, testRunMutation]);

  if (isEdit && isLoadingAutomation) {
    return (
      <PageContainer loading title={t('automations.builder.editTitle', 'Edit Automation')}>
        <View />
      </PageContainer>
    );
  }

  if (isEdit && loadError) {
    return (
      <PageContainer
        error={loadError instanceof Error ? loadError : new Error(String(loadError))}
        title={t('automations.builder.editTitle', 'Edit Automation')}>
        <View />
      </PageContainer>
    );
  }

  if (isEdit && !existingAutomation && !isLoadingAutomation) {
    return (
      <PageContainer title={t('automations.builder.editTitle', 'Edit Automation')}>
        <EmptyState
          icon={<Glyph char={GLYPHS.alert} tone="primary" />}
          message={t('automations.builder.notFound', 'Automation not found')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      subtitle={t(
        'automations.builder.subtitle',
        'Configure supported typed triggers, conditions, and actions for your automation.',
      )}
      title={
        isEdit
          ? t('automations.builder.editTitle', 'Edit Automation')
          : t('automations.builder.createTitle', 'Create Automation')
      }>
      <View style={styles.formStack}>
        <View style={styles.backRow}>
          <Button
            icon={<Glyph char={GLYPHS.back} />}
            onPress={handleBackToList}
            size="sm"
            variant="ghost">
            {t('automations.builder.backToList', 'Back to Automations')}
          </Button>
        </View>

        <EditConflictBanner
          resourceKey={leaseKey}
          resourceLabel={t('editConflict.resource.automation', 'This automation')}
        />

        {hasDraft && !isEdit && !presetId ? (
          <DraftRecoveryBanner
            draftSavedAt={draftSavedAt}
            hasDraft={hasDraft}
            itemNoun={t('draft.noun.automation', 'Automation')}
            onDiscard={() => {
              discardDraft();
              setDirty(false);
            }}
          />
        ) : null}

        <FadeIn>
          <AINLAutomationBuilder vehicleId={aiVehicleId ?? undefined} />
        </FadeIn>

        <FadeIn>
          <AIGeofenceAwareAutomationSuggestions
            onApplyDraft={proposedDraft => {
              // Copy the typed Automation graph proposed by the AI panel into the
              // canonical form state. Re-uses the per-step normalizers so the typed
              // envelope is byte-equivalent to one the POST /api/v1/automations
              // handler accepts.
              setFormValue(previous => ({
                ...previous,
                name: proposedDraft.name,
                description: proposedDraft.description ?? '',
                vehicle_id: proposedDraft.vehicle_id ?? null,
                enabled: proposedDraft.enabled ?? true,
                triggers: (
                  proposedDraft.triggers as unknown as AutomationTriggerStepInput[]
                ).map(normalizeTriggerInput),
                conditions: (
                  proposedDraft.conditions as unknown as AutomationConditionStepInput[]
                ).map(normalizeConditionInput),
                actions: (
                  proposedDraft.actions as unknown as AutomationActionStepInput[]
                ).map(normalizeActionInput),
              }));
              setDirty(true);
            }}
            vehicleId={aiVehicleId ?? undefined}
          />
        </FadeIn>

        <FadeIn>
          <FormSection title={t('automations.builder.general', 'General')}>
            <Input
              label={t('automations.builder.name', 'Name')}
              onChangeText={next => update('name', next)}
              placeholder={t('automations.builder.namePlaceholder', 'Morning Commute Prep')}
              required
              value={form.name}
            />
            <Textarea
              label={t('automations.builder.description', 'Description')}
              onChangeText={next => update('description', next)}
              placeholder={t(
                'automations.builder.descriptionPlaceholder',
                'Prepare the car for the morning commute',
              )}
              rows={2}
              value={form.description}
            />
            <Select
              label={t('automations.builder.vehicle', 'Vehicle')}
              onChange={next => update('vehicle_id', next ? Number(next) : null)}
              options={vehicleOptions}
              value={form.vehicle_id != null ? String(form.vehicle_id) : ''}
            />
            <Toggle
              checked={form.enabled}
              label={t('automations.builder.enabled', 'Enabled')}
              onChange={enabled => update('enabled', enabled)}
            />
          </FormSection>
        </FadeIn>

        <FadeIn delay={0.05}>
          <FormSection
            description={t(
              'automations.builder.whenDesc',
              'Choose the supported typed contract that starts this automation.',
            )}
            title={t('automations.builder.when', 'When (Trigger)')}>
            <Select
              label={t('automations.builder.triggerType', 'Trigger Type')}
              onChange={handleTriggerKindChange}
              options={triggerOptions}
              value={selectedTrigger?.kind ?? ''}
            />
            {selectedTrigger ? (
              <GlassPanel style={styles.nestedPanel}>
                <TriggerConfigurator
                  onChange={trigger => update('triggers', [trigger])}
                  trigger={selectedTrigger}
                />
              </GlassPanel>
            ) : (
              <GlassPanel style={styles.nestedPanel}>
                <EmptyState
                  message={t(
                    'automations.builder.emptyTrigger',
                    'Select a supported trigger type to configure when this automation starts.',
                  )}
                />
              </GlassPanel>
            )}
          </FormSection>
        </FadeIn>

        <FadeIn delay={0.1}>
          <FormSection
            description={t(
              'automations.builder.onlyIfDesc',
              'Optional checks that must pass before actions run.',
            )}
            title={t('automations.builder.onlyIf', 'Only If (Conditions)')}>
            <ConditionBuilder
              conditions={form.conditions}
              onChange={conditions => update('conditions', conditions)}
            />
          </FormSection>
        </FadeIn>

        <FadeIn delay={0.15}>
          <FormSection
            description={t('automations.builder.thenDesc', 'Actions are executed in order.')}
            title={t('automations.builder.then', 'Then (Actions)')}>
            <ActionBuilder
              actions={form.actions}
              channels={notificationChannels}
              onChange={actions => update('actions', actions)}
            />
          </FormSection>
        </FadeIn>

        {conflicts.length > 0 ? (
          <FadeIn delay={0.2}>
            <ConflictWarnings conflicts={conflicts} />
          </FadeIn>
        ) : null}

        {saveError ? (
          <AlertBanner
            icon={<Glyph char={GLYPHS.alert} tone="danger" />}
            title={t('automations.builder.saveError', 'Save Error')}
            variant="danger">
            {saveError}
          </AlertBanner>
        ) : null}

        <FadeIn delay={0.25}>
          <View style={styles.actionRow}>
            <Button
              disabled={isSaving}
              icon={<Glyph char={GLYPHS.save} tone="accent" />}
              loading={isSaving}
              onPress={handleSave}>
              {isEdit
                ? t('automations.builder.save', 'Save')
                : t('automations.builder.create', 'Create')}
            </Button>
            {savedId ?? automationId ? (
              <Button
                disabled={testRunMutation.isPending}
                icon={<Glyph char={GLYPHS.play} tone="success" />}
                loading={testRunMutation.isPending}
                onPress={handleTestRun}
                variant="secondary">
                {t('automations.builder.testRun', 'Test Run')}
              </Button>
            ) : null}
            <Button
              icon={<Glyph char={GLYPHS.close} />}
              onPress={handleBackToList}
              variant="ghost">
              {t('automations.builder.cancel', 'Cancel')}
            </Button>

            {testRunMutation.isSuccess ? (
              <View style={styles.testRunStarted}>
                <Glyph char={GLYPHS.zap} tone="success" />
                <AppText style={styles.testRunStartedText} variant="caption">
                  {t('automations.builder.testRunStarted', 'Test run started!')}
                </AppText>
              </View>
            ) : null}
          </View>
        </FadeIn>

        {!isEdit ? (
          <FadeIn delay={0.3}>
            <GlassPanel style={styles.presetHint}>
              <AppText style={styles.presetHintText} tone="secondary" variant="caption">
                {t(
                  'automations.builder.presetHint',
                  'Not sure where to start? Browse typed automation templates.',
                )}
              </AppText>
            </GlassPanel>
          </FadeIn>
        ) : null}
      </View>
      {discardDialogProps ? <ConfirmDialog {...discardDialogProps} /> : null}
    </PageContainer>
  );
}

/* ================================================================== */
/*  Styles                                                           */
/* ================================================================== */

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  backRow: {
    alignItems: 'flex-start',
  },
  btn: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnIconOnly: {
    paddingHorizontal: spacing.sm,
  },
  btnIconWrap: {
    marginRight: spacing.sm,
  },
  btnMd: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnSm: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  btnText: {
    fontSize: 13,
    lineHeight: 18,
  },
  dayChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  dayChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  dayChipText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  dayChipTextActive: {
    color: colors.accent,
    fontSize: 11,
  },
  daysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  field: {
    gap: spacing.xs,
  },
  fieldError: {
    marginTop: 2,
  },
  fieldHint: {
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  formSection: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  formSectionBody: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  formStack: {
    gap: spacing.lg,
    maxWidth: 720,
    width: '100%',
  },
  glyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  inputFocused: {
    borderColor: colors.borderAccent,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  modalMessage: {
    marginTop: spacing.sm,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  modalTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  nestedPanel: {
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionDisabled: {
    opacity: 0.4,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 13,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.lg,
  },
  pageErrorText: {
    color: colors.danger,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageLoading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  pageSubtitle: {
    fontSize: 14,
  },
  pageTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  presetHint: {
    alignItems: 'center',
    padding: spacing.md,
  },
  presetHintText: {
    textAlign: 'center',
  },
  sectionDescription: {
    lineHeight: 18,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  stack2: {
    gap: spacing.sm,
  },
  stack3: {
    gap: spacing.md,
  },
  stack4: {
    gap: spacing.md,
  },
  stepBody: {
    flex: 1,
    gap: spacing.sm,
  },
  stepCard: {
    padding: spacing.md,
  },
  stepControls: {
    gap: spacing.xs,
  },
  stepIndex: {
    fontFamily: 'monospace',
    marginTop: spacing.sm,
    width: 22,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  testRunStarted: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  testRunStartedText: {
    color: colors.success,
    fontSize: 13,
  },
  textarea: {
    paddingTop: spacing.sm,
  },
  toggleLabel: {
    fontSize: 13,
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
    backgroundColor: colors.surfaceRaised,
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

