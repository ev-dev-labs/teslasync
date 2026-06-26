// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx.
//
// The web component renders a `GlassPanel` (p-6) with a "Vehicle Configuration"
// header (a Settings icon + bold title) and, when `vehicleConfig` is present, a
// two-column `KVList` of 12 spec rows (Car Type / Trim / Exterior Color / Wheels
// / Roof Color / Charge Port / Right-Hand Drive / Europe Vehicle / Offroad
// Lightbar / Rear Seat Heaters / Sunroof / Software). The three boolean rows
// (right_hand_drive / europe_vehicle / offroad_lightbar_present) render
// Yes/No/"—" via a `!= null` guard; the rest fall back to "—" via `??`; the
// Software row falls back `software_update_version ?? softwareVersion ?? '—'`.
// When `vehicleConfig` is null/undefined the list is empty and a 4-line
// `Skeleton` (height 16) is shown instead. It is reproduced here with React
// Native primitives, preserving the `VehicleConfigSectionProps` (`vehicleConfig`
// / `softwareVersion`), every `vehicleConfig.*` read, the `configItems` build
// (with its exact `??` / `!= null` null handling), the `configItems.length > 0`
// branch, and every `t()` key + English fallback string.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim that
//     returns the web fallback copy verbatim (i18n intent preserved via keys).
//   - lucide-react `Settings` (an SVG, no native dependency) -> a decorative
//     Unicode gear `Glyph` (U+2699) tinted with the cyan accent token
//     (web `text-[var(--neon-cyan)]`), matching the sibling panels' convention.
//   - `@/components/ui` `GlassPanel` -> the shared native GlassPanel
//     (`components/ui/GlassPanel`); `className="p-6"` -> `style` padding 24.
//   - `@/components/data-display` `KVList` (a DOM <dl> grid) -> an inline
//     `KVList` View reproducing `columns={2}` (two 50%-width cells with a
//     gap-x-6 24px gutter), the `flex justify-between py-2` rows, the
//     `divide-y` top borders on every cell after the first, and the muted
//     label / medium primary value text-sm typography.
//   - `@/components/feedback` `Skeleton` -> an inline `Skeleton` reproducing the
//     `lines`/`height`/`width`/`rounded` props: `lines > 1` renders `lines`
//     space-y-2 pulse bars (the last at 60% width), else a single pulse bar;
//     the `animate-pulse` CSS keyframe -> an Animated opacity loop that honours
//     the OS reduce-motion setting.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {VehicleConfigSnapshot} from '../../../../api/types';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const ICON_SETTINGS = '\u2699'; // lucide Settings
const EM_DASH = '\u2014';

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

/* ─── inline KVList parity (@/components/data-display) ───────────────────────── */

interface KVItem {
  label: string;
  value: string;
}

function KVList({items, columns = 1}: {items: KVItem[]; columns?: 1 | 2}) {
  return (
    <View style={columns === 2 ? styles.kvGrid : undefined}>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[
            styles.kvRow,
            columns === 2 ? styles.kvCell : null,
            columns === 2 && index % 2 === 0 ? styles.kvCellLeft : null,
            columns === 2 && index % 2 === 1 ? styles.kvCellRight : null,
            index !== 0 ? styles.kvDivider : null,
          ]}>
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          <AppText style={styles.kvValue}>{item.value}</AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── inline Skeleton parity (@/components/feedback) ─────────────────────────── */

function Skeleton({
  width,
  height = 16,
  rounded,
  lines = 1,
}: {
  width?: number | `${number}%`;
  height?: number;
  rounded?: boolean;
  lines?: number;
}) {
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

  if (lines > 1) {
    return (
      <View style={styles.skeletonStack}>
        {Array.from({length: lines}).map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.skeletonBar,
              {
                height,
                opacity: pulse,
                width: i === lines - 1 ? '60%' : width ?? '100%',
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.skeletonBar,
        rounded ? styles.skeletonRounded : null,
        {height, opacity: pulse, width: width ?? '100%'},
      ]}
    />
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface VehicleConfigSectionProps {
  vehicleConfig: VehicleConfigSnapshot | null | undefined;
  softwareVersion: string | undefined;
}

export function VehicleConfigSection({
  vehicleConfig,
  softwareVersion,
}: VehicleConfigSectionProps) {
  const t = useNativeTranslation();

  const configItems: KVItem[] = vehicleConfig
    ? [
        {label: t('vehicles.detail.carType', 'Car Type'), value: vehicleConfig.car_type ?? EM_DASH},
        {label: t('vehicles.detail.trim', 'Trim'), value: vehicleConfig.trim ?? EM_DASH},
        {label: t('vehicles.detail.color', 'Exterior Color'), value: vehicleConfig.exterior_color ?? EM_DASH},
        {label: t('vehicles.detail.wheels', 'Wheels'), value: vehicleConfig.wheel_type ?? EM_DASH},
        {label: t('vehicles.detail.roofColor', 'Roof Color'), value: vehicleConfig.roof_color ?? EM_DASH},
        {label: t('vehicles.detail.chargePort', 'Charge Port'), value: vehicleConfig.charge_port ?? EM_DASH},
        {label: t('vehicles.detail.rhd', 'Right-Hand Drive'), value: vehicleConfig.right_hand_drive != null ? (vehicleConfig.right_hand_drive ? t('common.yes', 'Yes') : t('common.no', 'No')) : EM_DASH},
        {label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'), value: vehicleConfig.europe_vehicle != null ? (vehicleConfig.europe_vehicle ? t('common.yes', 'Yes') : t('common.no', 'No')) : EM_DASH},
        {label: t('vehicles.detail.offroadLightbar', 'Offroad Lightbar'), value: vehicleConfig.offroad_lightbar_present != null ? (vehicleConfig.offroad_lightbar_present ? t('common.yes', 'Yes') : t('common.no', 'No')) : EM_DASH},
        {label: t('vehicles.detail.rearSeatHeaters', 'Rear Seat Heaters'), value: vehicleConfig.rear_seat_heaters ?? EM_DASH},
        {label: t('vehicles.detail.sunroofInstalled', 'Sunroof'), value: vehicleConfig.sunroof_installed ?? EM_DASH},
        {label: t('vehicles.detail.softwareVersion', 'Software'), value: vehicleConfig.software_update_version ?? softwareVersion ?? EM_DASH},
      ]
    : [];

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <AppText importantForAccessibility="no" style={styles.headerIcon}>
          {ICON_SETTINGS}
        </AppText>
        <AppText accessibilityRole="header" style={styles.title}>
          {t('vehicles.detail.vehicleConfig', 'Vehicle Configuration')}
        </AppText>
      </View>
      {configItems.length > 0 ? (
        <KVList items={configItems} columns={2} />
      ) : (
        <Skeleton lines={4} height={16} />
      )}
    </GlassPanel>
  );
}

VehicleConfigSection.displayName = 'VehicleConfigSection';

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 20,
  },
  kvCell: {
    width: '50%',
  },
  kvCellLeft: {
    paddingRight: spacing.md,
  },
  kvCellRight: {
    paddingLeft: spacing.md,
  },
  kvDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  kvGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  kvLabel: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
    textAlign: 'right',
  },
  panel: {
    padding: 24,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
  },
  skeletonRounded: {
    borderRadius: 999,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
});
