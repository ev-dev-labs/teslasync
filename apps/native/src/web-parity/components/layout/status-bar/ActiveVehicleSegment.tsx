// Native parity port of web/src/components/layout/status-bar/ActiveVehicleSegment.tsx.
//
// The web component is a footer status-bar segment that shows the currently
// selected vehicle and, for multi-vehicle accounts, opens a small popover to
// switch between vehicles. It leans on several browser-only primitives that
// React Native has no analogue for, so (per conversion-contract rule 7) each is
// moved behind a native-safe substitute while every state name, API path, unit
// computation, i18n key and visual affordance is preserved:
//   - `useSelectedVehicle()` (web) composes react-router `useMatch` /
//     `useSearchParams` with the `SelectedVehicleProvider` localStorage store.
//     RN has no router and no localStorage, so the URL-precedence layer is
//     dropped (documented) and the persistent store is reproduced as an
//     in-process, listener-backed module store (`useSyncExternalStore`) seeded
//     to the first vehicle — the same default the web hook applies. Selection is
//     shared across mounts for the session; cross-tab `storage` sync is a
//     browser-only concern and is intentionally not ported.
//   - `useUnits()` reads the settings provider for the distance preference. The
//     parity tree has no settings provider (see Delta / data-display/format), so
//     the distance unit defaults to the web no-settings value
//     (`deriveDistance(undefined) === 'km'`) and may be overridden by the host
//     via the optional `distanceUnit` prop. `unitPrefs.distance` -> `distanceLabel`.
//   - `convertDistanceFromSI` (`@/lib/unitConversion`) is ported inline (the same
//     metres->mi / metres->km math used by the native data-display/format barrel).
//   - `useVehicleState(vehicleId ?? 0, { refetchInterval: 60_000 })` uses the REAL
//     native hook (it already exists in the parity api tree); the 60s footer-tier
//     poll is preserved verbatim.
//   - `react-i18next` `useTranslation` -> a native-safe (key, fallback) shim; all
//     i18n keys + English fallbacks are copied verbatim.
//   - lucide `Car` / `ChevronUp` / `Check` -> bare SemanticIcon glyph text
//     (`vehicle` 'EV' / `collapse` '^' + `expand` 'v' / `confirm` 'OK'), matching
//     the tiny-inline-icon convention used by the sibling parity ports.
//   - `Tooltip` (hover) -> the same composed text surfaced as `accessibilityHint`
//     (there is no hover on touch; the established parity mapping for tooltips).
//   - The DOM outside-click + Escape `useEffect` -> a React Native `Modal` whose
//     backdrop press + `onRequestClose` (hardware back) close the popover.
//   - `cn(...)` class merging -> StyleSheet style arrays; `className` -> `style`.
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useVehicleState,
  useVehicles,
  type Vehicle,
  type VehicleState,
} from '../../../api/hooks/useVehicles';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Ported unit conversion (web @/lib/unitConversion convertDistanceFromSI) -

type DistanceUnit = 'km' | 'mi';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// ---- Native selected-vehicle store ------------------------------------------
//
// Native-safe analogue of the web SelectedVehicleProvider / useSelectedVehicle
// store. The web store persisted to localStorage and synced across tabs via the
// `storage` event; RN has neither, so selection lives in this module-level value
// + listener set and is shared across every mount via `useSyncExternalStore`.
// The web `useMatch` / `useSearchParams` URL-precedence layer has no router
// equivalent and is intentionally dropped — selection falls back to the first
// vehicle, exactly as the web hook does once URL/store are empty.

let selectedVehicleId: number | null = null;
const selectionListeners = new Set<() => void>();

function setSelectedVehicleIdStore(id: number | null): void {
  if (selectedVehicleId === id) {
    return;
  }
  selectedVehicleId = id;
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

interface SelectedVehicleResult {
  /** Effective vehicle id (store > first vehicle). `null` only when the fleet is empty. */
  vehicleId: number | null;
  /** Vehicle record matching {@link vehicleId}, or `null` if not yet loaded / not found. */
  vehicle: Vehicle | null;
  /** Full vehicles list (always an array — empty when not loaded). */
  vehicles: Vehicle[];
  /** Update the persisted selection. */
  setVehicleId: (id: number | null) => void;
}

function useSelectedVehicle(): SelectedVehicleResult {
  const stored = useSyncExternalStore(subscribeSelection, getSelectionSnapshot);
  const {data} = useVehicles();
  const vehicles = useMemo<Vehicle[]>(() => data ?? [], [data]);

  const setVehicleId = useCallback((id: number | null) => {
    setSelectedVehicleIdStore(id);
  }, []);

  // Default to the first vehicle the moment the fleet loads (web L70-74).
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setSelectedVehicleIdStore(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  // Effective id computed inline so first-render reads don't wait for the effect.
  const effectiveId = stored ?? firstVehicleId;

  const vehicle = useMemo<Vehicle | null>(() => {
    if (effectiveId == null) {
      return null;
    }
    return vehicles.find(v => v.id === effectiveId) ?? null;
  }, [effectiveId, vehicles]);

  return {vehicleId: effectiveId, vehicle, vehicles, setVehicleId};
}

// ---- Icon glyphs (web lucide Car / ChevronUp / Check) -----------------------

const VEHICLE_GLYPH = getSemanticIconDefinition('vehicle').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('confirm').glyph;
// ChevronUp points up when the popover is open, and is `rotate-180` (down) when
// closed — reproduced with the collapse '^' / expand 'v' glyph pair.
const CHEVRON_UP_GLYPH = getSemanticIconDefinition('collapse').glyph;
const CHEVRON_DOWN_GLYPH = getSemanticIconDefinition('expand').glyph;

export interface ActiveVehicleSegmentProps {
  /** When true, renders only the vehicle glyph (web `iconOnly`). */
  iconOnly?: boolean;
  /**
   * Distance display unit. Replaces the web `useUnits().unitPrefs.distance`
   * (settings-provider driven). Defaults to the web no-settings value 'km'.
   */
  distanceUnit?: DistanceUnit;
  /** Extra style on the outer node (web root `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * ActiveVehicleSegment.
 *
 * Footer status-bar segment showing the currently selected vehicle. For
 * multi-vehicle accounts a press opens a small popover listing every vehicle —
 * picking one updates the shared native selection store, scoping the rest of the
 * app. Single-vehicle owners get a static, non-interactive chip; the segment is
 * hidden entirely while the fleet is empty / still loading (web L74-76).
 */
export function ActiveVehicleSegment({
  iconOnly = false,
  distanceUnit = 'km',
  style,
  testID,
}: ActiveVehicleSegmentProps) {
  const t = useNativeTranslationFallback();
  const {vehicle, vehicles, vehicleId, setVehicleId} = useSelectedVehicle();
  const [open, setOpen] = useState(false);

  // Footer-tier polling: 60s is plenty for an always-mounted micro-segment. The
  // full-vehicle state hook is shared via TanStack Query dedup with any
  // page-tier consumer, so this just lengthens the safety-net interval.
  const {data: stateData} = useVehicleState(vehicleId ?? 0, {
    refetchInterval: 60_000,
  });

  // state.rated_range arrives in metres (SI). Use the SI-aware converter + the
  // host distance preference so the value tracks the user's unit preference.
  const distanceLabel = distanceUnit;
  const rawState = stateData?.state;
  const liveState: VehicleState | null =
    rawState != null && typeof rawState === 'object' ? rawState : null;
  const metricsLabel = liveState
    ? `${liveState.battery_level ?? 0}% \u00B7 ${Math.round(
        convertDistanceFromSI(liveState.rated_range ?? 0, distanceLabel),
      )} ${distanceLabel}`
    : null;

  const pick = useCallback(
    (id: number) => {
      setVehicleId(id);
      setOpen(false);
    },
    [setVehicleId],
  );

  if (vehicles.length === 0) {
    return null;
  }

  const label =
    vehicle?.display_name ||
    vehicle?.vin ||
    (vehicleId != null
      ? `${t('statusBar.vehicle.fallback', 'Vehicle')} ${vehicleId}`
      : t('statusBar.vehicle.none', 'No vehicle'));
  const subLabel = vehicle?.model || '';

  // Web Tooltip content, surfaced as an accessibility hint on native.
  const tooltip = `${t('statusBar.vehicle.tooltip', 'Active vehicle')} \u00B7 ${label}${
    subLabel ? ` \u00B7 ${subLabel}` : ''
  }${metricsLabel ? ` \u00B7 ${metricsLabel}` : ''}`;

  const glyph = (
    <AppText style={styles.glyph} tone="muted" variant="caption" weight="bold">
      {VEHICLE_GLYPH}
    </AppText>
  );

  // Single-vehicle owners get a static, non-interactive chip — no need for a
  // switcher when there's nothing to switch to (web L94-116).
  if (vehicles.length === 1) {
    return (
      <View
        accessibilityHint={tooltip}
        accessibilityLabel={`${t('statusBar.vehicle.aria', 'Active vehicle')}: ${label}`}
        accessible
        style={[styles.chip, style]}
        testID={testID}>
        {glyph}
        {!iconOnly ? (
          <>
            <AppText
              numberOfLines={1}
              style={styles.label}
              tone="secondary"
              variant="caption">
              {label}
            </AppText>
            {metricsLabel ? (
              <AppText style={styles.metrics} tone="muted" variant="caption">
                {`\u00B7 ${metricsLabel}`}
              </AppText>
            ) : null}
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Pressable
        accessibilityHint={tooltip}
        accessibilityLabel={`${t('statusBar.vehicle.switch', 'Switch vehicle')} (${label})`}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={6}
        onPress={() => setOpen(o => !o)}
        style={({pressed}) => [styles.chip, pressed && styles.chipPressed]}>
        {glyph}
        {!iconOnly ? (
          <>
            <AppText
              numberOfLines={1}
              style={styles.label}
              tone="secondary"
              variant="caption">
              {label}
            </AppText>
            {metricsLabel ? (
              <AppText style={styles.metrics} tone="muted" variant="caption">
                {`\u00B7 ${metricsLabel}`}
              </AppText>
            ) : null}
            <AppText style={styles.chevron} tone="muted" variant="caption" weight="bold">
              {open ? CHEVRON_UP_GLYPH : CHEVRON_DOWN_GLYPH}
            </AppText>
          </>
        ) : null}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={t('statusBar.vehicle.aria', 'Active vehicle')}
            accessibilityRole="menu"
            style={styles.popover}
            testID="active-vehicle-segment-popover">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.popoverScroll}>
              {vehicles.map(v => {
                const selected = v.id === vehicleId;
                const name =
                  v.display_name ||
                  v.vin ||
                  `${t('statusBar.vehicle.fallback', 'Vehicle')} ${v.id}`;
                return (
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={{selected}}
                    key={v.id}
                    onPress={() => pick(v.id)}
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}>
                    <AppText
                      style={styles.optionGlyph}
                      tone="muted"
                      variant="caption"
                      weight="bold">
                      {VEHICLE_GLYPH}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      style={styles.optionLabel}
                      variant="caption">
                      <AppText
                        tone={selected ? 'primary' : 'secondary'}
                        variant="caption"
                        weight="semibold">
                        {name}
                      </AppText>
                      {v.model ? (
                        <AppText tone="muted" variant="caption">
                          {`  ${v.model}`}
                        </AppText>
                      ) : null}
                    </AppText>
                    {selected ? (
                      <AppText
                        style={styles.optionCheck}
                        variant="caption"
                        weight="bold">
                        {CHECK_GLYPH}
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

ActiveVehicleSegment.displayName = 'ActiveVehicleSegment';

const styles = StyleSheet.create({
  // Web root `relative inline-flex`.
  container: {
    alignSelf: 'flex-start',
  },
  // Web chip/button `inline-flex items-center gap-1.5 rounded px-1.5 py-0.5
  // text-[11px] leading-none text-[var(--text-secondary)]`.
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // Web `hover:bg-white/[0.04]` -> press affordance (no hover on touch).
  chipPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  glyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  // Web `font-medium truncate max-w-[140px..160px]` (single-line truncation via
  // numberOfLines). font-medium == 500.
  label: {
    fontSize: 11,
    fontWeight: '500',
    maxWidth: 160,
  },
  metrics: {
    fontSize: 11,
  },
  // Web ChevronUp `h-3 w-3 transition-transform` (glyph flips with `open`).
  chevron: {
    fontSize: 11,
    lineHeight: 14,
  },
  // Web popover wrapper `absolute bottom-full right-0` -> a Modal overlay that
  // anchors the panel to the bottom-right, mirroring the footer popover.
  overlay: {
    alignItems: 'flex-end',
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  // Web `min-w-[220px] max-h-[280px] rounded-lg border bg-[var(--surface-1)]
  // shadow-2xl backdrop-blur-xl p-1`.
  popover: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 280,
    minWidth: 220,
    padding: spacing.xs,
  },
  // Web `max-h-[280px] overflow-y-auto`.
  popoverScroll: {
    flexGrow: 0,
  },
  // Web option `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left
  // text-xs`.
  option: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  // Web `hover:bg-white/[0.06]` -> press affordance.
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  // Web `flex-1 min-w-0 truncate`.
  optionLabel: {
    flexShrink: 1,
    flexGrow: 1,
  },
  // Web Check `h-3.5 w-3.5 text-emerald-300`.
  optionCheck: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 16,
  },
});
