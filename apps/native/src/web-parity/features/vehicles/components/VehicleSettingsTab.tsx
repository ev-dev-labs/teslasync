// Native parity port of
// web/src/features/vehicles/components/VehicleSettingsTab.tsx.
//
// The web component is the per-vehicle settings section mounted inside
// <VehicleDetailPage>. It renders a `GlassPanel` (p-6) with a "Per-vehicle
// settings" heading + subtitle and, once `useVehicleSettings(vehicleId)`
// resolves, one row per supported key (`VEHICLE_SETTING_DESCRIPTORS`). Each row
// shows the label + help text, a "source" pill (override | user | vehicle |
// default), a typed input (text | datetime-local | select), a Save button (gated
// on the draft being dirty + not pending) and a "Reset to default" button (gated
// on source === 'override'). While loading it shows three skeleton bars; on error
// it shows a compact retryable ErrorDisplay so it never blocks the page. It is
// reproduced here with React Native primitives, preserving every state name
// (`draft` / `validationError`), the `dirty` derivation, the `handleSave` /
// `handleReset` flow, the mutation calls (`useUpsertVehicleSetting` /
// `useResetVehicleSetting`), the `findEffectiveSetting` selector, all six
// descriptors (key / kind / options / maxLength / autoComplete), the RFC3339 <->
// datetime-local helpers, the `effectiveToDraft` / `parseDraft` / `renderInput`
// helpers (logic verbatim), and every t() key + English fallback string. API
// paths live in the already-ported `useVehicleSettings` hook and are untouched.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim that
//     returns the web fallback copy verbatim (i18n intent preserved via keys),
//     matching the sibling vehicle-detail ports.
//   - `@/components/ui` `GlassPanel` -> the shared native GlassPanel
//     (`components/ui/GlassPanel`, same choice as the sibling
//     VehicleConfigSection); `className="p-6"` -> `style` padding 24.
//   - `@/components/ui` `Heading level="section"` / `Text variant="bodySm" |
//     "caption"` -> native `AppText` with the matching size/tone styles
//     (text-[var(--text-secondary)] -> tone secondary, --text-primary -> primary,
//     --text-muted -> muted, text-rose-300 -> danger).
//   - `@/components/ui` `Badge variant` (the source pill) -> inline `SourcePill`
//     rounded pill: tinted surface + border + text per variant (success ->
//     success token, info -> accent [no blue token], neutral -> raised surface +
//     muted text, warning -> warning token), mirroring the LiveStateIndicators
//     StateBadge map.
//   - `@/components/ui` `Input type="datetime-local" | "text"` (DOM <input>) ->
//     native `TextInput`: `onChange={(e)=>onChange(e.target.value)}` ->
//     `onChangeText`, `maxLength`/`autoComplete` preserved, and the datetime-local
//     picker becomes a free-text field keeping the exact `YYYY-MM-DDTHH:MM` format
//     contract (the RFC3339 helpers are unchanged) with an explicit placeholder.
//   - `@/components/ui` `Select` (DOM <select>) -> inline `SelectControl` row of
//     selectable Pressable option pills (RN core has no <select>); the active
//     option is accent-tinted and `onChange` receives the option value, matching
//     the web `e.target.value`.
//   - `@/components/ui` `Button variant primary|secondary size="sm"` -> the
//     already-ported native parity `Button` (`onClick` -> `onPress`,
//     `disabled` preserved verbatim so Save stays gated by `dirty`/pending and
//     Reset by `isOverride`/pending).
//   - `@/components/feedback` `Skeleton` -> inline `Skeleton` (Animated opacity
//     pulse honouring the OS reduce-motion setting), same pattern as the sibling
//     VehicleConfigSection.
//   - `@/components/feedback` `ErrorDisplay compact onRetry` -> inline
//     `ErrorDisplay`: the danger error message + a small "Try again" retry Button
//     (`common.retry`); the retry wires the same `void refetch()` callback.
//   - the DOM `<ul className="divide-y">` / `<li>` rows -> a `View` list with a
//     1px top border on every row after the first (divide-white/5 -> a
//     rgba(255,255,255,0.05) hairline); the `lg:grid-cols-12` row grid collapses
//     to the web `grid-cols-1` mobile stack (label block / input block / actions).
//   - every web `data-testid` is preserved verbatim as a native `testID`.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  findEffectiveSetting,
  useResetVehicleSetting,
  useUpsertVehicleSetting,
  useVehicleSettings,
  type VehicleSettingValue,
} from '../../../api/hooks/useVehicleSettings';
import type {EffectiveSetting, EffectiveSettingSource} from '../../../api/types';
import {Button} from '../../../components/ui/Button';

/* ─── inline i18n shim ───────────────────────────────────────────────────────── */

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

/* ─── inline reduce-motion + Skeleton parity (@/components/feedback) ──────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function Skeleton({height = 48}: {height?: number}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.45,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View style={[styles.skeletonBar, {height, opacity: pulse}]} />
  );
}

/* ─── inline ErrorDisplay parity (@/components/feedback) ──────────────────────── */

function ErrorDisplay({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const t = useNativeTranslation();
  return (
    <View style={styles.errorBox}>
      <AppText style={styles.errorText} tone="danger" variant="caption">
        {error.message}
      </AppText>
      {onRetry ? (
        <Button onPress={onRetry} size="sm" variant="secondary">
          {t('common.retry', 'Try again')}
        </Button>
      ) : null}
    </View>
  );
}

/* ─── Whitelist + per-key UI metadata ─────────────────────────────────────────── */

type VehicleSettingKind = 'text' | 'timestamp' | 'select';

interface SelectOption {
  value: string;
  label: string;
}

interface VehicleSettingDescriptor {
  key: string;
  kind: VehicleSettingKind;
  /** For 'select' kind: the static option set. */
  options?: SelectOption[];
  /** For 'text' kind: optional max length / placeholder. */
  maxLength?: number;
  /** For 'text' kind: HTML autocomplete hint. */
  autoComplete?: string;
}

/**
 * The supported keys mirror vehicleSettingDefs in
 * internal/database/vehicle_settings_repo.go. The order here drives
 * row rendering order; do not reorder unless the i18n labels change.
 */
const VEHICLE_SETTING_DESCRIPTORS: VehicleSettingDescriptor[] = [
  {key: 'nickname', kind: 'text', maxLength: 64, autoComplete: 'off'},
  {key: 'mute_until', kind: 'timestamp'},
  {key: 'charge_cost_tariff_id', kind: 'text', maxLength: 64, autoComplete: 'off'},
  {
    key: 'units_distance',
    kind: 'select',
    options: [
      {value: 'mi', label: 'mi'},
      {value: 'km', label: 'km'},
    ],
  },
  {
    key: 'units_temperature',
    kind: 'select',
    options: [
      {value: 'C', label: '°C'},
      {value: 'F', label: '°F'},
    ],
  },
  {
    key: 'units_energy',
    kind: 'select',
    options: [{value: 'kWh', label: 'kWh'}],
  },
];

/* ─── Datetime-local <-> RFC3339 helpers ──────────────────────────────────────── */

/**
 * Convert an RFC3339 timestamp from the API into the
 * `YYYY-MM-DDTHH:MM` shape an `<input type="datetime-local">` accepts.
 * Returns the empty string when input cannot be parsed so the input
 * renders as "no value".
 */
function rfc3339ToLocalInput(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  // datetime-local needs YYYY-MM-DDTHH:MM in *local* time
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Convert the datetime-local string the user typed back into an
 * RFC3339 timestamp (UTC). Returns null when the input is empty or
 * unparseable so the caller can short-circuit.
 */
function localInputToRFC3339(local: string): string | null {
  if (!local) {
    return null;
  }
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/* ─── Section component ───────────────────────────────────────────────────────── */

export interface VehicleSettingsTabProps {
  vehicleId: number;
}

export default function VehicleSettingsTab({vehicleId}: VehicleSettingsTabProps) {
  const t = useNativeTranslation();
  const {data, isLoading, isError, refetch} = useVehicleSettings(vehicleId);

  return (
    <GlassPanel style={styles.panel} testID="vehicle-settings-section">
      <View style={styles.headerBlock}>
        <AppText accessibilityRole="header" style={styles.title}>
          {t('vehicleSettings.title', 'Per-vehicle settings')}
        </AppText>
        <AppText style={styles.subtitle} tone="secondary">
          {t(
            'vehicleSettings.subtitle',
            'Override individual settings for this vehicle. Resets fall back to your account-wide values.',
          )}
        </AppText>
      </View>

      {isLoading ? (
        <View style={styles.skeletonStack} testID="vehicle-settings-loading">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      ) : isError ? (
        <View testID="vehicle-settings-error">
          <ErrorDisplay
            compact
            error={
              new Error(t('vehicleSettings.error', 'Could not load vehicle settings.'))
            }
            onRetry={() => {
              void refetch();
            }}
          />
        </View>
      ) : (
        <View testID="vehicle-settings-rows">
          {VEHICLE_SETTING_DESCRIPTORS.map((desc, index) => {
            const effective = findEffectiveSetting(data, desc.key);
            return (
              <VehicleSettingRow
                descriptor={desc}
                divided={index !== 0}
                effective={effective}
                key={desc.key}
                vehicleId={vehicleId}
              />
            );
          })}
        </View>
      )}
    </GlassPanel>
  );
}

/* ─── Source pill ─────────────────────────────────────────────────────────────── */

type SourceVariant = 'success' | 'info' | 'neutral' | 'warning';

const SOURCE_PILL_VARIANT: Record<EffectiveSettingSource, SourceVariant> = {
  override: 'success',
  user: 'info',
  vehicle: 'neutral',
  default: 'warning',
};

const SOURCE_VARIANT_COLORS: Record<
  SourceVariant,
  {fg: string; bg: string; border: string}
> = {
  success: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  info: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  neutral: {fg: colors.textMuted, bg: colors.surfaceRaised, border: colors.border},
  warning: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
};

function SourcePill({source}: {source: EffectiveSettingSource}) {
  const t = useNativeTranslation();
  const variant = SOURCE_PILL_VARIANT[source] ?? 'neutral';
  const palette = SOURCE_VARIANT_COLORS[variant];
  return (
    <View
      style={[styles.pill, {backgroundColor: palette.bg, borderColor: palette.border}]}
      testID={`vehicle-settings-source-${source}`}>
      <AppText style={[styles.pillText, {color: palette.fg}]}>
        {t(`vehicleSettings.source.${source}`, source)}
      </AppText>
    </View>
  );
}

/* ─── Per-row component ───────────────────────────────────────────────────────── */

interface VehicleSettingRowProps {
  vehicleId: number;
  descriptor: VehicleSettingDescriptor;
  effective: EffectiveSetting | undefined;
  divided: boolean;
}

function VehicleSettingRow({
  vehicleId,
  descriptor,
  effective,
  divided,
}: VehicleSettingRowProps) {
  const t = useNativeTranslation();
  const upsert = useUpsertVehicleSetting(vehicleId);
  const reset = useResetVehicleSetting(vehicleId);

  const source: EffectiveSettingSource = effective?.source ?? 'default';
  const isOverride = source === 'override';

  // Local draft state — initialised from the effective value, kept in
  // sync when the effective value changes from outside (e.g. another
  // tab saved an override). The draft is always a string so the
  // input components can be rendered uniformly.
  const initialDraft = useMemo(
    () => effectiveToDraft(descriptor, effective),
    [descriptor, effective],
  );
  const [draft, setDraft] = useState<string>(initialDraft);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setValidationError(null);
  }, [initialDraft]);

  const dirty = draft !== initialDraft;

  const handleSave = () => {
    setValidationError(null);
    const parsed = parseDraft(descriptor, draft);
    if (parsed.kind === 'invalid') {
      setValidationError(t(parsed.message, parsed.fallback));
      return;
    }
    if (parsed.kind === 'empty') {
      setValidationError(t('vehicleSettings.validation.required', 'Value is required.'));
      return;
    }
    upsert.mutate({key: descriptor.key, value: parsed.value});
  };

  const handleReset = () => {
    if (!isOverride) {
      return;
    }
    reset.mutate(descriptor.key);
  };

  return (
    <View
      style={[styles.row, divided ? styles.rowDivider : null]}
      testID={`vehicle-settings-row-${descriptor.key}`}>
      <View style={styles.labelBlock}>
        <View style={styles.labelRow}>
          <AppText style={styles.labelText}>
            {t(`vehicleSettings.keys.${descriptor.key}.label`, descriptor.key)}
          </AppText>
          <SourcePill source={source} />
        </View>
        <AppText style={styles.helpText} tone="muted" variant="caption">
          {t(`vehicleSettings.keys.${descriptor.key}.help`, '')}
        </AppText>
      </View>

      <View style={styles.inputBlock}>
        {renderInput(descriptor, draft, setDraft)}
        {validationError ? (
          <AppText
            style={styles.validationText}
            testID={`vehicle-settings-error-${descriptor.key}`}
            tone="danger"
            variant="caption">
            {validationError}
          </AppText>
        ) : null}
      </View>

      <View style={styles.actionsRow}>
        <Button
          disabled={!dirty || upsert.isPending}
          onPress={handleSave}
          size="sm"
          testID={`vehicle-settings-save-${descriptor.key}`}
          variant="primary">
          {upsert.isPending
            ? t('vehicleSettings.actions.saving', 'Saving…')
            : t('vehicleSettings.actions.save', 'Save')}
        </Button>
        <Button
          disabled={!isOverride || reset.isPending}
          onPress={handleReset}
          size="sm"
          testID={`vehicle-settings-reset-${descriptor.key}`}
          variant="secondary">
          {reset.isPending
            ? t('vehicleSettings.actions.resetting', 'Resetting…')
            : t('vehicleSettings.actions.reset', 'Reset to default')}
        </Button>
      </View>
    </View>
  );
}

/* ─── Per-row helpers ─────────────────────────────────────────────────────────── */

function effectiveToDraft(
  descriptor: VehicleSettingDescriptor,
  effective: EffectiveSetting | undefined,
): string {
  const v = effective?.value;
  switch (descriptor.kind) {
    case 'timestamp':
      return rfc3339ToLocalInput(v);
    case 'select':
      return typeof v === 'string' ? v : '';
    case 'text':
    default:
      return typeof v === 'string' ? v : v == null ? '' : String(v);
  }
}

type ParseResult =
  | {kind: 'ok'; value: VehicleSettingValue}
  | {kind: 'empty'}
  | {kind: 'invalid'; message: string; fallback: string};

function parseDraft(descriptor: VehicleSettingDescriptor, draft: string): ParseResult {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return {kind: 'empty'};
  }
  switch (descriptor.kind) {
    case 'timestamp': {
      const iso = localInputToRFC3339(trimmed);
      if (!iso) {
        return {
          kind: 'invalid',
          message: 'vehicleSettings.validation.invalidDate',
          fallback: 'Enter a valid date and time.',
        };
      }
      return {kind: 'ok', value: iso};
    }
    case 'select': {
      const allowed = descriptor.options?.some(o => o.value === trimmed) ?? false;
      if (!allowed) {
        return {
          kind: 'invalid',
          message: 'vehicleSettings.validation.invalid',
          fallback: 'Value is not valid for this setting.',
        };
      }
      return {kind: 'ok', value: trimmed};
    }
    case 'text':
    default:
      return {kind: 'ok', value: trimmed};
  }
}

/* ─── input controls (web @/components/ui Input / Select) ─────────────────────── */

function SelectControl({
  options,
  value,
  onChange,
  testID,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}) {
  return (
    <View style={styles.optionRow} testID={testID}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected}}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.optionPill, selected ? styles.optionPillSelected : null]}>
            <AppText
              style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function renderInput(
  descriptor: VehicleSettingDescriptor,
  draft: string,
  onChange: (value: string) => void,
) {
  switch (descriptor.kind) {
    case 'timestamp':
      return (
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChange}
          placeholder="YYYY-MM-DDTHH:MM"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID={`vehicle-settings-input-${descriptor.key}`}
          value={draft}
        />
      );
    case 'select':
      return (
        <SelectControl
          onChange={onChange}
          options={descriptor.options ?? []}
          testID={`vehicle-settings-input-${descriptor.key}`}
          value={draft}
        />
      );
    case 'text':
    default:
      return (
        <TextInput
          autoCapitalize="none"
          autoComplete={descriptor.autoComplete as TextInputProps['autoComplete']}
          autoCorrect={false}
          maxLength={descriptor.maxLength}
          onChangeText={onChange}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID={`vehicle-settings-input-${descriptor.key}`}
          value={draft}
        />
      );
  }
}

const HAIRLINE = 'rgba(255, 255, 255, 0.05)'; // divide-white/5

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 18,
  },
  headerBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  helpText: {
    lineHeight: 16,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputBlock: {
    gap: spacing.xs,
  },
  labelBlock: {
    gap: spacing.xs,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  labelText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  optionPill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionPillSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.accent,
  },
  panel: {
    padding: 24,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  row: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
  },
  skeletonStack: {
    gap: spacing.md,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  validationText: {
    marginTop: 2,
  },
});
