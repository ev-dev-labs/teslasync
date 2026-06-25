// Native parity port of web/src/components/forms/VehicleSelect.tsx.
//
// VehicleSelect — canonical per-page vehicle scope picker. A drop-in picker
// wired to a shared selected-vehicle store. Renders nothing when the fleet is
// empty (the page should already be showing a NoVehicleSelected empty state in
// that case) and always renders for fleets of >=1 vehicle so the user has an
// explicit context indicator even when they only own one car. For multi-vehicle
// pickers (rule editors, alert scopes), use VehicleMultiSelect instead.
//
// Web -> native mapping notes:
//   - The shared web <Select> (a styled DOM <select> + <option> list) has no
//     native analogue, so it becomes a Pressable trigger that opens a Modal
//     single-select list — the same Pressable + Modal dropdown pattern proven
//     in the SavedViewMenu parity port. The value/onChange(Number parse)/
//     options building/aria-label/data-testid semantics are all preserved.
//   - useSelectedVehicle() (web) composes a localStorage-backed React Context
//     store with react-router URL precedence (useMatch '/vehicles/:id',
//     useSearchParams '?vehicle_id='). react-router + localStorage are
//     browser-only, so the native port inlines a module-level shared store
//     (useSyncExternalStore) that preserves the cross-instance "global
//     selection" behaviour and the default-to-first-vehicle behaviour, reading
//     the fleet from the ported useVehicles() hook. The URL precedence and the
//     localStorage persistence are intentionally dropped (the parity tree pulls
//     in no RN router or storage dependency); selection is shared in-memory for
//     the app session — the same graceful degradation the web store documents
//     for private-browsing/SSR. Documented in the sidecar.
//   - react-i18next useTranslation -> inlined useNativeTranslationFallback()
//     returning the web English fallback copy verbatim, matching DatePresetChips.
//   - lucide-react Car -> a decorative car glyph hidden from assistive tech,
//     matching the established lucide -> glyph parity convention.
//   - The web className pass-through (cn('text-sm', className)) becomes a style
//     pass-through (StyleProp<ViewStyle>) merged onto the trigger; the web `id`
//     -> nativeID and `data-testid` -> testID, matching the other forms ports.

import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {useVehicles} from '../../api/hooks/useVehicles';
import type {Vehicle} from '../../api/types';

/**
 * Inlined react-i18next fallback: returns the web English fallback copy
 * verbatim (no interpolation needed here), matching the DatePresetChips port.
 */
function useNativeTranslationFallback(): (
  key: string,
  fallback: string,
) => string {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

// --- Native-safe shared selected-vehicle store -----------------------------
// Native analogue of web store/selectedVehicle (Context + localStorage). RN has
// no localStorage and the parity tree pulls in no router, so the store is a
// lean module-level external store shared across every VehicleSelect instance.
// Selection lives for the app session (no cold-restart persistence — the same
// graceful degradation the web store documents for private-browsing/SSR).

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

interface SelectedVehicleResult {
  /** Effective vehicle id (store > first vehicle). `null` only when the fleet is empty. */
  vehicleId: number | null;
  /** Full vehicles list (always an array — empty when not loaded). */
  vehicles: Vehicle[];
  /** Update the shared selection. */
  setVehicleId: (id: number | null) => void;
}

/**
 * Native-safe analogue of the web useSelectedVehicle() hook: composes the
 * shared module-level store with the ported useVehicles() fleet list and
 * defaults to the first vehicle the moment the fleet loads. The web URL
 * precedence (path/query params) is browser-router-only and omitted.
 */
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];

  const stored = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );

  // Default to the first vehicle the moment the fleet loads (web parity).
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  // Effective id computed inline so first-render reads don't wait for the effect.
  const effectiveId = stored ?? firstVehicleId;

  return {
    vehicleId: effectiveId,
    vehicles,
    setVehicleId: setSelectedVehicleId,
  };
}

export interface VehicleSelectProps {
  /** Optional override for the accessible label. Defaults to t('vehicleSelect.aria'). */
  ariaLabel?: string;
  /** Optional style applied to the underlying trigger (replaces the web className). */
  style?: StyleProp<ViewStyle>;
  /** Optional native id forwarded to the trigger (web `id` on the <select>). */
  id?: string;
  /** When true, prefixes a small car glyph before the trigger (matches sidebar picker). */
  withIcon?: boolean;
  /** Test id forwarded to the trigger. Defaults to "vehicle-select". */
  'data-testid'?: string;
}

export function VehicleSelect({
  ariaLabel,
  style,
  id,
  withIcon = false,
  'data-testid': testId = 'vehicle-select',
}: VehicleSelectProps) {
  const t = useNativeTranslationFallback();
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
  const label = ariaLabel ?? t('vehicleSelect.aria', 'Select vehicle');

  const select = (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        nativeID={id}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          style,
        ]}
        testID={testId}>
        <AppText numberOfLines={1} style={styles.triggerLabel}>
          {selectedOption?.label ?? label}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}>
          ⌄
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={() => undefined}>
            <ScrollView style={styles.list}>
              {options.map(opt => {
                const selected = opt.value === currentValue;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    onPress={() => {
                      const next = Number(opt.value);
                      setVehicleId(
                        Number.isFinite(next) && next > 0 ? next : null,
                      );
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.optionPressed,
                    ]}
                    testID={`${testId}-option-${opt.value}`}>
                    <AppText
                      numberOfLines={1}
                      style={[
                        styles.optionLabel,
                        selected && styles.optionLabelSelected,
                      ]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {selected ? (
                      <AppText style={styles.check}>✓</AppText>
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

  if (!withIcon) {
    return select;
  }

  return (
    <View style={styles.iconRow}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.carGlyph}>
        🚗
      </AppText>
      {select}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    justifyContent: 'space-between',
    minWidth: 140,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  iconRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  carGlyph: {
    color: colors.textMuted,
    fontSize: 16,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  menu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.sm,
    width: '92%',
    ...shadows.panel,
  },
  list: {
    maxHeight: 320,
  },
  option: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  optionLabelSelected: {
    color: colors.accent,
  },
  check: {
    color: colors.accent,
    fontSize: 14,
  },
});

export default VehicleSelect;
