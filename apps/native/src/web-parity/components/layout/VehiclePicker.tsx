// Native parity port of web/src/components/layout/VehiclePicker.tsx.
//
// The web component is a persistent app-wide vehicle selector mounted in the
// sidebar header: a small `Car` icon next to a `<Select>` dropdown. It hides
// itself for single-vehicle owners, floats pinned vehicles to the top, and
// reads/writes the active vehicle through `useSelectedVehicle`. It is
// reproduced here with React Native primitives:
//
//   - The web `@/components/ui/Select` (a DOM `<select>`) is browser-only and is
//     replaced by a trigger `Pressable` showing the active label + caret that
//     opens a `Modal` option list — the same pattern the native SortControl /
//     ChartExportMenu parity ports use. Picking an option runs the web
//     `onChange` body verbatim (`Number(value)`, keep when finite & > 0).
//   - The lucide `Car` icon (browser-only, `aria-hidden`) becomes a decorative
//     car glyph (`🚗`) rendered in `AppText` with `importantForAccessibility`
//     "no", matching the native glyph approach (SortControl arrows, Breadcrumbs
//     house). The pinned-label `📌` emoji from the web option labels is
//     preserved verbatim.
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     t() shim returns the English fallback copy verbatim so the
//     `vehiclePicker.aria` key (+ a native-only `vehiclePicker.closeMenu`) and
//     fallbacks are preserved.
//   - The web `useSelectedVehicle` derives the active id from react-router (path
//     `/vehicles/:id`, query `?vehicle_id=N`) plus a persisted Zustand store;
//     neither the router nor that store exists in native parity. The list comes
//     from the ported native `useVehicles()` and the selection is local state
//     seeded to the first vehicle (mirroring the web "default to the first
//     vehicle the moment the fleet loads" branch). Optional controlled props
//     (`vehicleId` + `onVehicleChange`) let a screen lift selection into its own
//     navigator/store (the additive escape-hatch precedent set by Breadcrumbs
//     `onNavigate` / PageHeader `onCopyLink`). The URL-precedence is browser-
//     only and is intentionally dropped.
//   - The ported native `usePinned('vehicle')` drives pin-aware ordering exactly
//     as on the web. The `cn`/`className` Tailwind merge is web-only: `className`
//     is retained on props for source compatibility but ignored on native, with
//     a `style` override added instead. The `lg:px-4` responsive padding bump
//     (viewport ≥1024px, never met on phone form factors) is flattened to the
//     base `px-3`.

import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {usePinned} from '../../api/hooks/usePinned';
import {useVehicles, type Vehicle} from '../../api/hooks/useVehicles';

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * react-i18next `useTranslation` is unavailable in native parity; this shim
 * returns the English fallback copy verbatim while preserving the i18n keys.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

interface SelectedVehicleState {
  /** Effective vehicle id, or `null` when the fleet is empty / not yet loaded. */
  vehicleId: number | null;
  /** Update the selection (notifies `onVehicleChange` and updates local state). */
  setVehicleId: (id: number | null) => void;
  /** Full vehicles list (always an array — empty when not loaded). */
  vehicles: Vehicle[];
}

/**
 * Native-safe replacement for the web `useSelectedVehicle`. The web hook resolves
 * the active id from the URL (path/query) and a persisted store; native parity
 * has neither router nor store, so the list comes from the ported `useVehicles()`
 * and the selection is local state seeded to the first vehicle the moment the
 * fleet loads. When `controlledId` is provided the component is controlled and
 * defers all writes to `onVehicleChange`.
 */
function useSelectedVehicle(
  controlledId: number | null | undefined,
  onVehicleChange: ((id: number | null) => void) | undefined,
): SelectedVehicleState {
  const {data: vehicles = []} = useVehicles();
  const [internalId, setInternalId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;

  useEffect(() => {
    if (internalId == null && firstVehicleId != null) {
      setInternalId(firstVehicleId);
    }
  }, [internalId, firstVehicleId]);

  const isControlled = controlledId !== undefined;
  const vehicleId = isControlled ? controlledId ?? null : internalId;

  const setVehicleId = useCallback(
    (id: number | null) => {
      if (!isControlled) {
        setInternalId(id);
      }
      onVehicleChange?.(id);
    },
    [isControlled, onVehicleChange],
  );

  return {vehicleId, setVehicleId, vehicles};
}

export interface VehiclePickerProps {
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /**
   * Optional controlled selection. When provided the picker is controlled and
   * all changes are routed through {@link onVehicleChange}; omit it to let the
   * picker manage selection internally (seeded to the first vehicle).
   */
  vehicleId?: number | null;
  /**
   * Native-safe replacement for the web router/store write. Invoked with the new
   * vehicle id whenever the user picks a vehicle, so a screen can scope its
   * navigation/queries to the selection.
   */
  onVehicleChange?: (id: number | null) => void;
  /** Native style override on the outer row. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Persistent app-wide vehicle selector mounted in the sidebar header.
 *
 * Hides itself for single-vehicle owners (and while the fleet is still loading)
 * so it doesn't add noise for the common case.
 *
 * Pin-aware ordering: vehicles the user has pinned float to the top in pin
 * position order, then the rest follow in their original API order.
 */
export function VehiclePicker({
  className: _className,
  vehicleId: controlledId,
  onVehicleChange,
  style,
  testID,
}: VehiclePickerProps) {
  const t = useNativeTranslationFallback();
  const {vehicleId, setVehicleId, vehicles} = useSelectedVehicle(
    controlledId,
    onVehicleChange,
  );
  const {data: pins = []} = usePinned('vehicle');
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => {
    if (pins.length === 0) {
      return vehicles;
    }
    const order = new Map<string, number>();
    pins.forEach(p => order.set(String(p.item_id), p.position));
    return [...vehicles].sort((a, b) => {
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
  }, [vehicles, pins]);

  const options = useMemo(
    () =>
      sorted.map(v => {
        const isPinned = pins.some(p => String(p.item_id) === String(v.id));
        const base = v.display_name || v.vin || `Vehicle ${v.id}`;
        return {
          value: String(v.id),
          label: isPinned ? `📌 ${base}` : base,
        };
      }),
    [sorted, pins],
  );

  const close = useCallback(() => setOpen(false), []);
  const pick = useCallback(
    (value: string) => {
      const next = Number(value);
      setVehicleId(Number.isFinite(next) && next > 0 ? next : null);
      setOpen(false);
    },
    [setVehicleId],
  );

  // Hide for fleets of 0 or 1 vehicle — there's nothing meaningful to pick.
  if (vehicles.length <= 1) {
    return null;
  }

  const currentValue = vehicleId != null ? String(vehicleId) : '';
  const selectedOption = options.find(o => o.value === currentValue);
  const selectedLabel = selectedOption?.label ?? t('vehiclePicker.aria', 'Select vehicle');

  return (
    <View style={[styles.root, style]} testID={testID ?? 'vehicle-picker'}>
      <AppText
        importantForAccessibility="no"
        style={styles.icon}
        tone="muted">
        {'\u{1F697}'}
      </AppText>
      <Pressable
        accessibilityLabel={t('vehiclePicker.aria', 'Select vehicle')}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={4}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.trigger, pressed && styles.pressed]}
        testID="vehicle-picker-trigger">
        <AppText
          numberOfLines={1}
          style={styles.triggerText}
          variant="caption">
          {selectedLabel}
        </AppText>
        <AppText style={styles.caret} variant="caption">
          {'\u25BE'}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('vehiclePicker.closeMenu', 'Close vehicle options')}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={t('vehiclePicker.aria', 'Select vehicle')}
            accessibilityRole="menu"
            style={styles.menu}
            testID="vehicle-picker-options">
            {options.map(option => {
              const active = option.value === currentValue;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="menuitem"
                  accessibilityState={{selected: active}}
                  key={option.value}
                  onPress={() => pick(option.value)}
                  style={({pressed}) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}
                  testID={`vehicle-picker-option-${option.value}`}>
                  <AppText
                    numberOfLines={1}
                    style={[styles.optionText, active && styles.optionTextActive]}
                    variant="caption"
                    weight="semibold">
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

VehiclePicker.displayName = 'VehiclePicker';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  caret: {
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  icon: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 20,
  },
  menu: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    maxHeight: '70%',
    maxWidth: 360,
    minWidth: 240,
    padding: spacing.xs,
    width: '82%',
  },
  option: {
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.accent,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  triggerText: {
    color: colors.textPrimary,
    flex: 1,
  },
});
