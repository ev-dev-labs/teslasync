// Native parity port of web/src/components/vehicles/VehiclePaintPicker.tsx.
//
// `VehiclePaintPicker` is the small swatch row that lets the user override the
// Digital Twin paint color for a specific vehicle. Picking a swatch sets a
// per-vehicle override; picking the auto-detected color (or pressing "Reset")
// clears the override so the picker stays in sync with any future change to the
// Tesla `exterior_color` field. A live label echoes the active paint name.
//
// Four web-only dependencies have no native parity surface (rules 4/7), so a
// native-safe implementation is built and documented in the sidecar:
//   - react-i18next `useTranslation` is absent from the native deps, so it is a
//     local fallback resolver returning the inline English string (the same
//     approach as the DensityToggle / SourceLayerBadge / OfflineBanner ports).
//     The i18n keys (paint.*) are still referenced so intent is preserved.
//   - the `cn` Tailwind class merger has no native analog; `className` is kept
//     on props for source compatibility but ignored (destructured `_className`)
//     and a `style` override is added for native consumers.
//   - `@/hooks/useVehiclePaint` persists the per-vehicle override to
//     `localStorage` and syncs it across browser tabs via the `BroadcastChannel`
//     / storage-event bus. React Native has neither localStorage nor
//     BroadcastChannel (and no AsyncStorage dependency is installed), so the
//     native `useVehiclePaint` keeps the identical resolution order
//     (override > inferred > fallback), the identical setPaint "snap to inferred
//     clears the override" normalization, reset, and isOverridden, plus the
//     in-process listener bus so two hook instances in the same app stay in sync
//     without a refresh. Cross-restart persistence and cross-process/tab sync
//     are unavailable on native and documented as such (the override lives for
//     the app session in a module-level Map).
//   - `@/lib/vehicleColors` `PAINT_PALETTE_LIST` (+ `inferPaintFromTesla`,
//     `isPaintPaletteId`, `FALLBACK_PAINT`) is reproduced locally with the exact
//     swatch hexes, i18n label keys, default labels, and display order from the
//     source. The full gradient palette (body/surface/mirror stops consumed by
//     the VehicleTwin SVG) belongs to the dedicated vehicleColors source module
//     and is ported separately; the picker only consumes id/labelKey/
//     defaultLabel/swatch, so only those fields are modeled here.
//   - the inline checkmark `<svg>` has no native analog (react-native-svg is not
//     a dependency), so the selected swatch shows a decorative white "✓" glyph
//     (h-3.5 w-3.5 -> fontSize 14), flagged aria-hidden, mirroring the
//     OfflineBanner glyph approach.
//
// Visual-intent mapping (Tailwind -> tokens): the radiogroup `flex flex-wrap
// items-center gap-3` -> View row/wrap/center, gap 12; the swatch row `flex
// items-center gap-2` -> gap 8. Each swatch `h-7 w-7 rounded-full border-2`
// -> 28x28, radius 14, borderWidth 2; selected `border-white scale-110
// shadow-cyan-500/20` -> white border, transform scale 1.1, soft cyan shadow;
// idle `border-[var(--border-strong)]` -> rgba(255,255,255,0.2); the web
// `hover:scale-105` has no native hover, so press feedback uses scale 1.05.
// The "Paint" eyebrow `text-xs uppercase tracking-wider text-[var(--text-
// secondary)]` -> 12 / uppercase / letterSpacing 0.6 / colors.textSecondary;
// the live value label `text-xs text-[var(--text-secondary)]` matches. The reset
// `text-[11px] text-cyan-300 hover:text-cyan-200 hover:underline` -> 11 /
// cyan-300 (#67e8f9) idle, cyan-200 (#a5f3fc) + underline on press. role/aria-*
// map to accessibilityRole/accessibilityState/accessibilityLabel; the swatch
// `title` (hover tooltip, incl. "· Auto-detected" for the inferred swatch)
// -> accessibilityHint; aria-live="polite" -> accessibilityLiveRegion="polite";
// aria-hidden -> accessibilityElementsHidden/no-hide-descendants.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {VisuallyHidden} from '../a11y/VisuallyHidden';

// ── i18n shim ──────────────────────────────────────────────────────────────
type TFunc = (key: string, fallback: string) => string;

// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ── vehicleColors (picker subset) ───────────────────────────────────────────
// Reproduced from web/src/lib/vehicleColors.ts. Only the fields the picker
// consumes are modeled (id/labelKey/defaultLabel/swatch); the full gradient
// palette for the VehicleTwin SVG lives in the dedicated source module and is
// ported separately.
export type PaintPaletteId =
  | 'pearl-white'
  | 'midnight-silver'
  | 'deep-blue'
  | 'solid-black'
  | 'red-multicoat';

export interface PaintPalette {
  /** Stable id used for storage, broadcast, and option keys. */
  id: PaintPaletteId;
  /** i18n key for the picker label. */
  labelKey: string;
  /** Fallback string when i18n is missing. */
  defaultLabel: string;
  /** Opaque hex color for the picker swatch dot. */
  swatch: string;
}

const PAINT_PALETTES: Record<PaintPaletteId, PaintPalette> = {
  'pearl-white': {
    id: 'pearl-white',
    labelKey: 'paint.pearlWhite',
    defaultLabel: 'Pearl White Multi-Coat',
    swatch: '#e9ecf2',
  },
  'midnight-silver': {
    id: 'midnight-silver',
    labelKey: 'paint.midnightSilver',
    defaultLabel: 'Midnight Silver Metallic',
    swatch: '#5b6675',
  },
  'deep-blue': {
    id: 'deep-blue',
    labelKey: 'paint.deepBlue',
    defaultLabel: 'Deep Blue Metallic',
    swatch: '#1f3a72',
  },
  'solid-black': {
    id: 'solid-black',
    labelKey: 'paint.solidBlack',
    defaultLabel: 'Solid Black',
    swatch: '#0d1117',
  },
  'red-multicoat': {
    id: 'red-multicoat',
    labelKey: 'paint.redMulticoat',
    defaultLabel: 'Red Multi-Coat',
    swatch: '#a3001a',
  },
};

/** All paint options in display order — used by the picker. */
const PAINT_PALETTE_LIST: readonly PaintPalette[] = [
  PAINT_PALETTES['pearl-white'],
  PAINT_PALETTES['midnight-silver'],
  PAINT_PALETTES['deep-blue'],
  PAINT_PALETTES['solid-black'],
  PAINT_PALETTES['red-multicoat'],
];

/** High-contrast default for cars with no exterior_color metadata. */
const FALLBACK_PAINT: PaintPalette = PAINT_PALETTES['pearl-white'];

/**
 * Map a Tesla `exterior_color` code to a paint palette. Case-insensitive,
 * ignores spaces/dashes/underscores, accepts the bare name plus the Tesla
 * Metallic / MultiCoat suffix variants. Unknown codes fall back.
 */
function inferPaintFromTesla(code: string | null | undefined): PaintPalette {
  if (!code) return FALLBACK_PAINT;
  const normalized = code.toLowerCase().replace(/[\s_-]/g, '');
  if (normalized.startsWith('pearl') || normalized === 'white') {
    return PAINT_PALETTES['pearl-white'];
  }
  if (normalized.startsWith('midnightsilver') || normalized === 'silver') {
    return PAINT_PALETTES['midnight-silver'];
  }
  if (
    normalized.startsWith('deepblue') ||
    normalized === 'blue' ||
    normalized === 'darkblue'
  ) {
    return PAINT_PALETTES['deep-blue'];
  }
  if (
    normalized.startsWith('solidblack') ||
    normalized === 'black' ||
    normalized === 'obsidianblack'
  ) {
    return PAINT_PALETTES['solid-black'];
  }
  if (normalized.startsWith('red') || normalized === 'multicoatred') {
    return PAINT_PALETTES['red-multicoat'];
  }
  return FALLBACK_PAINT;
}

/** Type-guard narrowing arbitrary strings into a known PaintPaletteId. */
function isPaintPaletteId(value: unknown): value is PaintPaletteId {
  return typeof value === 'string' && value in PAINT_PALETTES;
}

// ── useVehiclePaint (native-safe) ───────────────────────────────────────────
// Native analog of web/src/hooks/useVehiclePaint.ts. localStorage and
// BroadcastChannel do not exist in React Native, so the override is stored in a
// module-level Map (app-session lifetime only — no cross-restart persistence,
// no cross-process/tab sync). The in-process listener bus is preserved verbatim
// so two hook instances mounted in the same app (e.g. the picker and a twin
// below it) stay in sync without a refresh.
const overrideStore = new Map<number, PaintPaletteId>();

type PaintListener = (id: PaintPaletteId | null) => void;
const inTabListeners = new Map<number, Set<PaintListener>>();

function isValidVehicleId(vehicleId: number | null | undefined): vehicleId is number {
  return (
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0
  );
}

function notifyInTab(vehicleId: number, value: PaintPaletteId | null): void {
  const set = inTabListeners.get(vehicleId);
  if (!set) return;
  for (const fn of set) fn(value);
}

function subscribeInTab(vehicleId: number, fn: PaintListener): () => void {
  let set = inTabListeners.get(vehicleId);
  if (!set) {
    set = new Set();
    inTabListeners.set(vehicleId, set);
  }
  set.add(fn);
  return () => {
    const s = inTabListeners.get(vehicleId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) inTabListeners.delete(vehicleId);
  };
}

function readOverride(vehicleId: number | null | undefined): PaintPaletteId | null {
  if (!isValidVehicleId(vehicleId)) return null;
  // Mirrors the web readOverride's `isPaintPaletteId(raw) ? raw : null` guard
  // against a stale stored value.
  const raw = overrideStore.get(vehicleId);
  return isPaintPaletteId(raw) ? raw : null;
}

function writeOverride(vehicleId: number, value: PaintPaletteId | null): void {
  if (!isValidVehicleId(vehicleId)) return;
  if (value === null) {
    overrideStore.delete(vehicleId);
  } else {
    overrideStore.set(vehicleId, value);
  }
}

export interface UseVehiclePaint {
  /** Currently active paint (override > inferred > fallback). */
  paint: PaintPalette;
  /** What auto-detection alone would produce (ignoring override). */
  inferred: PaintPalette;
  /** True when the user has manually picked a color for this vehicle. */
  isOverridden: boolean;
  /** Set the override (or `null` to clear it and revert to inferred). */
  setPaint: (id: PaintPaletteId | null) => void;
  /** Clear the override — equivalent to `setPaint(null)`. */
  reset: () => void;
}

export function useVehiclePaint(
  vehicleId: number | null | undefined,
  exteriorColor?: string | null,
): UseVehiclePaint {
  const [overrideId, setOverrideId] = useState<PaintPaletteId | null>(() =>
    readOverride(vehicleId),
  );

  // Re-read when the vehicleId switches — each vehicle has its own slot.
  useEffect(() => {
    setOverrideId(readOverride(vehicleId));
  }, [vehicleId]);

  // Same-app sync: another hook instance updated this vehicle's override.
  useEffect(() => {
    if (!isValidVehicleId(vehicleId)) {
      return undefined;
    }
    return subscribeInTab(vehicleId, value => {
      setOverrideId(value);
    });
  }, [vehicleId]);

  const inferred = useMemo<PaintPalette>(
    () => inferPaintFromTesla(exteriorColor),
    [exteriorColor],
  );

  const paint = overrideId ? PAINT_PALETTES[overrideId] ?? inferred : inferred;

  const setPaint = useCallback(
    (id: PaintPaletteId | null) => {
      // Treat "set to the inferred color" as "clear the override" so the picker
      // can stay in sync if Tesla later reports a paint.
      const normalized: PaintPaletteId | null = id === inferred.id ? null : id;
      setOverrideId(normalized);
      if (isValidVehicleId(vehicleId)) {
        writeOverride(vehicleId, normalized);
        notifyInTab(vehicleId, normalized);
      }
    },
    [vehicleId, inferred.id],
  );

  const reset = useCallback(() => setPaint(null), [setPaint]);

  return {
    paint: paint ?? FALLBACK_PAINT,
    inferred,
    isOverridden: overrideId !== null,
    setPaint,
    reset,
  };
}

// ── VehiclePaintPicker ──────────────────────────────────────────────────────
export interface VehiclePaintPickerProps {
  vehicleId: number;
  /**
   * Tesla `exterior_color` code from the vehicle config — used to compute
   * the auto-detected paint that the "Reset" button reverts to.
   */
  exteriorColor?: string | null;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * VehiclePaintPicker — a small swatch row letting the user override the
 * Digital Twin paint color for a specific vehicle.
 *
 * The override is app-local (per-vehicle). When the user picks the inferred
 * color explicitly, the override is cleared so the picker stays in sync with
 * any future change to the Tesla `exterior_color` field.
 */
export function VehiclePaintPicker({
  vehicleId,
  exteriorColor,
  className: _className,
  style,
  testID,
}: VehiclePaintPickerProps) {
  const {t} = useTranslation();
  const {paint, setPaint, isOverridden, reset, inferred} = useVehiclePaint(
    vehicleId,
    exteriorColor,
  );

  return (
    <View
      accessibilityLabel={t('paint.pickerLabel', 'Vehicle paint color')}
      accessibilityRole="radiogroup"
      style={[styles.group, style]}
      testID={testID}>
      <AppText style={styles.eyebrow}>{t('paint.label', 'Paint')}</AppText>
      <View style={styles.swatchRow}>
        {PAINT_PALETTE_LIST.map(p => {
          const selected = p.id === paint.id;
          const label = t(p.labelKey, p.defaultLabel);
          const isInferred = p.id === inferred.id;
          const hint = isInferred
            ? `${label} · ${t('paint.detected', 'Auto-detected')}`
            : label;
          return (
            <Pressable
              accessibilityHint={hint}
              accessibilityLabel={label}
              accessibilityRole="radio"
              accessibilityState={{checked: selected, selected}}
              key={p.id}
              onPress={() => setPaint(p.id)}
              style={({pressed}) => [
                styles.swatch,
                {backgroundColor: p.swatch},
                selected ? styles.swatchSelected : styles.swatchIdle,
                pressed && !selected && styles.swatchPressed,
              ]}
              testID={testID ? `${testID}-${p.id}` : undefined}>
              {selected ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  pointerEvents="none"
                  style={styles.checkWrap}>
                  <AppText style={styles.checkGlyph} weight="bold">
                    ✓
                  </AppText>
                </View>
              ) : null}
              <VisuallyHidden>{label}</VisuallyHidden>
            </Pressable>
          );
        })}
      </View>
      <AppText accessibilityLiveRegion="polite" style={styles.valueLabel}>
        {t(paint.labelKey, paint.defaultLabel)}
      </AppText>
      {isOverridden ? (
        <Pressable
          accessibilityRole="button"
          onPress={reset}
          style={styles.reset}>
          {({pressed}) => (
            <AppText style={[styles.resetText, pressed && styles.resetTextPressed]}>
              {t('paint.reset', 'Reset to auto-detected')}
            </AppText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

VehiclePaintPicker.displayName = 'VehiclePaintPicker';

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12, // gap-3
  },
  eyebrow: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  swatchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  swatch: {
    alignItems: 'center',
    borderRadius: 14, // rounded-full (h-7 w-7)
    borderWidth: 2, // border-2
    height: 28, // h-7
    justifyContent: 'center',
    width: 28, // w-7
  },
  swatchIdle: {
    borderColor: 'rgba(255, 255, 255, 0.2)', // border-[var(--border-strong)]
  },
  swatchSelected: {
    borderColor: '#ffffff', // border-white
    elevation: 6,
    shadowColor: '#06b6d4', // shadow-cyan-500/20
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    transform: [{scale: 1.1}], // scale-110
  },
  swatchPressed: {
    transform: [{scale: 1.05}], // hover:scale-105 analog
  },
  checkWrap: {
    ...StyleSheet.absoluteFillObject, // absolute inset-0
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    color: '#ffffff', // text-white
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.6)', // drop-shadow
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  valueLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
  },
  reset: {
    alignSelf: 'center',
  },
  resetText: {
    color: '#67e8f9', // text-cyan-300
    fontSize: 11, // text-[11px]
  },
  resetTextPressed: {
    color: '#a5f3fc', // hover:text-cyan-200
    textDecorationLine: 'underline', // hover:underline
  },
});

export default VehiclePaintPicker;
