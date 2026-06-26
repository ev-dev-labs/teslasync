// Native parity port of web/src/features/notifications/pages/AlertStudioPage.tsx.
//
// AlertStudio is the typed alert-rule editor page: it lists existing rules,
// offers 40+ curated templates, and persists through /api/v1/alerts/rules using
// the current AlertRuleInput contract (signal-threshold OR computed-metric kind,
// trigger-mode force-choose, repeat-mode max-fires + escalation, per-rule message
// template + include_title, multi-vehicle targeting, snooze, bulk enable/disable,
// and the opt-in AI builder / tuning / conflict panels).
//
// Every web dependency that is DOM-only, i18next, zod, lucide-react, recharts,
// leaflet, framer-motion, or a web UI component is rebuilt here on React Native
// primitives + the repo native tokens/components, mirroring the sibling native
// ports (AlertCard, PowersharePage). Already-converted native modules are reused
// verbatim: the three AI sections, BulkActionsToolbar, DraftRecoveryBanner, the
// native Modal, GlassPanel, AppText, SemanticIcon, and every useNotifications /
// useVehicles / useAlertMessageHelpers hook (identical shapes the web imported).
//
// Native-safe adaptations (documented in the sidecar):
//   * react-i18next useTranslation -> useNativeTranslation: t(key, fallback?, vars?)
//     with {{var}} interpolation. Every translation key + fallback + interpolation
//     var is forwarded exactly as the source called it.
//   * usePageTitle -> useNativePageTitle no-op (no document.title on native).
//   * useConfirm -> useNativeConfirm (promise-based, backed by an inline Modal
//     ConfirmDialog) preserving { confirm, dialogProps }.
//   * useDirtyForm / useNavigationGuard -> no-ops (browser beforeunload + router
//     guards have no native analog; the in-app discard guard still runs via the
//     useNativeConfirm discard dialog in guardSwitch).
//   * useFormDraft (localStorage persistence) -> useNativeFormDraft (in-memory;
//     hasDraft=false, draftSavedAt=null). The page's pendingHydration ref + effect
//     keep working; the DraftRecoveryBanner simply never appears on native.
//   * useUrlString -> useNativeUrlString (useState; no query string on native).
//   * useSelectedVehicle (global store + URL) -> first fleet vehicle.
//   * zod alertRuleSchema -> alertRuleSchema.safeParse hand-port returning the same
//     { success, error.issues[].message } shape, mirroring the superRefine logic.
//   * @/lib/cn -> StyleSheet; @/lib/tokens severityTokens -> inline native color
//     maps; @/lib/dateFormat formatDateTime -> inline native formatter;
//     @/lib/icons Icons.* -> SemanticIcon glyph stand-ins.
//   * @/components/ui (Button/Badge/Input/Select/Modal/Toggle/HelpIcon/GlassPanel/
//     ConfirmDialog), @/components/data-display (SeverityBadge/SeverityIcon),
//     @/components/layout PageContainer, @/components/motion FadeIn,
//     @/components/feedback (AlertBanner/EmptyState/ErrorDisplay/Skeleton),
//     @/components/forms (SearchInput/VehicleMultiSelect + hydrateVehicleSelection/
//     buildVehiclePayload), ../components/ComputedMetricEditor + AlertMessageEditor
//     -> reimplemented inline on RN primitives + tokens.
//
// No DOM, no react-router-dom, no react-i18next, no zod, no lucide-react, no
// Recharts, no Leaflet, no framer-motion, and no web UI components are imported.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { Modal } from '../../../components/ui/Modal';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import { DraftRecoveryBanner } from '../../../components/feedback/DraftRecoveryBanner';
import { AINLAlertBuilder } from '../../../components/ai/AINLAlertBuilder';
import {
  AIAlertTuningSuggestions,
  type AlertRuleDraftPatch,
} from '../../../components/ai/AIAlertTuningSuggestions';
import { AICrossRuleConflictDetection } from '../../../components/ai/AICrossRuleConflictDetection';
import {
  useAlertMetrics,
  useAlertRules,
  useBulkDisableRules,
  useBulkEnableRules,
  useDeleteAlertRule,
  useNotificationChannels,
  usePreviewComputedMetric,
  useSaveAlertRule,
  useSnoozeAlertRule,
  useTestAlertRule,
  useToggleAlertRule,
  type AlertRule,
  type AlertRuleInput,
  type AlertRuleKind,
  type AlertRuleTriggerMode,
  type AlertTestTarget,
  type ComputedMetricOp,
  type ComputedMetricSummary,
  type NotificationChannel,
} from '../../../api/hooks/useNotifications';
import { useVehicles, type Vehicle } from '../../../api/hooks/useVehicles';
import {
  useAlertMessagePlaceholders,
  useAlertMessagePresets,
  useAlertMessagePreview,
  type AlertMessagePlaceholder,
  type AlertMessagePreset,
  type AlertMessagePreviewResponse,
} from '../../../api/hooks/useAlertMessageHelpers';

/* ------------------------------------------------------------------ */
/*  Native-safe replacements for unported web infrastructure           */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback?: string, vars?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

// react-i18next useTranslation port: returns the English fallback (i18next is not
// a native dependency) with {{var}} interpolation, preserving every key/fallback.
function useNativeTranslation(): { t: NativeTFunction } {
  const t = useCallback<NativeTFunction>(
    (key, fallback, vars) => interpolate(fallback ?? key, vars),
    [],
  );
  return { t };
}

// usePageTitle swap: document.title has no native equivalent — intentional no-op.
function useNativePageTitle(_title: string): void {
  // No-op on native (parity for the web usePageTitle document.title side effect).
}

// useDirtyForm / useNavigationGuard rely on the browser beforeunload event and
// the web router; neither exists in native. The in-app discard guard still runs
// through useNativeConfirm inside guardSwitch.
function useNativeDirtyForm(_dirty: boolean): void {}
function useNativeNavigationGuard(_dirty: boolean, _message: string): void {}

// useUrlString port: native has no query string, so the value lives in component
// state for the lifetime of the screen.
function useNativeUrlString(
  _key: string,
  initial: string,
): [string, (next: string) => void] {
  const [value, setValue] = useState(initial);
  return [value, setValue];
}

// useFormDraft port: the web hook persists in-progress new-rule editing to
// localStorage. Native has no localStorage, so this is an in-memory store with
// the same { value, setValue, hasDraft, draftSavedAt, discardDraft } contract;
// hasDraft stays false (the DraftRecoveryBanner never surfaces on native).
interface NativeFormDraft<T> {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  hasDraft: boolean;
  draftSavedAt: Date | null;
  discardDraft: () => void;
}

function useNativeFormDraft<T>(
  _key: string,
  initial: T,
  _options?: unknown,
): NativeFormDraft<T> {
  const [value, setValue] = useState<T>(initial);
  const discardDraft = useCallback(() => {}, []);
  return { value, setValue, hasDraft: false, draftSavedAt: null, discardDraft };
}

// useConfirm port: a promise-based confirm backed by the inline Modal
// ConfirmDialog. Preserves the web { confirm, dialogProps } surface.
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  silenceKey?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

function useNativeConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialogProps: ConfirmDialogProps | null;
} {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        setState({ ...opts, resolve });
      }),
    [],
  );
  const onConfirm = useCallback(() => {
    setState(s => {
      s?.resolve(true);
      return null;
    });
  }, []);
  const onCancel = useCallback(() => {
    setState(s => {
      s?.resolve(false);
      return null;
    });
  }, []);
  const dialogProps: ConfirmDialogProps | null = state
    ? { ...state, open: true, onConfirm, onCancel }
    : null;
  return { confirm, dialogProps };
}

// useSelectedVehicle port: the web hook reads a global store + URL scope. Native
// parity defaults to the first fleet vehicle (the EnergyPage/PowersharePage
// pattern); the AI panels only need a representative vehicle id.
function useNativeSelectedVehicle(vehicles: Vehicle[]): {
  vehicleId: number | null;
} {
  const vehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  return { vehicleId };
}

// @/lib/dateFormat formatDateTime port.
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

// @/lib/icons Icons.* glyph stand-in (mirrors the AlertCard port).
function glyphFor(name: SemanticIconName): string {
  return getSemanticIconDefinition(name).glyph;
}

/* ------------------------------------------------------------------ */
/*  Native UI primitives (web @/components/* parity)                   */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'info' | 'warning' | 'neutral' | 'success' | 'danger';
type SeverityLevel = 'info' | 'warn' | 'critical';

const severityColors: Record<
  SeverityLevel,
  { surface: string; border: string; fg: string }
> = {
  info: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    fg: colors.accent,
  },
  warn: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  critical: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
};

const SEVERITY_ICON: Record<SeverityLevel, SemanticIconName> = {
  info: 'info',
  warn: 'severityWarn',
  critical: 'severityCritical',
};

const badgeColors: Record<
  BadgeVariant,
  { surface: string; border: string; fg: string }
> = {
  info: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    fg: colors.accent,
  },
  warning: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  neutral: {
    surface: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textSecondary,
  },
  success: {
    surface: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  danger: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
};

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  const c = badgeColors[variant];
  return (
    <View
      style={[s.badge, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      {typeof children === 'string' ? (
        <AppText style={[s.badgeText, { color: c.fg }]} weight="semibold">
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

function Button({
  children,
  onClick,
  variant = 'secondary',
  icon,
  disabled,
  loading,
  accessibilityLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      disabled={isDisabled}
      onPress={onClick}
      style={({ pressed }) => [
        s.btn,
        buttonVariantStyles[variant],
        isDisabled && s.btnDisabled,
        pressed && !isDisabled && s.btnPressed,
      ]}
    >
      {icon ? <View style={s.btnIcon}>{icon}</View> : null}
      <AppText style={[s.btnText, buttonTextStyles[variant]]} weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

function IconButton({
  glyph,
  tone = colors.textMuted,
  onPress,
  accessibilityLabel,
}: {
  glyph: string;
  tone?: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && s.btnPressed]}
    >
      <AppText style={[s.iconButtonGlyph, { color: tone }]} weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
}

function Chip({
  active,
  onPress,
  children,
  glyph,
}: {
  active?: boolean;
  onPress: () => void;
  children: string;
  glyph?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        active && s.chipActive,
        pressed && s.btnPressed,
      ]}
    >
      {glyph ? (
        <AppText style={[s.chipText, active && s.chipTextActive]} weight="bold">
          {glyph}
        </AppText>
      ) : null}
      <AppText
        style={[s.chipText, active && s.chipTextActive]}
        weight="semibold"
      >
        {children}
      </AppText>
    </Pressable>
  );
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <View style={s.labelRow}>
      <AppText style={s.fieldLabel} weight="semibold">
        {label}
      </AppText>
      {help ? <HelpIcon content={help} /> : null}
    </View>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <View style={s.field}>
      <FieldLabel label={label} help={help} />
      {children}
    </View>
  );
}

// HelpIcon: the web hover tooltip has no native analog; the help copy is exposed
// to assistive tech via accessibilityLabel on a small "?" affordance.
function HelpIcon({
  content,
}: {
  content: string;
  i18nKey?: string;
  htmlFor?: string;
}) {
  return (
    <View
      accessibilityLabel={content}
      accessibilityRole="image"
      style={s.helpIcon}
    >
      <AppText style={s.helpIconText} weight="bold">
        ?
      </AppText>
    </View>
  );
}

type FieldChangeEvent = { target: { value: string } };

function NativeInput({
  value,
  onChange,
  type,
  placeholder,
  disabled,
  accessibilityLabel,
}: {
  value: string | number;
  onChange: (e: FieldChangeEvent) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      editable={!disabled}
      keyboardType={type === 'number' ? 'numeric' : 'default'}
      onChangeText={text => onChange({ target: { value: text } })}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={[s.input, disabled && s.inputDisabled]}
      value={value == null ? '' : String(value)}
    />
  );
}

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Native <select> port: a Pressable trigger that opens a Modal option list. The
// onChange contract mirrors the web change event ({ target: { value } }) so the
// page's handlers stay identical.
function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  accessibilityLabel,
}: {
  value: string;
  onChange: (e: FieldChangeEvent) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const triggerLabel = selected ? selected.label : placeholder ?? '';
  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.select,
          disabled && s.inputDisabled,
          pressed && !disabled && s.btnPressed,
        ]}
      >
        <AppText
          numberOfLines={1}
          style={[s.selectText, !selected && s.selectPlaceholder]}
        >
          {triggerLabel}
        </AppText>
        <AppText style={s.selectChevron}>{glyphFor('expand')}</AppText>
      </Pressable>
      <Modal
        onClose={() => setOpen(false)}
        open={open}
        size="sm"
        title={placeholder ?? accessibilityLabel ?? 'Select'}
      >
        <ScrollView style={s.selectMenu}>
          {options.map(option => {
            const isActive = option.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: isActive,
                  disabled: !!option.disabled,
                }}
                disabled={option.disabled}
                key={`${option.value}-${option.label}`}
                onPress={() => {
                  onChange({ target: { value: option.value } });
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  s.selectOption,
                  isActive && s.selectOptionActive,
                  pressed && s.btnPressed,
                ]}
              >
                <AppText
                  style={[
                    s.selectOptionText,
                    option.disabled && s.selectPlaceholder,
                    isActive && s.selectOptionTextActive,
                  ]}
                >
                  {option.label}
                </AppText>
                {isActive ? (
                  <AppText style={s.selectOptionCheck} weight="bold">
                    {glyphFor('confirm')}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
    </>
  );
}

function NativeToggle({
  checked,
  onChange,
  disabled,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[s.toggle, checked && s.toggleOn, disabled && s.inputDisabled]}
    >
      <View style={[s.toggleKnob, checked && s.toggleKnobOn]} />
    </Pressable>
  );
}

function NativeCheckbox({
  checked,
  onChange,
  accessibilityLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      style={[s.checkbox, checked && s.checkboxOn]}
    >
      {checked ? (
        <AppText style={s.checkboxMark} weight="bold">
          {glyphFor('confirm')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={s.searchInput}>
      <AppText style={s.searchGlyph} tone="muted" weight="bold">
        {glyphFor('search')}
      </AppText>
      <TextInput
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={s.searchField}
        value={value}
      />
    </View>
  );
}

function SeverityBadge({
  severity,
  children,
}: {
  severity: SeverityLevel;
  children: ReactNode;
}) {
  const c = severityColors[severity];
  return (
    <View
      style={[s.badge, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <AppText style={[s.badgeText, { color: c.fg }]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

function SeverityIcon({ severity }: { severity: SeverityLevel }) {
  const c = severityColors[severity];
  return (
    <AppText style={[s.severityIcon, { color: c.fg }]} weight="bold">
      {glyphFor(SEVERITY_ICON[severity])}
    </AppText>
  );
}

function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
}) {
  return (
    <View style={s.emptyState}>
      {icon ? <View style={s.emptyIcon}>{icon}</View> : null}
      <AppText style={s.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={s.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

function AlertBanner({
  variant = 'info',
  title,
  children,
}: {
  variant?: 'info' | 'danger';
  title?: string;
  children?: ReactNode;
}) {
  const c = variant === 'danger' ? badgeColors.danger : badgeColors.info;
  return (
    <View
      style={[
        s.alertBanner,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      {title ? (
        <AppText
          style={[s.alertBannerTitle, { color: c.fg }]}
          weight="semibold"
        >
          {title}
        </AppText>
      ) : null}
      {typeof children === 'string' ? (
        <AppText style={[s.alertBannerBody, { color: c.fg }]}>
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

function ErrorDisplay({
  error,
  compact,
}: {
  error: unknown;
  compact?: boolean;
}) {
  const message =
    error instanceof Error ? error.message : error ? String(error) : 'Error';
  return (
    <View style={[s.errorDisplay, compact && s.errorDisplayCompact]}>
      <AppText style={s.errorDisplayText} tone="danger">
        {message}
      </AppText>
    </View>
  );
}

function Skeleton({
  height = 16,
  width,
}: {
  height?: number;
  width?: number | string;
}) {
  return (
    <View
      style={[
        s.skeleton,
        { height, width: (width ?? '100%') as ViewStyle['width'] },
      ]}
    />
  );
}

// framer-motion FadeIn -> static View (web reduced-motion final state). The
// `delay` prop is accepted for source parity and ignored.
function FadeIn({ children }: { children: ReactNode; delay?: number }) {
  return <View>{children}</View>;
}

function PageContainerView({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: unknown;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.pageHeader}>
        <View style={s.pageHeaderText}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={s.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={s.pageActions}>{actions}</View> : null}
      </View>
      {loading ? <Skeleton height={4} /> : null}
      {error ? <ErrorDisplay error={error} /> : null}
      {children}
    </ScrollView>
  );
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal onClose={onCancel} open={open} size="sm" title={title}>
      <View style={s.dialogBody}>
        <AppText tone="secondary">{message}</AppText>
        <View style={s.dialogActions}>
          <Button onClick={onCancel} variant="ghost">
            {cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            loading={loading}
            onClick={onConfirm}
            variant={variant === 'danger' ? 'danger' : 'primary'}
          >
            {confirmLabel ?? 'Confirm'}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Ported domain logic (faithful to the web source)                   */
/* ------------------------------------------------------------------ */

type SignalValueType = 'numeric' | 'text' | 'bool';

// Editor-only tri-state. Backend column stays strict ('once' | 'repeat');
// 'unset' exists purely so a brand-new rule can be in the "user hasn't decided
// yet" state and the Save button can block until they do (Decision D3).
type TriggerModeOrUnset = AlertRuleTriggerMode | 'unset';

type Severity = NonNullable<AlertRuleInput['severity']>;
type RuleOp = NonNullable<AlertRuleInput['op']>;
type ValueKind = 'none' | 'number' | 'text' | 'bool' | 'range';

interface RuleTemplate {
  name: string;
  icon: SemanticIconName;
  category: string;
  severity: Severity;
  message: string;
  cooldown_min: number;
  signal_name: string;
  op: RuleOp;
  value_num?: number;
  value_text?: string;
  value_bool?: boolean;
  value_min?: number;
  value_max?: number;
}

interface SignalDefinition {
  name: string;
  category: string;
  value_type: SignalValueType;
}

const ruleTemplates: RuleTemplate[] = [
  {
    name: 'Battery Low (< 20%)',
    icon: 'battery',
    category: 'Battery',
    severity: 'warn',
    message: 'Battery at {{BatteryLevel}}%',
    cooldown_min: 30,
    signal_name: 'BatteryLevel',
    op: '<',
    value_num: 20,
  },
  {
    name: 'Battery Critical (< 10%)',
    icon: 'battery',
    category: 'Battery',
    severity: 'critical',
    message: 'Battery critically low at {{BatteryLevel}}%!',
    cooldown_min: 15,
    signal_name: 'BatteryLevel',
    op: '<',
    value_num: 10,
  },
  {
    name: 'Battery Full (>= 90%)',
    icon: 'battery',
    category: 'Battery',
    severity: 'info',
    message: 'Battery reached {{BatteryLevel}}%',
    cooldown_min: 60,
    signal_name: 'BatteryLevel',
    op: '>=',
    value_num: 90,
  },
  {
    name: 'Charge Limit Reached',
    icon: 'battery',
    category: 'Battery',
    severity: 'info',
    message: 'Battery at charge limit {{ChargeLimitSoc}}%',
    cooldown_min: 60,
    signal_name: 'BatteryLevel',
    op: '>=',
    value_num: 80,
  },
  {
    name: 'Range Below 50 km',
    icon: 'battery',
    category: 'Battery',
    severity: 'warn',
    message: 'Range low: {{RatedRange}} km remaining',
    cooldown_min: 30,
    signal_name: 'RatedRange',
    op: '<',
    value_num: 50,
  },

  {
    name: 'Charge Complete',
    icon: 'charging',
    category: 'Charging',
    severity: 'info',
    message: 'Charging complete at {{BatteryLevel}}%',
    cooldown_min: 60,
    signal_name: 'ChargeState',
    op: '=',
    value_text: 'Complete',
  },
  {
    name: 'Charging Started',
    icon: 'charging',
    category: 'Charging',
    severity: 'info',
    message: 'Charging started - {{DetailedChargeState}}',
    cooldown_min: 15,
    signal_name: 'DetailedChargeState',
    op: '=',
    value_text: 'Charging',
  },
  {
    name: 'Charging Stopped Unexpectedly',
    icon: 'charging',
    category: 'Charging',
    severity: 'warn',
    message: 'Charging stopped - {{DetailedChargeState}}',
    cooldown_min: 30,
    signal_name: 'DetailedChargeState',
    op: '=',
    value_text: 'Stopped',
  },
  {
    name: 'Supercharging (DC Fast)',
    icon: 'charging',
    category: 'Charging',
    severity: 'info',
    message: 'Supercharging at {{DCChargingPower}} kW',
    cooldown_min: 30,
    signal_name: 'DCChargingPower',
    op: '>',
    value_num: 50,
  },
  {
    name: 'Slow Charge Rate',
    icon: 'charging',
    category: 'Charging',
    severity: 'warn',
    message: 'Charging slow: {{ChargeAmps}}A',
    cooldown_min: 60,
    signal_name: 'ChargeAmps',
    op: 'between',
    value_min: 0.01,
    value_max: 5,
  },

  {
    name: 'Drive Started',
    icon: 'vehicle',
    category: 'Driving',
    severity: 'info',
    message: 'Drive started - gear is {{Gear}}',
    cooldown_min: 5,
    signal_name: 'Gear',
    op: '=',
    value_text: 'D',
  },
  {
    name: 'Drive Ended',
    icon: 'vehicle',
    category: 'Driving',
    severity: 'info',
    message: 'Drive ended - gear is {{Gear}}',
    cooldown_min: 5,
    signal_name: 'Gear',
    op: '=',
    value_text: 'P',
  },
  {
    name: 'Speed Limit Exceeded',
    icon: 'speed',
    category: 'Driving',
    severity: 'warn',
    message: 'Speed {{VehicleSpeed}} km/h exceeded limit',
    cooldown_min: 15,
    signal_name: 'VehicleSpeed',
    op: '>',
    value_num: 120,
  },
  {
    name: 'High Speed Alert (> 160 km/h)',
    icon: 'speed',
    category: 'Driving',
    severity: 'critical',
    message: 'Very high speed: {{VehicleSpeed}} km/h!',
    cooldown_min: 5,
    signal_name: 'VehicleSpeed',
    op: '>',
    value_num: 160,
  },
  {
    name: 'Reverse Gear Engaged',
    icon: 'vehicle',
    category: 'Driving',
    severity: 'info',
    message: 'Vehicle in reverse',
    cooldown_min: 5,
    signal_name: 'Gear',
    op: '=',
    value_text: 'R',
  },
  {
    name: 'Odometer Milestone (100k km)',
    icon: 'vehicle',
    category: 'Driving',
    severity: 'info',
    message: 'Odometer: {{Odometer}} km',
    cooldown_min: 1440,
    signal_name: 'Odometer',
    op: '>',
    value_num: 100000,
  },

  {
    name: 'Car Unlocked While Parked',
    icon: 'locked',
    category: 'Security',
    severity: 'critical',
    message: 'Vehicle is unlocked and parked!',
    cooldown_min: 30,
    signal_name: 'Locked',
    op: '=',
    value_bool: false,
  },
  {
    name: 'Vehicle Locked',
    icon: 'locked',
    category: 'Security',
    severity: 'info',
    message: 'Vehicle locked',
    cooldown_min: 5,
    signal_name: 'Locked',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Vehicle Unlocked',
    icon: 'locked',
    category: 'Security',
    severity: 'info',
    message: 'Vehicle unlocked',
    cooldown_min: 5,
    signal_name: 'Locked',
    op: '=',
    value_bool: false,
  },
  {
    name: 'Sentry Mode Activated',
    icon: 'security',
    category: 'Security',
    severity: 'info',
    message: 'Sentry mode activated',
    cooldown_min: 30,
    signal_name: 'SentryMode',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Door Opened While Parked',
    icon: 'locked',
    category: 'Security',
    severity: 'warn',
    message: 'Door opened - {{DoorState}}',
    cooldown_min: 15,
    signal_name: 'DoorState',
    op: '!=',
    value_text: 'Closed',
  },
  {
    name: 'Window Left Open',
    icon: 'vehicle',
    category: 'Security',
    severity: 'warn',
    message: 'Front driver window is {{FdWindow}}',
    cooldown_min: 60,
    signal_name: 'FdWindow',
    op: '!=',
    value_text: 'Closed',
  },
  {
    name: 'Valet Mode Enabled',
    icon: 'security',
    category: 'Security',
    severity: 'info',
    message: 'Valet mode enabled',
    cooldown_min: 60,
    signal_name: 'ValetModeEnabled',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Guest Mode Enabled',
    icon: 'security',
    category: 'Security',
    severity: 'warn',
    message: 'Guest mode enabled',
    cooldown_min: 60,
    signal_name: 'GuestModeEnabled',
    op: '=',
    value_bool: true,
  },

  {
    name: 'Cabin Overheat (> 40C)',
    icon: 'climate',
    category: 'Climate',
    severity: 'warn',
    message: 'Cabin temp: {{InsideTemp}}C',
    cooldown_min: 30,
    signal_name: 'InsideTemp',
    op: '>',
    value_num: 40,
  },
  {
    name: 'Cabin Freezing (< 0C)',
    icon: 'climate',
    category: 'Climate',
    severity: 'warn',
    message: 'Cabin temp: {{InsideTemp}}C - freezing!',
    cooldown_min: 60,
    signal_name: 'InsideTemp',
    op: '<',
    value_num: 0,
  },
  {
    name: 'HVAC Left On While Parked',
    icon: 'climate',
    category: 'Climate',
    severity: 'info',
    message: 'HVAC running while parked',
    cooldown_min: 30,
    signal_name: 'HvacPower',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Climate Keeper Active',
    icon: 'climate',
    category: 'Climate',
    severity: 'info',
    message: 'Climate keeper: {{ClimateKeeperMode}}',
    cooldown_min: 60,
    signal_name: 'ClimateKeeperMode',
    op: '!=',
    value_text: 'Off',
  },
  {
    name: 'Steering Wheel Heater On',
    icon: 'climate',
    category: 'Climate',
    severity: 'info',
    message: 'Steering wheel heater level {{HvacSteeringWheelHeatLevel}}',
    cooldown_min: 30,
    signal_name: 'HvacSteeringWheelHeatLevel',
    op: '>',
    value_num: 0,
  },

  {
    name: 'Tire Pressure Low',
    icon: 'droplets',
    category: 'Tire Pressure',
    severity: 'warn',
    message: 'Low tire pressure detected',
    cooldown_min: 60,
    signal_name: 'TpmsHardWarnings',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Tire Pressure Soft Warning',
    icon: 'droplets',
    category: 'Tire Pressure',
    severity: 'info',
    message: 'Tire pressure slightly low',
    cooldown_min: 120,
    signal_name: 'TpmsSoftWarnings',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Front Left Tire Low (< 2.2 bar)',
    icon: 'droplets',
    category: 'Tire Pressure',
    severity: 'warn',
    message: 'FL tire: {{TpmsPressureFl}} bar',
    cooldown_min: 60,
    signal_name: 'TpmsPressureFl',
    op: '<',
    value_num: 2.2,
  },

  {
    name: 'Arrived at Home',
    icon: 'vehicle',
    category: 'Location',
    severity: 'info',
    message: 'Vehicle arrived at home',
    cooldown_min: 15,
    signal_name: 'LocatedAtHome',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Left Home',
    icon: 'vehicle',
    category: 'Location',
    severity: 'info',
    message: 'Vehicle left home',
    cooldown_min: 15,
    signal_name: 'LocatedAtHome',
    op: '=',
    value_bool: false,
  },
  {
    name: 'Arrived at Work',
    icon: 'vehicle',
    category: 'Location',
    severity: 'info',
    message: 'Vehicle arrived at work',
    cooldown_min: 15,
    signal_name: 'LocatedAtWork',
    op: '=',
    value_bool: true,
  },
  {
    name: 'Navigation Started',
    icon: 'vehicle',
    category: 'Location',
    severity: 'info',
    message: 'Navigating to {{DestinationName}}',
    cooldown_min: 10,
    signal_name: 'DestinationName',
    op: 'changed',
  },

  {
    name: 'Driver Seatbelt Unbuckled',
    icon: 'security',
    category: 'Safety',
    severity: 'warn',
    message: 'Driver seatbelt unbuckled while driving!',
    cooldown_min: 5,
    signal_name: 'DriverSeatBelt',
    op: '=',
    value_bool: false,
  },
  {
    name: 'Speed Limit Mode Active',
    icon: 'security',
    category: 'Safety',
    severity: 'info',
    message: 'Speed limit mode active',
    cooldown_min: 60,
    signal_name: 'SpeedLimitMode',
    op: '=',
    value_bool: true,
  },
  {
    name: 'PIN to Drive Disabled',
    icon: 'security',
    category: 'Safety',
    severity: 'warn',
    message: 'PIN to Drive has been disabled',
    cooldown_min: 1440,
    signal_name: 'PinToDriveEnabled',
    op: '=',
    value_bool: false,
  },

  {
    name: 'High Motor Temperature (> 80C)',
    icon: 'climate',
    category: 'Motor',
    severity: 'warn',
    message: 'Motor stator temp: {{DiStatorTempF}}C',
    cooldown_min: 15,
    signal_name: 'DiStatorTempF',
    op: '>',
    value_num: 80,
  },
  {
    name: 'HVIL Fault',
    icon: 'security',
    category: 'Motor',
    severity: 'critical',
    message: 'HV interlock fault detected!',
    cooldown_min: 5,
    signal_name: 'Hvil',
    op: '=',
    value_text: 'Fault',
  },
  {
    name: 'High Regenerative Braking',
    icon: 'charging',
    category: 'Motor',
    severity: 'info',
    message: 'Regen power: {{Power}} kW',
    cooldown_min: 15,
    signal_name: 'Power',
    op: '<',
    value_num: -50,
  },

  {
    name: 'Software Update Available',
    icon: 'charging',
    category: 'Software',
    severity: 'info',
    message: 'Update available: {{SoftwareUpdateVersion}}',
    cooldown_min: 1440,
    signal_name: 'SoftwareUpdateVersion',
    op: 'changed',
  },
  {
    name: 'Software Update Installing',
    icon: 'charging',
    category: 'Software',
    severity: 'info',
    message:
      'Installing update: {{SoftwareUpdateInstallationPercentComplete}}%',
    cooldown_min: 30,
    signal_name: 'SoftwareUpdateInstallationPercentComplete',
    op: '>',
    value_num: 0,
  },

  {
    name: 'Music Playing',
    icon: 'vehicle',
    category: 'Media',
    severity: 'info',
    message:
      'Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}',
    cooldown_min: 60,
    signal_name: 'MediaPlaybackStatus',
    op: '=',
    value_text: 'Playing',
  },
  {
    name: 'Volume Too High',
    icon: 'vehicle',
    category: 'Media',
    severity: 'info',
    message: 'Volume at {{MediaAudioVolume}}',
    cooldown_min: 30,
    signal_name: 'MediaAudioVolume',
    op: '>',
    value_num: 8,
  },

  {
    name: 'Powershare Active',
    icon: 'charging',
    category: 'Powershare',
    severity: 'info',
    message: 'Powershare active: {{PowershareInstantaneousPowerKW}} kW',
    cooldown_min: 60,
    signal_name: 'PowershareStatus',
    op: 'changed',
  },
];

const templateCategories = [
  ...new Set(ruleTemplates.map(t => t.category)),
].sort();

const numericOperatorOptions: RuleOp[] = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'changed',
  'between',
  'outside',
];
const scalarOperatorOptions: RuleOp[] = ['=', '!=', 'changed'];
const customSignalCategory = '__custom__';

interface EditorState {
  id?: number;
  name: string;
  enabled: boolean;
  vehicle_selection: VehicleSelection;
  signal_name: string;
  op: RuleOp;
  value_kind: ValueKind;
  value_num: string;
  value_text: string;
  value_bool: boolean;
  value_min: string;
  value_max: string;
  severity: Severity;
  cooldown_min: number;
  trigger_mode: TriggerModeOrUnset;
  max_fires_per_resolution: string;
  escalation_enabled: boolean;
  escalation_after_min: string;
  escalation_severity: Severity | '';
  message: string;
  msg_template: string;
  include_title: boolean;
  kind: AlertRuleKind;
  metric_id: string;
  metric_window: string;
  metric_op: ComputedMetricOp;
  metric_threshold: string;
}

function freshEditor(): EditorState {
  return {
    name: '',
    enabled: true,
    vehicle_selection: { kind: 'all_sticky' },
    signal_name: '',
    op: '=',
    value_kind: 'number',
    value_num: '',
    value_text: '',
    value_bool: true,
    value_min: '',
    value_max: '',
    severity: 'warn',
    cooldown_min: 15,
    trigger_mode: 'unset',
    max_fires_per_resolution: '',
    escalation_enabled: false,
    escalation_after_min: '',
    escalation_severity: '',
    message: '',
    msg_template: '',
    include_title: true,
    kind: 'signal',
    metric_id: '',
    metric_window: '',
    metric_op: '>',
    metric_threshold: '',
  };
}

function isTriggerMode(
  value: string | null | undefined,
): value is AlertRuleTriggerMode {
  return value === 'once' || value === 'repeat';
}

function normalizeTriggerMode(
  value: string | null | undefined,
): AlertRuleTriggerMode {
  return isTriggerMode(value) ? value : 'repeat';
}

function isSnoozeActive(snoozedUntil: string | null | undefined): boolean {
  if (!snoozedUntil) {
    return false;
  }
  const ms = Date.parse(snoozedUntil);
  return Number.isFinite(ms) && ms > Date.now();
}

function isSeverity(value: string | null | undefined): value is Severity {
  return value === 'info' || value === 'warn' || value === 'critical';
}

function normalizeSeverity(value: string | null | undefined): Severity {
  if (isSeverity(value)) {
    return value;
  }
  return value === 'warning' ? 'warn' : 'info';
}

function templateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function valueToInput(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalMaxFires(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMsgTemplateForSave(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Canonical info < warn < critical ordering used by the escalation
// higher-severity check (matches alertSeverityRank in the Go handler).
const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  warn: 2,
  critical: 3,
};

function buildEscalationPayload(
  state: EditorState,
  triggerMode: AlertRuleTriggerMode,
): {
  escalation_after_min: number | null;
  escalation_severity: Severity | null;
} {
  if (triggerMode !== 'repeat' || !state.escalation_enabled) {
    return { escalation_after_min: null, escalation_severity: null };
  }
  const after = parseOptionalMaxFires(state.escalation_after_min);
  if (after == null || state.escalation_severity === '') {
    return { escalation_after_min: null, escalation_severity: null };
  }
  return {
    escalation_after_min: after,
    escalation_severity: state.escalation_severity,
  };
}

function isNumericOnlyOp(op: RuleOp): boolean {
  return op === '<' || op === '<=' || op === '>' || op === '>=';
}

function isRangeOp(op: RuleOp): boolean {
  return op === 'between' || op === 'outside';
}

function inferTemplateSignalType(template: RuleTemplate): SignalValueType {
  if (
    template.value_num != null ||
    template.value_min != null ||
    template.value_max != null ||
    isNumericOnlyOp(template.op) ||
    isRangeOp(template.op)
  ) {
    return 'numeric';
  }
  if (template.value_bool != null) {
    return 'bool';
  }
  return 'text';
}

function mergeSignalType(
  current: SignalValueType,
  next: SignalValueType,
): SignalValueType {
  if (current === next) {
    return current;
  }
  if (current === 'numeric' || next === 'numeric') {
    return 'numeric';
  }
  if (current === 'bool' || next === 'bool') {
    return 'bool';
  }
  return 'text';
}

function buildSignalCatalog(templates: RuleTemplate[]): SignalDefinition[] {
  const byName = new Map<string, SignalDefinition>();
  templates.forEach(template => {
    const valueType = inferTemplateSignalType(template);
    const existing = byName.get(template.signal_name);
    if (existing) {
      existing.value_type = mergeSignalType(existing.value_type, valueType);
      return;
    }
    byName.set(template.signal_name, {
      name: template.signal_name,
      category: template.category,
      value_type: valueType,
    });
  });
  return [...byName.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

const signalCatalog = buildSignalCatalog(ruleTemplates);
const signalCatalogByName = new Map(
  signalCatalog.map(signal => [signal.name, signal]),
);

function signalTypeForValueKind(valueKind: ValueKind): SignalValueType {
  if (valueKind === 'bool') {
    return 'bool';
  }
  if (valueKind === 'text' || valueKind === 'none') {
    return 'text';
  }
  return 'numeric';
}

function signalTypeForName(
  signalName: string,
  fallbackKind: ValueKind,
): SignalValueType {
  return (
    signalCatalogByName.get(signalName)?.value_type ??
    signalTypeForValueKind(fallbackKind)
  );
}

function allowedOpsForSignalType(valueType: SignalValueType): RuleOp[] {
  return valueType === 'numeric'
    ? numericOperatorOptions
    : scalarOperatorOptions;
}

function coerceOperatorForSignalType(
  op: RuleOp,
  valueType: SignalValueType,
): RuleOp {
  return allowedOpsForSignalType(valueType).includes(op) ? op : '=';
}

function valueKindForSignalOp(
  valueType: SignalValueType,
  op: RuleOp,
): ValueKind {
  if (op === 'changed') {
    return 'none';
  }
  if (valueType === 'numeric') {
    return isRangeOp(op) ? 'range' : 'number';
  }
  if (valueType === 'bool') {
    return 'bool';
  }
  return 'text';
}

function valueKindForState(
  state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>,
): ValueKind {
  return valueKindForSignalOp(
    signalTypeForName(state.signal_name, state.value_kind),
    state.op,
  );
}

function isOperatorAllowedForState(
  state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>,
): boolean {
  return allowedOpsForSignalType(
    signalTypeForName(state.signal_name, state.value_kind),
  ).includes(state.op);
}

function inferValueKind(
  rule: Pick<
    AlertRule,
    'op' | 'value_num' | 'value_text' | 'value_bool' | 'value_min' | 'value_max'
  >,
): ValueKind {
  if (isRangeOp(rule.op) || rule.value_min != null || rule.value_max != null) {
    return 'range';
  }
  if (rule.value_bool != null) {
    return 'bool';
  }
  if (rule.value_text != null) {
    return 'text';
  }
  if (rule.value_num != null) {
    return 'number';
  }
  return rule.op === 'changed' ? 'none' : 'number';
}

function inferTemplateValueKind(template: RuleTemplate): ValueKind {
  return valueKindForSignalOp(inferTemplateSignalType(template), template.op);
}

function ruleToEditor(rule: AlertRule): EditorState {
  const kind: AlertRuleKind = rule.kind ?? 'signal';
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    vehicle_selection: hydrateVehicleSelection(rule),
    signal_name: rule.signal_name,
    op: rule.op,
    value_kind: inferValueKind(rule),
    value_num: valueToInput(rule.value_num),
    value_text: rule.value_text ?? '',
    value_bool: rule.value_bool ?? true,
    value_min: valueToInput(rule.value_min),
    value_max: valueToInput(rule.value_max),
    severity: normalizeSeverity(rule.severity),
    cooldown_min: rule.cooldown_min,
    trigger_mode: normalizeTriggerMode(rule.trigger_mode),
    max_fires_per_resolution:
      rule.max_fires_per_resolution == null
        ? ''
        : String(rule.max_fires_per_resolution),
    escalation_enabled:
      rule.escalation_after_min != null && rule.escalation_severity != null,
    escalation_after_min:
      rule.escalation_after_min == null
        ? ''
        : String(rule.escalation_after_min),
    escalation_severity: rule.escalation_severity ?? '',
    message: rule.signal_name ? `${rule.name}: {{${rule.signal_name}}}` : '',
    msg_template: rule.msg_template ?? '',
    include_title: rule.include_title ?? true,
    kind,
    metric_id: rule.metric_id ?? '',
    metric_window: rule.metric_window ?? '',
    metric_op: (rule.metric_op ?? '>') as ComputedMetricOp,
    metric_threshold: valueToInput(rule.metric_threshold),
  };
}

function templateToEditor(
  template: RuleTemplate,
  name: string,
  message: string,
): EditorState {
  return {
    ...freshEditor(),
    name,
    signal_name: template.signal_name,
    op: template.op,
    value_kind: inferTemplateValueKind(template),
    value_num: valueToInput(template.value_num),
    value_text: template.value_text ?? '',
    value_bool: template.value_bool ?? true,
    value_min: valueToInput(template.value_min),
    value_max: valueToInput(template.value_max),
    severity: template.severity,
    cooldown_min: template.cooldown_min,
    message,
    msg_template: message,
    include_title: true,
  };
}

function buildSavePayload(state: EditorState): AlertRuleInput {
  const vehiclePayload = buildVehiclePayload(state.vehicle_selection);
  if (state.trigger_mode === 'unset') {
    throw new Error(
      'buildSavePayload: trigger_mode must be chosen before save',
    );
  }
  const triggerMode: AlertRuleTriggerMode = state.trigger_mode;

  if (state.kind === 'computed_metric') {
    const threshold = parseOptionalNumber(state.metric_threshold);
    const escalation = buildEscalationPayload(state, triggerMode);
    return {
      name: state.name.trim(),
      enabled: state.enabled,
      ...vehiclePayload,
      severity: state.severity,
      cooldown_min: state.cooldown_min,
      trigger_mode: triggerMode,
      max_fires_per_resolution: parseOptionalMaxFires(
        state.max_fires_per_resolution,
      ),
      ...escalation,
      kind: 'computed_metric',
      metric_id: state.metric_id || null,
      metric_window: state.metric_window || null,
      metric_op: state.metric_op,
      metric_threshold: threshold,
      msg_template: normalizeMsgTemplateForSave(state.msg_template),
      include_title: state.include_title,
    };
  }

  const valueKind = valueKindForState(state);
  const escalation = buildEscalationPayload(state, triggerMode);
  const payload: AlertRuleInput = {
    name: state.name.trim(),
    enabled: state.enabled,
    ...vehiclePayload,
    signal_name: state.signal_name.trim(),
    op: state.op,
    value_num: null,
    value_text: null,
    value_bool: null,
    value_min: null,
    value_max: null,
    severity: state.severity,
    cooldown_min: state.cooldown_min,
    trigger_mode: triggerMode,
    max_fires_per_resolution: parseOptionalMaxFires(
      state.max_fires_per_resolution,
    ),
    ...escalation,
    kind: 'signal',
    msg_template: normalizeMsgTemplateForSave(state.msg_template),
    include_title: state.include_title,
  };

  if (valueKind === 'number') {
    payload.value_num = parseOptionalNumber(state.value_num);
  } else if (valueKind === 'text') {
    payload.value_text = state.value_text.trim();
  } else if (valueKind === 'bool') {
    payload.value_bool = state.value_bool;
  } else if (valueKind === 'range') {
    payload.value_min = parseOptionalNumber(state.value_min);
    payload.value_max = parseOptionalNumber(state.value_max);
  }

  return payload;
}

function hasComputedMetricInputs(
  state: EditorState,
  metrics: ComputedMetricSummary[],
): boolean {
  if (!state.metric_id || !state.metric_window || !state.metric_op) {
    return false;
  }
  if (parseOptionalNumber(state.metric_threshold) == null) {
    return false;
  }
  const def = metrics.find(m => m.id === state.metric_id);
  if (!def) {
    return false;
  }
  if (!def.windows.includes(state.metric_window)) {
    return false;
  }
  if (!def.ops.includes(state.metric_op)) {
    return false;
  }
  return true;
}

function hasRequiredTypedValue(state: EditorState): boolean {
  const valueKind = valueKindForState(state);
  if (valueKind === 'none') {
    return state.op === 'changed';
  }
  if (valueKind === 'bool') {
    return true;
  }
  if (valueKind === 'text') {
    return state.value_text.trim().length > 0;
  }
  if (valueKind === 'number') {
    return parseOptionalNumber(state.value_num) !== null;
  }
  const valueMin = parseOptionalNumber(state.value_min);
  const valueMax = parseOptionalNumber(state.value_max);
  return valueMin !== null && valueMax !== null && valueMin <= valueMax;
}

function buildTestTarget(
  selectedIds: number[] | null,
  allIds: number[],
): AlertTestTarget | null {
  if (allIds.length === 0) {
    return null;
  }
  if (selectedIds === null) {
    return { all_channels: true };
  }
  return { channel_ids: selectedIds };
}

/* ---- @/components/forms VehicleMultiSelect helpers (value-identical) ---- */

type VehicleSelection =
  | { kind: 'all_sticky' }
  | { kind: 'specific'; vehicle_ids: number[] };

function dedupSort(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

function lastFourVin(vin: string | undefined | null): string | null {
  if (!vin || vin.length < 4) {
    return null;
  }
  return vin.slice(-4);
}

function vehicleLabel(v: Vehicle): string {
  const last4 = lastFourVin(v.vin);
  const base = v.display_name || v.model || `Vehicle #${v.id}`;
  if (!last4) {
    return v.model ? `${base} — ${v.model}` : base;
  }
  if (!v.model || v.display_name === v.model) {
    return `${base} (VIN ...${last4})`;
  }
  return `${base} — ${v.model} (VIN ...${last4})`;
}

function hydrateVehicleSelection(rule: {
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  vehicle_id?: number | null;
}): VehicleSelection {
  if (typeof rule.all_vehicles === 'boolean') {
    if (rule.all_vehicles) {
      return { kind: 'all_sticky' };
    }
    return { kind: 'specific', vehicle_ids: dedupSort(rule.vehicle_ids ?? []) };
  }
  return rule.vehicle_id == null
    ? { kind: 'all_sticky' }
    : { kind: 'specific', vehicle_ids: [rule.vehicle_id] };
}

function buildVehiclePayload(sel: VehicleSelection): {
  all_vehicles: boolean;
  vehicle_ids: number[];
} {
  if (sel.kind === 'all_sticky') {
    return { all_vehicles: true, vehicle_ids: [] };
  }
  return { all_vehicles: false, vehicle_ids: dedupSort(sel.vehicle_ids) };
}

/* ---- ../lib/recommendedTriggerMode (value-identical) ---- */

function recommendedTriggerMode(op: RuleOp): AlertRuleTriggerMode {
  switch (op) {
    case '=':
    case '!=':
    case 'changed':
      return 'once';
    case '>':
    case '<':
    case '>=':
    case '<=':
    case 'between':
    case 'outside':
      return 'repeat';
    default:
      return 'repeat';
  }
}

/* ---- ../schemas/alertRule zod schema (hand-ported safeParse) ---- */

type SchemaIssue = { message: string; path: Array<string | number> };
type SafeParseResult =
  | { success: true }
  | { success: false; error: { issues: SchemaIssue[] } };

const RANGE_OPS_SET = new Set<RuleOp>(['between', 'outside']);
const NO_VALUE_OPS_SET = new Set<RuleOp>(['changed']);

function alertRuleSchemaSafeParse(data: AlertRuleInput): SafeParseResult {
  const issues: SchemaIssue[] = [];
  const add = (path: Array<string | number>, message: string) =>
    issues.push({ path, message });

  const name = (data.name ?? '').trim();
  if (name.length < 1) {
    add(['name'], 'Name is required');
  } else if (name.length > 120) {
    add(['name'], 'Name must be 120 characters or fewer');
  }

  if (data.cooldown_min != null) {
    if (!Number.isInteger(data.cooldown_min)) {
      add(['cooldown_min'], 'Cooldown must be a whole number of minutes');
    } else if (data.cooldown_min < 1) {
      add(['cooldown_min'], 'Cooldown must be at least 1 minute');
    } else if (data.cooldown_min > 1440) {
      add(['cooldown_min'], 'Cooldown cannot exceed 1440 minutes (24 hours)');
    }
  }

  if (data.max_fires_per_resolution != null) {
    if (!Number.isInteger(data.max_fires_per_resolution)) {
      add(['max_fires_per_resolution'], 'Max fires must be a whole number');
    } else if (data.max_fires_per_resolution <= 0) {
      add(['max_fires_per_resolution'], 'Max fires must be greater than 0');
    }
  }

  if (data.msg_template != null && data.msg_template.length > 1024) {
    add(['msg_template'], 'Message template must be 1024 characters or fewer');
  }

  const afterPresent = data.escalation_after_min != null;
  const sevPresent = data.escalation_severity != null;
  if (afterPresent !== sevPresent) {
    add(
      [afterPresent ? 'escalation_severity' : 'escalation_after_min'],
      'Escalation requires both an escalate-after duration and a severity',
    );
  }
  if (afterPresent && sevPresent) {
    const triggerMode = data.trigger_mode ?? 'repeat';
    if (triggerMode !== 'repeat') {
      add(
        ['escalation_after_min'],
        'Escalation only applies to repeat-mode rules',
      );
    }
    const rank: Record<Severity, number> = { info: 1, warn: 2, critical: 3 };
    const baseSev = data.severity ?? 'warn';
    const escSev = data.escalation_severity as Severity;
    if (rank[escSev] <= rank[baseSev]) {
      add(
        ['escalation_severity'],
        'Escalated severity must be higher than the base severity',
      );
    }
  }

  const kind = data.kind ?? 'signal';

  if (kind === 'computed_metric') {
    if (!data.metric_id || data.metric_id.trim() === '') {
      add(['metric_id'], 'Metric is required');
    }
    if (!data.metric_window || data.metric_window.trim() === '') {
      add(['metric_window'], 'Window is required');
    }
    if (!data.metric_op) {
      add(['metric_op'], 'Operator is required');
    }
    if (
      data.metric_threshold == null ||
      !Number.isFinite(data.metric_threshold)
    ) {
      add(['metric_threshold'], 'Threshold is required');
    }
    return issues.length
      ? { success: false, error: { issues } }
      : { success: true };
  }

  if (!data.signal_name || data.signal_name.trim() === '') {
    add(['signal_name'], 'Signal is required');
    return { success: false, error: { issues } };
  }
  if (!data.op) {
    add(['op'], 'Operator is required');
    return { success: false, error: { issues } };
  }
  if (RANGE_OPS_SET.has(data.op)) {
    if (data.value_min == null || data.value_max == null) {
      add(['value_min'], 'Min and max are required for range operators');
      return { success: false, error: { issues } };
    }
    if (data.value_min > data.value_max) {
      add(['value_max'], 'Max must be greater than or equal to min');
    }
    return issues.length
      ? { success: false, error: { issues } }
      : { success: true };
  }
  if (NO_VALUE_OPS_SET.has(data.op)) {
    return issues.length
      ? { success: false, error: { issues } }
      : { success: true };
  }

  const present = [
    data.value_num != null,
    data.value_text != null && data.value_text !== '',
    data.value_bool != null,
  ].filter(Boolean).length;
  if (present === 0) {
    add(['value_num'], 'A value is required for this operator');
  }

  return issues.length
    ? { success: false, error: { issues } }
    : { success: true };
}

const alertRuleSchema = { safeParse: alertRuleSchemaSafeParse };

/* ------------------------------------------------------------------ */
/*  @/components/forms VehicleMultiSelect (native)                     */
/* ------------------------------------------------------------------ */

function VehicleMultiSelect({
  value,
  onChange,
  vehicles,
  errorKey,
  disabled,
}: {
  value: VehicleSelection;
  onChange: (next: VehicleSelection) => void;
  vehicles: Vehicle[];
  errorKey?: string | null;
  disabled?: boolean;
  id?: string;
}) {
  const { t } = useNativeTranslation();
  const [open, setOpen] = useState(false);
  const previousSpecificRef = useRef<number[]>(
    value.kind === 'specific' ? value.vehicle_ids : [],
  );
  useEffect(() => {
    if (value.kind === 'specific') {
      previousSpecificRef.current = value.vehicle_ids;
    }
  }, [value]);

  const knownIds = useMemo(() => new Set(vehicles.map(v => v.id)), [vehicles]);
  const selectedIds = useMemo(
    () => (value.kind === 'specific' ? value.vehicle_ids : []),
    [value],
  );
  const unknownIds = useMemo(
    () => selectedIds.filter(id => !knownIds.has(id)),
    [selectedIds, knownIds],
  );
  const isFleetEmpty = vehicles.length === 0;

  const triggerSummary = useMemo(() => {
    if (value.kind === 'all_sticky') {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryAll',
        'All vehicles',
      );
    }
    const total = vehicles.length;
    const count = selectedIds.length;
    if (count === 0) {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryNone',
        'No vehicles selected',
      );
    }
    if (count === 1) {
      const veh = vehicles.find(v => v.id === selectedIds[0]);
      const nm = veh
        ? veh.display_name || veh.model || `Vehicle #${selectedIds[0]}`
        : `Vehicle #${selectedIds[0]}`;
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryOne',
        '{{name}}',
        {
          name: nm,
        },
      );
    }
    if (total > 0 && count < total) {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryPartial',
        '{{count}} of {{total}} vehicles',
        { count, total },
      );
    }
    return t(
      'notifications.alertStudio.editor.vehiclesSummaryCount',
      '{{count}} vehicles',
      { count },
    );
  }, [value, selectedIds, vehicles, t]);

  const handleToggleAll = useCallback(() => {
    if (value.kind === 'all_sticky') {
      onChange({ kind: 'specific', vehicle_ids: previousSpecificRef.current });
      return;
    }
    onChange({ kind: 'all_sticky' });
  }, [value, onChange]);

  const handleToggleVehicle = useCallback(
    (vehicleId: number) => {
      const current = value.kind === 'specific' ? value.vehicle_ids : [];
      const isSelected = current.includes(vehicleId);
      const next = isSelected
        ? current.filter(id => id !== vehicleId)
        : dedupSort([...current, vehicleId]);
      onChange({ kind: 'specific', vehicle_ids: next });
    },
    [value, onChange],
  );

  const errorText = errorKey ? t(errorKey) : null;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: !!(disabled || isFleetEmpty),
          expanded: open,
        }}
        disabled={disabled || isFleetEmpty}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          s.select,
          errorText ? s.selectError : null,
          (disabled || isFleetEmpty) && s.inputDisabled,
          pressed && !disabled && s.btnPressed,
        ]}
      >
        <Badge variant="neutral">{triggerSummary}</Badge>
        <AppText style={s.selectChevron}>{glyphFor('expand')}</AppText>
      </Pressable>

      {isFleetEmpty ? (
        <AppText style={s.helperText} tone="muted">
          {t(
            'notifications.alertStudio.editor.vehiclesEmptyFleetHelp',
            'Add a vehicle in Settings → Vehicles to use this rule.',
          )}
        </AppText>
      ) : null}

      {errorText ? (
        <AppText style={s.errorText} tone="danger">
          {errorText}
        </AppText>
      ) : null}

      <Modal
        onClose={() => setOpen(false)}
        open={open && !isFleetEmpty}
        size="sm"
        title={t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles')}
      >
        <ScrollView style={s.selectMenu}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: value.kind === 'all_sticky' }}
            onPress={handleToggleAll}
            style={({ pressed }) => [
              s.selectOption,
              value.kind === 'all_sticky' && s.selectOptionActive,
              pressed && s.btnPressed,
            ]}
          >
            <NativeCheckbox
              accessibilityLabel={t(
                'notifications.alertStudio.editor.vehiclesAllOption',
                'All vehicles (current + future)',
              )}
              checked={value.kind === 'all_sticky'}
              onChange={handleToggleAll}
            />
            <AppText style={s.selectOptionText} weight="semibold">
              {t(
                'notifications.alertStudio.editor.vehiclesAllOption',
                'All vehicles (current + future)',
              )}
            </AppText>
          </Pressable>

          <View style={s.menuDivider} />

          {vehicles.map(v => {
            const checked =
              value.kind === 'specific' && value.vehicle_ids.includes(v.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                key={v.id}
                onPress={() => handleToggleVehicle(v.id)}
                style={({ pressed }) => [
                  s.selectOption,
                  checked && s.selectOptionActive,
                  pressed && s.btnPressed,
                ]}
              >
                <NativeCheckbox
                  accessibilityLabel={vehicleLabel(v)}
                  checked={checked}
                  onChange={() => handleToggleVehicle(v.id)}
                />
                <AppText numberOfLines={1} style={s.selectOptionText}>
                  {vehicleLabel(v)}
                </AppText>
              </Pressable>
            );
          })}

          {unknownIds.length > 0 ? (
            <>
              <View style={s.menuDivider} />
              {unknownIds.map(id => (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: true }}
                  key={`unknown-${id}`}
                  onPress={() => handleToggleVehicle(id)}
                  style={({ pressed }) => [
                    s.selectOption,
                    pressed && s.btnPressed,
                  ]}
                >
                  <NativeCheckbox
                    accessibilityLabel={t(
                      'notifications.alertStudio.editor.vehiclesUnknownLabel',
                      'Vehicle #{{id}}',
                      { id },
                    )}
                    checked={true}
                    onChange={() => handleToggleVehicle(id)}
                  />
                  <AppText
                    numberOfLines={1}
                    style={s.selectOptionText}
                    tone="muted"
                  >
                    {t(
                      'notifications.alertStudio.editor.vehiclesUnknownLabel',
                      'Vehicle #{{id}}',
                      { id },
                    )}
                  </AppText>
                  <Badge variant="warning">
                    {t(
                      'notifications.alertStudio.editor.vehiclesUnknownBadge',
                      'Unknown',
                    )}
                  </Badge>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ../components/ComputedMetricEditor (native)                        */
/* ------------------------------------------------------------------ */

interface ComputedMetricEditorValue {
  metric_id: string;
  metric_window: string;
  metric_op: ComputedMetricOp;
  metric_threshold: string;
  vehicle_id?: number | null;
}

const ALL_METRIC_OPS: ComputedMetricOp[] = [
  '>',
  '>=',
  '<',
  '<=',
  '=',
  '!=',
  '%_change_>',
  '%_change_<',
];

function metricOpLabel(op: ComputedMetricOp): string {
  switch (op) {
    case '%_change_>':
      return '% change >';
    case '%_change_<':
      return '% change <';
    default:
      return op;
  }
}

function metricOpKey(op: ComputedMetricOp): string {
  switch (op) {
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    case '=':
      return 'eq';
    case '!=':
      return 'neq';
    case '%_change_>':
      return 'pctGt';
    case '%_change_<':
      return 'pctLt';
    default:
      return op;
  }
}

function metricUnitSuffix(unit: string): string {
  switch (unit) {
    case 'currency':
      return '';
    case 'currency_per_mi':
      return '/mi';
    case 'kwh':
      return 'kWh';
    case 'wh_per_mi':
      return 'Wh/mi';
    case 'mi':
      return 'mi';
    case 'km':
      return 'km';
    case 'h':
      return 'h';
    case 'count':
      return '';
    case '%':
      return '%';
    default:
      return unit;
  }
}

function fmtNumber(value: unknown, decimals: number): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function ComputedMetricEditor({
  value,
  onChange,
  metrics,
  loading,
}: {
  value: ComputedMetricEditorValue;
  onChange: (next: ComputedMetricEditorValue) => void;
  metrics: ComputedMetricSummary[];
  loading?: boolean;
}) {
  const { t } = useNativeTranslation();
  const previewMut = usePreviewComputedMetric();
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selected = useMemo<ComputedMetricSummary | undefined>(
    () => metrics.find(m => m.id === value.metric_id),
    [metrics, value.metric_id],
  );

  const metricOptions = useMemo(
    () =>
      metrics.map(m => ({
        value: m.id,
        label: t(`notifications.alertStudio.metricNames.${m.id}`, m.label),
      })),
    [metrics, t],
  );

  const windowOptions = useMemo(() => {
    const list = selected?.windows ?? [];
    return list.map(w => ({
      value: w,
      label: t(`notifications.alertStudio.metricWindows.${w}`, w),
    }));
  }, [selected, t]);

  const opOptions = useMemo(() => {
    const list = selected?.ops ?? ALL_METRIC_OPS;
    return list.map(op => ({
      value: op,
      label: t(
        `notifications.alertStudio.metricOps.${metricOpKey(op)}`,
        metricOpLabel(op),
      ),
    }));
  }, [selected, t]);

  const handleMetric = (id: string) => {
    const def = metrics.find(m => m.id === id);
    onChange({
      ...value,
      metric_id: id,
      metric_window: def && def.windows.length > 0 ? def.windows[0] : '',
      metric_op: def && def.ops.length > 0 ? def.ops[0] : value.metric_op,
    });
    setPreviewError(null);
  };

  const ready =
    !!value.metric_id &&
    !!value.metric_window &&
    !!value.metric_op &&
    Number.isFinite(parseFloat(value.metric_threshold));

  useEffect(() => {
    if (!ready) {
      return;
    }
    const threshold = parseFloat(value.metric_threshold);
    if (!Number.isFinite(threshold)) {
      return;
    }
    setPreviewError(null);
    previewMut.mutate(
      {
        metric_id: value.metric_id,
        metric_window: value.metric_window,
        metric_op: value.metric_op,
        metric_threshold: threshold,
        vehicle_id: value.vehicle_id ?? undefined,
      },
      {
        onError: (err: unknown) => {
          setPreviewError(err instanceof Error ? err.message : String(err));
        },
      },
    );
    // previewMut intentionally excluded — calling .mutate() in deps would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    value.metric_id,
    value.metric_window,
    value.metric_op,
    value.metric_threshold,
    value.vehicle_id,
  ]);

  const previewData = previewMut.data;
  const previewSuffix = selected ? metricUnitSuffix(selected.unit) : '';

  return (
    <View style={s.stack}>
      <View style={s.rowWrap}>
        <View style={s.flexItem}>
          <Field
            label={t(
              'notifications.alertStudio.computedMetric.metric',
              'Metric',
            )}
          >
            <NativeSelect
              disabled={loading}
              onChange={e => handleMetric(e.target.value)}
              options={metricOptions}
              placeholder={
                loading
                  ? t(
                      'notifications.alertStudio.computedMetric.loading',
                      'Loading metrics…',
                    )
                  : t(
                      'notifications.alertStudio.computedMetric.metricPlaceholder',
                      'Choose a metric',
                    )
              }
              value={value.metric_id}
            />
          </Field>
        </View>
        <View style={s.flexItem}>
          <Field
            label={t(
              'notifications.alertStudio.computedMetric.window',
              'Window',
            )}
          >
            <NativeSelect
              disabled={!selected}
              onChange={e =>
                onChange({ ...value, metric_window: e.target.value })
              }
              options={windowOptions}
              placeholder={t(
                'notifications.alertStudio.computedMetric.windowPlaceholder',
                'Choose a window',
              )}
              value={value.metric_window}
            />
          </Field>
        </View>
        <View style={s.flexItem}>
          <Field
            label={t('notifications.alertStudio.computedMetric.op', 'Operator')}
          >
            <NativeSelect
              disabled={!selected}
              onChange={e =>
                onChange({
                  ...value,
                  metric_op: e.target.value as ComputedMetricOp,
                })
              }
              options={opOptions}
              value={value.metric_op}
            />
          </Field>
        </View>
      </View>

      <Field
        label={t(
          'notifications.alertStudio.computedMetric.threshold',
          'Threshold',
        )}
      >
        <NativeInput
          onChange={e =>
            onChange({ ...value, metric_threshold: e.target.value })
          }
          placeholder={t(
            'notifications.alertStudio.computedMetric.thresholdPlaceholder',
            'e.g. 200',
          )}
          type="number"
          value={value.metric_threshold}
        />
      </Field>

      <GlassPanel style={s.innerPanel}>
        <AppText style={s.fieldLabel} weight="semibold">
          {t(
            'notifications.alertStudio.computedMetric.preview',
            'Live preview',
          )}
        </AppText>
        {!ready ? (
          <AppText style={s.hintText} tone="muted">
            {t(
              'notifications.alertStudio.computedMetric.previewIdle',
              'Pick a metric, window, operator, and threshold to preview.',
            )}
          </AppText>
        ) : null}
        {ready && previewMut.isPending ? (
          <AppText style={s.hintText} tone="muted">
            {t(
              'notifications.alertStudio.computedMetric.previewLoading',
              'Computing…',
            )}
          </AppText>
        ) : null}
        {ready && previewError ? (
          <AppText style={s.hintText} tone="danger">
            {previewError}
          </AppText>
        ) : null}
        {ready && !previewMut.isPending && !previewError && previewData ? (
          <AppText style={s.hintText}>
            {t(
              'notifications.alertStudio.computedMetric.previewValue',
              'Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire.',
              {
                value: fmtNumber(previewData.value, 2),
                suffix: previewSuffix ? ` ${previewSuffix}` : '',
                verdict: previewData.would_trigger
                  ? t('notifications.alertStudio.computedMetric.would', '')
                  : t(
                      'notifications.alertStudio.computedMetric.wouldNot',
                      'NOT',
                    ),
              },
            )}
          </AppText>
        ) : null}
      </GlassPanel>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ../components/AlertMessageEditor (native)                          */
/* ------------------------------------------------------------------ */

interface AlertMessageEditorDraft {
  name?: string;
  kind?: AlertRuleKind;
  signal_name?: string;
  op?: RuleOp;
  severity?: Severity;
  vehicle_name?: string;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_op?: ComputedMetricOp | null;
  metric_threshold?: number | null;
}

const PLACEHOLDER_TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

function extractTemplateKeys(template: string): string[] {
  const out: string[] = [];
  PLACEHOLDER_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_TOKEN_RE.exec(template)) !== null) {
    out.push(m[1]);
  }
  return out;
}

const PREVIEW_DEBOUNCE_MS = 150;

function AlertMessageEditor({
  msgTemplate,
  includeTitle,
  draft,
  onTemplateChange,
  onIncludeTitleChange,
  label,
  disabled,
}: {
  msgTemplate: string;
  includeTitle: boolean;
  draft: AlertMessageEditorDraft;
  onTemplateChange: (next: string) => void;
  onIncludeTitleChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useNativeTranslation();
  const [placeholderModalOpen, setPlaceholderModalOpen] = useState(false);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetFilter, setPresetFilter] = useState<string | null>(null);

  const placeholdersQuery = useAlertMessagePlaceholders({
    kind: draft.kind,
    signal_name: draft.signal_name,
    op: draft.op,
    metric_id: draft.metric_id ?? null,
    enabled: !disabled,
  });

  const presetsQuery = useAlertMessagePresets(draft.kind);

  const availableKeys = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    for (const p of placeholdersQuery.data ?? []) {
      keys.add(p.key);
    }
    return keys;
  }, [placeholdersQuery.data]);

  const opValidPresets = useMemo<AlertMessagePreset[]>(() => {
    const all = presetsQuery.data ?? [];
    if (placeholdersQuery.isLoading || availableKeys.size === 0 || !draft.op) {
      return all;
    }
    return all.filter(preset => {
      const keys = extractTemplateKeys(preset.template);
      return keys.every(k => availableKeys.has(k));
    });
  }, [availableKeys, draft.op, placeholdersQuery.isLoading, presetsQuery.data]);

  const presetTags = useMemo<string[]>(() => {
    const tags = new Set<string>();
    for (const preset of opValidPresets) {
      for (const tag of preset.tags ?? []) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }, [opValidPresets]);

  useEffect(() => {
    if (presetFilter && !presetTags.includes(presetFilter)) {
      setPresetFilter(null);
    }
  }, [presetFilter, presetTags]);

  const filteredPresets = useMemo<AlertMessagePreset[]>(() => {
    if (!presetFilter) {
      return opValidPresets;
    }
    return opValidPresets.filter(p => (p.tags ?? []).includes(presetFilter));
  }, [opValidPresets, presetFilter]);

  const insertPlaceholder = useCallback(
    (placeholder: AlertMessagePlaceholder) => {
      onTemplateChange(`${msgTemplate}{{${placeholder.key}}}`);
      setPlaceholderModalOpen(false);
    },
    [msgTemplate, onTemplateChange],
  );

  const applyPreset = useCallback(
    (preset: AlertMessagePreset) => {
      onTemplateChange(preset.template);
      setPresetModalOpen(false);
    },
    [onTemplateChange],
  );

  // ──────────────── Live preview (debounced) ────────────────
  const previewMut = useAlertMessagePreview();
  const [preview, setPreview] = useState<AlertMessagePreviewResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        msgTemplate,
        includeTitle,
        name: draft.name,
        kind: draft.kind,
        signal_name: draft.signal_name,
        op: draft.op,
        severity: draft.severity,
        vehicle_name: draft.vehicle_name,
        value_num: draft.value_num,
        value_text: draft.value_text,
        value_bool: draft.value_bool,
        value_min: draft.value_min,
        value_max: draft.value_max,
        metric_id: draft.metric_id,
        metric_window: draft.metric_window,
        metric_op: draft.metric_op,
        metric_threshold: draft.metric_threshold,
      }),
    [draft, includeTitle, msgTemplate],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      previewMut.mutate(
        {
          name: draft.name,
          kind: draft.kind,
          signal_name: draft.signal_name,
          op: draft.op,
          severity: draft.severity,
          vehicle_name: draft.vehicle_name,
          value_num: draft.value_num,
          value_text: draft.value_text,
          value_bool: draft.value_bool,
          value_min: draft.value_min,
          value_max: draft.value_max,
          metric_id: draft.metric_id,
          metric_window: draft.metric_window,
          metric_op: draft.metric_op,
          metric_threshold: draft.metric_threshold,
          msg_template: msgTemplate.trim() === '' ? null : msgTemplate,
          include_title: includeTitle,
        },
        {
          onSuccess: data => {
            setPreview(data);
            setPreviewError(null);
          },
          onError: err => {
            setPreviewError(
              err instanceof Error ? err.message : 'Preview failed',
            );
          },
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  return (
    <View style={s.stack}>
      <View style={s.inlineRow}>
        <NativeCheckbox
          accessibilityLabel={t(
            'notifications.alertStudio.editor.includeTitleLabel',
            'Include title in notifications',
          )}
          checked={includeTitle}
          onChange={onIncludeTitleChange}
        />
        <AppText style={s.hintText}>
          {t(
            'notifications.alertStudio.editor.includeTitleLabel',
            'Include title in notifications',
          )}
        </AppText>
        <HelpIcon
          content={t(
            'notifications.alertStudio.editor.includeTitleHelp',
            'When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title.',
          )}
        />
      </View>

      <View style={s.rowBetween}>
        <View style={s.labelRow}>
          <AppText style={s.fieldLabel} weight="semibold">
            {label ??
              t(
                'notifications.alertStudio.editor.messageTemplateLabel',
                'Message Template',
              )}
          </AppText>
          <HelpIcon
            content={t(
              'notifications.alertStudio.editor.messageTemplateHelp',
              'Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body.',
            )}
          />
        </View>
        <Button
          disabled={disabled}
          icon={
            <AppText style={s.btnGlyph} weight="bold">
              {glyphFor('sparkles')}
            </AppText>
          }
          onClick={() => setPresetModalOpen(true)}
          variant="ghost"
        >
          {t('notifications.alertStudio.editor.presetButton', 'Pick a preset')}
        </Button>
      </View>

      <TextInput
        editable={!disabled}
        maxLength={1024}
        multiline
        onChangeText={onTemplateChange}
        placeholder={t(
          'notifications.alertStudio.editor.messageTemplatePlaceholder',
          'Battery at {{BatteryLevel}}% — leave blank for the smart default',
        )}
        placeholderTextColor={colors.textMuted}
        style={s.textarea}
        value={msgTemplate}
      />

      <Button
        disabled={disabled}
        onClick={() => setPlaceholderModalOpen(true)}
        variant="ghost"
      >
        {t(
          'notifications.alertStudio.editor.insertPlaceholderButton',
          'Insert placeholder',
        )}
      </Button>

      <GlassPanel style={s.innerPanel}>
        <AppText style={s.fieldLabel} weight="semibold">
          {t('notifications.alertStudio.editor.previewLabel', 'Preview')}
        </AppText>
        {previewMut.isPending && preview == null ? (
          <AppText style={s.hintText} tone="muted">
            {t('notifications.alertStudio.editor.previewLoading', 'Rendering…')}
          </AppText>
        ) : previewError ? (
          <AppText style={s.hintText} tone="danger">
            {previewError}
          </AppText>
        ) : preview ? (
          <View>
            {includeTitle && preview.title ? (
              <AppText style={s.previewTitle} weight="semibold">
                {preview.title}
              </AppText>
            ) : null}
            <AppText style={s.hintText}>{preview.body}</AppText>
          </View>
        ) : null}
      </GlassPanel>

      <Modal
        onClose={() => setPlaceholderModalOpen(false)}
        open={placeholderModalOpen}
        size="md"
        title={t(
          'notifications.alertStudio.editor.placeholderModalTitle',
          'Insert placeholder',
        )}
      >
        <ScrollView style={s.selectMenu}>
          {placeholdersQuery.isLoading ? (
            <Skeleton height={48} />
          ) : (placeholdersQuery.data ?? []).length === 0 ? (
            <AppText style={s.hintText} tone="muted">
              {t(
                'notifications.alertStudio.editor.placeholderEmpty',
                'No placeholders available for this rule yet.',
              )}
            </AppText>
          ) : (
            (placeholdersQuery.data ?? []).map(p => (
              <Pressable
                accessibilityRole="button"
                key={p.key}
                onPress={() => insertPlaceholder(p)}
                style={({ pressed }) => [
                  s.selectOption,
                  pressed && s.btnPressed,
                ]}
              >
                <View style={s.flexItem}>
                  <AppText weight="semibold">{`{{${p.key}}}`}</AppText>
                  <AppText style={s.hintText} tone="muted">
                    {p.label}
                  </AppText>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </Modal>

      <Modal
        onClose={() => setPresetModalOpen(false)}
        open={presetModalOpen}
        size="lg"
        title={t(
          'notifications.alertStudio.editor.presetModalTitle',
          'Message presets',
        )}
      >
        <View style={s.rowWrap}>
          <Chip
            active={presetFilter === null}
            onPress={() => setPresetFilter(null)}
          >
            {t('notifications.alertStudio.editor.presetAllTag', 'All')}
          </Chip>
          {presetTags.map(tag => (
            <Chip
              active={presetFilter === tag}
              key={tag}
              onPress={() => setPresetFilter(tag === presetFilter ? null : tag)}
            >
              {tag}
            </Chip>
          ))}
        </View>
        <ScrollView style={s.presetList}>
          {presetsQuery.isLoading ? (
            <Skeleton height={64} />
          ) : filteredPresets.length === 0 ? (
            <AppText style={s.hintText} tone="muted">
              {t(
                'notifications.alertStudio.editor.presetEmpty',
                'No presets match the current rule.',
              )}
            </AppText>
          ) : (
            filteredPresets.map(preset => (
              <Pressable
                accessibilityRole="button"
                key={preset.id}
                onPress={() => applyPreset(preset)}
                style={({ pressed }) => [s.presetCard, pressed && s.btnPressed]}
              >
                <AppText weight="semibold">{preset.name}</AppText>
                {preset.description ? (
                  <AppText style={s.hintText} tone="muted">
                    {preset.description}
                  </AppText>
                ) : null}
                <AppText style={s.presetTemplate} tone="muted">
                  {preset.template}
                </AppText>
              </Pressable>
            ))
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertStudio page                                                   */
/* ------------------------------------------------------------------ */

export default function AlertStudio() {
  const { t } = useNativeTranslation();
  const pageTitle = t('notifications.alertStudio.title', 'Alert Studio');
  const pageSubtitle = t(
    'notifications.alertStudio.subtitle',
    'Create custom rules from Fleet Telemetry signals',
  );
  const untitledRuleLabel = t(
    'notifications.alertStudio.rules.untitled',
    'Untitled',
  );
  useNativePageTitle(pageTitle);

  const { data: rules, isLoading, error } = useAlertRules();
  const {
    data: channels,
    isLoading: channelsLoading,
    error: channelsError,
  } = useNotificationChannels();
  const { data: vehiclesData } = useVehicles();
  const vehicles = useMemo(() => vehiclesData ?? [], [vehiclesData]);
  const saveRuleMut = useSaveAlertRule();
  const deleteRuleMut = useDeleteAlertRule();
  const toggleRuleMut = useToggleAlertRule();
  const testRuleMut = useTestAlertRule();
  const snoozeRuleMut = useSnoozeAlertRule();
  const [snoozeTargetId, setSnoozeTargetId] = useState<number | null>(null);
  const { confirm: confirmDelete, dialogProps: deleteDialogProps } =
    useNativeConfirm();
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } =
    useNativeConfirm();
  const { vehicleId: aiVehicleId } = useNativeSelectedVehicle(vehicles);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const clearBulk = useCallback(() => setBulkSelected(new Set()), []);
  const toggleBulkSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const bulkEnableMut = useBulkEnableRules();
  const bulkDisableMut = useBulkDisableRules();
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useNativeUrlString('q', '');
  const [testChannelIds, setTestChannelIds] = useState<number[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const initialEditorRef = useRef<string>(JSON.stringify(freshEditor()));
  const pendingHydrationRef = useRef<EditorState | null>(null);

  const draftKey = `alertstudio:rule:${selectedId ?? 'new'}`;
  const isNewRule = selectedId === null;
  const freshEditorJsonRef = useRef<string>(JSON.stringify(freshEditor()));
  const {
    value: editor,
    setValue: setEditor,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useNativeFormDraft<EditorState>(draftKey, freshEditor(), {
    version: 5,
    debounceMs: 800,
    skipPersist: (v: EditorState) =>
      saveRuleMut.isPending ||
      deleteRuleMut.isPending ||
      !isNewRule ||
      JSON.stringify(v) === freshEditorJsonRef.current,
  });

  const isDirty = useMemo(
    () => JSON.stringify(editor) !== initialEditorRef.current,
    [editor],
  );

  const previewVehicleName = useMemo<string | undefined>(() => {
    if (editor.vehicle_selection.kind === 'specific') {
      const firstId = editor.vehicle_selection.vehicle_ids[0];
      if (firstId != null) {
        const match = vehicles.find(v => v.id === firstId);
        if (match?.display_name) {
          return match.display_name;
        }
      }
    }
    return vehicles[0]?.display_name;
  }, [editor.vehicle_selection, vehicles]);

  useEffect(() => {
    if (pendingHydrationRef.current == null) {
      return;
    }
    const next = pendingHydrationRef.current;
    pendingHydrationRef.current = null;
    setEditor(next);
    initialEditorRef.current = JSON.stringify(next);
  }, [selectedId, setEditor]);

  useNativeDirtyForm(isDirty);
  useNativeNavigationGuard(
    isDirty,
    t('forms.unsavedRule', 'You have an unsaved alert rule.'),
  );

  const dirtyStrings = useMemo(
    () => ({
      title: t('forms.unsavedTitle', 'Unsaved changes'),
      message: t(
        'forms.unsavedWarning',
        'You have unsaved changes. Discard them?',
      ),
      discardLabel: t('forms.discard', 'Discard'),
      keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
    }),
    [t],
  );

  const guardSwitch = useCallback(
    async (action: () => void) => {
      if (!isDirty) {
        action();
        return;
      }
      const ok = await confirmDiscard({
        title: dirtyStrings.title,
        message: dirtyStrings.message,
        confirmLabel: dirtyStrings.discardLabel,
        cancelLabel: dirtyStrings.keepEditingLabel,
        variant: 'warning',
        silenceKey: 'discard-draft',
      });
      if (ok) {
        action();
      }
    },
    [confirmDiscard, dirtyStrings, isDirty],
  );

  const getTemplateName = useCallback(
    (tpl: RuleTemplate) =>
      t(
        `notifications.alertStudio.templates.${templateKey(tpl.name)}.name`,
        tpl.name,
      ),
    [t],
  );

  const getTemplateMessage = useCallback(
    (tpl: RuleTemplate) =>
      t(
        `notifications.alertStudio.templates.${templateKey(tpl.name)}.message`,
        tpl.message,
      ),
    [t],
  );

  const getTemplateCategory = useCallback(
    (category: string) =>
      t(
        `notifications.alertStudio.templateCategories.${templateKey(category)}`,
        category,
      ),
    [t],
  );

  const filteredTemplates = useMemo(() => {
    let list = ruleTemplates;
    if (templateCategory) {
      list = list.filter(tpl => tpl.category === templateCategory);
    }
    if (templateSearch) {
      const q = templateSearch.toLowerCase();
      list = list.filter(
        tpl =>
          getTemplateName(tpl).toLowerCase().includes(q) ||
          getTemplateMessage(tpl).toLowerCase().includes(q) ||
          getTemplateCategory(tpl.category).toLowerCase().includes(q),
      );
    }
    return list;
  }, [
    getTemplateCategory,
    getTemplateMessage,
    getTemplateName,
    templateSearch,
    templateCategory,
  ]);

  const isEditing = selectedId !== null;
  const rulesList = useMemo(() => rules ?? [], [rules]);
  const channelsList = useMemo(() => channels ?? [], [channels]);
  const allChannelIds = useMemo(
    () => channelsList.map(ch => ch.id),
    [channelsList],
  );
  const snoozeTargetRule = useMemo(
    () =>
      snoozeTargetId == null
        ? null
        : rulesList.find(r => r.id === snoozeTargetId) ?? null,
    [snoozeTargetId, rulesList],
  );
  const snoozeTargetActive = isSnoozeActive(snoozeTargetRule?.snoozed_until);

  const handleSnooze = useCallback(
    (id: number, minutes: number) => {
      snoozeRuleMut.mutate(
        { id, minutes },
        { onSuccess: () => setSnoozeTargetId(null) },
      );
    },
    [snoozeRuleMut],
  );

  const filteredRules = useMemo(() => {
    if (!ruleSearch) {
      return rulesList;
    }
    const q = ruleSearch.toLowerCase();
    return rulesList.filter(r => (r.name || '').toLowerCase().includes(q));
  }, [rulesList, ruleSearch]);

  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) {
        return prev;
      }
      const visible = new Set(filteredRules.map(r => r.id));
      const next = new Set<number>();
      prev.forEach(id => {
        if (visible.has(id)) {
          next.add(id);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredRules]);

  const bulkRulesActions = useMemo<BulkAction[]>(
    () => [
      {
        id: 'enable',
        label: t('bulk.actions.enable', 'Enable'),
        icon: (
          <AppText style={s.btnGlyph} weight="bold">
            {glyphFor('notifications')}
          </AppText>
        ),
        onClick: async ids => {
          await bulkEnableMut.mutateAsync(ids.map(Number));
          clearBulk();
        },
      },
      {
        id: 'disable',
        label: t('bulk.actions.disable', 'Disable'),
        icon: (
          <AppText style={s.btnGlyph} weight="bold">
            {glyphFor('notificationsMuted')}
          </AppText>
        ),
        onClick: async ids => {
          await bulkDisableMut.mutateAsync(ids.map(Number));
          clearBulk();
        },
      },
    ],
    [t, bulkEnableMut, bulkDisableMut, clearBulk],
  );

  const rulesCountLabel =
    rulesList.length === 1
      ? t('notifications.alertStudio.rules.countOne', '1 rule')
      : t('notifications.alertStudio.rules.countMany', '{{count}} rules', {
          count: rulesList.length,
        });

  const severityOptions = useMemo(
    () => [
      {
        value: 'info',
        label: t('notifications.alertStudio.severity.info', 'Info'),
      },
      {
        value: 'warn',
        label: t('notifications.alertStudio.severity.warn', 'Warning'),
      },
      {
        value: 'critical',
        label: t('notifications.alertStudio.severity.critical', 'Critical'),
      },
    ],
    [t],
  );

  const enabledOptions = useMemo(
    () => [
      {
        value: 'true',
        label: t('notifications.alertStudio.editor.enabled', 'Enabled'),
      },
      {
        value: 'false',
        label: t('notifications.alertStudio.editor.disabled', 'Disabled'),
      },
    ],
    [t],
  );

  const alertBehaviorOptions = useMemo(
    () => [
      {
        value: '',
        label: t(
          'notifications.alertStudio.editor.alertBehaviorPlaceholder',
          '— Choose one —',
        ),
        disabled: true,
      },
      {
        value: 'repeat',
        label: t(
          'notifications.alertStudio.editor.alertBehavior.repeatLabel',
          'Re-alert until resolved',
        ),
      },
      {
        value: 'once',
        label: t(
          'notifications.alertStudio.editor.alertBehavior.onceLabel',
          'Notify on event',
        ),
      },
    ],
    [t],
  );

  const recommendedMode = useMemo(
    () => recommendedTriggerMode(editor.op),
    [editor.op],
  );
  const recommendedLabel = useMemo(
    () =>
      recommendedMode === 'once'
        ? t(
            'notifications.alertStudio.editor.alertBehavior.onceLabel',
            'Notify on event',
          )
        : t(
            'notifications.alertStudio.editor.alertBehavior.repeatLabel',
            'Re-alert until resolved',
          ),
    [recommendedMode, t],
  );
  const alternativeLabel = useMemo(
    () =>
      recommendedMode === 'once'
        ? t(
            'notifications.alertStudio.editor.alertBehavior.repeatLabel',
            'Re-alert until resolved',
          )
        : t(
            'notifications.alertStudio.editor.alertBehavior.onceLabel',
            'Notify on event',
          ),
    [recommendedMode, t],
  );
  const showRecommendBanner =
    isNewRule &&
    editor.trigger_mode === 'unset' &&
    editor.kind === 'signal' &&
    editor.signal_name.trim().length > 0;
  const triggerModeBlocked = isNewRule && editor.trigger_mode === 'unset';

  const signalTypeLabels = useMemo<Record<SignalValueType, string>>(
    () => ({
      numeric: t('notifications.alertStudio.signalTypes.numeric', 'Numeric'),
      text: t('notifications.alertStudio.signalTypes.text', 'Text'),
      bool: t('notifications.alertStudio.signalTypes.bool', 'Boolean'),
    }),
    [t],
  );

  const getSignalCategoryLabel = useCallback(
    (category: string) =>
      category === customSignalCategory
        ? t('notifications.alertStudio.signalCategories.custom', 'Custom')
        : getTemplateCategory(category),
    [getTemplateCategory, t],
  );

  const selectedSignal = useMemo<SignalDefinition | null>(() => {
    const knownSignal = signalCatalogByName.get(editor.signal_name);
    if (knownSignal) {
      return knownSignal;
    }
    const signalName = editor.signal_name.trim();
    if (!signalName) {
      return null;
    }
    return {
      name: signalName,
      category: customSignalCategory,
      value_type: signalTypeForValueKind(editor.value_kind),
    };
  }, [editor.signal_name, editor.value_kind]);

  const selectedSignalType = selectedSignal?.value_type ?? 'numeric';

  const signalSelectOptions = useMemo(() => {
    const options = signalCatalog.map(signal => ({
      value: signal.name,
      label: t(
        'notifications.alertStudio.signals.optionLabel',
        '{{name}} - {{type}} - {{category}}',
        {
          name: signal.name,
          type: signalTypeLabels[signal.value_type],
          category: getSignalCategoryLabel(signal.category),
        },
      ),
    }));
    if (!selectedSignal || signalCatalogByName.has(selectedSignal.name)) {
      return options;
    }
    return [
      {
        value: selectedSignal.name,
        label: t(
          'notifications.alertStudio.signals.customOptionLabel',
          '{{name}} - {{type}} - Custom',
          {
            name: selectedSignal.name,
            type: signalTypeLabels[selectedSignal.value_type],
          },
        ),
      },
      ...options,
    ];
  }, [getSignalCategoryLabel, selectedSignal, signalTypeLabels, t]);

  const operatorSelectOptions = useMemo(
    () =>
      allowedOpsForSignalType(selectedSignalType).map(op => ({
        value: op,
        label: t(`notifications.alertStudio.operators.${op}`, op),
      })),
    [selectedSignalType, t],
  );

  const boolOptions = useMemo(
    () => [
      {
        value: 'true',
        label: t('notifications.alertStudio.boolean.true', 'True'),
      },
      {
        value: 'false',
        label: t('notifications.alertStudio.boolean.false', 'False'),
      },
    ],
    [t],
  );

  const computedMetricsQuery = useAlertMetrics();
  const computedMetrics = useMemo<ComputedMetricSummary[]>(
    () => computedMetricsQuery.data ?? [],
    [computedMetricsQuery.data],
  );

  const canSave = useMemo(() => {
    if (editor.name.trim().length === 0) {
      return false;
    }
    if (editor.cooldown_min <= 0) {
      return false;
    }
    if (isNewRule && editor.trigger_mode === 'unset') {
      return false;
    }
    if (
      editor.vehicle_selection.kind === 'specific' &&
      editor.vehicle_selection.vehicle_ids.length === 0
    ) {
      return false;
    }
    if (editor.escalation_enabled) {
      if (editor.trigger_mode !== 'repeat') {
        return false;
      }
      const after = parseOptionalMaxFires(editor.escalation_after_min);
      if (after == null) {
        return false;
      }
      if (editor.escalation_severity === '') {
        return false;
      }
      if (
        SEVERITY_RANK[editor.escalation_severity] <=
        SEVERITY_RANK[editor.severity]
      ) {
        return false;
      }
    }
    if (editor.kind === 'computed_metric') {
      if (!editor.metric_id || !editor.metric_window || !editor.metric_op) {
        return false;
      }
      if (parseOptionalNumber(editor.metric_threshold) == null) {
        return false;
      }
      if (
        computedMetrics.length > 0 &&
        !hasComputedMetricInputs(editor, computedMetrics)
      ) {
        return false;
      }
      return true;
    }
    return (
      editor.signal_name.trim().length > 0 &&
      isOperatorAllowedForState(editor) &&
      hasRequiredTypedValue(editor)
    );
  }, [computedMetrics, editor, isNewRule]);

  const handleSelectRule = useCallback(
    (rule: AlertRule) => {
      guardSwitch(() => {
        const nextEditor = ruleToEditor(rule);
        const signalType = signalTypeForName(
          nextEditor.signal_name,
          nextEditor.value_kind,
        );
        const nextOp = coerceOperatorForSignalType(nextEditor.op, signalType);
        const finalEditor: EditorState = {
          ...nextEditor,
          op: nextOp,
          value_kind: valueKindForSignalOp(signalType, nextOp),
        };
        pendingHydrationRef.current = finalEditor;
        setSelectedId(rule.id);
        setEditor(finalEditor);
        initialEditorRef.current = JSON.stringify(finalEditor);
        setFormError(null);
      });
    },
    [guardSwitch, setEditor],
  );

  const handleNewRule = useCallback(() => {
    guardSwitch(() => {
      const blank = freshEditor();
      pendingHydrationRef.current = blank;
      setSelectedId(null);
      setEditor(blank);
      initialEditorRef.current = JSON.stringify(blank);
      setFormError(null);
    });
  }, [guardSwitch, setEditor]);

  const handleCloneTemplate = useCallback(
    (tpl: RuleTemplate) => {
      guardSwitch(() => {
        const next = templateToEditor(
          tpl,
          getTemplateName(tpl),
          getTemplateMessage(tpl),
        );
        pendingHydrationRef.current = next;
        setSelectedId(null);
        setEditor(next);
        initialEditorRef.current = JSON.stringify(next);
        setShowTemplates(false);
        setFormError(null);
      });
    },
    [getTemplateMessage, getTemplateName, guardSwitch, setEditor],
  );

  const handleSignalChange = useCallback(
    (signalName: string) => {
      setEditor(current => {
        const signalType = signalName
          ? signalTypeForName(signalName, current.value_kind)
          : 'numeric';
        const nextOp = coerceOperatorForSignalType(current.op, signalType);
        return {
          ...current,
          signal_name: signalName,
          op: nextOp,
          value_kind: valueKindForSignalOp(signalType, nextOp),
        };
      });
    },
    [setEditor],
  );

  const handleOperatorChange = useCallback(
    (nextOp: RuleOp) => {
      setEditor(current => {
        const signalType = signalTypeForName(
          current.signal_name,
          current.value_kind,
        );
        const coercedOp = coerceOperatorForSignalType(nextOp, signalType);
        return {
          ...current,
          op: coercedOp,
          value_kind: valueKindForSignalOp(signalType, coercedOp),
        };
      });
    },
    [setEditor],
  );

  const handleSave = useCallback(() => {
    if (!canSave) {
      return;
    }
    const payload = buildSavePayload(editor);
    const parsed = alertRuleSchema.safeParse(payload);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setFormError(
        firstIssue?.message ??
          t(
            'forms.validationFailed',
            'Please fix the highlighted fields and try again.',
          ),
      );
      return;
    }
    setFormError(null);
    saveRuleMut.mutate(editor.id ? { id: editor.id, ...payload } : payload, {
      onSuccess: () => {
        discardDraft();
        const blank = freshEditor();
        pendingHydrationRef.current = blank;
        setSelectedId(null);
        setEditor(blank);
        initialEditorRef.current = JSON.stringify(blank);
      },
    });
  }, [canSave, discardDraft, editor, saveRuleMut, setEditor, t]);

  const handleDelete = useCallback(
    (id: number) => {
      deleteRuleMut.mutate(id, {
        onSuccess: () => {
          discardDraft();
          const blank = freshEditor();
          pendingHydrationRef.current = blank;
          setSelectedId(null);
          setEditor(blank);
          initialEditorRef.current = JSON.stringify(blank);
          setFormError(null);
        },
      });
    },
    [deleteRuleMut, discardDraft, setEditor],
  );

  const handleApplyAITuningPatch = useCallback(
    (patch: AlertRuleDraftPatch) => {
      setEditor(state => {
        const next = { ...state };
        if (patch.value_num != null) {
          next.value_num = String(patch.value_num);
        }
        if (patch.value_min != null) {
          next.value_min = String(patch.value_min);
        }
        if (patch.value_max != null) {
          next.value_max = String(patch.value_max);
        }
        if (typeof patch.cooldown_min === 'number') {
          next.cooldown_min = patch.cooldown_min;
        }
        if (patch.severity) {
          next.severity = patch.severity as Severity;
        }
        if (patch.trigger_mode) {
          next.trigger_mode = patch.trigger_mode as TriggerModeOrUnset;
        }
        if (patch.op) {
          next.op = patch.op as RuleOp;
        }
        return next;
      });
    },
    [setEditor],
  );

  const handleToggleTestChannel = useCallback(
    (channelId: number) => {
      setTestChannelIds(current => {
        const selected = current ?? allChannelIds;
        const next = selected.includes(channelId)
          ? selected.filter(id => id !== channelId)
          : [...selected, channelId];
        if (next.length === 0) {
          return current;
        }
        return next.length === allChannelIds.length ? null : next;
      });
    },
    [allChannelIds],
  );

  const handleTest = useCallback(() => {
    const message =
      editor.message.trim() ||
      t(
        'notifications.alertStudio.test.defaultMessage',
        'Test notification from Alert Studio',
      );
    const target = buildTestTarget(testChannelIds, allChannelIds);
    const msgTemplate = normalizeMsgTemplateForSave(editor.msg_template);
    const baseBody = {
      message,
      msg_template: msgTemplate,
      include_title: editor.include_title,
    };
    testRuleMut.mutate(target ? { ...baseBody, target } : baseBody);
  }, [
    allChannelIds,
    editor.include_title,
    editor.message,
    editor.msg_template,
    t,
    testChannelIds,
    testRuleMut,
  ]);

  const renderValueEditor = () => {
    if (!editor.signal_name.trim()) {
      return (
        <EmptyState
          icon={<SemanticIcon decorative name="info" />}
          message={t(
            'notifications.alertStudio.editor.noSignalDescription',
            'Select a telemetry signal before entering a comparison value.',
          )}
          title={t(
            'notifications.alertStudio.editor.noSignalTitle',
            'Choose a signal',
          )}
        />
      );
    }

    const valueKind = valueKindForState(editor);

    if (valueKind === 'range') {
      return (
        <View style={s.rowWrap}>
          <View style={s.flexItem}>
            <Field
              label={t(
                'notifications.alertStudio.editor.minValueLabel',
                'Minimum Value',
              )}
            >
              <NativeInput
                onChange={e =>
                  setEditor(st => ({ ...st, value_min: e.target.value }))
                }
                type="number"
                value={editor.value_min}
              />
            </Field>
          </View>
          <View style={s.flexItem}>
            <Field
              label={t(
                'notifications.alertStudio.editor.maxValueLabel',
                'Maximum Value',
              )}
            >
              <NativeInput
                onChange={e =>
                  setEditor(st => ({ ...st, value_max: e.target.value }))
                }
                type="number"
                value={editor.value_max}
              />
            </Field>
          </View>
        </View>
      );
    }

    if (valueKind === 'text') {
      return (
        <Field
          label={t(
            'notifications.alertStudio.editor.textValueLabel',
            'Text Value',
          )}
        >
          <NativeInput
            onChange={e =>
              setEditor(st => ({ ...st, value_text: e.target.value }))
            }
            placeholder={t(
              'notifications.alertStudio.editor.textValuePlaceholder',
              'Value to compare',
            )}
            value={editor.value_text}
          />
        </Field>
      );
    }

    if (valueKind === 'bool') {
      return (
        <Field
          label={t(
            'notifications.alertStudio.editor.booleanValueLabel',
            'Boolean Value',
          )}
        >
          <NativeSelect
            onChange={e =>
              setEditor(st => ({
                ...st,
                value_bool: e.target.value === 'true',
              }))
            }
            options={boolOptions}
            value={String(editor.value_bool)}
          />
        </Field>
      );
    }

    if (valueKind === 'none') {
      return (
        <GlassPanel style={s.innerPanel}>
          <AppText style={s.hintText} tone="muted">
            {t(
              'notifications.alertStudio.editor.anyChangeDescription',
              'This rule fires whenever the selected signal changes.',
            )}
          </AppText>
        </GlassPanel>
      );
    }

    return (
      <Field
        label={t(
          'notifications.alertStudio.editor.numericValueLabel',
          'Numeric Value',
        )}
      >
        <NativeInput
          onChange={e =>
            setEditor(st => ({ ...st, value_num: e.target.value }))
          }
          type="number"
          value={editor.value_num}
        />
      </Field>
    );
  };

  return (
    <PageContainerView
      actions={
        <View style={s.pageActionsRow}>
          <Button
            icon={
              <AppText style={s.btnGlyph} weight="bold">
                {glyphFor('sparkles')}
              </AppText>
            }
            onClick={() => setShowTemplates(!showTemplates)}
            variant="ghost"
          >
            {t('notifications.alertStudio.actions.templates', 'Templates')}
          </Button>
          <Button
            icon={
              <AppText style={s.btnGlyph} weight="bold">
                {glyphFor('add')}
              </AppText>
            }
            onClick={handleNewRule}
            variant="primary"
          >
            {t('notifications.alertStudio.actions.newRule', 'New Rule')}
          </Button>
        </View>
      }
      error={error ?? null}
      loading={isLoading}
      subtitle={pageSubtitle}
      title={pageTitle}
    >
      {/* Opt-in AI natural-language alert builder (propose-only). */}
      <FadeIn delay={0.04}>
        <AINLAlertBuilder vehicleId={aiVehicleId ?? undefined} />
      </FadeIn>

      {showTemplates ? (
        <FadeIn>
          <GlassPanel style={s.panel}>
            <View style={s.rowBetween}>
              <AppText style={s.sectionTitle} weight="semibold">
                {t(
                  'notifications.alertStudio.templates.header',
                  'Rule Templates - {{count}} pre-built rules',
                  { count: ruleTemplates.length },
                )}
              </AppText>
            </View>
            <View style={s.searchRow}>
              <SearchInput
                onChange={setTemplateSearch}
                placeholder={t(
                  'notifications.alertStudio.templates.searchPlaceholder',
                  'Search templates...',
                )}
                value={templateSearch}
              />
            </View>

            <View style={s.rowWrap}>
              <Chip
                active={templateCategory === null}
                onPress={() => setTemplateCategory(null)}
              >
                {`${t(
                  'notifications.alertStudio.templates.allCategory',
                  'All',
                )} (${ruleTemplates.length})`}
              </Chip>
              {templateCategories.map(cat => {
                const count = ruleTemplates.filter(
                  tpl => tpl.category === cat,
                ).length;
                return (
                  <Chip
                    active={templateCategory === cat}
                    key={cat}
                    onPress={() =>
                      setTemplateCategory(cat === templateCategory ? null : cat)
                    }
                  >
                    {`${getTemplateCategory(cat)} (${count})`}
                  </Chip>
                );
              })}
            </View>

            <View style={s.templatesGrid}>
              {filteredTemplates.map(tpl => {
                const tone = severityColors[tpl.severity];
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={tpl.name}
                    onPress={() => handleCloneTemplate(tpl)}
                    style={({ pressed }) => [
                      s.templateCard,
                      pressed && s.btnPressed,
                    ]}
                  >
                    <View style={s.templateHeader}>
                      <View
                        style={[
                          s.templateIconBox,
                          {
                            backgroundColor: tone.surface,
                            borderColor: tone.border,
                          },
                        ]}
                      >
                        <AppText
                          style={[s.templateIconGlyph, { color: tone.fg }]}
                          weight="bold"
                        >
                          {glyphFor(tpl.icon)}
                        </AppText>
                      </View>
                      <AppText
                        numberOfLines={1}
                        style={s.templateName}
                        weight="semibold"
                      >
                        {getTemplateName(tpl)}
                      </AppText>
                    </View>
                    <AppText
                      numberOfLines={1}
                      style={s.templateMessage}
                      tone="muted"
                    >
                      {getTemplateMessage(tpl)}
                    </AppText>
                    <View style={s.rowBetween}>
                      <SeverityBadge severity={tpl.severity}>
                        {t(
                          `notifications.alertStudio.severity.${tpl.severity}`,
                          tpl.severity === 'warn' ? 'Warning' : tpl.severity,
                        )}
                      </SeverityBadge>
                      <View style={s.inlineRow}>
                        <AppText style={s.metaGlyph} tone="muted" weight="bold">
                          {glyphFor('copy')}
                        </AppText>
                        <AppText style={s.metaText} tone="muted">
                          {t('notifications.alertStudio.templates.use', 'Use')}
                        </AppText>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              {filteredTemplates.length === 0 ? (
                <EmptyState
                  icon={<SemanticIcon decorative name="sparkles" />}
                  message={t(
                    'notifications.alertStudio.templates.noMatches',
                    'No templates match your search',
                  )}
                  title={t(
                    'notifications.alertStudio.templates.noMatchesTitle',
                    'No templates found',
                  )}
                />
              ) : null}
            </View>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* Rules list column */}
      <GlassPanel style={s.panel}>
        <View style={s.rowBetween}>
          <AppText style={s.sectionTitle} weight="semibold">
            {t('notifications.alertStudio.rules.title', 'Rules')}
          </AppText>
          <AppText style={s.metaText} tone="muted">
            {rulesCountLabel}
          </AppText>
        </View>

        {rulesList.length > 3 ? (
          <View style={s.searchRow}>
            <SearchInput
              onChange={setRuleSearch}
              placeholder={t(
                'notifications.alertStudio.rules.searchPlaceholder',
                'Search rules...',
              )}
              value={ruleSearch}
            />
          </View>
        ) : null}

        {isLoading ? (
          <View style={s.stack}>
            {[1, 2, 3].map(i => (
              <Skeleton height={64} key={i} />
            ))}
          </View>
        ) : null}

        {!isLoading && rulesList.length === 0 ? (
          <EmptyState
            icon={<SemanticIcon decorative name="notifications" />}
            message={t(
              'notifications.alertStudio.rules.emptyDescription',
              'Create your first rule or pick a template above.',
            )}
            title={t(
              'notifications.alertStudio.rules.emptyTitle',
              'No alert rules yet',
            )}
          />
        ) : null}

        {!isLoading && rulesList.length > 0 && filteredRules.length === 0 ? (
          <EmptyState
            icon={<SemanticIcon decorative name="search" />}
            message={t(
              'notifications.alertStudio.rules.noMatches',
              'No rules match "{{search}}"',
              { search: ruleSearch },
            )}
            title={t(
              'notifications.alertStudio.rules.noMatchesTitle',
              'No matching rules',
            )}
          />
        ) : null}

        <BulkActionsToolbar
          actions={bulkRulesActions}
          itemNoun={{
            one: t('bulk.noun.rule_one', 'alert rule'),
            other: t('bulk.noun.rule_other', 'alert rules'),
          }}
          onClear={clearBulk}
          selectedIds={Array.from(bulkSelected)}
          total={filteredRules.length}
        />

        <View style={s.stack}>
          {filteredRules.map(rule => {
            const sev = normalizeSeverity(rule.severity);
            const active = selectedId === rule.id;
            const snoozed = isSnoozeActive(rule.snoozed_until);
            const triggerMode = normalizeTriggerMode(rule.trigger_mode);
            const checked = bulkSelected.has(rule.id);
            return (
              <GlassPanel
                key={rule.id}
                style={[s.ruleRow, active && s.ruleRowActive]}
              >
                <View style={s.ruleRowInner}>
                  <NativeCheckbox
                    accessibilityLabel={t(
                      'notifications.alertStudio.rules.selectRow',
                      'Select rule {{name}}',
                      { name: rule.name || untitledRuleLabel },
                    )}
                    checked={checked}
                    onChange={next => toggleBulkSelected(rule.id, next)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleSelectRule(rule)}
                    style={s.ruleRowBody}
                  >
                    <View style={s.ruleTitleRow}>
                      <SeverityIcon severity={sev} />
                      <AppText
                        numberOfLines={1}
                        style={s.ruleName}
                        weight="semibold"
                      >
                        {rule.name || untitledRuleLabel}
                      </AppText>
                      {triggerMode === 'once' ? (
                        <Badge variant="info">
                          {t(
                            'notifications.alertStudio.rules.onceMode',
                            'Once',
                          )}
                        </Badge>
                      ) : null}
                      {snoozed && rule.snoozed_until ? (
                        <Badge variant="warning">
                          {t(
                            'notifications.alertStudio.snooze.badge',
                            'Snoozed until {{time}}',
                            { time: formatDateTime(rule.snoozed_until) },
                          )}
                        </Badge>
                      ) : null}
                    </View>
                    <View style={s.ruleMetaRow}>
                      <AppText style={s.ruleMeta} tone="muted">
                        {`${rule.signal_name} ${rule.op}`}
                      </AppText>
                      {rule.updated_at ? (
                        <View style={s.inlineRow}>
                          <AppText
                            style={s.metaGlyph}
                            tone="muted"
                            weight="bold"
                          >
                            {glyphFor('clock')}
                          </AppText>
                          <AppText style={s.ruleMeta} tone="muted">
                            {formatDateTime(rule.updated_at)}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                  <IconButton
                    accessibilityLabel={
                      snoozed
                        ? t(
                            'notifications.alertStudio.snooze.manage',
                            'Manage snooze',
                          )
                        : t('notifications.alertStudio.snooze.button', 'Snooze')
                    }
                    glyph={glyphFor('moonStar')}
                    onPress={() => setSnoozeTargetId(rule.id)}
                    tone={snoozed ? colors.warning : colors.textMuted}
                  />
                  <IconButton
                    accessibilityLabel={
                      rule.enabled
                        ? t(
                            'notifications.alertStudio.rules.disableRule',
                            'Disable rule',
                          )
                        : t(
                            'notifications.alertStudio.rules.enableRule',
                            'Enable rule',
                          )
                    }
                    glyph={glyphFor(
                      rule.enabled ? 'notifications' : 'notificationsMuted',
                    )}
                    onPress={() =>
                      toggleRuleMut.mutate({
                        id: rule.id,
                        enabled: !rule.enabled,
                      })
                    }
                    tone={rule.enabled ? colors.success : colors.textMuted}
                  />
                  <IconButton
                    accessibilityLabel={t(
                      'notifications.alertStudio.rules.deleteRule',
                      'Delete rule',
                    )}
                    glyph={glyphFor('delete')}
                    onPress={async () => {
                      const ruleName = rule.name || untitledRuleLabel;
                      const ok = await confirmDelete({
                        title: t(
                          'notifications.alertStudio.rules.confirmDeleteTitle',
                          'Delete rule?',
                        ),
                        message: t(
                          'notifications.alertStudio.rules.confirmDelete',
                          'Delete "{{name}}"?',
                          { name: ruleName },
                        ),
                        variant: 'danger',
                        confirmLabel: t('common.delete', 'Delete'),
                        cancelLabel: t('common.cancel', 'Cancel'),
                      });
                      if (ok) {
                        handleDelete(rule.id);
                      }
                    }}
                    tone={colors.textMuted}
                  />
                </View>
              </GlassPanel>
            );
          })}
        </View>
      </GlassPanel>

      {/* Editor column */}
      <View style={s.stack}>
        {(rules?.length ?? 0) >= 2 ? (
          <FadeIn delay={0.02}>
            <AICrossRuleConflictDetection
              onSelectRule={setSelectedId}
              ruleIds={(rules ?? []).map(r => r.id)}
              vehicleId={aiVehicleId ?? undefined}
            />
          </FadeIn>
        ) : null}
        {selectedId != null ? (
          <FadeIn delay={0.04}>
            <AIAlertTuningSuggestions
              onApplyDraft={handleApplyAITuningPatch}
              ruleId={selectedId}
              vehicleId={aiVehicleId ?? undefined}
            />
          </FadeIn>
        ) : null}
        <GlassPanel style={s.panel}>
          <View style={s.editorHeader}>
            <AppText style={s.editorGlyph} tone="accent" weight="bold">
              {glyphFor('pencil')}
            </AppText>
            <AppText style={s.sectionTitle} weight="semibold">
              {isEditing
                ? t('notifications.alertStudio.editor.editTitle', 'Edit Rule')
                : t('notifications.alertStudio.editor.newTitle', 'New Rule')}
            </AppText>
          </View>

          {hasDraft ? (
            <View style={s.blockSpacer}>
              <DraftRecoveryBanner
                draftSavedAt={draftSavedAt}
                hasDraft={hasDraft}
                itemNoun={t('draft.noun.rule', 'Alert rule')}
                onDiscard={discardDraft}
              />
            </View>
          ) : null}

          {formError ? (
            <View style={s.blockSpacer}>
              <AlertBanner
                title={t(
                  'forms.validationFailed',
                  'Please fix the highlighted fields and try again.',
                )}
                variant="danger"
              >
                {formError}
              </AlertBanner>
            </View>
          ) : null}

          <View style={s.rowWrap}>
            <View style={s.flexItem}>
              <Field
                label={t('notifications.alertStudio.editor.nameLabel', 'Name')}
              >
                <NativeInput
                  onChange={e =>
                    setEditor(st => ({ ...st, name: e.target.value }))
                  }
                  placeholder={t(
                    'notifications.alertStudio.editor.namePlaceholder',
                    'My alert rule',
                  )}
                  value={editor.name}
                />
              </Field>
            </View>
            <View style={s.flexItem}>
              <Field
                label={t(
                  'notifications.alertStudio.editor.enabledLabel',
                  'Status',
                )}
              >
                <NativeSelect
                  onChange={e =>
                    setEditor(st => ({
                      ...st,
                      enabled: e.target.value === 'true',
                    }))
                  }
                  options={enabledOptions}
                  value={String(editor.enabled)}
                />
              </Field>
            </View>
          </View>

          <View style={s.rowWrap}>
            <View style={s.flexItem}>
              <Field
                help="Choose 'All vehicles' to apply this rule to your entire fleet, including any cars you add later. Otherwise pick a specific subset."
                label={t(
                  'notifications.alertStudio.editor.vehiclesLabel',
                  'Vehicles',
                )}
              >
                <VehicleMultiSelect
                  errorKey={
                    editor.vehicle_selection.kind === 'specific' &&
                    editor.vehicle_selection.vehicle_ids.length === 0
                      ? 'notifications.alertStudio.editor.vehiclesEmptyError'
                      : null
                  }
                  onChange={next =>
                    setEditor(st => ({ ...st, vehicle_selection: next }))
                  }
                  value={editor.vehicle_selection}
                  vehicles={vehicles}
                />
              </Field>
            </View>
            <View style={s.flexItemWide}>
              <FieldLabel
                help="Choose 'Signal threshold' to trigger when a raw telemetry signal crosses a value. Choose 'Computed metric' to trigger on a derived analytic such as efficiency or charging cost."
                label={t(
                  'notifications.alertStudio.editor.kindLabel',
                  'Rule type',
                )}
              />
              <View style={s.segmented}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: editor.kind === 'signal' }}
                  onPress={() => setEditor(st => ({ ...st, kind: 'signal' }))}
                  style={[
                    s.segment,
                    editor.kind === 'signal' && s.segmentActive,
                  ]}
                >
                  <AppText
                    style={
                      editor.kind === 'signal'
                        ? s.segmentTextActive
                        : s.segmentText
                    }
                  >
                    {t(
                      'notifications.alertStudio.kind.signal',
                      'Signal threshold',
                    )}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: editor.kind === 'computed_metric',
                  }}
                  onPress={() =>
                    setEditor(st => ({ ...st, kind: 'computed_metric' }))
                  }
                  style={[
                    s.segment,
                    editor.kind === 'computed_metric' && s.segmentActive,
                  ]}
                >
                  <AppText
                    style={
                      editor.kind === 'computed_metric'
                        ? s.segmentTextActive
                        : s.segmentText
                    }
                  >
                    {t(
                      'notifications.alertStudio.kind.computedMetric',
                      'Computed metric',
                    )}
                  </AppText>
                </Pressable>
              </View>
              <AppText style={s.hintText} tone="muted">
                {editor.kind === 'computed_metric'
                  ? t(
                      'notifications.alertStudio.kind.computedMetricHint',
                      'Aggregate metric (cost, kWh, distance) over a time window.',
                    )
                  : t(
                      'notifications.alertStudio.kind.signalHint',
                      'Fires when a raw telemetry signal crosses a threshold.',
                    )}
              </AppText>
            </View>
          </View>

          {editor.kind === 'computed_metric' ? (
            <ComputedMetricEditor
              loading={computedMetricsQuery.isLoading}
              metrics={computedMetrics}
              onChange={next =>
                setEditor(st => ({
                  ...st,
                  metric_id: next.metric_id,
                  metric_window: next.metric_window,
                  metric_op: next.metric_op,
                  metric_threshold: next.metric_threshold,
                }))
              }
              value={{
                metric_id: editor.metric_id,
                metric_window: editor.metric_window,
                metric_op: editor.metric_op,
                metric_threshold: editor.metric_threshold,
                vehicle_id:
                  editor.vehicle_selection.kind === 'specific' &&
                  editor.vehicle_selection.vehicle_ids.length > 0
                    ? editor.vehicle_selection.vehicle_ids[0]
                    : null,
              }}
            />
          ) : (
            <View style={s.rowWrap}>
              <View style={s.flexItem}>
                <Field
                  label={t(
                    'notifications.alertStudio.editor.signalNameLabel',
                    'Signal',
                  )}
                >
                  <NativeSelect
                    onChange={e => handleSignalChange(e.target.value)}
                    options={signalSelectOptions}
                    placeholder={t(
                      'notifications.alertStudio.editor.signalNamePlaceholder',
                      'Select a telemetry signal',
                    )}
                    value={editor.signal_name}
                  />
                  {selectedSignal ? (
                    <AppText style={s.hintText} tone="muted">
                      {t(
                        'notifications.alertStudio.editor.signalTypeHint',
                        '{{type}} signal from {{category}}',
                        {
                          type: signalTypeLabels[selectedSignal.value_type],
                          category: getSignalCategoryLabel(
                            selectedSignal.category,
                          ),
                        },
                      )}
                    </AppText>
                  ) : null}
                </Field>
              </View>
              <View style={s.flexItem}>
                <Field
                  help="The comparison applied between the live signal value and your typed value. Available operators depend on the signal's value type."
                  label={t(
                    'notifications.alertStudio.editor.operatorLabel',
                    'Operator',
                  )}
                >
                  <NativeSelect
                    disabled={!editor.signal_name.trim()}
                    onChange={e =>
                      handleOperatorChange(e.target.value as RuleOp)
                    }
                    options={operatorSelectOptions}
                    value={editor.op}
                  />
                </Field>
              </View>
            </View>
          )}

          <View style={s.rowWrap}>
            <View style={s.flexItem}>
              <Field
                help="Determines how the alert is presented and prioritised: Info is informational, Warning is actionable, Critical is urgent."
                label={t(
                  'notifications.alertStudio.editor.severityLabel',
                  'Severity',
                )}
              >
                <NativeSelect
                  onChange={e => {
                    const next = e.target.value as Severity;
                    setEditor(st => {
                      const escSev = st.escalation_severity;
                      const stillValid =
                        escSev === '' ||
                        SEVERITY_RANK[escSev] > SEVERITY_RANK[next];
                      return {
                        ...st,
                        severity: next,
                        escalation_severity: stillValid ? escSev : '',
                      };
                    });
                  }}
                  options={severityOptions}
                  value={editor.severity}
                />
              </Field>
            </View>
            {editor.kind !== 'computed_metric' ? (
              <View style={s.flexItem}>
                <GlassPanel style={s.innerPanel}>
                  <AppText style={s.fieldLabel} weight="semibold">
                    {t(
                      'notifications.alertStudio.editor.allowedOperatorsLabel',
                      'Allowed Operators',
                    )}
                  </AppText>
                  <AppText style={s.hintText}>
                    {editor.signal_name.trim()
                      ? operatorSelectOptions
                          .map(option => option.label)
                          .join('  ')
                      : t(
                          'notifications.alertStudio.editor.allowedOperatorsPlaceholder',
                          'Select a signal to see its operators',
                        )}
                  </AppText>
                </GlassPanel>
              </View>
            ) : null}
          </View>

          {editor.kind !== 'computed_metric' ? (
            <View style={s.blockSpacer}>
              <AppText style={s.fieldLabel} weight="semibold">
                {t(
                  'notifications.alertStudio.editor.typedValueLabel',
                  'Typed Value',
                )}
              </AppText>
              {renderValueEditor()}
            </View>
          ) : null}

          <View style={s.rowWrap}>
            <View style={s.flexItem}>
              <Field
                help="Minimum minutes to wait between repeat firings of this rule. Helps prevent notification spam during prolonged threshold breaches."
                label={t(
                  'notifications.alertStudio.editor.cooldownLabel',
                  'Cooldown (minutes)',
                )}
              >
                <NativeInput
                  onChange={e =>
                    setEditor(st => ({
                      ...st,
                      cooldown_min: Number(e.target.value),
                    }))
                  }
                  type="number"
                  value={editor.cooldown_min}
                />
              </Field>
            </View>
            <View style={s.flexItem}>
              <FieldLabel
                help="Pick 'Notify on event' for one-time confirmations like 'vehicle locked' or 'charging done'. Pick 'Re-alert until resolved' for ongoing safety concerns like 'vehicle unlocked' or 'door open'."
                label={t(
                  'notifications.alertStudio.editor.alertBehaviorLabel',
                  'Alert Behavior',
                )}
              />
              {showRecommendBanner ? (
                <View style={s.blockSpacer}>
                  <AlertBanner variant="info">
                    <AppText style={s.alertBannerBody}>
                      {`${t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBanner',
                        'Recommended for "{{op}}" comparisons: {{recommended}}.',
                        { op: editor.op, recommended: recommendedLabel },
                      )} ${t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBannerAlt',
                        '{{alternative}} is also valid — pick whatever fits.',
                        { alternative: alternativeLabel },
                      )}`}
                    </AppText>
                  </AlertBanner>
                </View>
              ) : null}
              <NativeSelect
                onChange={e => {
                  const v = e.target.value;
                  if (v !== 'once' && v !== 'repeat') {
                    return;
                  }
                  setEditor(st => ({
                    ...st,
                    trigger_mode: v,
                    escalation_enabled:
                      v === 'repeat' ? st.escalation_enabled : false,
                    escalation_after_min:
                      v === 'repeat' ? st.escalation_after_min : '',
                    escalation_severity:
                      v === 'repeat' ? st.escalation_severity : '',
                  }));
                }}
                options={alertBehaviorOptions}
                value={
                  editor.trigger_mode === 'unset' ? '' : editor.trigger_mode
                }
              />
              {triggerModeBlocked ? (
                <AppText style={s.errorText} tone="danger">
                  {t(
                    'notifications.alertStudio.editor.alertBehavior.forceChoose',
                    'Pick how this alert should behave.',
                  )}
                </AppText>
              ) : null}
              {!triggerModeBlocked && editor.trigger_mode !== 'unset' ? (
                <AppText style={s.hintText} tone="muted">
                  {editor.trigger_mode === 'once'
                    ? t(
                        'notifications.alertStudio.editor.alertBehavior.onceDesc',
                        'Fires when the condition is first met. Stays quiet until it resets.',
                      )
                    : t(
                        'notifications.alertStudio.editor.alertBehavior.repeatDesc',
                        'Keeps firing every {{cooldown}} minutes while the condition stays true.',
                        { cooldown: editor.cooldown_min },
                      )}
                </AppText>
              ) : null}
            </View>
            {editor.trigger_mode === 'repeat' ? (
              <View style={s.flexItemWide}>
                <Field
                  help="Cap the number of times this rule can re-fire while the condition keeps holding. The counter resets to zero as soon as the condition becomes false. Leave blank for unlimited."
                  label={t(
                    'notifications.alertStudio.editor.maxFiresLabel',
                    'Max alerts before condition resolves',
                  )}
                >
                  <NativeInput
                    onChange={e =>
                      setEditor(st => ({
                        ...st,
                        max_fires_per_resolution: e.target.value,
                      }))
                    }
                    placeholder={t(
                      'notifications.alertStudio.editor.maxFiresPlaceholder',
                      'Leave blank for unlimited',
                    )}
                    type="number"
                    value={editor.max_fires_per_resolution}
                  />
                </Field>
                <AppText style={s.hintText} tone="muted">
                  {t(
                    'notifications.alertStudio.editor.maxFiresHint',
                    'Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution.',
                  )}
                </AppText>
              </View>
            ) : null}
            {editor.trigger_mode === 'repeat' ? (
              <View style={s.flexItemWide}>
                <View style={s.inlineRow}>
                  <NativeToggle
                    accessibilityLabel={t(
                      'notifications.alertStudio.editor.escalationCheckboxLabel',
                      'Escalate to a higher severity if the condition stays unresolved',
                    )}
                    checked={editor.escalation_enabled}
                    onChange={next =>
                      setEditor(st => ({
                        ...st,
                        escalation_enabled: next,
                        escalation_after_min: next
                          ? st.escalation_after_min
                          : '',
                        escalation_severity: next ? st.escalation_severity : '',
                      }))
                    }
                  />
                  <AppText style={s.hintText}>
                    {t(
                      'notifications.alertStudio.editor.escalationCheckboxLabel',
                      'Escalate to a higher severity if the condition stays unresolved',
                    )}
                  </AppText>
                  <HelpIcon content="When the underlying condition stays true for at least the minutes you specify, subsequent fires use the escalated severity instead of the base one. Useful for a soft warn → critical promotion when a problem is being ignored." />
                </View>
                {editor.escalation_enabled ? (
                  <View style={s.rowWrap}>
                    <View style={s.flexItem}>
                      <Field
                        label={t(
                          'notifications.alertStudio.editor.escalationAfterLabel',
                          'Escalate after (minutes)',
                        )}
                      >
                        <NativeInput
                          onChange={e =>
                            setEditor(st => ({
                              ...st,
                              escalation_after_min: e.target.value,
                            }))
                          }
                          placeholder={t(
                            'notifications.alertStudio.editor.escalationAfterPlaceholder',
                            'e.g. 30',
                          )}
                          type="number"
                          value={editor.escalation_after_min}
                        />
                      </Field>
                    </View>
                    <View style={s.flexItem}>
                      <Field
                        label={t(
                          'notifications.alertStudio.editor.escalationSeverityLabel',
                          'Escalated severity',
                        )}
                      >
                        <NativeSelect
                          onChange={e =>
                            setEditor(st => ({
                              ...st,
                              escalation_severity: e.target.value as
                                | Severity
                                | '',
                            }))
                          }
                          options={[
                            {
                              value: '',
                              label: t(
                                'notifications.alertStudio.editor.escalationSeverityPlaceholder',
                                'Select severity…',
                              ),
                            },
                            ...severityOptions.filter(
                              opt =>
                                SEVERITY_RANK[opt.value as Severity] >
                                SEVERITY_RANK[editor.severity],
                            ),
                          ]}
                          value={editor.escalation_severity}
                        />
                      </Field>
                    </View>
                    <AppText style={s.hintText} tone="muted">
                      {t(
                        'notifications.alertStudio.editor.escalationHint',
                        'Only repeat-mode rules can escalate. The escalated severity must be higher than the base severity.',
                      )}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={s.flexItemWide}>
              <AlertMessageEditor
                draft={{
                  name: editor.name,
                  kind: editor.kind,
                  signal_name: editor.signal_name,
                  op: editor.op,
                  severity: editor.severity,
                  vehicle_name: previewVehicleName,
                  value_num: parseOptionalNumber(editor.value_num),
                  value_text: editor.value_text || null,
                  value_bool: editor.value_bool,
                  value_min: parseOptionalNumber(editor.value_min),
                  value_max: parseOptionalNumber(editor.value_max),
                  metric_id: editor.metric_id || null,
                  metric_window: editor.metric_window || null,
                  metric_op: editor.metric_op,
                  metric_threshold: parseOptionalNumber(
                    editor.metric_threshold,
                  ),
                }}
                includeTitle={editor.include_title}
                msgTemplate={editor.msg_template}
                onIncludeTitleChange={next =>
                  setEditor(st => ({ ...st, include_title: next }))
                }
                onTemplateChange={next =>
                  setEditor(st => ({ ...st, msg_template: next }))
                }
              />
            </View>
          </View>

          <View style={s.blockSpacer}>
            <AppText style={s.fieldLabel} weight="semibold">
              {t(
                'notifications.alertStudio.channels.testTargetLabel',
                'Test Delivery Target',
              )}
            </AppText>
            <View style={s.stack}>
              <View style={s.inlineRow}>
                <View style={s.greenDot} />
                <AppText style={s.hintText}>
                  {t(
                    'notifications.alertStudio.channels.browserToast',
                    'Browser toast notification (real-time via SSE)',
                  )}
                </AppText>
              </View>
              <View style={s.inlineRow}>
                <View style={s.greenDot} />
                <AppText style={s.hintText}>
                  {t(
                    'notifications.alertStudio.channels.alertHistory',
                    'Alert history (saved to database)',
                  )}
                </AppText>
              </View>

              <GlassPanel style={s.innerPanel}>
                {channelsLoading ? (
                  <View style={s.stack}>
                    <Skeleton height={20} width={192} />
                    <View style={s.rowWrap}>
                      {[1, 2, 3].map(i => (
                        <Skeleton height={32} key={i} width={112} />
                      ))}
                    </View>
                  </View>
                ) : channelsError ? (
                  <ErrorDisplay compact error={channelsError} />
                ) : channelsList.length > 0 ? (
                  <View>
                    <AppText style={s.hintText} tone="muted">
                      {t(
                        'notifications.alertStudio.channels.externalChannels',
                        'External channels for test notifications:',
                      )}
                    </AppText>
                    <View style={s.rowWrap}>
                      {channelsList.map((ch: NotificationChannel) => {
                        const isSelected =
                          testChannelIds === null ||
                          testChannelIds.includes(ch.id);
                        return (
                          <Chip
                            active={isSelected}
                            glyph={glyphFor('notifications')}
                            key={ch.id}
                            onPress={() => handleToggleTestChannel(ch.id)}
                          >
                            {`${ch.name} (${t(
                              `notifications.alertStudio.channels.kind.${ch.kind}`,
                              ch.kind,
                            )})`}
                          </Chip>
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  <EmptyState
                    icon={<SemanticIcon decorative name="notificationsMuted" />}
                    message={t(
                      'notifications.alertStudio.channels.emptyDescription',
                      'Browser toasts and alert history are always enabled. Configure channels from Notifications to fan out alerts.',
                    )}
                    title={t(
                      'notifications.alertStudio.channels.emptyTitle',
                      'No external channels configured',
                    )}
                  />
                )}
              </GlassPanel>
            </View>
          </View>

          <View style={s.actionsRow}>
            <Button
              disabled={!canSave}
              icon={
                <AppText style={s.btnGlyph} weight="bold">
                  {glyphFor('save')}
                </AppText>
              }
              loading={saveRuleMut.isPending}
              onClick={handleSave}
              variant="primary"
            >
              {saveRuleMut.isPending
                ? t('notifications.alertStudio.actions.saving', 'Saving...')
                : isEditing
                ? t(
                    'notifications.alertStudio.actions.updateRule',
                    'Update Rule',
                  )
                : t(
                    'notifications.alertStudio.actions.createRule',
                    'Create Rule',
                  )}
            </Button>

            {isEditing && editor.id ? (
              <Button
                icon={
                  <AppText style={s.btnGlyph} weight="bold">
                    {glyphFor('delete')}
                  </AppText>
                }
                onClick={() => {
                  if (editor.id != null) {
                    handleDelete(editor.id);
                  }
                }}
                variant="danger"
              >
                {t('notifications.alertStudio.actions.delete', 'Delete')}
              </Button>
            ) : null}

            <Button
              disabled={!editor.name.trim()}
              icon={
                <AppText style={s.btnGlyph} weight="bold">
                  {glyphFor('notifications')}
                </AppText>
              }
              loading={testRuleMut.isPending}
              onClick={handleTest}
              variant="secondary"
            >
              {t('notifications.alertStudio.actions.test', 'Test')}
            </Button>

            <Button onClick={handleNewRule} variant="ghost">
              {t('notifications.alertStudio.actions.reset', 'Reset')}
            </Button>
          </View>
        </GlassPanel>
      </View>

      <Modal
        onClose={() => setSnoozeTargetId(null)}
        open={snoozeTargetRule != null}
        size="sm"
        title={
          snoozeTargetRule
            ? t('notifications.alertStudio.snooze.title', 'Snooze "{{name}}"', {
                name: snoozeTargetRule.name || untitledRuleLabel,
              })
            : t('notifications.alertStudio.snooze.button', 'Snooze')
        }
      >
        {snoozeTargetRule ? (
          <View style={s.dialogBody}>
            <AppText tone="secondary">
              {t(
                'notifications.alertStudio.snooze.description',
                'Suppress this rule temporarily. Snooze auto-expires; the rule will fire again afterwards if its condition is true.',
              )}
            </AppText>
            {snoozeTargetActive && snoozeTargetRule.snoozed_until ? (
              <View style={s.snoozeNotice}>
                <AppText style={s.snoozeNoticeText}>
                  {t(
                    'notifications.alertStudio.snooze.currentlySnoozed',
                    'Currently snoozed until {{time}}',
                    { time: formatDateTime(snoozeTargetRule.snoozed_until) },
                  )}
                </AppText>
              </View>
            ) : null}
            <View style={s.stack}>
              <Button
                disabled={snoozeRuleMut.isPending}
                onClick={() => handleSnooze(snoozeTargetRule.id, 60)}
                variant="secondary"
              >
                {t('notifications.alertStudio.snooze.1h', 'Snooze 1 hour')}
              </Button>
              <Button
                disabled={snoozeRuleMut.isPending}
                onClick={() => handleSnooze(snoozeTargetRule.id, 240)}
                variant="secondary"
              >
                {t('notifications.alertStudio.snooze.4h', 'Snooze 4 hours')}
              </Button>
              <Button
                disabled={snoozeRuleMut.isPending}
                onClick={() => handleSnooze(snoozeTargetRule.id, 1440)}
                variant="secondary"
              >
                {t('notifications.alertStudio.snooze.24h', 'Snooze 24 hours')}
              </Button>
              {snoozeTargetActive ? (
                <Button
                  disabled={snoozeRuleMut.isPending}
                  onClick={() => handleSnooze(snoozeTargetRule.id, 0)}
                  variant="ghost"
                >
                  {t(
                    'notifications.alertStudio.snooze.cancel',
                    'Cancel snooze',
                  )}
                </Button>
              ) : null}
            </View>
          </View>
        ) : null}
      </Modal>
      {deleteDialogProps ? (
        <ConfirmDialog
          {...deleteDialogProps}
          loading={deleteRuleMut.isPending}
        />
      ) : null}
      {discardDialogProps ? <ConfirmDialog {...discardDialogProps} /> : null}
    </PageContainerView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  page: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {
    flex: 1,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    alignItems: 'flex-end',
  },
  pageActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  innerPanel: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  stack: {
    gap: spacing.sm,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  flexItem: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
  },
  flexItemWide: {
    flexBasis: '100%',
    width: '100%',
  },
  searchRow: {
    marginVertical: spacing.xs,
  },
  blockSpacer: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  field: {
    gap: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  helperText: {
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
  errorText: {
    marginTop: spacing.xs,
    fontSize: 11,
    lineHeight: 15,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 17,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  // --- inputs -----------------------------------------------------------
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 84,
    textAlignVertical: 'top',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  selectError: {
    borderColor: colors.dangerBorder,
  },
  selectText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  selectPlaceholder: {
    color: colors.textMuted,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  selectMenu: {
    maxHeight: 360,
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 8,
  },
  selectOptionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  selectOptionText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  selectOptionTextActive: {
    color: colors.accent,
  },
  selectOptionCheck: {
    color: colors.accent,
    fontSize: 12,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  // --- toggle / checkbox ------------------------------------------------
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    padding: 2,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.textMuted,
  },
  toggleKnobOn: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-end',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxMark: {
    color: colors.accent,
    fontSize: 11,
  },
  // --- search -----------------------------------------------------------
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
  },
  searchGlyph: {
    fontSize: 11,
    color: colors.textMuted,
  },
  searchField: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 10,
  },
  // --- badge / severity -------------------------------------------------
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  severityIcon: {
    fontSize: 12,
    lineHeight: 16,
  },
  // --- button -----------------------------------------------------------
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 38,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnIcon: {
    marginRight: 2,
  },
  btnText: {
    fontSize: 13,
    lineHeight: 17,
  },
  btnGlyph: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  // --- chip -------------------------------------------------------------
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  chipText: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: colors.accent,
  },
  // --- help -------------------------------------------------------------
  helpIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpIconText: {
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
  },
  // --- empty / banners --------------------------------------------------
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    width: '100%',
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  alertBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  alertBannerTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  alertBannerBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  errorDisplay: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorDisplayCompact: {
    padding: spacing.sm,
  },
  errorDisplayText: {
    fontSize: 12,
    lineHeight: 17,
  },
  skeleton: {
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  // --- dialog -----------------------------------------------------------
  dialogBody: {
    gap: spacing.md,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  // --- templates --------------------------------------------------------
  templatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  templateCard: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  templateIconBox: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateIconGlyph: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  templateName: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  templateMessage: {
    fontSize: 11,
    lineHeight: 15,
  },
  metaGlyph: {
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
  },
  metaText: {
    fontSize: 10,
    lineHeight: 14,
  },
  // --- rule rows --------------------------------------------------------
  ruleRow: {
    padding: spacing.md,
  },
  ruleRowActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  ruleRowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  ruleRowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  ruleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  ruleName: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  ruleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  ruleMeta: {
    fontSize: 10,
    lineHeight: 14,
  },
  // --- editor -----------------------------------------------------------
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editorGlyph: {
    fontSize: 13,
    lineHeight: 17,
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  segmentActive: {
    backgroundColor: colors.surfaceRaised,
  },
  segmentText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  segmentTextActive: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  snoozeNotice: {
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  snoozeNoticeText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.warning,
  },
  // --- preview / presets ------------------------------------------------
  previewTitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  presetList: {
    maxHeight: 360,
    marginTop: spacing.sm,
  },
  presetCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  presetTemplate: {
    fontSize: 11,
    lineHeight: 15,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>(
  {
    primary: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    secondary: {
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    danger: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
    },
  },
);

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
  ghost: {
    color: colors.textPrimary,
  },
  danger: {
    color: colors.danger,
  },
});
