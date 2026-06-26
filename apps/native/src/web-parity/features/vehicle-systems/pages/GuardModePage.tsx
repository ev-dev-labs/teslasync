// Native parity port of web/src/features/vehicle-systems/pages/GuardModePage.tsx.
//
// Guard Mode — anti-theft monitoring + emergency response. Every web behaviour is
// preserved one-for-one:
//   - All state names + defaults: panicDialogOpen/sensitivity/homeGeofenceId/
//     autoPanic (useState), effectiveSensitivity/effectiveHomeGeofenceId,
//     isArmed/events/unacknowledgedCount/latestEvent/isTriggered, state/
//     vehicleLat/vehicleLng/hasLocation, homeGeofence, geofenceOptions (useMemo).
//   - All hooks called verbatim with identical args + API paths: useGuardConfig/
//     useGuardEvents/useVehicleState({refetchInterval: guardConfig?.enabled ?
//     5_000 : 30_000})/useGeofences (reads), useSetGuardConfig/useGuardPanic/
//     useAcknowledgeGuardEvent (mutations). SI stays on the wire; the page reads
//     latitude/longitude/is_locked/sentry_mode straight off the state object.
//   - All handlers identical: handleToggleGuard/handleSaveSettings/handlePanic/
//     handleAcknowledge — same mutate payloads (vehicleId/enabled/
//     home_geofence_id (Number|null)/sensitivity/auto_panic) and same guards
//     (activeVehicleId <= 0 / > 0).
//   - Section order: triggered AlertBanner -> row1 (guard toggle + status + panic)
//     -> row2 settings -> row3 live map -> row4 event timeline -> panic
//     ConfirmDialog.
//   - EVENT_LABELS / EVENT_BADGE_VARIANT / SENSITIVITY_OPTIONS ported verbatim
//     (incl. emoji), and every i18n key keeps its English default (intent
//     preserved) with i18next {{time}}/{{count}} interpolation reproduced.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) shim reproducing i18next {{name}} interpolation.
//   - lucide-react ShieldCheck/ShieldAlert/ShieldOff/Siren/MapPin/Clock/
//     CheckCircle2/AlertTriangle/Lock/Unlock/Car/Eye/Info -> SemanticIcon glyphs
//     (securityCheck/securityAlert/securityOff/location/clock/success/warning/
//     locked/unlocked/vehicle/show/info); lucide SVG has no native renderer.
//   - @/components/layout PageContainer/Grid -> inline native PageContainer
//     (title + subtitle + always-visible actions + loading spinner / children)
//     and Grid (the web cols={{default:1, md:3}} mobile default is one column, so
//     Grid stacks its children with a gap — the faithful phone layout).
//   - @/components/ui GlassPanel -> shared native GlassPanel; Button/Select/
//     Toggle/Badge/ConfirmDialog -> inline RN primitives (Pressable/Switch/Modal)
//     preserving value/onChange/variant/disabled semantics.
//   - @/components/feedback EmptyState/AlertBanner -> inline native equivalents.
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/components/forms VehicleSelect + @/hooks/useSelectedVehicle -> an inline
//     native picker (Pressable trigger + Modal single-select list) backed by a
//     shared module-level selected-vehicle store paired with an inline
//     useSelectedVehicle, so the web read(useSelectedVehicle)+write(VehicleSelect)
//     shared-store coupling is preserved on native. URL/router precedence +
//     localStorage persistence are browser-only and dropped (selection is shared
//     in-memory for the session — the same graceful degradation the shared native
//     VehicleSelect port documents).
//   - @/components/data-display TimeStamp -> the shared native parity TimeStamp.
//   - @/hooks/usePageTitle -> native-safe shim (feature-detects document.title).
//   - @/lib/dateFormat formatDateTime -> ported verbatim (Intl year/month/day +
//     hour/minute, '—' for null/invalid). @/lib/cn -> not needed (StyleSheet).
//
// Native-unavailable surface (documented in the sidecar, contract rule 7):
//   - Leaflet MapContainer/Marker/Circle/Popup/Polyline/MapTileLayer/
//     MapInvalidator (the LiveMap/MapPopup/EventTrail sub-components) have no
//     React Native equivalent. The "Live Vehicle Location" panel renders an
//     explicit unavailable state that still surfaces the same data the web map
//     showed: the vehicle name + lat/lng (web MapPopup, toFixed(6)) and the home
//     geofence name + radius (web Circle). The web eventPositions trail is kept
//     (it is always empty in the source — GuardEvent rows carry no lat/lng) and
//     therefore never renders, matching the web positions.length > 1 gate.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported — only react, react-native
// primitives, the shared native SemanticIcon / AppText / GlassPanel / theme
// tokens, and the ported parity TimeStamp / useGuard / useVehicles / useLocations.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';

import {useGeofences} from '../../../api/hooks/useLocations';
import {
  isGuardEventAcknowledged,
  useAcknowledgeGuardEvent,
  useGuardConfig,
  useGuardEvents,
  useGuardPanic,
  useSetGuardConfig,
  type GuardEvent,
} from '../../../api/hooks/useGuard';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';
import type {Vehicle} from '../../../api/types';
import {TimeStamp} from '../../../components/data-display/TimeStamp';

/* ── react-i18next useTranslation replacement ──────────── */

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ── usePageTitle shim (web @/hooks/usePageTitle) ──────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

/* ── formatDateTime (ported from web @/lib/dateFormat) ──── */

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Event type display helpers ──────────────────────────────────────────

// `/vehicles/{id}/guard/events` returns state-change records
// derived from `security_events` (`locked`, `sentry_mode`,
// `valet_mode_enabled` — see `securityEventTypeByField` in
// `internal/tesla/router/writers/security_event_writer.go`). Legacy
// alert-shaped entries (`vehicle_moved`, `unauthorized_*`) are kept so
// historic rows still render, and the lookup-with-fallback pattern
// makes any newly-added backend type render as the raw token without
// crashing the page.
const EVENT_LABELS: Record<string, string> = {
  vehicle_moved: '📍 Vehicle Moved',
  unauthorized_unlock: '🔓 Unauthorized Unlock',
  unauthorized_drive: '🚗 Unauthorized Drive',
  sentry_triggered: '👁️ Sentry Triggered',
  manual_panic: '🚨 Manual Panic',
  test_alert: '🔔 Test Alert',
  locked: '🔒 Lock State Changed',
  sentry_mode: '👁️ Sentry Mode',
  valet_mode_enabled: '🅿️ Valet Mode',
};

const EVENT_BADGE_VARIANT: Record<string, 'danger' | 'warning' | 'info'> = {
  vehicle_moved: 'danger',
  unauthorized_unlock: 'danger',
  unauthorized_drive: 'danger',
  sentry_triggered: 'warning',
  manual_panic: 'danger',
  test_alert: 'info',
  locked: 'info',
  sentry_mode: 'warning',
  valet_mode_enabled: 'info',
};

const SENSITIVITY_OPTIONS = [
  {value: 'low', label: 'Low — Movement > 1km'},
  {value: 'medium', label: 'Medium — Movement > 200m'},
  {value: 'high', label: 'High — Any movement'},
];

/* ── Native-safe shared selected-vehicle store ─────────── */
// Native analogue of web store/selectedVehicle (Context + localStorage). RN has
// no localStorage and the parity tree pulls in no router, so the store is a lean
// module-level external store shared between the inline VehicleSelect (write) and
// useSelectedVehicle (read). Selection lives for the app session.

let selectedVehicleId: number | null = null;
const selectionListeners = new Set<() => void>();

function setSelectedVehicleId(id: number | null): void {
  const next = id != null && Number.isFinite(id) && id > 0 ? id : null;
  if (next === selectedVehicleId) {
    return;
  }
  selectedVehicleId = next;
  selectionListeners.forEach(listener => listener());
}

function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

function getSelectionSnapshot(): number | null {
  return selectedVehicleId;
}

interface UseSelectedVehicleResult {
  vehicleId: number | null;
  vehicle: Vehicle | undefined;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native-safe analogue of the web useSelectedVehicle(): composes the shared
// module-level store with the ported useVehicles() fleet list and defaults to the
// first vehicle the moment the fleet loads. Returns the resolved Vehicle object
// (web `vehicle`) so the page can read activeVehicle?.display_name.
function useSelectedVehicle(): UseSelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];

  const stored = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  const vehicle = vehicles.find(v => v.id === effectiveId);

  return {
    vehicleId: effectiveId,
    vehicle,
    vehicles,
    setVehicleId: setSelectedVehicleId,
  };
}

/* ── VehicleSelect (web @/components/forms VehicleSelect) ── */

function VehicleSelect() {
  const t = useNativeTranslation();
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const [open, setOpen] = useState(false);

  if (vehicles.length === 0) {
    return null;
  }

  const options = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  const currentValue = vehicleId != null ? String(vehicleId) : '';
  const selectedOption = options.find(o => o.value === currentValue);
  const label = t('vehicleSelect.aria', 'Select vehicle');

  return (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.vsTrigger,
          pressed && styles.pressed,
        ]}
        testID="vehicle-select">
        <AppText numberOfLines={1} style={styles.vsTriggerLabel}>
          {selectedOption?.label ?? label}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.vsChevron}>
          ⌄
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.modalOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalMenu} onPress={() => undefined}>
            <ScrollView style={styles.vsList}>
              {options.map(opt => {
                const selected = opt.value === currentValue;
                return (
                  <Pressable
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    key={opt.value}
                    onPress={() => {
                      const next = Number(opt.value);
                      setVehicleId(
                        Number.isFinite(next) && next > 0 ? next : null,
                      );
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.vsOption,
                      selected && styles.vsOptionSelected,
                      pressed && styles.pressed,
                    ]}
                    testID={`vehicle-select-option-${opt.value}`}>
                    <AppText
                      numberOfLines={1}
                      style={[
                        styles.vsOptionLabel,
                        selected && styles.vsOptionLabelSelected,
                      ]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {selected ? (
                      <AppText style={styles.vsCheck}>✓</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* ── FadeIn (web @/components/motion FadeIn) ───────────── */

function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ── Grid (web @/components/layout Grid) ───────────────── */
// Web cols={{default:1, md:3}}; the mobile default is one column, so on native the
// children stack with a gap — the faithful phone layout for a `default:1` grid.

function Grid({children}: {children: ReactNode}) {
  return <View style={styles.grid}>{children}</View>;
}

/* ── PageContainer (web @/components/layout PageContainer) ── */

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageTitleBlock}>
          <AppText variant="title" weight="bold">
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
        <View style={styles.loadingDot}>
          <SemanticIcon decorative name="loading" size="md" />
        </View>
      ) : null}
      <View style={styles.pageSections}>{children}</View>
    </ScrollView>
  );
}

/* ── Button (web @/components/ui Button) ───────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'danger';

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  size = 'md',
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  const labelStyle =
    variant === 'secondary' ? styles.buttonLabel : styles.buttonPrimaryLabel;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        buttonVariantStyles[variant],
        fullWidth && styles.buttonFullWidth,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText
        style={[labelStyle, size === 'sm' && styles.buttonLabelSm]}
        variant="caption"
        weight={variant === 'danger' ? 'bold' : 'semibold'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── Badge (web @/components/ui Badge) ─────────────────── */

type BadgeVariant = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

function Badge({label, variant = 'info'}: {label: string; variant?: BadgeVariant}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── Toggle (web @/components/ui Toggle) ───────────────── */

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

/* ── Select (web @/components/ui Select) ───────────────── */
// The web styled <select>/<option> has no native analogue, so it becomes a
// horizontally-scrolling chip row preserving options/value/onChange semantics.

function Select({
  options,
  value,
  onValueChange,
}: {
  options: {value: string; label: string}[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
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
  );
}

/* ── AlertBanner (web @/components/feedback AlertBanner) ── */

function AlertBanner({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: SemanticIconName;
  children?: ReactNode;
}) {
  return (
    <View accessibilityRole="alert" style={styles.alertBanner}>
      <View style={styles.alertHeader}>
        {icon ? <SemanticIcon decorative name={icon} size="sm" /> : null}
        <AppText style={styles.alertTitle} weight="bold">
          {title}
        </AppText>
      </View>
      {children ? <View style={styles.alertBody}>{children}</View> : null}
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({icon, message}: {icon?: SemanticIconName; message: string}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyRoot}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ── ConfirmDialog (web @/components/ui ConfirmDialog) ──── */

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  variant = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useNativeTranslation();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.modalOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.dialogBackdrop}
        />
        <View style={styles.dialog} testID="confirm-dialog">
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.dialogMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.dialogActions}>
            <Button
              label={t('common.cancel', 'Cancel')}
              onPress={onCancel}
              variant="secondary"
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={variant === 'danger' ? 'danger' : 'primary'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Guard Mode Page ─────────────────────────────────────────────────────

export default function GuardModePage() {
  const t = useNativeTranslation();
  usePageTitle(t('guard.title', 'Guard Mode'));

  // Vehicle selector — global, shared across all vehicle-scoped pages.
  const {vehicleId, vehicle: activeVehicle} = useSelectedVehicle();
  const activeVehicleId = vehicleId ?? 0;

  // Guard data
  const {data: guardConfig, isLoading: configLoading} =
    useGuardConfig(activeVehicleId);
  const {data: guardEvents, isLoading: eventsLoading} =
    useGuardEvents(activeVehicleId);
  const {data: vehicleState} = useVehicleState(activeVehicleId, {
    refetchInterval: guardConfig?.enabled ? 5_000 : 30_000,
  });
  const {data: geofences} = useGeofences();

  // Mutations
  const setConfig = useSetGuardConfig();
  const panic = useGuardPanic();
  const ackEvent = useAcknowledgeGuardEvent();

  // Local state
  const [panicDialogOpen, setPanicDialogOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState<string>('');
  const [homeGeofenceId, setHomeGeofenceId] = useState<string>('');
  const [autoPanic, setAutoPanic] = useState(false);

  // Sync local state from config
  const effectiveSensitivity = sensitivity || guardConfig?.sensitivity || 'medium';
  const effectiveHomeGeofenceId =
    homeGeofenceId ||
    (guardConfig?.home_geofence_id != null
      ? String(guardConfig.home_geofence_id)
      : '');

  // Derived data
  const isArmed = guardConfig?.enabled ?? false;
  const events = guardEvents ?? [];
  const unacknowledgedCount = events.filter(
    e => !isGuardEventAcknowledged(e),
  ).length;
  const latestEvent = events[0] ?? null;
  const isTriggered =
    latestEvent != null &&
    !isGuardEventAcknowledged(latestEvent) &&
    latestEvent.event_type !== 'test_alert';

  const state = vehicleState?.state ?? vehicleState;
  const stateRecord = state as unknown as Record<string, unknown> | null | undefined;
  const vehicleLat = stateRecord?.latitude as number | undefined;
  const vehicleLng = stateRecord?.longitude as number | undefined;
  const hasLocation =
    vehicleLat != null &&
    vehicleLng != null &&
    vehicleLat !== 0 &&
    vehicleLng !== 0;

  const homeGeofence = geofences?.find(
    g => String(g.id) === effectiveHomeGeofenceId,
  );

  const geofenceOptions = useMemo(
    () => [
      {value: '', label: t('guard.noGeofence', '— No home geofence —')},
      ...(geofences ?? []).map(g => ({value: String(g.id), label: g.name})),
    ],
    [geofences, t],
  );

  // ── Handlers ────────────────────────────────────────────────────────

  const handleToggleGuard = () => {
    if (activeVehicleId <= 0) {
      return;
    }
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: !isArmed,
      home_geofence_id: effectiveHomeGeofenceId
        ? Number(effectiveHomeGeofenceId)
        : null,
      sensitivity: effectiveSensitivity,
      auto_panic: autoPanic,
    });
  };

  const handleSaveSettings = () => {
    if (activeVehicleId <= 0) {
      return;
    }
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: isArmed,
      home_geofence_id: effectiveHomeGeofenceId
        ? Number(effectiveHomeGeofenceId)
        : null,
      sensitivity: effectiveSensitivity,
      auto_panic: autoPanic,
    });
  };

  const handlePanic = () => {
    setPanicDialogOpen(false);
    if (activeVehicleId > 0) {
      panic.mutate(activeVehicleId);
    }
  };

  const handleAcknowledge = (eventId: number) => {
    if (activeVehicleId > 0) {
      ackEvent.mutate({vehicleId: activeVehicleId, eventId});
    }
  };

  const isLoading = configLoading || eventsLoading;

  // ── Render ──────────────────────────────────────────────────────────

  const guardCircleStyle: StyleProp<ViewStyle> = [
    styles.guardCircle,
    isArmed && !isTriggered && styles.guardCircleArmed,
    isTriggered && styles.guardCircleTriggered,
    !isArmed && styles.guardCircleDisarmed,
  ];

  return (
    <PageContainer
      title={t('guard.title', 'Guard Mode')}
      subtitle={t('guard.subtitle', 'Anti-theft monitoring and emergency response')}
      loading={isLoading}
      actions={<VehicleSelect />}>
      {/* Triggered alert banner */}
      {isTriggered && latestEvent ? (
        <AlertBanner
          icon="securityAlert"
          title={t('guard.alertTriggered', 'Guard Alert Triggered!')}>
          <View style={styles.alertEventRow}>
            <AppText style={styles.alertEventText} variant="caption">
              {EVENT_LABELS[latestEvent.event_type] ?? latestEvent.event_type}
              {' — '}
            </AppText>
            <TimeStamp style={styles.alertEventText} value={latestEvent.ts} />
          </View>
        </AlertBanner>
      ) : null}

      {/* Row 1: Guard toggle + Status + Panic */}
      <FadeIn>
        <Grid>
          {/* Guard Mode Toggle */}
          <GlassPanel
            style={[
              styles.guardPanel,
              isArmed && !isTriggered && styles.guardPanelArmed,
              isTriggered && styles.guardPanelTriggered,
            ]}>
            <View style={guardCircleStyle}>
              <SemanticIcon
                decorative
                name={
                  isTriggered
                    ? 'securityAlert'
                    : isArmed
                    ? 'securityCheck'
                    : 'securityOff'
                }
                size="lg"
              />
            </View>
            <AppText style={styles.guardHeading} variant="title" weight="bold">
              {isTriggered
                ? t('guard.triggered', 'TRIGGERED')
                : isArmed
                ? t('guard.armed', 'Armed')
                : t('guard.disarmed', 'Disarmed')}
            </AppText>
            <Toggle
              checked={isArmed}
              label={t('guard.enableGuard', 'Guard Mode')}
              onChange={handleToggleGuard}
            />
            {setConfig.isPending ? (
              <AppText tone="muted" variant="caption">
                {t('guard.updating', 'Updating...')}
              </AppText>
            ) : null}
          </GlassPanel>

          {/* Status Card */}
          <GlassPanel style={styles.panel}>
            <AppText style={styles.sectionTitle} variant="caption" weight="semibold">
              {t('guard.status', 'Status')}
            </AppText>
            <View style={styles.statusList}>
              <StatusRow icon="clock">
                {isArmed && guardConfig?.updated_at
                  ? t('guard.armedSince', 'Armed since {{time}}', {
                      time: formatDateTime(guardConfig.updated_at),
                    })
                  : t('guard.notArmed', 'Not armed')}
              </StatusRow>
              <StatusRow icon="locked">
                {stateRecord?.is_locked
                  ? t('guard.locked', 'Vehicle locked')
                  : t('guard.unlocked', 'Vehicle unlocked')}
              </StatusRow>
              <StatusRow icon="show">
                {stateRecord?.sentry_mode
                  ? t('guard.sentryOn', 'Sentry mode active')
                  : t('guard.sentryOff', 'Sentry mode off')}
              </StatusRow>
              <StatusRow icon="warning">
                {unacknowledgedCount > 0
                  ? t('guard.unackEvents', '{{count}} unacknowledged event(s)', {
                      count: unacknowledgedCount,
                    })
                  : t('guard.noEvents', 'No active alerts')}
              </StatusRow>
            </View>
          </GlassPanel>

          {/* PANIC Button */}
          <GlassPanel style={styles.panicPanel}>
            <SemanticIcon decorative name="securityAlert" size="lg" />
            <AppText style={styles.sectionTitle} variant="caption" weight="semibold">
              {t('guard.emergency', 'Emergency')}
            </AppText>
            <Button
              disabled={panic.isPending || activeVehicleId <= 0}
              fullWidth
              label={
                panic.isPending
                  ? t('guard.panicking', 'Sending...')
                  : t('guard.panicButton', '🚨 PANIC')
              }
              onPress={() => setPanicDialogOpen(true)}
              variant="danger"
            />
            <AppText style={styles.panicDesc} tone="muted" variant="caption">
              {t(
                'guard.panicDesc',
                'Flash lights, honk horn, lock doors, enable sentry, and notify all channels',
              )}
            </AppText>
          </GlassPanel>
        </Grid>
      </FadeIn>

      {/* Row 2: Settings */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.sectionTitle} variant="caption" weight="semibold">
            {t('guard.settings', 'Guard Settings')}
          </AppText>
          <Grid>
            <View>
              <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
                {t('guard.homeGeofence', 'Home Geofence')}
              </AppText>
              <Select
                onValueChange={setHomeGeofenceId}
                options={geofenceOptions}
                value={effectiveHomeGeofenceId}
              />
              <AppText style={styles.fieldHint} tone="muted" variant="caption">
                {t(
                  'guard.homeGeofenceHelp',
                  'Vehicle will trigger alert if it leaves this area',
                )}
              </AppText>
            </View>
            <View>
              <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
                {t('guard.sensitivity', 'Sensitivity')}
              </AppText>
              <Select
                onValueChange={setSensitivity}
                options={SENSITIVITY_OPTIONS}
                value={effectiveSensitivity}
              />
            </View>
            <View style={styles.settingsAutoCol}>
              <View>
                <Toggle
                  checked={autoPanic || guardConfig?.auto_panic || false}
                  label={t('guard.autoPanic', 'Auto-Panic on Trigger')}
                  onChange={setAutoPanic}
                />
                <AppText style={styles.fieldHint} tone="muted" variant="caption">
                  {t(
                    'guard.autoPanicHelp',
                    'Automatically execute panic actions when guard is triggered',
                  )}
                </AppText>
              </View>
              <View style={styles.saveButtonWrap}>
                <Button
                  disabled={setConfig.isPending}
                  label={t('guard.saveSettings', 'Save Settings')}
                  onPress={handleSaveSettings}
                />
              </View>
            </View>
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* Row 3: Live Map */}
      <FadeIn>
        <GlassPanel style={styles.mapPanel}>
          <View style={styles.mapHeader}>
            <AppText style={styles.sectionTitle} variant="caption" weight="semibold">
              {t('guard.liveMap', 'Live Vehicle Location')}
            </AppText>
          </View>
          <View style={styles.mapBody}>
            {hasLocation ? (
              <LiveMap
                events={events}
                homeGeofence={homeGeofence ?? null}
                vehicleLat={vehicleLat as number}
                vehicleLng={vehicleLng as number}
                vehicleName={activeVehicle?.display_name ?? ''}
              />
            ) : (
              <View style={styles.mapEmpty}>
                {/* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */}
                <EmptyState
                  icon="location"
                  message={t('guard.noLocation', 'No vehicle location available')}
                />
              </View>
            )}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* Row 4: Event Timeline */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.timelineHeader}>
            <AppText style={styles.sectionTitle} variant="caption" weight="semibold">
              {t('guard.eventTimeline', 'Event Timeline')}
            </AppText>
            {unacknowledgedCount > 0 ? (
              <Badge
                label={`${unacknowledgedCount} ${t('guard.unack', 'unacknowledged')}`}
                variant="danger"
              />
            ) : null}
          </View>

          {events.length > 0 ? (
            <ScrollView
              nestedScrollEnabled
              style={styles.timelineList}>
              <View style={styles.timelineListInner}>
                {events.map(ev => (
                  <EventRow
                    event={ev}
                    isAcking={ackEvent.isPending}
                    key={ev.id}
                    onAcknowledge={handleAcknowledge}
                  />
                ))}
              </View>
            </ScrollView>
          ) : (
            <EmptyState
              icon="info"
              message={t('guard.noEvents', 'No guard events yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Panic confirmation dialog */}
      <ConfirmDialog
        confirmLabel={t('guard.panicConfirmLabel', '🚨 ACTIVATE PANIC')}
        message={t(
          'guard.panicConfirmMessage',
          'This will immediately flash lights, honk horn, lock doors, enable sentry mode, and send alerts to all notification channels.',
        )}
        onCancel={() => setPanicDialogOpen(false)}
        onConfirm={handlePanic}
        open={panicDialogOpen}
        title={t('guard.panicConfirmTitle', 'Activate Panic Mode?')}
        variant="danger"
      />
    </PageContainer>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function StatusRow({icon, children}: {icon: SemanticIconName; children: ReactNode}) {
  return (
    <View style={styles.statusRow}>
      <SemanticIcon decorative name={icon} size="sm" />
      <AppText style={styles.statusText} tone="secondary" variant="caption">
        {children}
      </AppText>
    </View>
  );
}

// Web LiveMap rendered a Leaflet MapContainer with the vehicle marker (+ popup
// showing name/coords), a home-geofence circle, and an (always-empty) event
// trail. React Native has no Leaflet equivalent, so this renders an explicit
// unavailable panel that still surfaces every datum the web map showed.
function LiveMap({
  vehicleLat,
  vehicleLng,
  vehicleName,
  homeGeofence,
  events,
}: {
  vehicleLat: number;
  vehicleLng: number;
  vehicleName: string;
  homeGeofence: {latitude: number; longitude: number; radius: number; name: string} | null;
  events: GuardEvent[];
}) {
  const t = useNativeTranslation();

  // GuardEvent records are state-change rows (locked, valet_mode_enabled, …)
  // sourced from security_events; they no longer carry latitude/longitude. The
  // map therefore omits the trail and shows only the live vehicle position +
  // home geofence circle. The position-building below is preserved from the web
  // LiveMap intent (build a trail from any event coordinates) and naturally
  // degrades to an empty array because the wire shape has no lat/lng.
  const eventPositions: [number, number][] = useMemo(
    () =>
      events
        .map(ev => {
          const rec = ev as unknown as {latitude?: number; longitude?: number};
          return rec.latitude != null && rec.longitude != null
            ? ([rec.latitude, rec.longitude] as [number, number])
            : null;
        })
        .filter((p): p is [number, number] => p != null),
    [events],
  );

  return (
    <View style={styles.mapUnavailable}>
      <View
        accessibilityLabel={t('guard.mapLabel', 'Live vehicle location map')}
        accessibilityRole="image"
        style={styles.mapPlaceholder}>
        <SemanticIcon decorative name="map" size="lg" />
        <AppText style={styles.mapPlaceholderText} tone="muted" variant="caption">
          {t(
            'guard.mapUnavailable',
            'Interactive map is unavailable on this device. Live coordinates are shown below.',
          )}
        </AppText>
      </View>

      {/* Vehicle marker (web Marker + MapPopup) */}
      <View style={styles.mapDatumRow}>
        <SemanticIcon decorative name="vehicle" size="sm" />
        <View style={styles.mapDatumBody}>
          <AppText weight="semibold">{vehicleName || 'Vehicle'}</AppText>
          <AppText style={styles.mapCoords} tone="muted" variant="caption">
            {vehicleLat.toFixed(6)}, {vehicleLng.toFixed(6)}
          </AppText>
        </View>
      </View>

      {/* Home geofence circle (web Circle) */}
      {homeGeofence ? (
        <View style={styles.mapDatumRow}>
          <SemanticIcon decorative name="fence" size="sm" />
          <View style={styles.mapDatumBody}>
            <AppText weight="semibold">{homeGeofence.name}</AppText>
            <AppText style={styles.mapCoords} tone="muted" variant="caption">
              {homeGeofence.latitude.toFixed(6)}, {homeGeofence.longitude.toFixed(6)}
              {' · '}
              {t('guard.geofenceRadius', '{{radius}}m radius', {
                radius: Math.round(homeGeofence.radius),
              })}
            </AppText>
          </View>
        </View>
      ) : null}

      {/* Event trail (web Polyline) — positions are always empty, so never renders */}
      {eventPositions.length > 1 ? <EventTrail positions={eventPositions} /> : null}
    </View>
  );
}

// Web EventTrail rendered a Leaflet Polyline of the event positions. Positions
// are always empty (GuardEvent rows carry no coordinates), so this is never
// reached — preserved for one-for-one parity with the source.
function EventTrail({positions}: {positions: [number, number][]}) {
  return (
    <AppText tone="muted" variant="caption">
      {positions.length}
    </AppText>
  );
}

function EventRow({
  event,
  onAcknowledge,
  isAcking,
}: {
  event: GuardEvent;
  onAcknowledge: (eventId: number) => void;
  isAcking: boolean;
}) {
  const t = useNativeTranslation();
  const acknowledged = isGuardEventAcknowledged(event);

  const iconName: SemanticIconName = acknowledged
    ? 'success'
    : event.event_type === 'manual_panic'
    ? 'securityAlert'
    : (event.event_type ?? '').includes('unlock')
    ? 'unlocked'
    : (event.event_type ?? '').includes('drive')
    ? 'vehicle'
    : 'warning';

  return (
    <View
      style={[
        styles.eventRow,
        acknowledged ? styles.eventRowAck : styles.eventRowActive,
      ]}>
      <View style={styles.eventIcon}>
        <SemanticIcon decorative name={iconName} size="sm" />
      </View>

      <View style={styles.eventBody}>
        <View style={styles.eventBadgeRow}>
          <Badge
            label={EVENT_LABELS[event.event_type] ?? event.event_type}
            variant={EVENT_BADGE_VARIANT[event.event_type] ?? 'info'}
          />
          <TimeStamp style={styles.eventTime} value={event.ts} />
        </View>

        {event.from_state != null || event.to_state != null ? (
          <AppText style={styles.eventMeta} tone="muted" variant="caption">
            {event.from_state ?? '—'} → {event.to_state ?? '—'}
          </AppText>
        ) : null}

        {event.acknowledged_by ? (
          <AppText style={styles.eventMeta} tone="muted" variant="caption">
            {t('guard.acknowledgedBy', 'Acknowledged by')}: {event.acknowledged_by}
          </AppText>
        ) : null}
      </View>

      <View style={styles.eventAction}>
        {!acknowledged ? (
          <Button
            disabled={isAcking}
            label={t('guard.acknowledge', 'Ack')}
            onPress={() => onAcknowledge(event.id)}
            size="sm"
            variant="secondary"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alertBanner: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  alertBody: {
    paddingLeft: 2,
  },
  alertEventRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  alertEventText: {
    color: colors.textSecondary,
  },
  alertHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  alertTitle: {
    color: colors.danger,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    letterSpacing: 0.2,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonFullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  buttonLabel: {
    color: colors.textPrimary,
  },
  buttonLabelSm: {
    fontSize: 11,
  },
  buttonPrimaryLabel: {
    color: colors.background,
  },
  buttonSm: {
    minHeight: 30,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 480,
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
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialogMessage: {
    lineHeight: 22,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  emptyIcon: {
    opacity: 0.7,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyRoot: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  eventAction: {
    flexShrink: 0,
  },
  eventBadgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  eventBody: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  eventIcon: {
    flexShrink: 0,
    paddingTop: 2,
  },
  eventMeta: {
    marginTop: 2,
  },
  eventRow: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  eventRowAck: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
  },
  eventRowActive: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  eventTime: {
    color: colors.textMuted,
  },
  fieldHint: {
    marginTop: spacing.xs,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
  },
  grid: {
    gap: spacing.md,
  },
  guardCircle: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  guardCircleArmed: {
    backgroundColor: colors.successSurface,
  },
  guardCircleDisarmed: {
    backgroundColor: colors.surfaceRaised,
  },
  guardCircleTriggered: {
    backgroundColor: colors.dangerSurface,
  },
  guardHeading: {
    textAlign: 'center',
  },
  guardPanel: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  guardPanelArmed: {
    borderColor: colors.successBorder,
  },
  guardPanelTriggered: {
    borderColor: colors.dangerBorder,
  },
  loadingDot: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  mapBody: {
    padding: spacing.md,
  },
  mapCoords: {
    fontFamily: 'monospace',
  },
  mapDatumBody: {
    flex: 1,
    minWidth: 0,
  },
  mapDatumRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mapEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  mapHeader: {
    paddingBottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  mapPanel: {
    overflow: 'hidden',
  },
  mapPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  mapPlaceholderText: {
    textAlign: 'center',
  },
  mapUnavailable: {
    gap: spacing.md,
  },
  modalMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.sm,
    width: '92%',
    ...shadows.panel,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageActions: {
    alignItems: 'flex-end',
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageSections: {
    gap: spacing.lg,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panicDesc: {
    textAlign: 'center',
  },
  panicPanel: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  saveButtonWrap: {
    marginTop: spacing.md,
  },
  sectionTitle: {
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  selectChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  selectChipText: {
    color: colors.textSecondary,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  selectRowContent: {
    paddingVertical: spacing.xs,
  },
  settingsAutoCol: {
    gap: spacing.md,
  },
  statusList: {
    gap: spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusText: {
    flex: 1,
    minWidth: 0,
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timelineList: {
    maxHeight: 400,
  },
  timelineListInner: {
    gap: spacing.md,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  vsCheck: {
    color: colors.accent,
    fontSize: 14,
  },
  vsChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  vsList: {
    maxHeight: 320,
  },
  vsOption: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  vsOptionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
  },
  vsOptionLabelSelected: {
    color: colors.accent,
  },
  vsOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  vsTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minWidth: 150,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  vsTriggerLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
});

const buttonVariantStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: colors.danger,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, {color: string}>>({
  danger: {
    color: colors.danger,
  },
  warning: {
    color: colors.warning,
  },
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
