// Native parity port of web/src/components/data-display/TeslaCarViz.tsx.
//
// The web component is an animated, theme-aware SVG side-view of a Tesla with a
// per-model body, spinning wheels, head/tail lights, a battery indicator bar,
// charging/lock/climate/sentry overlays, speed lines, and status dots, plus a
// compact `TeslaCarMini`. This app vendors neither `react-native-svg` nor
// `framer-motion`, so -- following the `HelixMark` precedent (SVG paths drawn as
// scalable `View` strokes) and the `MetricBar` precedent (`Animated` fills with
// a reduce-motion fallback) -- the bezier car bodies are approximated as layered
// rounded `View`s that preserve each model's silhouette proportions and the
// 560x290 viewBox coordinate system (`WHEEL_POS`, headlight/taillight, battery
// bar, lock, and sentry ring positions are reused verbatim and scaled).
//
// Preserved verbatim: the `TeslaModel` union, `parseModelKey` parsing rules, the
// `TeslaCarVizProps` public shape (batteryLevel/isCharging/isLocked/isClimateOn/
// sentryMode/speed/className/size/model), `driving = speed > 0`, the
// `batteryColor`/`boolColor` thresholds, the `sm/md/lg` size map, the per-model
// aspect ratios, the ambient-glow state selection, the status-dot set, and the
// `TeslaCarMini` battery/charging behavior.
//
// Native-safe substitutions (documented in the parity sidecar): CSS
// `radial-gradient` ambient glows and `blur()` collapse to solid translucent
// tints; SVG `strokeDasharray` sentry rings become translucent circular borders;
// `useTheme().mode.colorScheme` becomes the built-in `useColorScheme()`; and the
// framer-motion path/width/rotate tweens become `Animated` timings/loops that
// honor the OS "reduce motion" setting.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export type TeslaModel = 'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck';

export interface TeslaCarVizProps {
  batteryLevel: number;
  isCharging: boolean;
  isLocked: boolean;
  isClimateOn: boolean;
  sentryMode: boolean;
  speed: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  model?: TeslaModel;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

/** Parse a vehicle.model string like "Model 3 P", "Model Y", "Cybertruck" into a TeslaModel key */
export function parseModelKey(modelStr?: string): TeslaModel {
  if (!modelStr) {
    return 'model3';
  }
  const s = modelStr.toLowerCase().replace(/\s+/g, '');
  if (s.includes('cybertruck') || s.includes('ct')) {
    return 'cybertruck';
  }
  if (s.includes('modelx') || s.includes('mx')) {
    return 'modelx';
  }
  if (s.includes('modely') || s.includes('my')) {
    return 'modely';
  }
  if (s.includes('models') || s.includes('ms')) {
    return 'models';
  }
  return 'model3';
}

/* Per-model layout positions (560x290 viewBox units, reused verbatim from web). */
const WHEEL_POS: Record<
  TeslaModel,
  {
    fx: number;
    rx: number;
    wy: number;
    headX: number;
    headY: number;
    tailX: number;
    tailY: number;
    batX: number;
    batY: number;
    lockX: number;
    lockY: number;
  }
> = {
  model3: {fx: 160, rx: 432, wy: 210, headX: 112, headY: 180, tailX: 488, tailY: 178, batX: 158, batY: 172, lockX: 296, lockY: 108},
  models: {fx: 160, rx: 432, wy: 210, headX: 108, headY: 180, tailX: 490, tailY: 178, batX: 158, batY: 172, lockX: 296, lockY: 108},
  modely: {fx: 160, rx: 432, wy: 210, headX: 112, headY: 178, tailX: 486, tailY: 176, batX: 158, batY: 170, lockX: 296, lockY: 104},
  modelx: {fx: 160, rx: 432, wy: 210, headX: 112, headY: 176, tailX: 486, tailY: 174, batX: 158, batY: 168, lockX: 296, lockY: 100},
  cybertruck: {fx: 160, rx: 432, wy: 210, headX: 108, headY: 176, tailX: 480, tailY: 165, batX: 158, batY: 172, lockX: 296, lockY: 108},
};

/**
 * Per-model body geometry derived from the web bezier path bounding boxes. The
 * `hull` is the lower body + hood belt line; the `cabin` is the glass
 * greenhouse. `rad` controls corner rounding -- large for sedans, medium for the
 * SUVs, near-zero for the angular Cybertruck wedge.
 */
const BODY_GEOM: Record<
  TeslaModel,
  {
    hull: {l: number; r: number; t: number; b: number; rad: number};
    cabin: {l: number; r: number; t: number; b: number; rad: number};
  }
> = {
  model3: {hull: {l: 110, r: 496, t: 158, b: 210, rad: 26}, cabin: {l: 214, r: 460, t: 114, b: 162, rad: 18}},
  models: {hull: {l: 104, r: 498, t: 158, b: 210, rad: 30}, cabin: {l: 214, r: 462, t: 114, b: 162, rad: 20}},
  modely: {hull: {l: 110, r: 494, t: 156, b: 210, rad: 24}, cabin: {l: 210, r: 455, t: 112, b: 160, rad: 20}},
  modelx: {hull: {l: 110, r: 492, t: 154, b: 210, rad: 22}, cabin: {l: 210, r: 455, t: 110, b: 160, rad: 20}},
  cybertruck: {hull: {l: 104, r: 488, t: 166, b: 210, rad: 3}, cabin: {l: 225, r: 439, t: 150, b: 178, rad: 2}},
};

/* Semantic status colors -- theme-independent so "green = good" stays true. */
const HEX = {
  good: '#10b981',
  warn: '#f59e0b',
  bad: '#ef4444',
  cyan: '#00f0ff',
  taillight: '#ef4444',
  taillightCore: '#ff6b6b',
  turnSignal: '#fbbf24',
  charge: '#10b981',
  white: '#ffffff',
} as const;

/** Color for battery level (0-100). Ported from web `@/lib/colors`. */
function batteryColor(level: number): string {
  if (level > 60) {
    return HEX.good;
  }
  if (level > 25) {
    return HEX.warn;
  }
  return HEX.bad;
}

/** Color for boolean on/off state. Ported from web `@/lib/colors`. */
function boolColor(active: boolean): string {
  return active ? HEX.good : HEX.warn;
}

type SvgPalette = ReturnType<typeof buildSvgPalette>;

/** Theme-aware color palette for the silhouette, mirroring web `useSvgPalette`. */
function buildSvgPalette(isLight: boolean) {
  return {
    isLight,
    body: {
      fill: isLight ? '#d4d8e0' : '#2d3748',
      stroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
    },
    glass: {
      fill: isLight ? 'rgba(0,120,200,0.15)' : 'rgba(15,23,42,0.9)',
      stroke: isLight ? 'rgba(0,120,200,0.25)' : 'rgba(255,255,255,0.12)',
    },
    wheel: {
      outer: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.6)',
      outerStroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
      inner: isLight ? 'rgba(40,40,50,0.6)' : 'rgba(30,30,40,0.8)',
      innerStroke: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)',
      hub: isLight ? 'rgba(50,50,60,0.7)' : 'rgba(60,60,70,0.9)',
      hubStroke: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)',
    },
    detail: {
      line: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
      lineFaint: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
    },
    battery: {
      bg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
      text: isLight ? 'rgba(0,0,0,0.7)' : '#ffffff',
    },
    shadow: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)',
    headlightOn: '#ffffff',
    headlightOff: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
    falconWing: isLight ? 'rgba(0,120,200,0.15)' : 'rgba(0,240,255,0.08)',
    speedLine: isLight ? 'rgba(0,120,200,0.3)' : 'rgba(0,240,255,0.3)',
    lockBg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.4)',
    climate: isLight ? 'rgba(0,120,200,0.4)' : 'rgba(0,240,255,0.4)',
    sentry: {
      ring1: isLight ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
      ring2: isLight ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
    },
    // CSS radial-gradient ambient glows collapse to the gradient's inner tint.
    ambient: {
      sentry: isLight ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.4)',
      charging: isLight ? 'rgba(16,185,129,0.2)' : 'rgba(16,185,129,0.4)',
      driving: isLight ? 'rgba(0,120,200,0.15)' : 'rgba(0,240,255,0.3)',
      idle: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
    },
    statusInactive: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)',
    statusTextInactive: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)',
    miniBody: {
      fill: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
      stroke: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)',
    },
    miniWheel: {
      fill: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.5)',
      stroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
    },
    miniBatBg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
  };
}

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

/** Renders the model-specific body hull + glass greenhouse and per-model accents. */
function ModelBody({
  model,
  palette,
  scale,
}: {
  model: TeslaModel;
  palette: SvgPalette;
  scale: number;
}) {
  const {hull, cabin} = BODY_GEOM[model];
  const px = (n: number) => n * scale;

  return (
    <View pointerEvents="none">
      {/* Lower body hull */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.body.fill,
            borderColor: palette.body.stroke,
            borderWidth: 1,
            borderTopLeftRadius: px(hull.rad),
            borderTopRightRadius: px(hull.rad),
            height: px(hull.b - hull.t),
            left: px(hull.l),
            top: px(hull.t),
            width: px(hull.r - hull.l),
          },
        ]}
      />
      {/* Glass greenhouse / cabin */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.glass.fill,
            borderColor: palette.glass.stroke,
            borderWidth: 1,
            borderTopLeftRadius: px(cabin.rad + 6),
            borderTopRightRadius: px(cabin.rad + 6),
            height: px(cabin.b - cabin.t),
            left: px(cabin.l),
            top: px(cabin.t),
            width: px(cabin.r - cabin.l),
          },
        ]}
      />
      {/* Belt / door feature line */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.detail.line,
            height: Math.max(StyleSheet.hairlineWidth, px(1)),
            left: px(cabin.l + 36),
            top: px(cabin.b - 6),
            width: px(cabin.r - cabin.l - 72),
          },
        ]}
      />
      {/* Cybertruck angular bed separator */}
      {model === 'cybertruck' ? (
        <View
          style={[
            styles.absolute,
            {
              backgroundColor: palette.detail.lineFaint,
              height: px(48),
              left: px(420),
              top: px(152),
              width: Math.max(StyleSheet.hairlineWidth, px(1)),
            },
          ]}
        />
      ) : null}
      {/* Model X falcon-wing door hinge hint */}
      {model === 'modelx' ? (
        <View
          style={[
            styles.absolute,
            {
              backgroundColor: palette.falconWing,
              borderRadius: px(2),
              height: Math.max(StyleSheet.hairlineWidth, px(1)),
              left: px(290),
              top: px(96),
              width: px(80),
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/** A single wheel: outer rim, a (driving-)spinning 5-spoke inner, and the hub. */
function Wheel({
  cx,
  wy,
  model,
  palette,
  scale,
  driving,
  reduceMotion,
}: {
  cx: number;
  wy: number;
  model: TeslaModel;
  palette: SvgPalette;
  scale: number;
  driving: boolean;
  reduceMotion: boolean;
}) {
  const px = (n: number) => n * scale;
  const outerR = 32;
  const innerR = model === 'cybertruck' ? 24 : 22;
  const spokeLen = model === 'cybertruck' ? 22 : 20;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!driving || reduceMotion) {
      spin.setValue(0);
      return;
    }
    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [driving, reduceMotion, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const innerSize = px(innerR * 2);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.absolute,
        styles.center,
        {
          borderRadius: px(outerR),
          height: px(outerR * 2),
          left: px(cx - outerR),
          top: px(wy - outerR),
          width: px(outerR * 2),
          backgroundColor: palette.wheel.outer,
          borderColor: palette.wheel.outerStroke,
          borderWidth: 1.5,
        },
      ]}>
      <Animated.View
        style={[
          styles.center,
          {
            borderRadius: px(innerR),
            height: innerSize,
            width: innerSize,
            backgroundColor: palette.wheel.inner,
            borderColor: palette.wheel.innerStroke,
            borderWidth: 2,
            transform: [{rotate}],
          },
        ]}>
        {[0, 72, 144, 216, 288].map(angle => (
          <View
            key={angle}
            style={[
              styles.absoluteFill,
              styles.itemsCenter,
              {transform: [{rotate: `${angle}deg`}]},
            ]}>
            <View
              style={{
                backgroundColor: palette.wheel.hubStroke,
                borderRadius: px(2),
                height: px(spokeLen),
                width: Math.max(1, px(2.5)),
              }}
            />
          </View>
        ))}
      </Animated.View>
      {/* Hub cap */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.wheel.hub,
            borderColor: palette.wheel.hubStroke,
            borderRadius: px(8),
            borderWidth: 1.5,
            height: px(16),
            width: px(16),
          },
        ]}
      />
    </View>
  );
}

/** Battery indicator bar with an Animated fill (mirrors the framer-motion width tween). */
function BatteryBar({
  pos,
  palette,
  batteryLevel,
  batClr,
  scale,
  reduceMotion,
}: {
  pos: (typeof WHEEL_POS)[TeslaModel];
  palette: SvgPalette;
  batteryLevel: number;
  batClr: string;
  scale: number;
  reduceMotion: boolean;
}) {
  const px = (n: number) => n * scale;
  const trackW = 260;
  const clamped = Math.max(0, Math.min(100, batteryLevel));
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 1500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [clamped, progress, reduceMotion]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${clamped}%`],
  });

  return (
    <View
      pointerEvents="none"
      style={[
        styles.absolute,
        {left: px(pos.batX), top: px(pos.batY), width: px(trackW)},
      ]}>
      <View
        style={{
          backgroundColor: palette.battery.bg,
          borderRadius: px(4),
          height: px(8),
          overflow: 'hidden',
          width: '100%',
        }}>
        <Animated.View
          style={{
            backgroundColor: batClr,
            borderRadius: px(4),
            height: '100%',
            shadowColor: batClr,
            shadowOffset: {width: 0, height: 0},
            shadowOpacity: 0.6,
            shadowRadius: px(6),
            width,
          }}
        />
      </View>
      <AppText
        style={[
          styles.batteryText,
          {color: palette.battery.text, fontSize: Math.max(8, px(11))},
        ]}>
        {batteryLevel}%
      </AppText>
    </View>
  );
}

/** Lock indicator: green padlock (closed) when locked, amber (open) when not. */
function LockGlyph({
  pos,
  palette,
  isLocked,
  isClimateOn,
  scale,
}: {
  pos: (typeof WHEEL_POS)[TeslaModel];
  palette: SvgPalette;
  isLocked: boolean;
  isClimateOn: boolean;
  scale: number;
}) {
  const px = (n: number) => n * scale;
  const color = isLocked ? HEX.good : HEX.warn;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.absolute,
        styles.center,
        {
          backgroundColor: palette.lockBg,
          borderRadius: px(4),
          height: px(16),
          left: px(pos.lockX - 10),
          top: px(pos.lockY - 8),
          width: px(20),
        },
      ]}>
      {/* Shackle */}
      <View
        style={{
          borderColor: color,
          borderTopLeftRadius: px(3),
          borderTopRightRadius: px(3),
          borderWidth: Math.max(1, px(1.2)),
          borderBottomWidth: 0,
          height: px(isLocked ? 4 : 5),
          marginBottom: -px(1),
          width: px(6),
        }}
      />
      {/* Body */}
      <View
        style={{
          borderColor: color,
          borderRadius: px(2),
          borderWidth: Math.max(1, px(1.2)),
          height: px(8),
          width: px(10),
        }}
      />
      {/* Climate waves rising from the lock area */}
      {isClimateOn ? (
        <View style={[styles.climateRow, {top: px(10)}]}>
          {[0, 1, 2].map(i => (
            <View
              key={i}
              style={{
                backgroundColor: palette.climate,
                borderRadius: px(1),
                height: Math.max(1, px(1.2)),
                marginHorizontal: px(1),
                width: px(4),
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StatusDot({
  active,
  color,
  label,
  palette,
}: {
  active: boolean;
  color: string;
  label: string;
  palette: SvgPalette;
}) {
  return (
    <View style={styles.statusItem}>
      <View
        style={[
          styles.statusDot,
          {
            backgroundColor: active ? color : palette.statusInactive,
            shadowColor: active ? color : 'transparent',
            shadowOpacity: active ? 0.9 : 0,
          },
        ]}
      />
      <AppText
        style={[
          styles.statusLabel,
          {color: active ? color : palette.statusTextInactive},
        ]}>
        {label}
      </AppText>
    </View>
  );
}

export function TeslaCarViz({
  batteryLevel,
  isCharging,
  isLocked,
  isClimateOn,
  sentryMode,
  speed,
  className: _className = '',
  size = 'md',
  model = 'model3',
  style,
  testID,
}: TeslaCarVizProps) {
  const scheme = useColorScheme();
  const palette = buildSvgPalette(scheme === 'light');
  const reduceMotion = useReduceMotion();
  const batClr = batteryColor(batteryLevel);
  const driving = speed > 0;
  const sizeMap = {sm: 180, md: 280, lg: 380} as const;
  const w = sizeMap[size];
  const aspect =
    model === 'cybertruck'
      ? 0.56
      : model === 'modelx' || model === 'modely'
        ? 0.55
        : 0.52;
  const h = w * aspect;
  const scale = w / 560;
  const px = (n: number) => n * scale;
  const pos = WHEEL_POS[model];
  const canvasH = 290 * scale;

  const ambient = sentryMode
    ? palette.ambient.sentry
    : isCharging
      ? palette.ambient.charging
      : driving
        ? palette.ambient.driving
        : palette.ambient.idle;

  const states: string[] = [];
  if (isCharging) {
    states.push('charging');
  }
  states.push(isLocked ? 'locked' : 'unlocked');
  if (isClimateOn) {
    states.push('climate on');
  }
  if (sentryMode) {
    states.push('sentry mode');
  }
  if (driving) {
    states.push('driving');
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Tesla ${model} visualization, battery ${batteryLevel}%, ${states.join(
        ', ',
      )}`}
      style={[styles.root, {width: w}, style]}
      testID={testID}>
      {/* Ambient glow behind the car (solid tint stands in for the blurred radial gradient) */}
      <View
        pointerEvents="none"
        style={[
          styles.ambient,
          {
            backgroundColor: ambient,
            borderRadius: (w * 0.7) / 2,
            height: h * 0.5,
            top: canvasH * 0.5 - (h * 0.5) / 2,
            width: w * 0.7,
          },
        ]}
      />

      {/* Car canvas (the SVG viewBox, scaled to the requested width) */}
      <View style={{height: canvasH, width: w}}>
        {/* Ground shadow */}
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            styles.shadow,
            {
              backgroundColor: palette.shadow,
              height: px(14),
              left: px(280 - (model === 'cybertruck' ? 240 : 220)),
              top: px(263),
              width: px((model === 'cybertruck' ? 240 : 220) * 2),
            },
          ]}
        />

        {/* Sentry mode rings (dashed SVG rings -> translucent circular borders) */}
        {sentryMode ? (
          <SentryRings palette={palette} scale={scale} reduceMotion={reduceMotion} />
        ) : null}

        {/* Model-specific body */}
        <ModelBody model={model} palette={palette} scale={scale} />

        {/* Wheels */}
        <Wheel
          cx={pos.fx}
          wy={pos.wy}
          model={model}
          palette={palette}
          scale={scale}
          driving={driving}
          reduceMotion={reduceMotion}
        />
        <Wheel
          cx={pos.rx}
          wy={pos.wy}
          model={model}
          palette={palette}
          scale={scale}
          driving={driving}
          reduceMotion={reduceMotion}
        />

        {/* Headlight (DRL strip + projector); brightens when driving */}
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              backgroundColor: driving ? palette.headlightOn : palette.headlightOff,
              borderRadius: px(2),
              height: px(model === 'cybertruck' ? 4 : 16),
              left: px(pos.headX - 4),
              top: px(pos.headY - (model === 'cybertruck' ? 5 : 8)),
              width: px(model === 'cybertruck' ? 20 : 5),
              shadowColor: HEX.white,
              shadowOffset: {width: 0, height: 0},
              shadowOpacity: driving ? 0.7 : 0,
              shadowRadius: px(6),
            },
          ]}
        />
        {/* Amber turn-signal accent */}
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              backgroundColor: driving ? HEX.turnSignal : palette.headlightOff,
              borderRadius: px(2),
              height: px(3),
              left: px(pos.headX + (model === 'cybertruck' ? 8 : 4)),
              top: px(pos.headY + (model === 'cybertruck' ? 0 : 12)),
              opacity: driving ? 0.6 : 0.2,
              width: px(5),
            },
          ]}
        />

        {/* Taillight (continuous LED strip) */}
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              backgroundColor: HEX.taillight,
              borderRadius: px(2),
              height: px(model === 'cybertruck' ? 20 : 22),
              left: px(pos.tailX),
              top: px(pos.tailY - 4),
              width: px(model === 'cybertruck' ? 4 : 4),
              shadowColor: HEX.taillight,
              shadowOffset: {width: 0, height: 0},
              shadowOpacity: 0.6,
              shadowRadius: px(8),
            },
          ]}
        />
        {/* Taillight brighter core */}
        <View
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              backgroundColor: HEX.taillightCore,
              borderRadius: px(1),
              height: px(12),
              left: px(pos.tailX + 1),
              opacity: 0.8,
              top: px(pos.tailY + 1),
              width: Math.max(1, px(1.5)),
            },
          ]}
        />

        {/* Charging cable + pulsing plug node */}
        {isCharging ? (
          <ChargingPlug pos={pos} scale={scale} reduceMotion={reduceMotion} />
        ) : null}

        {/* Battery indicator bar */}
        <BatteryBar
          pos={pos}
          palette={palette}
          batteryLevel={batteryLevel}
          batClr={batClr}
          scale={scale}
          reduceMotion={reduceMotion}
        />

        {/* Lock + climate */}
        <LockGlyph
          pos={pos}
          palette={palette}
          isLocked={isLocked}
          isClimateOn={isClimateOn}
          scale={scale}
        />

        {/* Speed lines when driving */}
        {driving ? (
          <View pointerEvents="none">
            {[0, 1, 2, 3].map(i => (
              <View
                key={i}
                style={[
                  styles.absolute,
                  {
                    backgroundColor: palette.speedLine,
                    borderRadius: px(1),
                    height: Math.max(1, px(1.5)),
                    left: px(508 + i * 8),
                    top: px(160 + i * 12),
                    width: px(28),
                  },
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>

      {/* Status indicators below the car */}
      <View style={styles.statusRow}>
        <StatusDot
          active={isCharging}
          color={HEX.charge}
          label={isCharging ? 'Charging' : 'Not Charging'}
          palette={palette}
        />
        <StatusDot
          active={isLocked}
          color={boolColor(isLocked)}
          label={isLocked ? 'Locked' : 'Unlocked'}
          palette={palette}
        />
        {isClimateOn ? (
          <StatusDot active color={HEX.cyan} label="Climate" palette={palette} />
        ) : null}
        {sentryMode ? (
          <StatusDot active color={HEX.bad} label="Sentry" palette={palette} />
        ) : null}
      </View>
    </View>
  );
}

TeslaCarViz.displayName = 'TeslaCarViz';

/** Two slowly counter-rotating translucent rings (parity for the SVG sentry dashes). */
function SentryRings({
  palette,
  scale,
  reduceMotion,
}: {
  palette: SvgPalette;
  scale: number;
  reduceMotion: boolean;
}) {
  const px = (n: number) => n * scale;
  const cw = useRef(new Animated.Value(0)).current;
  const ccw = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const a1 = Animated.loop(
      Animated.timing(cw, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const a2 = Animated.loop(
      Animated.timing(ccw, {
        toValue: 1,
        duration: 30000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    a1.start();
    a2.start();
    return () => {
      a1.stop();
      a2.stop();
    };
  }, [cw, ccw, reduceMotion]);

  const rotate1 = cw.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const rotate2 = ccw.interpolate({inputRange: [0, 1], outputRange: ['0deg', '-360deg']});

  return (
    <View pointerEvents="none">
      <Animated.View
        style={[
          styles.absolute,
          {
            borderColor: palette.sentry.ring1,
            borderRadius: px(90),
            borderStyle: 'dashed',
            borderWidth: 1,
            height: px(180),
            left: px(190),
            top: px(70),
            transform: [{rotate: rotate1}],
            width: px(180),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.absolute,
          {
            borderColor: palette.sentry.ring2,
            borderRadius: px(95),
            borderStyle: 'dashed',
            borderWidth: 1,
            height: px(190),
            left: px(185),
            top: px(65),
            transform: [{rotate: rotate2}],
            width: px(190),
          },
        ]}
      />
    </View>
  );
}

/** Charging cable stub + pulsing green plug node with a lightning glyph. */
function ChargingPlug({
  pos,
  scale,
  reduceMotion,
}: {
  pos: (typeof WHEEL_POS)[TeslaModel];
  scale: number;
  reduceMotion: boolean;
}) {
  const px = (n: number) => n * scale;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.5);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  const scaleNode = pulse.interpolate({inputRange: [0, 1], outputRange: [1, 1.3]});
  const opacity = pulse.interpolate({inputRange: [0, 1], outputRange: [0.8, 1]});

  return (
    <View pointerEvents="none">
      {/* Vertical cable run */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: HEX.charge,
            borderRadius: px(2),
            height: px(35),
            left: px(pos.headX - 66),
            top: px(pos.headY - 45),
            width: Math.max(1, px(3)),
          },
        ]}
      />
      {/* Horizontal cable run into the port */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: HEX.charge,
            borderRadius: px(2),
            height: Math.max(1, px(3)),
            left: px(pos.headX - 65),
            top: px(pos.headY + 4),
            width: px(55),
          },
        ]}
      />
      {/* Pulsing plug node */}
      <Animated.View
        style={[
          styles.absolute,
          styles.center,
          {
            backgroundColor: HEX.charge,
            borderRadius: px(6),
            height: px(12),
            left: px(pos.headX - 71),
            opacity,
            shadowColor: HEX.charge,
            shadowOffset: {width: 0, height: 0},
            shadowOpacity: 0.8,
            shadowRadius: px(8),
            top: px(pos.headY - 56),
            transform: [{scale: scaleNode}],
            width: px(12),
          },
        ]}>
        <AppText style={{color: HEX.white, fontSize: Math.max(7, px(9))}}>⚡</AppText>
      </Animated.View>
    </View>
  );
}

/** Mini version for cards/lists. */
export function TeslaCarMini({
  batteryLevel,
  isCharging,
  model,
}: {
  batteryLevel: number;
  isCharging: boolean;
  model?: TeslaModel;
}) {
  const scheme = useColorScheme();
  const palette = buildSvgPalette(scheme === 'light');
  const color = batteryColor(batteryLevel);
  const m = model ?? 'model3';
  const tall = m === 'modelx';
  const clamped = Math.max(0, Math.min(100, batteryLevel));
  const wheelY = tall ? 24 : 22;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Tesla ${m} mini, battery ${batteryLevel}%${
        isCharging ? ', charging' : ''
      }`}
      style={[styles.mini, {height: tall ? 34 : 32}]}>
      {/* Body silhouette */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.miniBody.fill,
            borderColor: palette.miniBody.stroke,
            borderWidth: 0.8,
            borderTopLeftRadius: m === 'cybertruck' ? 2 : 7,
            borderTopRightRadius: m === 'cybertruck' ? 2 : 7,
            height: tall ? 13 : 12,
            left: 7,
            top: tall ? 6 : 8,
            width: 50,
          },
        ]}
      />
      {/* Cabin */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.miniBody.fill,
            borderColor: palette.miniBody.stroke,
            borderWidth: 0.8,
            borderTopLeftRadius: m === 'cybertruck' ? 1 : 5,
            borderTopRightRadius: m === 'cybertruck' ? 1 : 5,
            height: 7,
            left: 20,
            top: tall ? 3 : 5,
            width: 26,
          },
        ]}
      />
      {/* Wheels */}
      <View
        style={[
          styles.absolute,
          styles.miniWheel,
          {
            backgroundColor: palette.miniWheel.fill,
            borderColor: palette.miniWheel.stroke,
            left: 14,
            top: wheelY - 4,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          styles.miniWheel,
          {
            backgroundColor: palette.miniWheel.fill,
            borderColor: palette.miniWheel.stroke,
            left: 46,
            top: wheelY - 4,
          },
        ]}
      />
      {/* Battery track + fill */}
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: palette.miniBatBg,
            borderRadius: 1,
            height: 2,
            left: 18,
            top: tall ? 19 : 17,
            width: 28,
          },
        ]}
      />
      <View
        style={[
          styles.absolute,
          {
            backgroundColor: color,
            borderRadius: 1,
            height: 2,
            left: 18,
            opacity: 0.8,
            top: tall ? 19 : 17,
            width: 28 * (clamped / 100),
          },
        ]}
      />
      {/* Charging dot */}
      {isCharging ? (
        <View
          style={[
            styles.absolute,
            styles.miniChargeDot,
            {top: tall ? 18 : 16},
          ]}
        />
      ) : null}
    </View>
  );
}

TeslaCarMini.displayName = 'TeslaCarMini';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ambient: {
    opacity: 0.3,
    position: 'absolute',
  },
  absolute: {
    position: 'absolute',
  },
  absoluteFill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemsCenter: {
    alignItems: 'center',
  },
  shadow: {
    opacity: 0.9,
    transform: [{scaleY: 0.5}],
  },
  batteryText: {
    fontWeight: '700',
    marginTop: 2,
    opacity: 0.7,
    textAlign: 'center',
    width: '100%',
  },
  climateRow: {
    flexDirection: 'row',
    position: 'absolute',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  statusItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  statusDot: {
    borderRadius: 3,
    height: 6,
    shadowOffset: {width: 0, height: 0},
    shadowRadius: 6,
    width: 6,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  mini: {
    position: 'relative',
    width: 64,
  },
  miniWheel: {
    borderRadius: 4,
    borderWidth: 0.5,
    height: 8,
    width: 8,
  },
  miniChargeDot: {
    backgroundColor: '#10b981',
    borderRadius: 2,
    height: 4,
    left: 8,
    opacity: 0.8,
    width: 4,
  },
});
