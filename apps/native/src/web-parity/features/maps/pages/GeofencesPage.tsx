// Native parity port of web/src/features/maps/pages/GeofencesPage.tsx.
//
// Manage geofence zones with create/edit/delete. The page preserves every web
// behaviour one-for-one: summary stats, an AI "suggest new geofences" panel,
// bulk selection + delete, name search/filter, pinning, inline rename, a
// create/edit modal with "use current location" (vehicle / browser / draw on
// map) sources, and a delete confirm dialog. State names, query keys, API
// paths, and validation rules are identical to the web source.
//
// Reused already-ported web-parity modules (RN-safe, identical contracts):
//   - api/client request; api/types Position
//   - api/hooks/useVehicles useVehicles; api/hooks/useLocations
//     useBulkGeofencesDelete; api/hooks/usePinned usePinned
//   - components/feedback/Toast useToast (same throw-without-provider contract)
//   - components/data-display/MetricCard MetricCard
//   - components/data-display/BulkActionToolbar BulkActionToolbar (handles its
//     own confirm flow for the bulk delete action)
//   - components/ui/PinButton PinButton
//   - components/ai/AISuggestNewGeofences AISuggestNewGeofences (already
//     withAiFeature-wrapped, renders null in off mode exactly like web)
//   - components/icons/SemanticIcon, components/ui/AppText,
//     components/ui/GlassPanel, theme/tokens
//
// Inlined native-safe equivalents for web deps absent from the parity manifest
// (documented in the sidecar):
//   - react-i18next useTranslation -> useNativeTranslation(): (key, fallback?,
//     options?) shim returning the English fallback (or the key when it is the
//     literal English string) with i18next {{name}} interpolation. Handles the
//     web call shapes t('Geofences'), t(key, 'fallback'), t(key, {name}) and
//     t(key, 'fallback', {name}).
//   - @/hooks/usePageTitle -> native no-op (React Native has no document.title).
//   - @/hooks/useFilteredList, @/hooks/useBulkSelection -> ported verbatim
//     (pure logic, no DOM).
//   - @/hooks/useDirtyForm -> returns the same localized strings; the
//     beforeunload listener has no native analogue and is dropped.
//   - @/hooks/useConfirm + @/components/ui/ConfirmDialog -> promise-based
//     confirm + a Modal-backed ConfirmDialog with an in-memory "Don't ask
//     again" silence set (replacing the web localStorage confirmSilence store).
//   - ../schemas/geofence (zod) -> hand-written validation + toGeofencePayload
//     reproducing the exact rules (name 1..120, lat -90..90, lon -180..180,
//     radius 10..50000) and the same per-field first-error reporting.
//   - @/lib/numberFormat fmtNumber -> local toLocaleString helper.
//   - @/components/layout PageContainer and @/components/ui Button, Input,
//     Select, Modal, Toggle, Badge, Tabs, EditableText + @/components/feedback
//     Skeleton, EmptyState, Spinner, AlertBanner + @/components/motion
//     FadeIn/StaggerContainer/StaggerItem -> inline RN primitives.
//
// Native-unavailable surfaces (documented in the sidecar, contract rule 7):
//   - Leaflet MapContainer/MapTileLayer/MapInvalidator/GeofenceDrawer have no
//     native equivalent; the "Draw on map" tab renders an explicit unavailable
//     panel and users enter coordinates via the manual lat/long/radius inputs.
//     The web mapPickerZoom / drawerFences / handleDrawerCreate plumbing that
//     only fed the interactive drawer is therefore not reproduced; mapPicker
//     Center is kept and surfaced as read-only context.
//   - navigator.geolocation (the "Browser" source) is not available on React
//     Native, so that branch surfaces an explicit unavailable toast instead of
//     calling a DOM API. The "Vehicle" source is fully functional.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported.

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
  Switch,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {request} from '../../../api/client';
import type {Position} from '../../../api/types';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useBulkGeofencesDelete} from '../../../api/hooks/useLocations';
import {usePinned} from '../../../api/hooks/usePinned';
import {useToast} from '../../../components/feedback/Toast';
import {MetricCard} from '../../../components/data-display/MetricCard';
import {BulkActionToolbar} from '../../../components/data-display/BulkActionToolbar';
import {PinButton} from '../../../components/ui/PinButton';
import {AISuggestNewGeofences} from '../../../components/ai/AISuggestNewGeofences';

// ─── i18n shim ─────────────────────────────────────────────────────────────

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | NativeTOptions,
  options?: NativeTOptions,
) => string;

function interpolate(template: string, values: NativeTOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined ? '' : String(value);
  });
}

// Mirrors the web react-i18next call shapes. The English-language keys the web
// page passes with no fallback (t('Geofences'), t('Active'), …) are themselves
// the display copy, so the key doubles as the fallback.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key, fallbackOrOptions, options) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const opts = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      return opts ? interpolate(fallback, opts) : fallback;
    },
    [],
  );
}

// ─── usePageTitle (web @/hooks/usePageTitle) ───────────────────────────────

// React Native has no document.title; the hook is preserved as a lifecycle
// no-op so the call site and its dependency are kept intact.
function usePageTitle(title: string): void {
  useEffect(() => {
    // intentionally empty — no native document title to set/restore.
  }, [title]);
}

// ─── useFilteredList (web @/hooks/useFilteredList) ─────────────────────────

type FilterField<T> = keyof T | ((item: T) => string | null | undefined);

function useFilteredList<T>(
  items: T[] | undefined | null,
  query: string,
  fields: ReadonlyArray<FilterField<T>>,
): T[] {
  return useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(item =>
      fields.some(f => {
        const v = typeof f === 'function' ? f(item) : item[f];
        return String(v ?? '').toLowerCase().includes(q);
      }),
    );
  }, [items, query, fields]);
}

// ─── useBulkSelection (web @/hooks/useBulkSelection) ───────────────────────

interface BulkSelection<T> {
  selectedIds: Set<T>;
  count: number;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  setSelected: (id: T, selected: boolean) => void;
  selectAll: (ids: T[]) => void;
  clear: () => void;
  masterState: (visibleIds: T[]) => 'none' | 'some' | 'all';
  toggleAll: (visibleIds: T[]) => void;
}

function useBulkSelection<T = number>(): BulkSelection<T> {
  const [selectedIds, setIds] = useState<Set<T>>(() => new Set<T>());

  const isSelected = useCallback((id: T) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: T) => {
    setIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setSelected = useCallback((id: T, sel: boolean) => {
    setIds(prev => {
      const has = prev.has(id);
      if (has === sel) {
        return prev;
      }
      const next = new Set(prev);
      if (sel) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    if (ids.length === 0) {
      return;
    }
    setIds(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const clear = useCallback(() => {
    setIds(prev => (prev.size === 0 ? prev : new Set<T>()));
  }, []);

  const masterState = useCallback(
    (visible: T[]): 'none' | 'some' | 'all' => {
      if (visible.length === 0) {
        return 'none';
      }
      let hits = 0;
      for (const id of visible) {
        if (selectedIds.has(id)) {
          hits++;
        }
      }
      if (hits === 0) {
        return 'none';
      }
      if (hits === visible.length) {
        return 'all';
      }
      return 'some';
    },
    [selectedIds],
  );

  const toggleAll = useCallback((visible: T[]) => {
    if (visible.length === 0) {
      return;
    }
    setIds(prev => {
      const allSelected = visible.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visible) {
          next.delete(id);
        }
      } else {
        for (const id of visible) {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  return useMemo<BulkSelection<T>>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    }),
    [selectedIds, isSelected, toggle, setSelected, selectAll, clear, masterState, toggleAll],
  );
}

// ─── useDirtyForm (web @/hooks/useDirtyForm) ───────────────────────────────

interface UseDirtyFormResult {
  isDirty: boolean;
  message: string;
  title: string;
  discardLabel: string;
  keepEditingLabel: string;
}

function useDirtyForm(isDirty: boolean): UseDirtyFormResult {
  const t = useNativeTranslation();
  // The web hook installs a window 'beforeunload' guard; React Native has no
  // such lifecycle, so only the localized confirm copy is reproduced.
  return {
    isDirty,
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t('forms.unsavedWarning', 'You have unsaved changes. Discard them?'),
    discardLabel: t('forms.discard', 'Discard changes'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  };
}

// ─── useConfirm (web @/hooks/useConfirm) ───────────────────────────────────

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  silenceKey?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ConfirmInternalState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

// In-memory replacement for the web localStorage confirmSilence store. Keys
// opted out via the "Don't ask again" checkbox short-circuit future prompts for
// the lifetime of the JS context.
const silencedConfirmKeys = new Set<string>();

function isSilenced(key: string): boolean {
  return silencedConfirmKeys.has(key);
}

function silenceConfirm(key: string): void {
  silencedConfirmKeys.add(key);
}

function useConfirm() {
  const [state, setState] = useState<ConfirmInternalState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    if (opts.silenceKey && opts.variant !== 'danger' && isSilenced(opts.silenceKey)) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>(resolve => {
      setState(prev => {
        if (prev) {
          prev.resolve(false);
        }
        return {...opts, resolve};
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(true);
      }
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(false);
      }
      return null;
    });
  }, []);

  const dialogProps: ConfirmDialogProps | null = state
    ? {
        open: true,
        title: state.title,
        message: state.message,
        confirmLabel: state.confirmLabel,
        cancelLabel: state.cancelLabel,
        variant: state.variant,
        silenceKey: state.silenceKey,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      }
    : null;

  return {confirm, dialogProps};
}

// ─── Geofence types + validation (web ../schemas/geofence + @/types/location) ─

interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  enabled: boolean;
  costPerKwh: number | null;
  createdAt: string;
}

const GEOFENCE_ALERT_TYPES = ['entry', 'exit', 'both', 'none'] as const;
type GeofenceAlertType = (typeof GEOFENCE_ALERT_TYPES)[number];

interface GeofenceFormData {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  alertType: GeofenceAlertType;
  enabled: boolean;
}

interface GeofencePayload {
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  enabled: boolean;
}

type GeofenceFieldErrors = Partial<Record<keyof GeofenceFormData, string>>;

// Reproduces the zod numericString refinements, returning the first failing
// message (or null) so the page can mirror the web "first issue per key" rule.
function validateNumericString(
  label: string,
  value: string,
  min: number,
  max: number,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return `${label} is required`;
  }
  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    return `${label} must be a number`;
  }
  if (n < min || n > max) {
    return `${label} must be between ${min} and ${max}`;
  }
  return null;
}

type GeofenceParseResult =
  | {success: true; data: GeofenceFormData}
  | {success: false; fieldErrors: GeofenceFieldErrors};

function parseGeofenceForm(form: GeofenceFormData): GeofenceParseResult {
  const fieldErrors: GeofenceFieldErrors = {};

  const name = form.name.trim();
  if (name.length < 1) {
    fieldErrors.name = 'Name is required';
  } else if (name.length > 120) {
    fieldErrors.name = 'Name must be 120 characters or fewer';
  }

  const latErr = validateNumericString('Latitude', form.latitude, -90, 90);
  if (latErr) {
    fieldErrors.latitude = latErr;
  }
  const lonErr = validateNumericString('Longitude', form.longitude, -180, 180);
  if (lonErr) {
    fieldErrors.longitude = lonErr;
  }
  const radiusErr = validateNumericString('Radius', form.radius, 10, 50000);
  if (radiusErr) {
    fieldErrors.radius = radiusErr;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {success: false, fieldErrors};
  }
  return {success: true, data: form};
}

function toGeofencePayload(form: GeofenceFormData): GeofencePayload {
  const alertOnEntry = form.alertType === 'entry' || form.alertType === 'both';
  const alertOnExit = form.alertType === 'exit' || form.alertType === 'both';
  return {
    name: form.name,
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    radius: Number(form.radius),
    alertOnEntry,
    alertOnExit,
    enabled: form.enabled,
  };
}

// ─── Local helpers (web @/lib/numberFormat fmtNumber) ──────────────────────

function fmtNumber(value: unknown, decimals = 0): string {
  const n = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return safe.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

type LocationSource = 'vehicle' | 'browser' | 'map';

interface ReverseGeocodeResult {
  display_name: string;
  road: string;
  city: string;
  state: string;
  country: string;
  postcode: string;
}

const EMPTY_FORM: GeofenceFormData = {
  name: '',
  latitude: '',
  longitude: '',
  radius: '100',
  alertType: 'both',
  enabled: true,
};

const ALERT_OPTIONS: {value: GeofenceAlertType; label: string}[] = [
  {value: 'entry', label: 'Entry Only'},
  {value: 'exit', label: 'Exit Only'},
  {value: 'both', label: 'Entry & Exit'},
  {value: 'none', label: 'None'},
];

type BadgeVariant = 'success' | 'warning' | 'info' | 'neutral';

function getAlertType(g: Geofence): GeofenceAlertType {
  if (g.alertOnEntry && g.alertOnExit) {
    return 'both';
  }
  if (g.alertOnEntry) {
    return 'entry';
  }
  if (g.alertOnExit) {
    return 'exit';
  }
  return 'none';
}

function alertBadgeVariant(type: GeofenceAlertType): BadgeVariant {
  switch (type) {
    case 'both':
      return 'success';
    case 'entry':
      return 'info';
    case 'exit':
      return 'warning';
    default:
      return 'neutral';
  }
}

function alertBadgeLabel(type: GeofenceAlertType, t: NativeTFunction): string {
  switch (type) {
    case 'both':
      return t('Entry & Exit');
    case 'entry':
      return t('Entry');
    case 'exit':
      return t('Exit');
    default:
      return t('None');
  }
}

// ─── Inline UI primitives ──────────────────────────────────────────────────

function Spinner({size = 'md'}: {size?: 'sm' | 'md' | 'lg'}) {
  return (
    <ActivityIndicator
      accessibilityLabel="Loading"
      color={colors.accent}
      size={size === 'sm' ? 'small' : 'large'}
    />
  );
}

function Skeleton({height = 24}: {height?: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = disabled || loading;
  const labelStyle = variant === 'primary' ? styles.buttonPrimaryLabel : styles.buttonLabel;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        buttonVariantStyles[variant],
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.textSecondary}
          size="small"
          style={styles.buttonIcon}
        />
      ) : icon ? (
        <View style={styles.buttonIcon}>{icon}</View>
      ) : null}
      {label ? (
        <AppText style={labelStyle} variant="caption" weight="semibold">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

function IconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
      {icon}
    </Pressable>
  );
}

function Badge({
  label,
  variant = 'neutral',
}: {
  label: string;
  variant?: BadgeVariant;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
          {label}
        </AppText>
      ) : null}
      {children}
      {error ? (
        <AppText style={styles.fieldError} variant="caption">
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

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  icon,
  error,
  hint,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  icon?: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <Field error={error} hint={hint} label={label}>
      <View style={[styles.inputWrap, error ? styles.inputWrapError : null]}>
        {icon ? <View style={styles.inputIcon}>{icon}</View> : null}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={value}
        />
      </View>
    </Field>
  );
}

function Select<T extends string>({
  label,
  options,
  value,
  onValueChange,
  error,
}: {
  label?: string;
  options: {value: T; label: string}[];
  value: T;
  onValueChange: (value: T) => void;
  error?: string;
}) {
  return (
    <Field error={error} label={label}>
      <ScrollView
        contentContainerStyle={styles.selectRowContent}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}>
        {options.map(option => {
          const active = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              hitSlop={4}
              key={option.value === '' ? '__empty__' : option.value}
              onPress={() => onValueChange(option.value)}
              style={({pressed}) => [
                styles.selectChip,
                active && styles.selectChipActive,
                pressed && styles.pressed,
              ]}>
              <AppText
                style={active ? styles.selectChipTextActive : styles.selectChipText}
                variant="caption"
                weight="semibold">
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Switch
        ios_backgroundColor={colors.surfaceRaised}
        onValueChange={onChange}
        thumbColor={colors.textPrimary}
        trackColor={{false: colors.surfaceRaised, true: colors.accent}}
        value={checked}
      />
      {label ? (
        <Pressable hitSlop={4} onPress={() => onChange(!checked)}>
          <AppText tone="secondary" variant="caption" weight="semibold">
            {label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: {key: T; label: string}[];
  activeTab: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.tabsRow}>
      {tabs.map(tab => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            hitSlop={4}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tabChip,
              active && styles.tabChipActive,
              pressed && styles.pressed,
            ]}>
            <AppText
              style={active ? styles.tabChipTextActive : styles.tabChipText}
              variant="caption"
              weight="semibold">
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function AlertBanner({children}: {children: ReactNode}) {
  return (
    <View accessibilityRole="alert" style={styles.alertBanner}>
      <SemanticIcon decorative name="alertCircle" size="sm" style={styles.alertIcon} />
      <AppText style={styles.alertText} variant="caption">
        {children}
      </AppText>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
  action?: {label: string; onPress: () => void};
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.emptyTitle} weight="bold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="secondary" variant="caption">
        {message}
      </AppText>
      {action ? (
        <View style={styles.emptyAction}>
          <Button label={action.label} onPress={action.onPress} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

// EditableText (web @/components/ui EditableText): tap to rename inline, with
// optional length validation and an async onSave that surfaces errors inline.
function EditableText({
  value,
  ariaLabel,
  maxLength,
  validate,
  onSave,
}: {
  value: string;
  ariaLabel: string;
  maxLength?: number;
  validate?: (next: string) => string | null;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const begin = useCallback(() => {
    setDraft(value);
    setError(null);
    setEditing(true);
  }, [value]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const commit = useCallback(async () => {
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    const validationError = validate ? validate(next) : null;
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [draft, value, validate, onSave]);

  if (!editing) {
    return (
      <Pressable
        accessibilityHint="Double tap to rename"
        accessibilityLabel={ariaLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={begin}
        style={styles.editableTrigger}>
        <AppText numberOfLines={1} style={styles.cardTitle} weight="bold">
          {value}
        </AppText>
        <SemanticIcon decorative name="pencil" size="sm" style={styles.editablePencil} />
      </Pressable>
    );
  }

  return (
    <View style={styles.editableEditing}>
      <View style={styles.editableInputRow}>
        <TextInput
          accessibilityLabel={ariaLabel}
          autoFocus
          maxLength={maxLength}
          onChangeText={setDraft}
          placeholderTextColor={colors.textMuted}
          style={styles.editableInput}
          value={draft}
        />
        <IconButton
          accessibilityLabel="Save"
          icon={<SemanticIcon decorative name="confirm" size="sm" />}
          onPress={() => {
            void commit();
          }}
        />
        <IconButton
          accessibilityLabel="Cancel"
          icon={<SemanticIcon decorative name="close" size="sm" />}
          onPress={cancel}
        />
      </View>
      {saving ? <Spinner size="sm" /> : null}
      {error ? (
        <AppText style={styles.fieldError} variant="caption">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

// ConfirmDialog (web @/components/ui ConfirmDialog, used subset).
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'warning',
  silenceKey,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [dontAsk, setDontAsk] = useState(false);
  const canSilence = Boolean(silenceKey) && variant !== 'danger';

  const handleConfirm = useCallback(() => {
    if (canSilence && dontAsk && silenceKey) {
      silenceConfirm(silenceKey);
    }
    onConfirm();
  }, [canSilence, dontAsk, silenceKey, onConfirm]);

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={open}>
      <View accessibilityRole="alert" accessible style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageBox,
              variant === 'danger' ? styles.dialogMessageBoxDanger : styles.dialogMessageBoxWarning,
            ]}>
            <SemanticIcon decorative name="warning" size="sm" style={styles.dialogIcon} />
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          {canSilence ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{checked: dontAsk}}
              hitSlop={4}
              onPress={() => setDontAsk(v => !v)}
              style={styles.silenceRow}>
              <View style={[styles.checkbox, dontAsk && styles.checkboxChecked]}>
                {dontAsk ? (
                  <SemanticIcon decorative name="confirm" size="sm" style={styles.checkboxGlyph} />
                ) : null}
              </View>
              <AppText tone="secondary" variant="caption">
                Don&apos;t ask again
              </AppText>
            </Pressable>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              onPress={onCancel}
              style={({pressed}) => [
                styles.dialogButton,
                styles.dialogCancelButton,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.dialogCancelLabel} weight="semibold">
                {cancelLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={handleConfirm}
              style={({pressed}) => [
                styles.dialogButton,
                variant === 'danger' ? styles.dialogConfirmDanger : styles.dialogConfirmWarning,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.dialogConfirmLabel} weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// FormModal (web @/components/ui Modal): a transparent overlay card hosting the
// scrollable create/edit form.
function FormModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle} variant="title" weight="bold">
              {title}
            </AppText>
            <IconButton
              accessibilityLabel="Close"
              icon={<SemanticIcon decorative name="close" size="sm" />}
              onPress={onClose}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.modalBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// PageContainer (web @/components/layout PageContainer, used subset).
function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.pageSpinner}>
          <Spinner size="lg" />
        </View>
      ) : error ? (
        <View style={styles.pageError}>
          <AppText style={styles.pageErrorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

// Checkbox for bulk row selection (web raw <input type="checkbox">).
function RowCheckbox({
  checked,
  onToggle,
  accessibilityLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      hitSlop={6}
      onPress={onToggle}
      style={styles.rowCheckboxHit}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? (
          <SemanticIcon decorative name="confirm" size="sm" style={styles.checkboxGlyph} />
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const t = useNativeTranslation();
  usePageTitle(t('Geofences'));
  const queryClient = useQueryClient();
  const toast = useToast();

  // ─── State ───────────────────────────────────────────────────────────────

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GeofenceFormData>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<GeofenceFormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<GeofenceFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Geofence | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource>('vehicle');
  const [selectedVehicleId, setSelectedVehicleId] = useState<number>(0);
  const [locationLoading, setLocationLoading] = useState(false);
  const [search, setSearch] = useState('');
  // The AI geofence suggestion panel needs a candidate visited-location ID.
  // We expose a small numeric input so the user can paste the ID copied from
  // the Locations page; future work may auto-populate this from a clustering
  // job. The state is local to this page so the off-mode user never sees it
  // (the AI panel itself is gated by withAiFeature).
  const [aiLocationIdRaw, setAiLocationIdRaw] = useState('');
  const aiLocationId = useMemo(() => {
    const parsed = parseInt(aiLocationIdRaw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [aiLocationIdRaw]);

  // Bulk selection keys off geofence ids. The frontend Geofence type carries id
  // as string (legacy) but the backend bulk endpoint expects int64s — we
  // convert at the call site.
  const sel = useBulkSelection<string>();
  const bulkDelete = useBulkGeofencesDelete();

  // Dirty when the modal is open AND the form diverges from the initial
  // snapshot taken on open. Closed modal => not dirty so we don't pester the
  // user about list-page navigation.
  const isFormDirty = useMemo(() => {
    if (!modalOpen) {
      return false;
    }
    return (
      form.name !== initialForm.name ||
      form.latitude !== initialForm.latitude ||
      form.longitude !== initialForm.longitude ||
      form.radius !== initialForm.radius ||
      form.alertType !== initialForm.alertType ||
      form.enabled !== initialForm.enabled
    );
  }, [modalOpen, form, initialForm]);

  const dirtyForm = useDirtyForm(isFormDirty);
  const {confirm: confirmDiscard, dialogProps: discardDialogProps} = useConfirm();

  // ─── Data fetching ─────────────────────────────────────────────────────

  const {data: geofences, isLoading, error} = useQuery({
    queryKey: ['geofences'],
    queryFn: () => request<Geofence[]>('/geofences'),
  });

  const {data: vehicles} = useVehicles();

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  }, []);

  const createMut = useMutation({
    mutationFn: (body: GeofencePayload & {costPerKwh: number | null}) =>
      request<Geofence>('/geofences', {method: 'POST', body: JSON.stringify(body)}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['geofences']});
      toast.success(t('Geofence created'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to create geofence'), err.message),
  });

  const updateMut = useMutation({
    mutationFn: ({id, body}: {id: string; body: GeofencePayload & {costPerKwh: number | null}}) =>
      request<Geofence>(`/geofences/${id}`, {method: 'PUT', body: JSON.stringify(body)}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['geofences']});
      toast.success(t('Geofence updated'));
      closeModal();
    },
    onError: (err: Error) => toast.error(t('Failed to update geofence'), err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => request<void>(`/geofences/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['geofences']});
      toast.success(t('Geofence deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(t('Failed to delete geofence'), err.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({id, enabled}: {id: string; enabled: boolean}) =>
      request<Geofence>(`/geofences/${id}`, {
        method: 'PUT',
        body: JSON.stringify({enabled}),
      }),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['geofences']}),
    onError: (err: Error) => toast.error(t('Failed to toggle geofence'), err.message),
  });

  // Inline rename sends a full merged payload rather than a partial `{ name }`
  // so the backend's PUT semantics are unambiguous regardless of whether it
  // does field-level merge. Errors are surfaced inline by EditableText, so no
  // toast here.
  const renameMut = useMutation({
    mutationFn: ({g, name}: {g: Geofence; name: string}) => {
      const {id: _id, createdAt: _createdAt, ...rest} = g;
      void _id;
      void _createdAt;
      return request<Geofence>(`/geofences/${g.id}`, {
        method: 'PUT',
        body: JSON.stringify({...rest, name}),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['geofences']}),
  });

  // ─── Computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const list = geofences ?? [];
    return {
      total: list.length,
      active: list.filter(g => g.enabled).length,
      entryAlerts: list.filter(g => g.alertOnEntry).length,
      exitAlerts: list.filter(g => g.alertOnExit).length,
    };
  }, [geofences]);

  const geofenceSearchFields = useMemo(
    () => ['name'] as const satisfies ReadonlyArray<keyof Geofence>,
    [],
  );
  const filteredGeofences = useFilteredList(geofences, search, geofenceSearchFields);
  const {data: geofencePins = []} = usePinned('geofence');
  const sortedGeofences = useMemo(() => {
    if (geofencePins.length === 0) {
      return filteredGeofences;
    }
    const order = new Map<string, number>();
    geofencePins.forEach(p => order.set(String(p.item_id), p.position));
    return [...filteredGeofences].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) {
        return ap - bp;
      }
      if (ap != null) {
        return -1;
      }
      if (bp != null) {
        return 1;
      }
      return 0;
    });
  }, [filteredGeofences, geofencePins]);

  // ─── Drawer integration ──────────────────────────────────────────────────

  // Center the picker on the form's current coords or fall back to the first
  // existing geofence so users have spatial context. The interactive Leaflet
  // drawer (zoom level, draft fence, onCreate→form sync) has no native
  // equivalent, so only the center is surfaced as read-only context.
  const mapPickerCenter = useMemo<[number, number]>(() => {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0)) {
      return [lat, lng];
    }
    const first = (geofences ?? [])[0];
    if (first && first.latitude != null && first.longitude != null) {
      return [first.latitude, first.longitude];
    }
    return [37.7749, -122.4194];
  }, [form.latitude, form.longitude, geofences]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  // Cancel handler — if the user has made unsaved edits, prompt before
  // dismissing the modal. Otherwise close immediately.
  const handleRequestClose = useCallback(async () => {
    if (isFormDirty) {
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
    closeModal();
  }, [
    isFormDirty,
    confirmDiscard,
    dirtyForm.title,
    dirtyForm.message,
    dirtyForm.discardLabel,
    dirtyForm.keepEditingLabel,
    closeModal,
  ]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setLocationLoading(false);
    setModalOpen(true);
  }, []);

  // Apply-from-AI opens the canonical Add Geofence modal pre-filled with the
  // typed envelope fields the LLM proposed (name + centroid lat/lon + radius).
  // The user reviews the pre-filled form and clicks Save in the existing
  // baseline modal — the AI panel never persists state itself.
  const applyAiDraftToForm = useCallback(
    (draft: {name: string; latitude: number; longitude: number; radius: number}) => {
      const next: GeofenceFormData = {
        name: draft.name,
        latitude: String(draft.latitude),
        longitude: String(draft.longitude),
        radius: String(Math.round(draft.radius)),
        alertType: EMPTY_FORM.alertType,
        enabled: EMPTY_FORM.enabled,
      };
      setEditingId(null);
      setForm(next);
      setInitialForm(EMPTY_FORM);
      setFieldErrors({});
      setFormError(null);
      setLocationLoading(false);
      setModalOpen(true);
    },
    [],
  );

  const openEdit = useCallback((g: Geofence) => {
    setEditingId(g.id);
    const next: GeofenceFormData = {
      name: g.name,
      latitude: String(g.latitude),
      longitude: String(g.longitude),
      radius: String(g.radius),
      alertType: getAlertType(g),
      enabled: g.enabled,
    };
    setForm(next);
    setInitialForm(next);
    setFieldErrors({});
    setFormError(null);
    setModalOpen(true);
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string> => {
    try {
      const res = await request<ReverseGeocodeResult>(`/geocode/reverse?lat=${lat}&lon=${lon}`);
      return res.display_name || `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`;
    } catch {
      return `${fmtNumber(lat, 4)}, ${fmtNumber(lon, 4)}`;
    }
  }, []);

  const handleGetLocation = useCallback(async () => {
    setLocationLoading(true);
    try {
      let lat: number;
      let lon: number;

      if (locationSource === 'vehicle') {
        if (selectedVehicleId <= 0) {
          toast.error(t('geofences.selectVehicle', 'Select a vehicle first'));
          setLocationLoading(false);
          return;
        }
        const positions = await request<Position[]>(
          `/vehicles/${selectedVehicleId}/positions?limit=1`,
        );
        if (!positions || positions.length === 0) {
          toast.error(t('geofences.noPosition', 'No position data available for this vehicle'));
          setLocationLoading(false);
          return;
        }
        lat = positions[0].latitude;
        lon = positions[0].longitude;
      } else {
        // Browser geolocation (navigator.geolocation) is a DOM API with no
        // React Native equivalent; surface an explicit unavailable message.
        toast.error(
          t('geofences.browserUnavailable', 'Browser location is not available on this device'),
        );
        setLocationLoading(false);
        return;
      }

      const name = await reverseGeocode(lat, lon);
      setForm(prev => ({
        ...prev,
        name: prev.name || name,
        latitude: String(lat),
        longitude: String(lon),
      }));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('geofences.locationFailed', 'Failed to get location');
      toast.error(message);
    } finally {
      setLocationLoading(false);
    }
  }, [locationSource, selectedVehicleId, reverseGeocode, toast, t]);

  const handleSubmit = useCallback(() => {
    setFormError(null);
    const parsed = parseGeofenceForm(form);
    if (!parsed.success) {
      setFieldErrors(parsed.fieldErrors);
      setFormError(t('forms.validationFailed', 'Please fix the highlighted fields before saving.'));
      return;
    }
    setFieldErrors({});
    const payload = {...toGeofencePayload(parsed.data), costPerKwh: null};
    if (editingId) {
      updateMut.mutate({id: editingId, body: payload});
    } else {
      createMut.mutate(payload);
    }
  }, [form, editingId, createMut, updateMut, t]);

  // Submit-disable heuristic: block only when any required string is empty so
  // the button feels responsive; the parse drives the actual error display.
  const hasMinimalInput =
    form.name.trim().length > 0 &&
    form.latitude.trim().length > 0 &&
    form.longitude.trim().length > 0 &&
    form.radius.trim().length > 0;

  const isSaving = createMut.isPending || updateMut.isPending;

  const vehicleOptions = useMemo(
    () => [
      {value: '0', label: t('geofences.chooseVehicle', '— Choose vehicle —')},
      ...(vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    ],
    [vehicles, t],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  const hasGeofences = Boolean(geofences && geofences.length > 0);

  return (
    <PageContainer
      actions={
        <Button
          icon={<SemanticIcon decorative name="add" size="sm" />}
          label={t('Add Geofence')}
          onPress={openCreate}
          variant="primary"
        />
      }
      error={(error as Error | null) ?? null}
      loading={isLoading}
      subtitle={t('Define locations for contextual tracking and automation')}
      title={t('Geofences')}>
      {/* Summary Stats */}
      {!isLoading && (
        <GlassPanel style={styles.statsPanel}>
          {hasGeofences ? (
            <View style={styles.statsGrid}>
              <View style={styles.statsCell}>
                <MetricCard
                  color="purple"
                  icon={<SemanticIcon decorative name="mapPinned" size="sm" />}
                  label={t('Total Geofences')}
                  value={stats.total}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="green"
                  icon={<SemanticIcon decorative name="confirm" size="sm" />}
                  label={t('Active')}
                  value={stats.active}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="cyan"
                  icon={<SemanticIcon decorative name="arrowDownToDot" size="sm" />}
                  label={t('Entry Alerts')}
                  value={stats.entryAlerts}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="amber"
                  icon={<SemanticIcon decorative name="arrowUpFromDot" size="sm" />}
                  label={t('Exit Alerts')}
                  value={stats.exitAlerts}
                />
              </View>
            </View>
          ) : (
            <EmptyState
              icon={<SemanticIcon decorative name="activity" size="lg" />}
              message={t('common.noData', 'No data available')}
            />
          )}
        </GlassPanel>
      )}

      {/* Loading skeleton — unreachable while PageContainer renders the page
          spinner during loading, but preserved for parity with the source. */}
      {isLoading && (
        <GlassPanel style={styles.skeletonPanel}>
          <Skeleton height={24} />
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </GlassPanel>
      )}

      {/* AISuggestNewGeofences is wrapped with withAiFeature so the wrapper
          renders nothing in off mode. Off-mode users see no surrounding
          chrome and the flow shows the geofence list directly. */}
      {!isLoading && (
        <View style={styles.aiSection}>
          <Input
            keyboardType="number-pad"
            label={t(
              'geofences.aiSuggest.pickLocation',
              'Pick a visited location to draft a geofence around',
            )}
            onChangeText={setAiLocationIdRaw}
            placeholder="501"
            value={aiLocationIdRaw}
          />
          <View style={styles.aiPanel}>
            <AISuggestNewGeofences locationId={aiLocationId} onApplyDraft={applyAiDraftToForm} />
          </View>
        </View>
      )}

      {/* Geofence List */}
      {!isLoading && (
        <View style={styles.listSection}>
          <BulkActionToolbar
            actions={[
              {
                id: 'delete',
                label: t('geofences.bulk.delete', 'Delete'),
                variant: 'danger',
                icon: <SemanticIcon decorative name="delete" size="sm" />,
                confirm: {
                  title: t('geofences.bulk.deleteConfirm.title', 'Delete geofences?'),
                  description: t(
                    'geofences.bulk.deleteConfirm.body',
                    'Selected geofences will be removed permanently. Linked alert rules and automations will continue to reference their old IDs.',
                  ),
                  confirmLabel: t('common.delete', 'Delete'),
                },
                onClick: async ids => {
                  await bulkDelete.mutateAsync(ids.map(i => Number(i)));
                  sel.clear();
                },
              },
            ]}
            itemNoun={{
              one: t('geofences.noun.one', 'geofence'),
              other: t('geofences.noun.other', 'geofences'),
            }}
            onClear={sel.clear}
            selectedIds={Array.from(sel.selectedIds)}
            total={sortedGeofences.length}
          />

          {hasGeofences && (
            <View style={styles.filterBar}>
              <Input
                onChangeText={setSearch}
                placeholder={t('geofences.searchPlaceholder', 'Search by name…')}
                value={search}
              />
              {search ? (
                <View style={styles.filterChips}>
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={4}
                    onPress={() => setSearch('')}
                    style={({pressed}) => [styles.filterChip, pressed && styles.pressed]}>
                    <AppText style={styles.filterChipText} variant="caption" weight="semibold">
                      {t('geofences.filterLabel.search', 'Search')}: {search}
                    </AppText>
                    <SemanticIcon decorative name="close" size="sm" style={styles.filterChipIcon} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}

          {filteredGeofences.length > 0 ? (
            sortedGeofences.map(g => {
              const alertType = getAlertType(g);
              return (
                <GlassPanel key={g.id} style={styles.geofenceCard}>
                  <View style={styles.cardLeft}>
                    <RowCheckbox
                      accessibilityLabel={t('geofences.selectGeofence', 'Select geofence {{name}}', {
                        name: g.name,
                      })}
                      checked={sel.isSelected(g.id)}
                      onToggle={() => sel.toggle(g.id)}
                    />
                    <View style={styles.cardIconBox}>
                      <SemanticIcon decorative name="mapPinned" size="sm" />
                    </View>
                    <View style={styles.cardInfo}>
                      <View style={styles.cardTitleRow}>
                        <EditableText
                          ariaLabel={t('editableText.rename.geofence', 'Rename geofence {{name}}', {
                            name: g.name,
                          })}
                          maxLength={120}
                          onSave={async next => {
                            await renameMut.mutateAsync({g, name: next});
                          }}
                          validate={next =>
                            next.length > 120
                              ? t('geofences.error.nameTooLong', 'Max 120 characters')
                              : null
                          }
                          value={g.name}
                        />
                        <Badge
                          label={g.enabled ? t('Active') : t('Inactive')}
                          variant={g.enabled ? 'success' : 'neutral'}
                        />
                        <Badge label={alertBadgeLabel(alertType, t)} variant={alertBadgeVariant(alertType)} />
                      </View>
                      <View style={styles.cardMetaRow}>
                        <View style={styles.cardMetaItem}>
                          <SemanticIcon decorative name="globe" size="sm" />
                          <AppText style={styles.cardMetaMono} tone="muted" variant="caption">
                            {fmtNumber(g.latitude ?? 0, 6)}, {fmtNumber(g.longitude ?? 0, 6)}
                          </AppText>
                        </View>
                        <View style={styles.cardMetaItem}>
                          <SemanticIcon decorative name="range" size="sm" />
                          <AppText tone="muted" variant="caption">
                            {g.radius}
                            {t('m')}
                          </AppText>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.cardActions}>
                    <PinButton itemId={g.id} itemType="geofence" size="sm" />
                    <Toggle
                      checked={g.enabled}
                      onChange={checked => toggleMut.mutate({id: g.id, enabled: checked})}
                    />
                    <IconButton
                      accessibilityLabel={t('Edit')}
                      icon={<SemanticIcon decorative name="pencil" size="sm" />}
                      onPress={() => openEdit(g)}
                    />
                    <IconButton
                      accessibilityLabel={t('Delete')}
                      icon={<SemanticIcon decorative name="delete" size="sm" />}
                      onPress={() => setDeleteTarget(g)}
                    />
                  </View>
                </GlassPanel>
              );
            })
          ) : hasGeofences ? (
            <EmptyState
              action={{label: t('Clear search'), onPress: () => setSearch('')}}
              icon={<SemanticIcon decorative name="activity" size="lg" />}
              message={t('geofences.noMatches', 'No geofences match your search.')}
            />
          ) : (
            <EmptyState
              icon={<SemanticIcon decorative name="activity" size="lg" />}
              message={t('common.noData', 'No data available')}
            />
          )}
        </View>
      )}

      {/* Empty state */}
      {!isLoading && geofences && geofences.length === 0 && (
        <EmptyState
          action={{label: t('Add Geofence'), onPress: openCreate}}
          icon={<SemanticIcon decorative name="security" size="lg" />}
          message={t('Add a geofence to track when your vehicle arrives or leaves a location.')}
          title={t('No geofences defined')}
        />
      )}

      {/* Create / Edit Modal */}
      <FormModal
        onClose={() => {
          void handleRequestClose();
        }}
        open={modalOpen}
        title={editingId ? t('Edit Geofence') : t('Create Geofence')}>
        {formError ? <AlertBanner>{formError}</AlertBanner> : null}

        {/* Use Current Location */}
        {!editingId && (
          <GlassPanel style={styles.locationPanel}>
            <View style={styles.locationHeader}>
              <SemanticIcon decorative name="navigation" size="sm" />
              <AppText weight="semibold">
                {t('geofences.useCurrentLocation', 'Use Current Location')}
              </AppText>
            </View>

            <Tabs
              activeTab={locationSource}
              onChange={key => setLocationSource(key)}
              tabs={[
                {key: 'vehicle', label: `🚗 ${t('geofences.vehicle', 'Vehicle')}`},
                {key: 'browser', label: `📱 ${t('geofences.browser', 'Browser')}`},
                {key: 'map', label: `🗺️ ${t('geofences.drawOnMap', 'Draw on map')}`},
              ]}
            />

            {locationSource === 'vehicle' && (
              <Select
                label={t('geofences.selectVehicle', 'Select Vehicle')}
                onValueChange={val => setSelectedVehicleId(Number(val))}
                options={vehicleOptions}
                value={String(selectedVehicleId)}
              />
            )}

            {locationSource === 'map' ? (
              <View style={styles.mapUnavailable}>
                <AppText style={styles.mapHint} tone="muted" variant="caption">
                  {t(
                    'geofences.drawHint',
                    'Click the circle tool, then click and drag on the map to draw a fence.',
                  )}
                </AppText>
                <View
                  accessibilityLabel={t('geofences.drawerLabel', 'Geofence drawing map')}
                  accessibilityRole="image"
                  style={styles.mapPlaceholder}>
                  <SemanticIcon decorative name="map" size="lg" />
                  <AppText style={styles.mapPlaceholderText} tone="muted" variant="caption">
                    {t(
                      'geofences.mapUnavailable',
                      'Interactive map drawing is unavailable on this device. Enter coordinates below.',
                    )}
                  </AppText>
                  <AppText style={styles.cardMetaMono} tone="muted" variant="caption">
                    {fmtNumber(mapPickerCenter[0], 5)}, {fmtNumber(mapPickerCenter[1], 5)}
                  </AppText>
                </View>
              </View>
            ) : (
              <Button
                disabled={locationLoading || (locationSource === 'vehicle' && selectedVehicleId <= 0)}
                icon={
                  locationLoading ? undefined : <SemanticIcon decorative name="navigation" size="sm" />
                }
                label={
                  locationLoading
                    ? t('geofences.gettingLocation', 'Getting location…')
                    : t('geofences.getLocation', 'Get Location')
                }
                loading={locationLoading}
                onPress={() => {
                  void handleGetLocation();
                }}
                variant="secondary"
              />
            )}
          </GlassPanel>
        )}

        <Input
          error={fieldErrors.name}
          label={t('Name')}
          onChangeText={text => setForm({...form, name: text})}
          placeholder={t('Home')}
          value={form.name}
        />

        <View style={styles.coordGrid}>
          <View style={styles.coordCell}>
            <Input
              error={fieldErrors.latitude}
              icon={<SemanticIcon decorative name="globe" size="sm" />}
              keyboardType="numbers-and-punctuation"
              label={t('Latitude')}
              onChangeText={text => setForm({...form, latitude: text})}
              placeholder="37.7749"
              value={form.latitude}
            />
          </View>
          <View style={styles.coordCell}>
            <Input
              error={fieldErrors.longitude}
              icon={<SemanticIcon decorative name="globe" size="sm" />}
              keyboardType="numbers-and-punctuation"
              label={t('Longitude')}
              onChangeText={text => setForm({...form, longitude: text})}
              placeholder="-122.4194"
              value={form.longitude}
            />
          </View>
        </View>

        <Input
          error={fieldErrors.radius}
          hint={t('Minimum 10m, maximum 50000m')}
          icon={<SemanticIcon decorative name="range" size="sm" />}
          keyboardType="number-pad"
          label={t('Radius (meters)')}
          onChangeText={text => setForm({...form, radius: text})}
          placeholder="100"
          value={form.radius}
        />

        <Select
          error={fieldErrors.alertType}
          label={t('Alert Type')}
          onValueChange={val => setForm({...form, alertType: val})}
          options={ALERT_OPTIONS.map(o => ({value: o.value, label: t(o.label)}))}
          value={form.alertType}
        />

        <Toggle
          checked={form.enabled}
          label={t('Active')}
          onChange={checked => setForm({...form, enabled: checked})}
        />

        <View style={styles.modalActions}>
          <Button
            icon={<SemanticIcon decorative name="close" size="sm" />}
            label={t('Cancel')}
            onPress={() => {
              void handleRequestClose();
            }}
            variant="secondary"
          />
          <Button
            disabled={!hasMinimalInput || isSaving}
            icon={<SemanticIcon decorative name="confirm" size="sm" />}
            label={editingId ? t('Update') : t('Create')}
            loading={isSaving}
            onPress={handleSubmit}
            variant="primary"
          />
        </View>
      </FormModal>

      {/* Discard-changes confirm dialog (mounted alongside the modal). */}
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        cancelLabel={t('Cancel')}
        confirmLabel={t('Delete')}
        message={t('Are you sure you want to delete "{{name}}"? This action cannot be undone.', {
          name: deleteTarget?.name ?? '',
        })}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id);
          }
        }}
        open={deleteTarget !== null}
        title={t('Delete Geofence')}
        variant="danger"
      />
    </PageContainer>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  pageSpinner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  pageError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: {
    color: colors.danger,
  },
  statsPanel: {
    padding: spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statsCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  skeletonPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
  },
  aiSection: {
    gap: spacing.md,
  },
  aiPanel: {
    marginTop: spacing.xs,
  },
  listSection: {
    gap: spacing.md,
  },
  filterBar: {
    gap: spacing.sm,
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterChipText: {
    color: colors.textSecondary,
  },
  filterChipIcon: {
    transform: [{scale: 0.8}],
  },
  geofenceCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  cardLeft: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.md,
  },
  cardIconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardInfo: {
    flexShrink: 1,
    gap: spacing.sm,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.textPrimary,
    maxWidth: 200,
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cardMetaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  cardMetaMono: {
    fontVariant: ['tabular-nums'],
  },
  cardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  rowCheckboxHit: {
    paddingTop: spacing.xs,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    transform: [{scale: 0.7}],
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonIcon: {
    marginRight: spacing.xs,
  },
  buttonLabel: {
    color: colors.textPrimary,
  },
  buttonPrimaryLabel: {
    color: colors.background,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
  },
  iconButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    marginBottom: 2,
  },
  fieldError: {
    color: colors.danger,
  },
  fieldHint: {
    color: colors.textMuted,
  },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  inputWrapError: {
    borderColor: colors.dangerBorder,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  selectRowContent: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  selectChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  selectChipText: {
    color: colors.textSecondary,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tabChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  tabChipText: {
    color: colors.textSecondary,
  },
  tabChipTextActive: {
    color: colors.accent,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertIcon: {
    flexShrink: 0,
  },
  alertText: {
    color: colors.danger,
    flexShrink: 1,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    opacity: 0.6,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: spacing.sm,
  },
  editableTrigger: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  editablePencil: {
    transform: [{scale: 0.75}],
  },
  editableEditing: {
    gap: spacing.xs,
  },
  editableInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  editableInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 440,
    padding: spacing.lg,
    width: '100%',
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  dialogMessageBox: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dialogMessageBoxDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogMessageBoxWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  dialogIcon: {
    flexShrink: 0,
  },
  dialogMessage: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  silenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dialogButton: {
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  dialogCancelButton: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  dialogCancelLabel: {
    color: colors.textPrimary,
  },
  dialogConfirmWarning: {
    backgroundColor: colors.warning,
  },
  dialogConfirmDanger: {
    backgroundColor: colors.danger,
  },
  dialogConfirmLabel: {
    color: colors.background,
  },
  modalCard: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 520,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  modalBody: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  locationPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  locationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mapUnavailable: {
    gap: spacing.sm,
  },
  mapHint: {
    color: colors.textMuted,
  },
  mapPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    height: 160,
    justifyContent: 'center',
    padding: spacing.md,
  },
  mapPlaceholderText: {
    textAlign: 'center',
  },
  coordGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  coordCell: {
    flex: 1,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: colors.danger,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  info: {
    color: colors.accent,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
