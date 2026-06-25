/**
 * `VehicleMultiSelect` — React Native parity port of
 * web/src/components/forms/VehicleMultiSelect.tsx.
 *
 * Multi-vehicle picker for the Alert Studio.
 *
 * Discriminated-union value shape modeling the editor invariant:
 *
 *   { kind: 'all_sticky' }                              — applies to fleet (current + future)
 *   { kind: 'specific', vehicle_ids: number[] }         — explicit subset
 *
 * The "All vehicles (current + future)" sentinel is mutually
 * exclusive with per-vehicle selection. Toggling it ON moves to
 * `all_sticky` and remembers the previous specific selection so a
 * subsequent toggle OFF restores it.
 *
 * Unknown vehicle IDs (selected on a server-stored rule but not in
 * the current vehicles list, e.g. deleted/re-VINed vehicles) are
 * preserved in the selection and rendered with an "Unknown" badge at
 * the bottom of the list — they are never silently dropped from the
 * payload.
 *
 * Browser-only dependencies are reduced explicitly and documented in
 * the `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback?, params?)` that interpolates i18next-style
 *     `{{name}}` / `{{count}}` placeholders, keeping the i18n intent +
 *     every translation key.
 *   - lucide-react `ChevronDown`: rendered as a decorative `AppText`
 *     chevron glyph that rotates 180° when the popover opens (web
 *     `rotate-180 transition-transform`).
 *   - `@/components/ui` `Badge`: no native parity port yet, so a
 *     minimal native-safe `Badge` (neutral + warning, sm) is
 *     reproduced locally with a `View` + `AppText` (mirrors the
 *     CurrencyInput/ScoreBadge "reproduce the dependency locally"
 *     precedent).
 *   - `cn`: dropped — native styling uses `StyleSheet` + tokens.
 *   - The custom button + absolutely-positioned `<div role="listbox">`
 *     popover plus the `window` `mousedown` (click-outside) + `keydown`
 *     Escape listeners are replaced by a React Native `<Modal>` with a
 *     full-screen backdrop `Pressable` (outside tap → close) and
 *     `onRequestClose` (Android back ≈ Escape). The web `containerRef`
 *     (used only for click-outside hit-testing) becomes a `triggerRef`
 *     measured on open to anchor the popover below the trigger.
 *   - Option items render as `<Pressable accessibilityRole="checkbox"
 *     accessibilityState={{checked}}>` with a custom check indicator —
 *     the same "no Checkbox primitive" decision as the web source.
 *   - The web `handleTriggerKey` (ArrowDown / Enter / Space to open) has
 *     no native analog; on native the Pressable `onPress` opens the
 *     popover. `className` is retained on the props for source
 *     compatibility but ignored on native.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import type {Vehicle} from '../../api/types';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

export type VehicleSelection =
  | {kind: 'all_sticky'}
  | {kind: 'specific'; vehicle_ids: number[]};

export interface VehicleMultiSelectProps {
  value: VehicleSelection;
  onChange: (next: VehicleSelection) => void;
  vehicles: Vehicle[];
  /**
   * Inline error key resolved by i18n. When set, the trigger gets a
   * danger-coloured border and the error text appears below.
   */
  errorKey?: string | null;
  disabled?: boolean;
  /** Optional id forwarded to the trigger for label association / test hooks. */
  id?: string;
  /** Retained for source compatibility with the web Tailwind API; ignored on native. */
  className?: string;
}

const SENTINEL_ID = 'all_sticky_sentinel';

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

interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BadgeVariant = 'neutral' | 'warning';

interface BadgeProps {
  variant?: BadgeVariant;
  children: string;
  testID?: string;
}

/**
 * Minimal native-safe `Badge` — reproduces the two variants the web
 * `@/components/ui` `Badge` is used with here (neutral trigger summary +
 * warning "Unknown" chip), size `sm`. Documented in the sidecar.
 */
function Badge({variant = 'neutral', children, testID}: BadgeProps) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]} testID={testID}>
      <AppText
        numberOfLines={1}
        style={badgeTextVariantStyles[variant]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/**
 * `VehicleMultiSelect` — multi-vehicle picker for the Alert Studio.
 *
 * See the file header for the full behavioural contract and the list of
 * browser-only dependencies that were reduced for native.
 */
export function VehicleMultiSelect({
  value,
  onChange,
  vehicles,
  errorKey,
  disabled,
  id,
  className: _className,
}: VehicleMultiSelectProps) {
  const t = useNativeTranslationFallback();
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const popoverId = `${triggerId}-popover`;
  const errorId = `${triggerId}-error`;
  const [open, setOpen] = useState(false);
  // Replaces the web `containerRef`/`triggerRef`. The web container ref existed
  // only for `mousedown` click-outside hit-testing — handled here by the Modal
  // backdrop — so on native the trigger ref is measured to anchor the popover
  // below it (the web `absolute mt-1 w-full`).
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const previousSpecificRef = useRef<number[]>(
    value.kind === 'specific' ? value.vehicle_ids : [],
  );
  useEffect(() => {
    if (value.kind === 'specific') {
      previousSpecificRef.current = value.vehicle_ids;
    }
  }, [value]);

  const knownIds = useMemo(
    () => new Set(vehicles.map((v) => v.id)),
    [vehicles],
  );
  const selectedIds = useMemo(
    () => (value.kind === 'specific' ? value.vehicle_ids : []),
    [value],
  );
  const unknownIds = useMemo(
    () => selectedIds.filter((vid) => !knownIds.has(vid)),
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
      const veh = vehicles.find((v) => v.id === selectedIds[0]);
      const name = veh
        ? veh.display_name || veh.model || `Vehicle #${selectedIds[0]}`
        : `Vehicle #${selectedIds[0]}`;
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryOne',
        '{{name}}',
        {name},
      );
    }
    if (total > 0 && count < total) {
      return t(
        'notifications.alertStudio.editor.vehiclesSummaryPartial',
        '{{count}} of {{total}} vehicles',
        {count, total},
      );
    }
    return t(
      'notifications.alertStudio.editor.vehiclesSummaryCount',
      '{{count}} vehicles',
      {count},
    );
  }, [value, selectedIds, vehicles, t]);

  const close = useCallback(() => setOpen(false), []);

  const handleToggleAll = useCallback(() => {
    if (value.kind === 'all_sticky') {
      // Restore the previous specific selection (D13). Empty if none.
      onChange({kind: 'specific', vehicle_ids: previousSpecificRef.current});
      return;
    }
    onChange({kind: 'all_sticky'});
  }, [value, onChange]);

  const handleToggleVehicle = useCallback(
    (vehicleId: number) => {
      const current = value.kind === 'specific' ? value.vehicle_ids : [];
      const isSelected = current.includes(vehicleId);
      const next = isSelected
        ? current.filter((vid) => vid !== vehicleId)
        : dedupSort([...current, vehicleId]);
      onChange({kind: 'specific', vehicle_ids: next});
    },
    [value, onChange],
  );

  const toggle = useCallback(() => {
    if (disabled || isFleetEmpty) {
      return;
    }
    if (open) {
      setOpen(false);
      return;
    }
    // Measure the trigger so the popover can anchor to it (web `mt-1 w-full`).
    // In test / headless environments measureInWindow is a no-op; the popover
    // then falls back to a sensible top position.
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({x, y, width, height});
    });
    setOpen(true);
  }, [disabled, isFleetEmpty, open]);

  const menuPosition = useMemo<StyleProp<ViewStyle>>(() => {
    if (!anchor) {
      return styles.menuFallback;
    }
    return {
      left: anchor.x,
      top: anchor.y + anchor.height + spacing.xs,
      width: anchor.width,
    };
  }, [anchor]);

  const errorText = errorKey ? t(errorKey) : null;
  const hasError = Boolean(errorText);
  const disabledTrigger = Boolean(disabled) || isFleetEmpty;

  return (
    <View style={styles.root}>
      <Pressable
        ref={triggerRef}
        accessibilityLabel={triggerSummary}
        accessibilityRole="button"
        accessibilityState={{disabled: disabledTrigger, expanded: open}}
        disabled={disabledTrigger}
        nativeID={triggerId}
        onPress={toggle}
        style={({pressed}) => [
          styles.trigger,
          hasError ? styles.triggerError : styles.triggerDefault,
          disabledTrigger && styles.triggerDisabled,
          pressed && !disabledTrigger && styles.triggerPressed,
        ]}
        testID="vehicle-multiselect-trigger">
        <View style={styles.triggerLeft}>
          <Badge variant="neutral">{triggerSummary}</Badge>
        </View>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.chevron, open && styles.chevronOpen]}>
          {'\u25BE'}
        </AppText>
      </Pressable>

      {isFleetEmpty ? (
        <AppText style={styles.helpText} testID="vehicle-multiselect-empty-help">
          {t(
            'notifications.alertStudio.editor.vehiclesEmptyFleetHelp',
            'Add a vehicle in Settings → Vehicles to use this rule.',
          )}
        </AppText>
      ) : null}

      {hasError ? (
        <AppText
          accessibilityLiveRegion="assertive"
          nativeID={errorId}
          style={styles.errorText}
          testID="vehicle-multiselect-error">
          {errorText}
        </AppText>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open && !isFleetEmpty}>
        {/* Backdrop tap closes the popover — native analog of the web
            `window` mousedown click-outside listener. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={styles.backdrop}
          testID="vehicle-multiselect-backdrop"
        />
        <View
          accessibilityLabel={triggerSummary}
          accessibilityViewIsModal
          nativeID={popoverId}
          style={[styles.menu, menuPosition]}
          testID="vehicle-multiselect-popover">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.menuScroll}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{checked: value.kind === 'all_sticky'}}
              onPress={handleToggleAll}
              style={({pressed}) => [
                styles.option,
                value.kind === 'all_sticky' && styles.optionChecked,
                pressed && styles.optionPressed,
              ]}
              testID={`vehicle-multiselect-option-${SENTINEL_ID}`}>
              <View style={styles.optionLeft}>
                <View
                  style={[
                    styles.checkbox,
                    value.kind === 'all_sticky' && styles.checkboxChecked,
                  ]}>
                  {value.kind === 'all_sticky' ? (
                    <AppText style={styles.checkmark}>{'\u2713'}</AppText>
                  ) : null}
                </View>
                <AppText numberOfLines={1} style={styles.optionLabelStrong}>
                  {t(
                    'notifications.alertStudio.editor.vehiclesAllOption',
                    'All vehicles (current + future)',
                  )}
                </AppText>
              </View>
            </Pressable>

            <View style={styles.divider} />

            {vehicles.map((v) => {
              const checked =
                value.kind === 'specific' && value.vehicle_ids.includes(v.id);
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked}}
                  onPress={() => handleToggleVehicle(v.id)}
                  style={({pressed}) => [
                    styles.option,
                    checked && styles.optionChecked,
                    pressed && styles.optionPressed,
                  ]}
                  testID={`vehicle-multiselect-option-${v.id}`}>
                  <View style={styles.optionLeft}>
                    <View
                      style={[
                        styles.checkbox,
                        checked && styles.checkboxChecked,
                      ]}>
                      {checked ? (
                        <AppText style={styles.checkmark}>{'\u2713'}</AppText>
                      ) : null}
                    </View>
                    <AppText numberOfLines={1} style={styles.optionLabel}>
                      {vehicleLabel(v)}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}

            {unknownIds.length > 0 ? (
              <>
                <View style={styles.divider} />
                {unknownIds.map((vid) => (
                  <Pressable
                    key={`unknown-${vid}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: true}}
                    onPress={() => handleToggleVehicle(vid)}
                    style={({pressed}) => [
                      styles.option,
                      pressed && styles.optionPressed,
                    ]}
                    testID={`vehicle-multiselect-option-unknown-${vid}`}>
                    <View style={styles.optionLeft}>
                      <View style={[styles.checkbox, styles.checkboxChecked]}>
                        <AppText style={styles.checkmark}>{'\u2713'}</AppText>
                      </View>
                      <AppText numberOfLines={1} style={styles.optionLabelMuted}>
                        {t(
                          'notifications.alertStudio.editor.vehiclesUnknownLabel',
                          'Vehicle #{{id}}',
                          {id: vid},
                        )}
                      </AppText>
                    </View>
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
        </View>
      </Modal>
    </View>
  );
}

VehicleMultiSelect.displayName = 'VehicleMultiSelect';

/**
 * Convert a server-stored AlertRule into the editor's
 * {@link VehicleSelection}. Honours the new `all_vehicles` flag when
 * present and falls back to the legacy `vehicle_id` for transitional
 * compat (Decision D12).
 */
export function hydrateVehicleSelection(rule: {
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  vehicle_id?: number | null;
}): VehicleSelection {
  if (typeof rule.all_vehicles === 'boolean') {
    if (rule.all_vehicles) {
      return {kind: 'all_sticky'};
    }
    return {
      kind: 'specific',
      vehicle_ids: dedupSort(rule.vehicle_ids ?? []),
    };
  }
  return rule.vehicle_id == null
    ? {kind: 'all_sticky'}
    : {kind: 'specific', vehicle_ids: [rule.vehicle_id]};
}

/**
 * Convert a {@link VehicleSelection} into the wire-shape sub-payload
 * for `AlertRuleInput`. Always emits BOTH `all_vehicles` and
 * `vehicle_ids`; never emits the legacy `vehicle_id` (Decision D11).
 * Vehicle IDs are deduped + sorted (Decision D14).
 */
export function buildVehiclePayload(sel: VehicleSelection): {
  all_vehicles: boolean;
  vehicle_ids: number[];
} {
  if (sel.kind === 'all_sticky') {
    return {all_vehicles: true, vehicle_ids: []};
  }
  return {all_vehicles: false, vehicle_ids: dedupSort(sel.vehicle_ids)};
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  triggerDefault: {
    borderColor: colors.border,
  },
  triggerError: {
    borderColor: colors.danger,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  triggerPressed: {
    borderColor: colors.borderAccent,
  },
  triggerLeft: {
    flexShrink: 1,
    flexDirection: 'row',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
  chevronOpen: {
    transform: [{rotate: '180deg'}],
  },
  helpText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menu: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 12,
    maxHeight: 288,
    padding: spacing.xs,
    position: 'absolute',
    // Soft elevation for the floating popover (web `shadow-lg`).
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.34,
    shadowRadius: 18,
  },
  menuFallback: {
    left: spacing.md,
    right: spacing.md,
    top: spacing.xxl,
  },
  menuScroll: {
    maxHeight: 280,
  },
  option: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  optionChecked: {
    backgroundColor: colors.surfaceRaised,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  optionLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  optionLabelStrong: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontWeight: '600',
  },
  optionLabelMuted: {
    color: colors.textMuted,
    flexShrink: 1,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  badgeTextNeutral: {
    color: colors.textSecondary,
  },
  badgeTextWarning: {
    color: colors.warning,
  },
});

const badgeVariantStyles: Record<BadgeVariant, StyleProp<ViewStyle>> = {
  neutral: styles.badgeNeutral,
  warning: styles.badgeWarning,
};

const badgeTextVariantStyles: Record<BadgeVariant, StyleProp<TextStyle>> = {
  neutral: styles.badgeTextNeutral,
  warning: styles.badgeTextWarning,
};
