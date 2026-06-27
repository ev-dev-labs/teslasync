// Native parity port of web/src/components/vehicles/VehicleTwin.tsx.
//
// The web "Digital Twin" is a ~1300-line layered SVG illustration: an
// <svg viewBox> with dozens of <path>/<circle>/<ellipse>/<linearGradient>
// nodes, framer-motion keyframe animations (wheel spin, charging underglow,
// drive-in slide) and lucide-react icons, all driven by the live
// VehicleTwinState. React Native in this project ships NONE of those
// primitives — there is no react-native-svg, no framer-motion and no
// lucide-react (see apps/native/package.json) — so the pixel-faithful SVG
// cannot be reproduced.
//
// Per the conversion contract's native-safe rule, this port preserves
// everything that is portable: the exact prop/type surface
// (VehicleTwinState + size/interactive/driveIn/vehicleId/exteriorColor/paint),
// the paint-resolution precedence (paint prop > per-vehicle override+inference
// hook > FALLBACK_PAINT), the size→dimension map and aspect ratio, the
// drive-in entrance (a finite Animated translate+fade), and — crucially — a
// readout of EVERY telemetry overlay the SVG draws (lock, sentry, charging,
// charge port, doors, windows, frunk/trunk, headlights, hazards, turn signal,
// driver seat, driving) rendered as semantically-coloured status chips over a
// stylised car painted in the resolved body colour. The fine SVG geometry and
// the infinite spin/pulse loops are intentionally NOT reproduced (documented
// in the parity sidecar).

import React, {useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {FALLBACK_PAINT, type PaintPalette} from './_vehicleColors';
import {useVehiclePaint} from './useVehiclePaint';
import type {
  DoorStates,
  TurnSignalState,
  VehicleTwinState,
  WindowState,
} from './_vehicleState';

export type {
  DoorStates,
  TurnSignalState,
  VehicleTwinState,
  WindowState,
} from './_vehicleState';

const SIZE_MAP = {sm: 300, md: 440, lg: 560} as const;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_HEIGHT = 220;
const ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH;
const DRIVE_IN_DURATION = 1350;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  driveIn?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * Optional vehicle id — when provided, enables per-vehicle paint persistence
   * (the user can override the auto-detected color and the choice is remembered
   * for the app session via {@link useVehiclePaint}).
   */
  vehicleId?: number | null;
  /**
   * Tesla `exterior_color` code used to auto-detect the paint when no override
   * is set. Falls back to the embedded `vehicleColor` from the twin state, then
   * to {@link FALLBACK_PAINT}.
   */
  exteriorColor?: string | null;
  /**
   * Direct paint override — bypasses both the override hook and inference.
   */
  paint?: PaintPalette;
}

// Semantic status colours — ported from the paint-agnostic `C` constant in the
// web VehicleTwin so state semantics stay consistent across paints.
const TWIN = {
  lockedGreen: 'rgba(34,197,94,0.9)',
  unlockedRed: 'rgba(239,68,68,0.9)',
  chargeGreen: 'rgba(34,197,94,0.82)',
  chargeGreenFill: 'rgba(34,197,94,0.22)',
  sentryRed: 'rgba(239,68,68,0.8)',
  amber: 'rgba(251,191,36,0.78)',
  headlightOn: 'rgba(255,255,220,0.9)',
  seatOccupied: 'rgba(34,211,238,0.6)',
  driving: 'rgba(34,211,238,0.8)',
  neutral: 'rgba(148,163,184,0.7)',
  glassStroke: 'rgba(125,211,252,0.32)',
  glassOpen: 'rgba(3,7,18,0.72)',
  shadow: 'rgba(0,0,0,0.48)',
  wheelDark: 'rgba(0,0,0,0.94)',
  wheelStroke: 'rgba(255,255,255,0.12)',
} as const;

function countOpenDoors(doors: DoorStates): number {
  const sides = [
    doors.driverFront,
    doors.passengerFront,
    doors.driverRear,
    doors.passengerRear,
  ];
  return sides.filter(side => side === true).length;
}

function anyDoorKnown(doors: DoorStates): boolean {
  return [
    doors.driverFront,
    doors.passengerFront,
    doors.driverRear,
    doors.passengerRear,
  ].some(side => side !== null);
}

/** Reduce the 4 cabin windows to a single summary state (open > partial > closed). */
function windowSummary(states: WindowState[]): WindowState {
  if (states.some(s => s === 'open')) {
    return 'open';
  }
  if (states.some(s => s === 'partial')) {
    return 'partial';
  }
  if (states.some(s => s === 'closed')) {
    return 'closed';
  }
  return null;
}

function windowLabel(state: WindowState): string {
  switch (state) {
    case 'closed':
      return 'Windows closed';
    case 'open':
      return 'Windows open';
    case 'partial':
      return 'Windows partially open';
    default:
      return 'Windows unknown';
  }
}

function turnSignalLabel(signal: TurnSignalState): string | null {
  switch (signal) {
    case 'left':
      return 'Left turn signal';
    case 'right':
      return 'Right turn signal';
    case 'both':
      return 'Hazards flashing';
    default:
      return null;
  }
}

interface Indicator {
  key: string;
  label: string;
  color: string;
}

function buildIndicators(state: {
  doors: DoorStates;
  windows: WindowState[];
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  chargePortOpen: boolean | null;
  isCharging: boolean;
  isDriving: boolean;
  locked: boolean | null;
  sentryMode: boolean | null;
  headlights: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driverSeatOccupied: boolean | null;
}): Indicator[] {
  const out: Indicator[] = [];

  // Lock — always shown (the SVG SecurityOverlay always renders a lock badge).
  if (state.locked === null) {
    out.push({key: 'lock', label: 'Lock unknown', color: TWIN.neutral});
  } else if (state.locked) {
    out.push({key: 'lock', label: 'Locked', color: TWIN.lockedGreen});
  } else {
    out.push({key: 'lock', label: 'Unlocked', color: TWIN.unlockedRed});
  }

  if (state.sentryMode) {
    out.push({key: 'sentry', label: 'Sentry on', color: TWIN.sentryRed});
  }
  if (state.isCharging) {
    out.push({key: 'charging', label: 'Charging', color: TWIN.chargeGreen});
  } else if (state.chargePortOpen) {
    out.push({key: 'charge-port', label: 'Charge port open', color: TWIN.amber});
  }
  if (state.isDriving) {
    out.push({key: 'driving', label: 'Driving', color: TWIN.driving});
  }

  const openDoors = countOpenDoors(state.doors);
  if (openDoors > 0) {
    out.push({
      key: 'doors',
      label: openDoors === 1 ? '1 door open' : `${openDoors} doors open`,
      color: TWIN.amber,
    });
  } else if (anyDoorKnown(state.doors)) {
    out.push({key: 'doors', label: 'Doors closed', color: TWIN.neutral});
  }

  const windows = windowSummary(state.windows);
  if (windows === 'open' || windows === 'partial') {
    out.push({key: 'windows', label: windowLabel(windows), color: TWIN.amber});
  }

  if (state.frunkOpen) {
    out.push({key: 'frunk', label: 'Frunk open', color: TWIN.amber});
  }
  if (state.trunkOpen) {
    out.push({key: 'trunk', label: 'Trunk open', color: TWIN.amber});
  }
  if (state.headlights) {
    out.push({key: 'lights', label: 'Lights on', color: TWIN.headlightOn});
  }
  if (state.hazards) {
    out.push({key: 'hazards', label: 'Hazards on', color: TWIN.amber});
  }
  const turn = turnSignalLabel(state.turnSignal);
  if (turn) {
    out.push({key: 'turn', label: turn, color: TWIN.amber});
  }
  if (state.driverSeatOccupied) {
    out.push({key: 'seat', label: 'Driver seated', color: TWIN.seatOccupied});
  }

  return out;
}

interface StatusChipProps {
  label: string;
  color: string;
  interactive: boolean;
}

function StatusChip({label, color, interactive}: StatusChipProps) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityHint={interactive ? label : undefined}
      style={styles.chip}>
      <View style={[styles.chipDot, {backgroundColor: color}]} />
      <AppText style={styles.chipLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

export function VehicleTwin({
  doors,
  windowFD,
  windowFP,
  windowRD,
  windowRP,
  frunkOpen,
  trunkOpen,
  chargePortOpen,
  isCharging,
  isDriving,
  locked,
  sentryMode,
  headlights,
  hazards,
  turnSignal,
  driverSeatOccupied,
  vehicleColor,
  size = 'md',
  interactive = false,
  driveIn = false,
  className: _className,
  style,
  testID,
  vehicleId,
  exteriorColor,
  paint: paintOverride,
}: VehicleTwinProps) {
  const width = SIZE_MAP[size];
  const height = Math.round(width * ASPECT_RATIO);

  // Resolve paint: explicit `paint` prop wins, else the per-vehicle override +
  // Tesla-inferred paint via the hook (safe to call with a null vehicleId).
  const colorSource =
    exteriorColor ?? (vehicleColor && vehicleColor.length > 0 ? vehicleColor : null);
  const {paint: resolvedPaint} = useVehiclePaint(vehicleId ?? null, colorSource);
  const paint = paintOverride ?? resolvedPaint ?? FALLBACK_PAINT;

  // Drive-in entrance — a finite translate+fade replacement for the web
  // framer-motion slide. No infinite loops (the web wheel-spin / underglow
  // pulses are intentionally omitted to keep the surface native-safe).
  const enter = useRef(new Animated.Value(driveIn ? 0 : 1)).current;
  useEffect(() => {
    if (!driveIn) {
      enter.setValue(1);
      return;
    }
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: DRIVE_IN_DURATION,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [driveIn, enter]);

  const translateX = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.round(width * 0.4), 0],
  });

  const indicators = useMemo(
    () =>
      buildIndicators({
        doors,
        windows: [windowFD, windowFP, windowRD, windowRP],
        frunkOpen,
        trunkOpen,
        chargePortOpen,
        isCharging,
        isDriving,
        locked,
        sentryMode,
        headlights,
        hazards,
        turnSignal,
        driverSeatOccupied,
      }),
    [
      doors,
      windowFD,
      windowFP,
      windowRD,
      windowRP,
      frunkOpen,
      trunkOpen,
      chargePortOpen,
      isCharging,
      isDriving,
      locked,
      sentryMode,
      headlights,
      hazards,
      turnSignal,
      driverSeatOccupied,
    ],
  );

  const windows = windowSummary([windowFD, windowFP, windowRD, windowRP]);
  const cabinBorder =
    windows === 'open' || windows === 'partial' ? TWIN.amber : TWIN.glassStroke;
  const cabinHeight = Math.round(height * 0.34);
  const bodyHeight = Math.round(height * 0.32);
  const wheelSize = Math.round(height * 0.26);

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Vehicle digital twin showing current physical state"
      style={[styles.root, style, {opacity: enter, transform: [{translateX}]}]}
      testID={testID}>
      <View style={[styles.stage, {height, width}]}>
        {isCharging ? (
          <View
            style={[
              styles.chargeGlow,
              {backgroundColor: TWIN.chargeGreenFill, width: Math.round(width * 0.78)},
            ]}
          />
        ) : null}
        <View
          style={[styles.shadow, {backgroundColor: TWIN.shadow, width: Math.round(width * 0.72)}]}
        />
        <View style={[styles.car, {width: Math.round(width * 0.82)}]}>
          <View
            style={[
              styles.cabin,
              {
                backgroundColor: TWIN.glassOpen,
                borderColor: cabinBorder,
                height: cabinHeight,
              },
            ]}
          />
          <View
            style={[
              styles.body,
              {
                backgroundColor: paint.swatch,
                borderColor: paint.bodyStroke,
                height: bodyHeight,
              },
            ]}>
            <View
              style={[styles.bodyHighlight, {backgroundColor: paint.bodyHighlight}]}
            />
          </View>
          <View style={styles.wheelRow}>
            <View
              style={[
                styles.wheel,
                {borderRadius: wheelSize / 2, height: wheelSize, width: wheelSize},
              ]}
            />
            <View
              style={[
                styles.wheel,
                {borderRadius: wheelSize / 2, height: wheelSize, width: wheelSize},
              ]}
            />
          </View>
        </View>
      </View>
      <View style={styles.chipRow}>
        {indicators.map(ind => (
          <StatusChip
            key={ind.key}
            color={ind.color}
            interactive={interactive}
            label={ind.label}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  bodyHighlight: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    height: '34%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cabin: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    marginBottom: -2,
    width: '60%',
    zIndex: 1,
  },
  car: {
    alignItems: 'center',
    position: 'relative',
  },
  chargeGlow: {
    borderRadius: 999,
    bottom: 6,
    height: 14,
    position: 'absolute',
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  chipLabel: {
    color: colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    maxWidth: 560,
  },
  root: {
    alignItems: 'center',
    gap: 12,
  },
  shadow: {
    borderRadius: 999,
    bottom: 8,
    height: 10,
    opacity: 0.8,
    position: 'absolute',
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    paddingBottom: 14,
  },
  wheel: {
    backgroundColor: TWIN.wheelDark,
    borderColor: TWIN.wheelStroke,
    borderWidth: 1,
  },
  wheelRow: {
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: '8%',
    position: 'absolute',
    width: '100%',
  },
});
