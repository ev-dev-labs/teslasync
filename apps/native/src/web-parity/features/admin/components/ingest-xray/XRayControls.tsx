// Native parity port of
// web/src/features/admin/components/ingest-xray/XRayControls.tsx.
//
// The web source is the Ingest X-Ray controls bar: a vehicle picker plus a
// window and a bucket selector, laid out in a flex-wrap row (`gap-4`,
// `items-center`) with the vehicle control wider (`w-64`) than the two small
// `w-40` time controls. All three are constrained to the exact server-accepted
// values so a typo can never round-trip a 400, and the bucket control
// auto-disables any bucket whose seconds are >= the current window's seconds to
// avoid the server-side "bucket >= window" 400. It composes the shared web
// `<Select>` (a styled DOM `<select>` whose `SelectOption` items carry an
// optional `disabled` flag), react-i18next for every label, the `Vehicle` API
// type, and the `IngestXRayWindow` / `IngestXRayBucket` literal-union types.
//
// React Native ships no DOM `<select>` and native parity exposes no shared
// Select component, so -- mirroring the sibling AIPiiRedactionSharedExports port
// (NativeExportTypeSelect), which renders a constrained option set as a wrapped
// radiogroup of pressable pills -- this self-contained port rebuilds each piece
// with React Native primitives and existing native tokens:
//   * Each web `<Select>` becomes a native `XRaySelect`: an accessibilityRole
//     "radiogroup" View whose `SelectOption`s render as accessibilityRole "radio"
//     pressable pills. The selected pill is highlighted (accent surface/border);
//     a disabled option (a bucket >= the current window) renders dimmed and
//     non-pressable, exactly as the web `disabled` greys the `<option>` and blocks
//     its selection. The `aria-label` maps to the group `accessibilityLabel`.
//   * The placeholder "Select vehicle…" `<option value="">` is preserved as the
//     first pill (value ''); pressing it re-runs the web `v ? Number(v) : null`
//     conversion and reports `null` to `onVehicleChange`, just like the empty
//     `<option>`.
//   * The WINDOW_SECS / BUCKET_SECS / ALL_WINDOWS / ALL_BUCKETS tables and the
//     `BUCKET_SECS[b] >= WINDOW_SECS[windowSel]` "tooBig" disable rule are ported
//     verbatim, preserving every server-accepted value and the disable logic.
//   * The flex-wrap `items-center gap-4` bar becomes a flex-wrap row (16px gap);
//     the `w-64` / `w-40` widths map to per-control min widths so the vehicle
//     control stays the widest. The bar is top-aligned (`flex-start`) because the
//     pill groups can wrap to multiple rows, unlike the single-line DOM selects.
//   * react-i18next is replaced by a self-contained fallback that preserves every
//     translation key and English fallback string (including the dynamic
//     `admin.xray.windowOption.${w}` / `admin.xray.bucketOption.${b}` keys).
//
// No DOM, no recharts/leaflet, and no web UI components are imported. The
// `IngestXRayWindow` / `IngestXRayBucket` types are reused from the existing
// native useIngestXRay hook port (the same shape the web source imported from
// @/types/admin-diagnostics); `Vehicle` comes from the native api/types port.

import React, {useCallback} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '../../../../api/hooks/useIngestXRay';
import type {Vehicle} from '../../../../api/types';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for every label (vehicle placeholder, the three
// aria-labels, and the per-window / per-bucket option labels).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the web `SelectOption` shape (value / label / optional
// disabled) imported from @/components/ui -- native parity ships no shared
// Select export.
interface XRaySelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface XRayControlsProps {
  vehicles: Vehicle[];
  vehicleId: number | null;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
  onVehicleChange: (id: number | null) => void;
  onWindowChange: (w: IngestXRayWindow) => void;
  onBucketChange: (b: IngestXRayBucket) => void;
}

const WINDOW_SECS: Record<IngestXRayWindow, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
};

const BUCKET_SECS: Record<IngestXRayBucket, number> = {
  '30s': 30,
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
};

const ALL_WINDOWS: IngestXRayWindow[] = ['5m', '15m', '1h', '6h', '24h'];
const ALL_BUCKETS: IngestXRayBucket[] = ['30s', '1m', '5m', '15m', '1h'];

// Tailwind `gap-4` == 1rem == 16px -- the spacing between the three controls.
const BAR_GAP = 16;

// Native stand-in for the web `<Select>` (a server-constrained dropdown). The
// constrained option set renders as a wrapped radiogroup of pressable pills; the
// selected pill is highlighted and a disabled option renders dimmed and
// non-pressable, matching the web `<option disabled>` behaviour.
function XRaySelect({
  accessibilityLabel,
  onChange,
  options,
  value,
}: {
  accessibilityLabel: string;
  onChange: (value: string) => void;
  options: XRaySelectOption[];
  value: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radiogroup"
      style={styles.selectGroup}>
      {options.map(option => {
        const selected = option.value === value;
        const disabled = option.disabled ?? false;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{disabled, selected}}
            disabled={disabled}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({pressed}) => [
              styles.optionPill,
              selected && styles.optionPillSelected,
              disabled && styles.optionPillDisabled,
              pressed && !disabled && styles.optionPillPressed,
            ]}>
            <AppText
              style={[
                styles.optionText,
                selected && styles.optionTextSelected,
                disabled && styles.optionTextDisabled,
              ]}
              variant="caption"
              weight="semibold">
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function XRayControls({
  vehicles,
  vehicleId,
  windowSel,
  bucketSel,
  onVehicleChange,
  onWindowChange,
  onBucketChange,
}: XRayControlsProps) {
  const t = useNativeTranslationFallback();

  const vehicleOptions: XRaySelectOption[] = [
    {
      value: '',
      label: t('admin.xray.controls.selectVehicle', 'Select vehicle…'),
    },
    ...vehicles.map(v => ({
      value: String(v.id),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
  ];

  const windowOptions: XRaySelectOption[] = ALL_WINDOWS.map(w => ({
    value: w,
    label: t(`admin.xray.windowOption.${w}`, w),
  }));

  const bucketOptions: XRaySelectOption[] = ALL_BUCKETS.map(b => {
    const tooBig = BUCKET_SECS[b] >= WINDOW_SECS[windowSel];
    return {
      value: b,
      label: t(`admin.xray.bucketOption.${b}`, b),
      disabled: tooBig,
    };
  });

  return (
    <View style={styles.root}>
      <View style={styles.vehicleControl}>
        <XRaySelect
          accessibilityLabel={t('admin.xray.controls.vehicleAria', 'Vehicle')}
          onChange={v => onVehicleChange(v ? Number(v) : null)}
          options={vehicleOptions}
          value={vehicleId !== null ? String(vehicleId) : ''}
        />
      </View>

      <View style={styles.control}>
        <XRaySelect
          accessibilityLabel={t('admin.xray.controls.windowAria', 'Window')}
          onChange={v => onWindowChange(v as IngestXRayWindow)}
          options={windowOptions}
          value={windowSel}
        />
      </View>

      <View style={styles.control}>
        <XRaySelect
          accessibilityLabel={t('admin.xray.controls.bucketAria', 'Bucket')}
          onChange={v => onBucketChange(v as IngestXRayBucket)}
          options={bucketOptions}
          value={bucketSel}
        />
      </View>
    </View>
  );
}

XRayControls.displayName = 'XRayControls';

const styles = StyleSheet.create({
  control: {
    flexShrink: 1,
    minWidth: 160,
  },
  optionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionPillDisabled: {
    opacity: 0.4,
  },
  optionPillPressed: {
    opacity: 0.82,
  },
  optionPillSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  optionText: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  optionTextDisabled: {
    color: colors.textMuted,
  },
  optionTextSelected: {
    color: colors.textPrimary,
  },
  root: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: BAR_GAP,
  },
  selectGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleControl: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 240,
  },
});
