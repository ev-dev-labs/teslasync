import { createContext, useContext, useId, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';
import {
  FALLBACK_PAINT,
  type PaintPalette,
} from '@/lib/vehicleColors';
import { buildCompositorUrl, COMPOSITOR_METRICS } from '@/lib/teslaCompositor';
import { useVehiclePaint } from '@/hooks/useVehiclePaint';

const SIZE_MAP = { sm: 300, md: 440, lg: 560 } as const;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_MIN_Y = 52;
const VIEWBOX_HEIGHT = 220;
const ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH;
const DRIVE_IN_DURATION = 1.35;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

/**
 * Model Y proportions traced from a real side view (4750 mm long × 1624 mm
 * tall, 2890 mm wheelbase, mapped to 513 viewBox units). Ground line y=263,
 * axles at x=138 / x=450, tire radius 38.5.
 */
const BODY_PATH = `
  M 84 248.5
  C 72 246.5 62 244 54 240
  C 47 236 43.5 230 43 222
  C 42.4 215 42.6 206 43.2 198
  C 43.8 190 45.5 185 49 182
  C 56 176.5 66 169.5 77 165.5
  C 92 159.8 102 156.5 114 153.5
  C 138 148 158 144.5 172 143
  C 180 142.2 189 142.6 196 144
  C 197.5 144.8 198.5 145.4 199 146
  C 213 133.5 238 112.5 264 99.5
  C 279 93.4 295 89.8 311 88.4
  C 322 86.5 345 85.7 370 86.6
  C 390 88.2 415 91.6 440 96.4
  C 452 98.9 468 103.3 480 107.2
  C 495 112 520 121 535 126.5
  C 541 127.6 546 128.2 549.5 128.7
  C 550.5 130.5 549.5 132.5 547.5 134
  C 545.5 136.5 544.5 139 544.5 141.5
  C 548 146 551 155 552.5 165
  C 554.5 176 555.2 192 554.2 205
  C 553.7 212 552.8 221 551 228
  C 547 231 540 233.5 530 235.5
  C 522 237.3 512 239.5 504 240.5
  Z`;

/** Glazing band (windows + trim) — the visible "DLO" from the side. */
const DLO_PATH = `
  M 199 146
  C 208 137.5 220 126.5 233 117.5
  C 247 108 262 100.6 277 96
  C 289 92.6 302 90.4 316 89.4
  C 338 87.9 362 88.4 386 90.9
  C 400 93.6 430 98.5 458 105.2
  C 466 107.5 474 110 480 113
  L 481 115.5
  C 470 121.5 452 130 440 132.2
  C 437.5 132.6 435 132.6 433 132.4
  C 425 133.4 417 134.2 410 134.9
  C 380 136.7 348 138.8 316 140.5
  C 290 142 246 144.6 219 146.2
  C 212 146.6 205 146.4 199 146
  Z`;

/** DLO inset ~2 units — clips the state-tinted window panes. */
const DLO_INNER_PATH = `
  M 204 144.5
  C 213 136.5 224 126.5 236 118.5
  C 250 109.5 264 102.4 278 98
  C 290 94.6 303 92.4 317 91.4
  C 339 89.9 362 90.4 386 92.9
  C 400 95.4 429 100.3 456 107
  C 463 109 470 111.3 474 113.5
  C 467 117 454 124.5 441 129.5
  C 437 131 434.5 131 432 130.9
  C 424 131.7 417 132.4 410 133
  C 380 134.8 348 136.8 317 138.4
  C 291 140 248 142.6 222 144.2
  C 215 144.6 209 144.7 204 144.5
  Z`;

const FRONT_WHEEL_CX = 132;
const REAR_WHEEL_CX = 464;
const WHEEL_CY = 221;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  driveIn?: boolean;
  className?: string;
  /**
   * Optional vehicle id — when provided, enables per-vehicle paint
   * persistence (the user can override the auto-detected color and the
   * choice is remembered across reloads / tabs).
   */
  vehicleId?: number | null;
  /**
   * Tesla `exterior_color` code used to auto-detect the paint when no
   * override is set. Falls back to the embedded `vehicleColor` from the
   * twin state (SSE path), then to {@link FALLBACK_PAINT}.
   */
  exteriorColor?: string | null;
  /**
   * Direct paint override — bypasses both the override hook and inference.
   * Use this only when the caller already resolved the paint (e.g. a
   * snapshot replay). Most callers should pass `vehicleId` instead.
   */
  paint?: PaintPalette;
  /**
   * Tesla `Vehicle.model` string — selects the configurator model for the
   * photo render. Defaults to Model Y when omitted or unrecognized.
   */
  model?: string | null;
}

/**
 * Per-instance gradient / filter ids. Each rendered `<VehicleTwin>` builds
 * its own set with `useId()` so that two twins on the same page (e.g. two
 * Digital Twin widgets bound to different vehicles, each with a different
 * paint) do not collide on shared `<defs>` ids.
 */
interface TwinIds {
  shadowBlur: string;
  glow: string;
  bodyGrad: string;
  lowerShadow: string;
  hoodSheen: string;
  mirrorGrad: string;
  shoulderHighlight: string;
  softReflection: string;
  glassGrad: string;
  glassReflection: string;
  lowReflection: string;
  windshieldGrad: string;
  headlightLens: string;
  taillightGrad: string;
  rimGrad: string;
  tireOuter: string;
  bodyClip: string;
  dloClip: string;
}

function buildTwinIds(uid: string): TwinIds {
  const p = (suffix: string) => `${uid}-${suffix}`;
  return {
    shadowBlur: p('shadow-blur'),
    glow: p('glow'),
    bodyGrad: p('body-grad'),
    lowerShadow: p('lower-shadow'),
    hoodSheen: p('hood-sheen'),
    mirrorGrad: p('mirror-grad'),
    shoulderHighlight: p('shoulder-highlight'),
    softReflection: p('soft-reflection'),
    glassGrad: p('glass-grad'),
    glassReflection: p('glass-reflection'),
    lowReflection: p('low-reflection'),
    windshieldGrad: p('windshield-grad'),
    headlightLens: p('headlight-lens'),
    taillightGrad: p('taillight-grad'),
    rimGrad: p('rim-grad'),
    tireOuter: p('tire-outer'),
    bodyClip: p('body-clip'),
    dloClip: p('dlo-clip'),
  };
}

interface TwinContextValue {
  ids: TwinIds;
  paint: PaintPalette;
  /** Paint-derived accent colors used by `BodyShell` etc. */
  bodyAccent: {
    stroke: string;
    highlight: string;
    chrome: string;
    shadow: string;
  };
}

const TwinContext = createContext<TwinContextValue | null>(null);

function useTwinCtx(): TwinContextValue {
  const ctx = useContext(TwinContext);
  if (!ctx) {
    throw new Error('VehicleTwin sub-components must be rendered inside <VehicleTwin>');
  }
  return ctx;
}

/**
 * Static (paint-agnostic) accent colors — semantic state indicators that
 * MUST stay consistent across paints. The paint-derived colors live in
 * the twin context (`bodyAccent`) and the dynamic gradient stops live in
 * `<SvgDefs>` below.
 */
const C = {
  cladding: 'rgba(10,13,20,0.88)',
  glassStroke: 'rgba(125,211,252,0.32)',
  glassOpen: 'rgba(3,7,18,0.72)',
  glassPartial: 'rgba(100,200,255,0.05)',
  glassUnknown: 'rgba(255,255,255,0.04)',
  doorClosed: 'rgba(255,255,255,0.13)',
  doorOpen: 'rgba(251,191,36,0.72)',
  doorUnknown: 'rgba(255,255,255,0.07)',
  headlightOff: 'rgba(255,255,255,0.14)',
  headlightOn: 'rgba(255,255,220,0.9)',
  headlightBeam: 'rgba(255,255,220,0.08)',
  headlightGlow: 'rgba(34,211,238,0.35)',
  taillightBase: 'rgba(239,68,68,0.45)',
  taillightActive: 'rgba(239,68,68,0.85)',
  amber: 'rgba(251,191,36,0.78)',
  amberFill: 'rgba(251,191,36,0.18)',
  chargeGreen: 'rgba(34,197,94,0.82)',
  chargeGreenFill: 'rgba(34,197,94,0.22)',
  lockedGreen: 'rgba(34,197,94,0.9)',
  unlockedRed: 'rgba(239,68,68,0.9)',
  sentryRed: 'rgba(239,68,68,0.8)',
  sentryGlow: 'rgba(239,68,68,0.35)',
  seatOccupied: 'rgba(34,211,238,0.32)',
  frunkTrunkOpen: 'rgba(251,191,36,0.2)',
  neutral: 'rgba(255,255,255,0.05)',
  shadow: 'rgba(0,0,0,0.5)',
  wheelDark: 'rgba(0,0,0,0.94)',
  wheelSidewall: 'rgba(8,12,22,0.95)',
  wheelStroke: 'rgba(255,255,255,0.12)',
} as const;

function windowFill(state: WindowState, glassClosedRef: string): string {
  switch (state) {
    case 'closed': return glassClosedRef;
    case 'open': return C.glassOpen;
    case 'partial': return C.glassPartial;
    default: return C.glassUnknown;
  }
}

function windowStroke(state: WindowState): string {
  switch (state) {
    case 'open': return C.amber;
    case 'partial': return 'rgba(245,158,11,0.45)';
    case 'closed': return C.glassStroke;
    default: return 'rgba(255,255,255,0.08)';
  }
}

function windowLabel(state: WindowState): string {
  switch (state) {
    case 'closed': return 'Closed';
    case 'open': return 'Open';
    case 'partial': return 'Partially open';
    default: return 'Unknown';
  }
}

function doorStroke(open: boolean | null): string {
  if (open === null) return C.doorUnknown;
  return open ? C.doorOpen : C.doorClosed;
}

function stateLabel(value: boolean | null, trueText: string, falseText: string): string {
  if (value === null) return 'Unknown';
  return value ? trueText : falseText;
}

function InteractiveHotspot({
  enabled,
  x,
  y,
  width,
  height,
  label,
  side = 'top',
}: {
  enabled?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!enabled) return null;

  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <Tooltip content={label} side={side}>
        <span className="block w-full h-full" />
      </Tooltip>
    </foreignObject>
  );
}

function GroundShadow() {
  const { ids } = useTwinCtx();
  return (
    <g>
      <ellipse
        cx={298}
        cy={263}
        rx={242}
        ry={12}
        fill={C.shadow}
        filter={`url(#${ids.shadowBlur})`}
      />
      <ellipse
        cx={298}
        cy={262}
        rx={205}
        ry={6}
        fill="rgba(0,0,0,0.55)"
      />
    </g>
  );
}

function ChargingUnderglow() {
  const { ids } = useTwinCtx();
  return (
    <g pointerEvents="none">
      <motion.ellipse
        cx={298}
        cy={255}
        rx={190}
        ry={16}
        fill="rgba(34,197,94,0.18)"
        filter={`url(#${ids.glow})`}
        animate={{ opacity: [0.2, 0.55, 0.2], rx: [160, 205, 160] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 152 246 C 240 253 360 253 446 244"
        fill="none"
        stroke="rgba(34,197,94,0.38)"
        strokeWidth={2}
        strokeLinecap="round"
        animate={{ opacity: [0.18, 0.75, 0.18] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </g>
  );
}

function WheelSVG({
  cx,
  cy,
  driveIn = false,
  driving = false,
}: {
  cx: number;
  cy: number;
  driveIn?: boolean;
  driving?: boolean;
}) {
  const { ids } = useTwinCtx();
  const spokes = [0, 72, 144, 216, 288];
  const shouldSpin = driveIn || driving;

  return (
    <g>
      {/* Ground contact shadow */}
      <ellipse cx={cx} cy={cy + 40} rx={35} ry={4.5} fill="rgba(0,0,0,0.55)" />
      {/* Tire */}
      <circle cx={cx} cy={cy} r={42} fill={`url(#${ids.tireOuter})`} />
      {/* Sidewall */}
      <circle cx={cx} cy={cy} r={34} fill={C.wheelSidewall} stroke="rgba(255,255,255,0.06)" strokeWidth={0.7} />
      <motion.g
        initial={shouldSpin ? { rotate: 0 } : false}
        animate={shouldSpin ? { rotate: driving ? -360 : -1080 } : undefined}
        transition={
          shouldSpin
            ? {
              duration: driving ? 0.9 : DRIVE_IN_DURATION,
              repeat: driving ? Infinity : 0,
              ease: 'linear',
            }
            : undefined
        }
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        {/* Rim face */}
        <circle cx={cx} cy={cy} r={30} fill={`url(#${ids.rimGrad})`} stroke="rgba(255,255,255,0.18)" strokeWidth={0.8} />
        {/* 5 wide silver spokes with dark aero petals between them (Gemini-style) */}
        {spokes.map((angle) => (
          <g key={angle}>
            <g transform={`rotate(${angle} ${cx} ${cy})`}>
              <path
                d={`M ${cx - 3.4} ${cy - 5} L ${cx - 7.6} ${cy - 24.5} C ${cx - 2.7} ${cy - 27} ${cx + 2.7} ${cy - 27} ${cx + 7.6} ${cy - 24.5} L ${cx + 3.4} ${cy - 5} Z`}
                fill="rgba(168,180,196,0.75)"
                stroke="rgba(15,23,42,0.6)"
                strokeWidth={0.6}
              />
              <path
                d={`M ${cx - 3.8} ${cy - 8} L ${cx - 5.2} ${cy - 23}`}
                stroke="rgba(240,245,250,0.5)"
                strokeWidth={0.7}
              />
            </g>
            <g transform={`rotate(${angle + 36} ${cx} ${cy})`}>
              <path
                d={`M ${cx - 6} ${cy - 11} C ${cx - 8.8} ${cy - 17.5} ${cx - 8.8} ${cy - 22} ${cx - 6.6} ${cy - 26.5} C ${cx - 2.2} ${cy - 24} ${cx + 2.2} ${cy - 24} ${cx + 6.6} ${cy - 26.5} C ${cx + 8.8} ${cy - 22} ${cx + 8.8} ${cy - 17.5} ${cx + 6} ${cy - 11} Z`}
                fill="rgba(22,30,46,0.85)"
                stroke="rgba(15,23,42,0.5)"
                strokeWidth={0.5}
              />
            </g>
          </g>
        ))}
        {/* Hub */}
        <circle cx={cx} cy={cy} r={6} fill="rgba(15,23,42,0.96)" stroke="rgba(255,255,255,0.2)" strokeWidth={0.7} />
        <circle cx={cx} cy={cy} r={2.2} fill="rgba(148,163,184,0.7)" />
      </motion.g>
    </g>
  );
}

/**
 * Body-clipped shading: lower-body depth, hood sheen, wheel wells, black
 * rocker + arch cladding (Model Y signature), diffuser, bumper details.
 */
function BodyShading() {
  const { ids, bodyAccent } = useTwinCtx();
  return (
    <g clipPath={`url(#${ids.bodyClip})`} pointerEvents="none">
      {/* Body-side value structure (from a real render): bright shoulder,
          subtle mid-door dip, reflected-light band low on the doors, dark
          sill falloff into black cladding. */}
      <rect x={40} y={216} width={520} height={40} fill={`url(#${ids.lowerShadow})`} opacity={0.6} />
      <rect x={40} y={186} width={520} height={20} fill="rgba(2,6,23,0.06)" />
      <rect x={40} y={202} width={520} height={22} fill={`url(#${ids.lowReflection})`} />
      <path
        d="M 60 176 C 90 166 130 156 170 149 L 196 145 L 202 156 L 176 160 C 138 167 100 176 68 186 Z"
        fill={`url(#${ids.hoodSheen})`}
        opacity={0.6}
      />
      {/* Front bumper crease, intake slot, under-nose shadow */}
      <path d="M 44 206 C 56 204 70 204 84 206" fill="none" stroke="rgba(2,6,23,0.35)" strokeWidth={1.1} strokeLinecap="round" />
      <rect x={52} y={224} width={50} height={6} rx={3} fill="rgba(2,6,23,0.55)" />
      <path d="M 42 234 L 96 236 L 96 252 L 42 252 Z" fill="rgba(2,6,23,0.4)" />
      {/* Black rocker cladding (thin strip like the real car) */}
      <path d="M 96 241 L 500 241 L 500 252 L 96 252 Z" fill="rgba(10,13,20,0.8)" />
      {/* Wheel wells */}
      <circle cx={FRONT_WHEEL_CX} cy={WHEEL_CY} r={49.5} fill="rgba(3,5,10,0.96)" />
      <circle cx={REAR_WHEEL_CX} cy={WHEEL_CY} r={49.5} fill="rgba(3,5,10,0.96)" />
      {/* Slim black arch cladding rings */}
      <path d="M 84 208 A 50 50 0 0 1 180 208" fill="none" stroke="rgba(10,13,20,0.72)" strokeWidth={4.5} />
      <path d="M 416 208 A 50 50 0 0 1 512 208" fill="none" stroke="rgba(10,13,20,0.72)" strokeWidth={4.5} />
      {/* Arch lips above the cladding */}
      <path d="M 84 205 A 51 51 0 0 1 180 205" fill="none" stroke={bodyAccent.highlight} strokeWidth={1.4} opacity={0.5} />
      <path d="M 416 205 A 51 51 0 0 1 512 205" fill="none" stroke={bodyAccent.highlight} strokeWidth={1.4} opacity={0.5} />
      {/* Rear diffuser */}
      <rect x={512} y={228} width={32} height={11} rx={3} fill="rgba(10,13,20,0.8)" />
      {/* Subtle mid-door crease */}
      <path d="M 208 202 C 300 197 420 195 512 201" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
    </g>
  );
}

function BodyShell({
  frunkOpen,
  trunkOpen,
  interactive,
  photo,
}: {
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  interactive?: boolean;
  photo?: boolean;
}) {
  const { ids, bodyAccent } = useTwinCtx();
  return (
    <g>
      {!photo && (
        <>
          <path
            d={BODY_PATH}
            fill={`url(#${ids.bodyGrad})`}
            stroke={bodyAccent.stroke}
            strokeWidth={0.8}
          />
          <BodyShading />

          {/* Bright cantrail along the roof + lit spoiler blade */}
          <path
            d="M 288 89.5 C 320 86.5 348 86.3 372 87.3 C 396 88.9 420 92.3 444 97"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <path
            d="M 484 108.5 C 500 113.5 522 121.5 537 127 C 542 128.5 546 128.7 549 128.7"
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />

          {/* Fender crease from headlight over the front arch */}
          <path
            d="M 94 172 C 130 164 168 158 206 151"
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={1}
            strokeLinecap="round"
          />
        </>
      )}

      {/* Frunk seam (hood cutline) — on the photo, only the open state draws */}
      {(!photo || frunkOpen) && (
        <path
          d="M 96 172 C 130 163 160 154 194 146"
          fill="none"
          stroke={frunkOpen ? C.doorOpen : 'rgba(255,255,255,0.1)'}
          strokeWidth={frunkOpen ? 1.6 : 0.9}
          strokeLinecap="round"
        />
      )}
      <AnimatePresence>
        {frunkOpen && (
          <motion.path
            d="M 48.5 183.5 C 80 158 140 146 197 144 L 190 156 C 140 154 88 168 56 194 Z"
            fill={C.frunkTrunkOpen}
            stroke={C.doorOpen}
            strokeWidth={1.2}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>

      {/* Trunk (liftgate) seam under the spoiler */}
      {(!photo || trunkOpen) && (
        <path
          d="M 481 108 C 502 116 524 125.5 543 133"
          fill="none"
          stroke={trunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
          strokeWidth={trunkOpen ? 1.6 : 0.8}
          strokeLinecap="round"
        />
      )}
      <AnimatePresence>
        {trunkOpen && (
          <motion.path
            d="M 481 107.5 C 507 94 535 98 549 121 L 545 132 C 535 122 510 111.5 483 113 Z"
            fill={C.frunkTrunkOpen}
            stroke={C.doorOpen}
            strokeWidth={1.2}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>

      <InteractiveHotspot
        enabled={interactive}
        x={44}
        y={140}
        width={150}
        height={48}
        label={`Frunk: ${stateLabel(frunkOpen, 'Open', 'Closed')}`}
        side="left"
      />
      <InteractiveHotspot
        enabled={interactive}
        x={462}
        y={94}
        width={88}
        height={46}
        label={`Trunk: ${stateLabel(trunkOpen, 'Open', 'Closed')}`}
        side="right"
      />
    </g>
  );
}

/** Static body detailing: seams, handles, mirror, autopilot camera. */
function BodyDetails() {
  const { ids } = useTwinCtx();
  return (
    <g id="body-details" pointerEvents="none">
      {/* Mirror: body-color cap, dark glass along the inner lower edge */}
      <path
        d="M 192 137 C 192 129.5 197 124 204 123.2 C 210 122.8 214 125.5 214.5 129.5 C 214.5 133.5 210 136.6 204 137 Z"
        fill={`url(#${ids.mirrorGrad})`}
        stroke="rgba(2,6,23,0.35)"
        strokeWidth={0.7}
      />
      <path d="M 195 134.5 C 199.5 136.3 205 136.5 210 134.8" fill="none" stroke="rgba(5,8,18,0.7)" strokeWidth={2} strokeLinecap="round" />
      <path d="M 203 137 L 205.5 144" stroke="rgba(2,6,23,0.8)" strokeWidth={2.6} strokeLinecap="round" />

      {/* Front door leading-edge seam */}
      <path
        d="M 216 147 C 212 178 209 212 208 242"
        fill="none"
        stroke="rgba(2,6,23,0.32)"
        strokeWidth={0.9}
        strokeLinecap="round"
      />

      {/* Autopilot camera dot on the fender */}
      <circle cx={190} cy={168} r={2.4} fill="rgba(2,6,23,0.7)" stroke="rgba(255,255,255,0.2)" strokeWidth={0.6} />
    </g>
  );
}

function BodyReflections() {
  const { ids } = useTwinCtx();
  return (
    <g id="body-reflections" pointerEvents="none">
      <motion.path
        d="M 96 170 C 200 152 330 140 468 120"
        fill="none"
        stroke={`url(#${ids.shoulderHighlight})`}
        strokeWidth={1.4}
        strokeLinecap="round"
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 212 154 C 280 150 380 145 458 136 L 450 144 C 372 151 282 156 218 160 Z"
        fill={`url(#${ids.softReflection})`}
        animate={{ opacity: [0.28, 0.55, 0.28] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 118 166 C 230 148 390 134 508 120"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray="58 420"
        animate={{ strokeDashoffset: [0, -420], opacity: [0, 0.32, 0] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </g>
  );
}

function SideWindows({
  windowFD: wFD,
  windowFP: wFP,
  windowRD: wRD,
  windowRP: wRP,
  interactive,
  photo,
}: {
  windowFD: WindowState;
  windowFP: WindowState;
  windowRD: WindowState;
  windowRP: WindowState;
  interactive?: boolean;
  photo?: boolean;
}) {
  const { ids } = useTwinCtx();
  const glassClosedRef = `url(#${ids.glassGrad})`;
  const passengerAlert = wFP === 'open' || wFP === 'partial' || wRP === 'open' || wRP === 'partial';
  const fdActive = wFD === 'open' || wFD === 'partial';
  const rdActive = wRD === 'open' || wRD === 'partial';

  return (
    <g>
      {!photo && (<>
      {/* Windshield: wide dark band merging into the glasshouse */}
      <path
        d="M 186 149.5 C 202 134.5 226 116 252 101.5 C 258 98 265 95 272 92.5 L 281 90.5 C 262 98 243 110 227 124 C 215 134.5 205 143 199.5 149 Z"
        fill="rgba(4,8,20,0.82)"
      />
      <path
        d="M 196 145 C 209 132 228 116.5 250 103.5 L 258 100.5 C 240 111.5 222 126.5 208 141.5 Z"
        fill={`url(#${ids.windshieldGrad})`}
        opacity={0.22}
      />
      {/* Bright A-pillar edge along the silhouette */}
      <path
        d="M 200 144.5 C 214 132.5 238.5 112 264 99.3 C 270 96.5 276 94 281 92"
        fill="none"
        stroke="rgba(255,255,255,0.42)"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      {/* Cowl shadow + wiper hint + windshield shadow on the hood rear */}
      <path
        d="M 183 150 C 190 148.3 197 147.6 204 147.4"
        fill="none"
        stroke="rgba(2,6,23,0.45)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <path d="M 196 148.5 L 210 141" stroke="rgba(2,6,23,0.5)" strokeWidth={1} strokeLinecap="round" />
      <path
        d="M 172 147 C 180 145.5 189 145 197 145.6 L 202 148 C 194 151 186 152.5 178 153 Z"
        fill="rgba(2,6,23,0.12)"
      />

      {/* Glazing band (trim + seals) */}
      <path
        d={DLO_PATH}
        fill="rgba(2,6,23,0.85)"
        stroke="rgba(15,23,42,0.7)"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />

      {/* State-tinted panes, clipped to the glass opening */}
      <g clipPath={`url(#${ids.dloClip})`}>
        <rect x={196} y={84} width={100} height={64} fill={windowFill(wFD, glassClosedRef)} />
        <rect x={316} y={84} width={96} height={60} fill={windowFill(wRD, glassClosedRef)} />
        {/* Fixed quarter glass (does not open) */}
        <rect x={434} y={84} width={50} height={52} fill={glassClosedRef} />
        {/* Headrest silhouettes */}
        <rect x={252} y={116} width={9} height={13} rx={3.5} fill="rgba(5,8,18,0.5)" />
        <rect x={362} y={108} width={9} height={13} rx={3.5} fill="rgba(5,8,18,0.5)" />
        {/* B-pillar and quarter divider trim */}
        <rect x={297} y={84} width={16} height={60} fill="rgba(2,6,23,0.85)" />
        <rect x={415} y={84} width={16} height={56} fill="rgba(2,6,23,0.85)" />
        <path
          d="M 232 118 C 300 98 380 94 460 108"
          fill="none"
          stroke={`url(#${ids.glassReflection})`}
          strokeWidth={1.4}
          strokeLinecap="round"
        />
        <motion.path
          d="M 236 114 C 300 95 378 91 456 105"
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1}
          strokeLinecap="round"
          strokeDasharray="42 260"
          animate={{ strokeDashoffset: [0, -260], opacity: [0.1, 0.42, 0.1] }}
          transition={{ duration: 6.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </g>

      {/* Liftgate glass wedge under the body-color spoiler */}
      <path
        d="M 481 108.5 L 541 130.5 C 535 133.5 526 134 519 131.5 L 474 114 Z"
        fill="rgba(6,10,20,0.85)"
      />

      {/* Beltline trim (black, chrome-delete) */}
      <path
        d="M 202 145.6 C 290 141.5 380 136 432 132 C 452 129.5 468 121 479 114.5"
        fill="none"
        stroke="rgba(2,6,23,0.5)"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      </>)}

      {/* Per-window state underline along the beltline. On the photo only
          open/partial states draw — the photo already shows closed glass. */}
      {(!photo || fdActive) && (
        <path
          d="M 206 144.6 C 240 143 268 141.6 296 140.1"
          fill="none"
          stroke={windowStroke(wFD)}
          strokeWidth={photo ? 2 : 1.4}
          strokeLinecap="round"
        />
      )}
      {(!photo || rdActive) && (
        <path
          d="M 316 139 C 348 137.4 380 135.4 410 133.6"
          fill="none"
          stroke={windowStroke(wRD)}
          strokeWidth={photo ? 2 : 1.4}
          strokeLinecap="round"
        />
      )}

      {passengerAlert && (
        <motion.path
          d="M 236 116 C 290 97 340 90 390 92.5 C 420 95.5 450 103 476 112"
          fill="none"
          stroke={C.amber}
          strokeWidth={2}
          strokeLinecap="round"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}
      <InteractiveHotspot
        enabled={interactive}
        x={198}
        y={92}
        width={98}
        height={50}
        label={`Front driver window: ${windowLabel(wFD)}`}
      />
      <InteractiveHotspot
        enabled={interactive}
        x={316}
        y={90}
        width={96}
        height={46}
        label={`Rear driver window: ${windowLabel(wRD)}`}
      />
      <title>
        Front passenger window: {windowLabel(wFP)}. Rear passenger window: {windowLabel(wRP)}.
      </title>
    </g>
  );
}

function DoorOverlay({
  kind,
  open,
  label,
  interactive,
  photo,
}: {
  kind: 'front' | 'rear';
  open: boolean | null;
  label: string;
  interactive?: boolean;
  photo?: boolean;
}) {
  const isFront = kind === 'front';
  const seam = isFront
    ? { d: 'M 306 141 C 302 176 300 210 299 243', handleX: 243, handleY: 157 }
    : { d: 'M 434 133 C 432 146 430 158 428 170', handleX: 350, handleY: 150 };
  const doorPath = isFront
    ? 'M 306 141 L 220 130 L 206 232 L 299 246 Z'
    : 'M 434 131 L 498 118 L 510 215 L 438 236 Z';
  const hotspot = isFront
    ? { x: 206, y: 148, width: 100, height: 92, side: 'left' as const }
    : { x: 310, y: 142, width: 124, height: 98, side: 'right' as const };

  return (
    <g>
      <AnimatePresence>
        {open && (
          <motion.path
            d={doorPath}
            fill={C.amberFill}
            stroke={C.doorOpen}
            strokeWidth={1.4}
            initial={{ opacity: 0, scaleX: 0.9 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0.9 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>
      {/* On the photo, the closed seam/handle are already in the render —
          draw them only when the door is open. */}
      {(!photo || open) && (
        <path
          d={seam.d}
          fill="none"
          stroke={doorStroke(open)}
          strokeWidth={open ? 2 : 1}
          strokeDasharray={open ? undefined : '4,4'}
        />
      )}
      {(!photo || open) && (
        <rect
          x={seam.handleX}
          y={seam.handleY}
          width={21}
          height={4.4}
          rx={2.2}
          fill={open ? C.doorOpen : 'rgba(2,6,23,0.5)'}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={0.6}
        />
      )}
      <InteractiveHotspot
        enabled={interactive}
        x={hotspot.x}
        y={hotspot.y}
        width={hotspot.width}
        height={hotspot.height}
        label={`${label}: ${stateLabel(open, 'Open', 'Closed')}`}
        side={hotspot.side}
      />
      <title>{label}: {stateLabel(open, 'Open', 'Closed')}</title>
    </g>
  );
}

function PassengerDoorAlerts({
  passengerFront,
  passengerRear,
}: {
  passengerFront: boolean | null;
  passengerRear: boolean | null;
}) {
  if (!passengerFront && !passengerRear) return null;

  return (
    <g>
      {passengerFront && (
        <motion.path
          d="M 306 140.5 C 276 142.5 246 144.5 218 146.2"
          fill="none"
          stroke={C.doorOpen}
          strokeWidth={2}
          strokeLinecap="round"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}
      {passengerRear && (
        <motion.path
          d="M 434 132 C 448 130 466 122 480 113.5"
          fill="none"
          stroke={C.doorOpen}
          strokeWidth={2}
          strokeLinecap="round"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}
    </g>
  );
}

function HeadlightGlows({
  on,
  hazards,
  turnSignal,
  driveIn = false,
  photo,
}: {
  on: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driveIn?: boolean;
  photo?: boolean;
}) {
  const { ids } = useTwinCtx();
  const flashing = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const headlightsActive = on === true || driveIn;

  return (
    <g>
      {/* Smoked headlight lens + DRL (the photo already shows them) */}
      {!photo && (
        <>
          <path
            d="M 55 180 C 62 174.5 74 168 87 163.5 C 91.5 162.2 93.5 164 91 166.8 C 80 172 68 178.5 59 182.5 C 55.5 183.5 53 182.5 55 180 Z"
            fill={`url(#${ids.headlightLens})`}
            stroke={headlightsActive ? C.headlightOn : 'rgba(15,23,42,0.6)'}
            strokeWidth={headlightsActive ? 1 : 0.7}
          />
          <path
            d="M 56.5 178.5 C 64 173 76 166.8 89 162.8"
            fill="none"
            stroke={headlightsActive ? C.headlightOn : 'rgba(235,245,255,0.95)'}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <circle cx={57.5} cy={179.5} r={1.6} fill="rgba(235,245,255,0.9)" />
        </>
      )}
      {headlightsActive && (
        <>
          <motion.ellipse
            cx={66}
            cy={181}
            rx={16}
            ry={6}
            fill={C.headlightGlow}
            filter={`url(#${ids.glow})`}
            animate={{ opacity: driveIn ? [0.1, 0.95, 0.22, 0.85, 0.28] : [0.35, 0.85, 0.35] }}
            transition={driveIn ? { duration: 1.35, ease: 'easeInOut' } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.path
            d="M 44 194 L 0 180 L 0 216 Z"
            fill={C.headlightBeam}
            animate={{ opacity: driveIn ? [0, 0.72, 0.18, 0.58, 0.12] : [0.45, 0.8, 0.45] }}
            transition={driveIn ? { duration: 1.35, ease: 'easeInOut' } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
      {flashing && (
        <motion.ellipse
          cx={90}
          cy={180}
          rx={6}
          ry={3.5}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
    </g>
  );
}

function TaillightGlows({
  hazards,
  turnSignal,
  driveIn = false,
  photo,
}: {
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driveIn?: boolean;
  photo?: boolean;
}) {
  const { ids } = useTwinCtx();
  const flashing = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      {/* Wrap-around taillight lens (the photo already shows it) */}
      {!photo && (
        <>
          <path
            d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5 C 544 156.2 540.5 154.5 539 151.5 C 537.8 148 538 144 538.5 141 Z"
            fill={`url(#${ids.taillightGrad})`}
            stroke={flashing ? C.amber : 'rgba(248,113,113,0.5)'}
            strokeWidth={0.9}
          />
          <path
            d="M 540 143.5 C 543.5 143.2 546 145.2 547 148.5"
            fill="none"
            stroke="rgba(255,90,90,0.95)"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        </>
      )}
      {flashing && (
        <motion.path
          d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5 C 544 156.2 540.5 154.5 539 151.5 C 537.8 148 538 144 538.5 141 Z"
          fill="none"
          stroke={C.amber}
          strokeWidth={2}
          strokeLinecap="round"
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
      {driveIn && (
        <>
          <motion.ellipse
            cx={543}
            cy={148}
            rx={18}
            ry={9}
            fill={C.taillightActive}
            filter={`url(#${ids.glow})`}
            animate={{ opacity: [0, 0.95, 0.18, 0.9, 0.22] }}
            transition={{ delay: 1.2, duration: 0.75, ease: 'easeOut' }}
          />
          <motion.path
            d="M 538.5 141 C 543 140.5 547 143 548.5 146.5 C 549.5 150 549 153.5 547 155.5"
            fill="none"
            stroke={C.taillightActive}
            strokeWidth={3.6}
            strokeLinecap="round"
            animate={{ opacity: [0, 1, 0.2, 1, 0.35] }}
            transition={{ delay: 1.2, duration: 0.75, ease: 'easeOut' }}
          />
        </>
      )}
    </g>
  );
}

function ChargePortIndicator({
  open,
  charging,
  interactive,
  photo,
}: {
  open: boolean | null;
  charging: boolean;
  interactive?: boolean;
  photo?: boolean;
}) {
  const { bodyAccent } = useTwinCtx();
  const cx = 532;
  const cy = 136;
  const fill = charging || open ? C.chargeGreenFill : C.neutral;
  const stroke = charging || open ? C.chargeGreen : bodyAccent.stroke;
  const label = charging ? 'Charging' : stateLabel(open, 'Open', 'Closed');

  return (
    <g>
      {/* Charge-port flap sits above the taillight on the rear quarter.
          On the photo it only draws when open/charging. */}
      {(!photo || charging || open) && (
        <rect x={527} y={132} width={10} height={7.5} rx={2} fill={fill} stroke={stroke} strokeWidth={0.9} />
      )}
      {charging && (
        <>
          <motion.circle
            cx={cx}
            cy={cy}
            r={5}
            fill={C.chargeGreen}
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.circle
            cx={cx}
            cy={cy}
            r={10}
            fill="none"
            stroke={C.chargeGreen}
            strokeWidth={1}
            animate={{ opacity: [0.75, 0, 0.75], r: [8, 18, 8] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <path
            d="M 532 129.5 L 526.5 138 L 532 138 L 529 144.5 L 538.5 134 L 533 134 Z"
            fill={C.chargeGreen}
          />
        </>
      )}
      {open && !charging && (
        <circle cx={cx} cy={cy} r={9} fill="none" stroke={C.chargeGreen} strokeWidth={0.8} />
      )}
      <InteractiveHotspot
        enabled={interactive}
        x={cx - 14}
        y={cy - 14}
        width={28}
        height={28}
        label={`Charge port: ${label}`}
        side="right"
      />
    </g>
  );
}

function SecurityOverlay({
  locked,
  sentryMode,
  interactive,
}: {
  locked: boolean | null;
  sentryMode: boolean | null;
  interactive?: boolean;
}) {
  const iconSize = 18;
  const cx = 320;
  const cy = 114;
  const sentryY = cy - 23;

  return (
    <g>
      {sentryMode && (
        <motion.ellipse
          cx={cx}
          cy={sentryY}
          rx={16}
          ry={7}
          fill="none"
          stroke={C.sentryGlow}
          strokeWidth={1.2}
          animate={{ opacity: [0.65, 0.18, 0.65], rx: [13, 21, 13] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
      {sentryMode && (
        <foreignObject x={cx - iconSize / 2} y={sentryY - iconSize / 2} width={iconSize} height={iconSize}>
          <Tooltip content="Sentry mode active" side="top">
            <motion.span
              className="flex items-center justify-center w-full h-full rounded-full bg-[var(--bg-app)]"
              animate={{ opacity: [1, 0.45, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Shield className="w-4 h-4" fill={C.sentryRed} stroke={C.sentryRed} />
            </motion.span>
          </Tooltip>
        </foreignObject>
      )}
      {locked !== null && (
        <foreignObject x={cx - iconSize / 2} y={cy - iconSize / 2} width={iconSize} height={iconSize}>
          {interactive ? (
            <Tooltip content={locked ? 'Locked' : 'Unlocked'} side="top">
              <span className="flex items-center justify-center w-full h-full rounded-full bg-[var(--bg-app)]">
                {locked
                  ? <Lock className="w-4 h-4" fill={C.lockedGreen} stroke={C.lockedGreen} />
                  : <Unlock className="w-4 h-4" fill={C.unlockedRed} stroke={C.unlockedRed} />
                }
              </span>
            </Tooltip>
          ) : (
            <span className="flex items-center justify-center w-full h-full rounded-full bg-[var(--bg-app)]">
              {locked
                ? <Lock className="w-4 h-4" fill={C.lockedGreen} stroke={C.lockedGreen} />
                : <Unlock className="w-4 h-4" fill={C.unlockedRed} stroke={C.unlockedRed} />
              }
            </span>
          )}
        </foreignObject>
      )}
    </g>
  );
}

function DriverSeatIndicator({ occupied }: { occupied: boolean | null }) {
  if (!occupied) return null;

  return (
    <ellipse cx={268} cy={122} rx={8.5} ry={11.5} fill={C.seatOccupied} stroke="rgba(34,211,238,0.35)" />
  );
}

function SvgDefs({ paint, ids }: { paint: PaintPalette; ids: TwinIds }) {
  return (
    <defs>
      <filter id={ids.shadowBlur} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={8} />
      </filter>
      <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={4} result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <clipPath id={ids.bodyClip}><path d={BODY_PATH} /></clipPath>
      <clipPath id={ids.dloClip}><path d={DLO_INNER_PATH} /></clipPath>
      {/* Paint-derived gradients */}
      <linearGradient id={ids.bodyGrad} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={paint.body[0]} />
        <stop offset="28%" stopColor={paint.body[1]} />
        <stop offset="58%" stopColor={paint.body[2]} />
        <stop offset="100%" stopColor={paint.body[3]} />
      </linearGradient>
      <linearGradient id={ids.lowerShadow} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={paint.lower[0]} />
        <stop offset="48%" stopColor={paint.lower[1]} />
        <stop offset="100%" stopColor={paint.lower[2]} />
      </linearGradient>
      <linearGradient id={ids.hoodSheen} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.surface[0]} />
        <stop offset="48%" stopColor={paint.surface[1]} />
        <stop offset="100%" stopColor={paint.surface[2]} />
      </linearGradient>
      <linearGradient id={ids.mirrorGrad} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.mirror[0]} />
        <stop offset="45%" stopColor={paint.mirror[1]} />
        <stop offset="100%" stopColor={paint.mirror[2]} />
      </linearGradient>
      {/* Paint-agnostic: pure white reflections work on every paint. */}
      <linearGradient id={ids.shoulderHighlight} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
        <stop offset="18%" stopColor="rgba(255,255,255,0.34)" />
        <stop offset="64%" stopColor="rgba(255,255,255,0.18)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.03)" />
      </linearGradient>
      <linearGradient id={ids.softReflection} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0)" />
        <stop offset="22%" stopColor="rgba(255,255,255,0.18)" />
        <stop offset="75%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </linearGradient>
      <linearGradient id={ids.glassReflection} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="36%" stopColor="rgba(255,255,255,0.34)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
      </linearGradient>
      {/* Tinted glass reads dark at the top, brighter near the beltline
          (matches the value structure of a real render). */}
      <linearGradient id={ids.glassGrad} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(5,10,22,0.88)" />
        <stop offset="62%" stopColor="rgba(24,36,58,0.62)" />
        <stop offset="100%" stopColor="rgba(95,120,150,0.4)" />
      </linearGradient>
      <linearGradient id={ids.lowReflection} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0)" />
        <stop offset="50%" stopColor="rgba(255,255,255,0.15)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </linearGradient>
      <linearGradient id={ids.windshieldGrad} x1="0" y1="0" x2="1" y2="0.35">
        <stop offset="0%" stopColor="rgba(186,210,235,0.45)" />
        <stop offset="100%" stopColor="rgba(15,23,42,0.55)" />
      </linearGradient>
      {/* Smoked headlight / taillight lenses — the bright accents come from
          the DRL strip and taillight core strokes, not the lens fill. */}
      <linearGradient id={ids.headlightLens} x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0%" stopColor="rgba(90,115,145,0.85)" />
        <stop offset="55%" stopColor="rgba(35,48,68,0.85)" />
        <stop offset="100%" stopColor="rgba(12,18,32,0.85)" />
      </linearGradient>
      <linearGradient id={ids.taillightGrad} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(130,25,30,0.92)" />
        <stop offset="55%" stopColor="rgba(85,14,18,0.92)" />
        <stop offset="100%" stopColor="rgba(50,8,10,0.92)" />
      </linearGradient>
      <radialGradient id={ids.rimGrad} cx="42%" cy="38%" r="66%">
        <stop offset="0%" stopColor="rgba(190,200,215,0.7)" />
        <stop offset="52%" stopColor="rgba(90,105,128,0.85)" />
        <stop offset="100%" stopColor="rgba(15,23,42,0.95)" />
      </radialGradient>
      <radialGradient id={ids.tireOuter} cx="40%" cy="35%" r="72%">
        <stop offset="0%" stopColor="rgba(46,55,70,0.9)" />
        <stop offset="55%" stopColor="rgba(6,9,16,0.98)" />
        <stop offset="100%" stopColor="rgba(0,0,0,1)" />
      </radialGradient>
    </defs>
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
  className,
  vehicleId,
  exteriorColor,
  paint: paintOverride,
  model,
}: VehicleTwinProps) {
  const width = SIZE_MAP[size];
  const height = Math.round(width * ASPECT_RATIO);

  // Resolve paint: explicit `paint` prop wins, else fall back to the
  // per-vehicle override + Tesla-inferred paint via the hook. The hook is
  // safe to call with `null`/missing vehicleId — it just no-ops storage.
  const colorSource = exteriorColor ?? (vehicleColor && vehicleColor.length > 0 ? vehicleColor : null);
  const { paint: resolvedPaint } = useVehiclePaint(vehicleId ?? null, colorSource);
  const paint = paintOverride ?? resolvedPaint ?? FALLBACK_PAINT;

  // Photo mode: Tesla's own configurator side render in the twin's paint,
  // with the live state indicators overlaid. Falls back to the hand-drawn
  // SVG twin whenever the image cannot load (offline / CSP / endpoint gone).
  const [photoState, setPhotoState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const photoUrl = useMemo(() => buildCompositorUrl(paint.id, model), [paint.id, model]);
  const photoOn = photoState === 'ready';

  // Align the photo with the SVG overlay: the twin geometry was traced from
  // this exact render, so image carLeft..carRight ↔ viewBox x 43..556 and
  // image ground ↔ viewBox y 263 (viewBox min-y 52).
  const u = width / VIEWBOX_WIDTH; // CSS px per viewBox unit
  const unitsPerImgPx = (556 - 43) / (COMPOSITOR_METRICS.carRight - COMPOSITOR_METRICS.carLeft);
  const imgStyle = {
    position: 'absolute' as const,
    width: COMPOSITOR_METRICS.imgWidth * unitsPerImgPx * u,
    left: (43 - COMPOSITOR_METRICS.carLeft * unitsPerImgPx) * u,
    top: ((263 - VIEWBOX_MIN_Y) - COMPOSITOR_METRICS.ground * unitsPerImgPx) * u,
    opacity: photoOn ? 1 : 0,
    transition: 'opacity 200ms ease',
  };

  // Per-instance gradient ids — prevents <defs> id collisions when two
  // twins render on the same page with different paints.
  const reactId = useId();
  const ids = useMemo<TwinIds>(() => buildTwinIds(`twin-${reactId.replace(/:/g, '')}`), [reactId]);

  const ctxValue = useMemo<TwinContextValue>(
    () => ({
      ids,
      paint,
      bodyAccent: {
        stroke: paint.bodyStroke,
        highlight: paint.bodyHighlight,
        chrome: paint.bodyChrome,
        shadow: paint.bodyShadow,
      },
    }),
    [ids, paint],
  );

  return (
    <TwinContext.Provider value={ctxValue}>
      <motion.div
        className={cn('relative inline-flex items-center justify-center overflow-hidden', className)}
        style={{ width, height }}
        role="img"
        aria-label="Vehicle digital twin showing current physical state"
        initial={driveIn ? { x: '115%', opacity: 0.18, scale: 0.96 } : false}
        animate={driveIn ? { x: 0, opacity: 1, scale: 1 } : undefined}
        transition={driveIn ? { duration: DRIVE_IN_DURATION, ease: 'easeOut' } : undefined}
      >
        {photoState !== 'failed' && (
          <img
            src={photoUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={imgStyle}
            onLoad={() => setPhotoState('ready')}
            onError={() => setPhotoState('failed')}
          />
        )}
        <svg
          viewBox={`0 ${VIEWBOX_MIN_Y} ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
          className="select-none relative"
        >
          <SvgDefs paint={paint} ids={ids} />
          <title>Tesla side view digital twin</title>
          <desc>Vehicle side view with dynamic telemetry overlays for doors, windows, lights, lock, sentry mode, and charging status.</desc>
          {!photoOn && <GroundShadow />}
          {isCharging && <ChargingUnderglow />}
          <g id="body">
            <BodyShell frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} photo={photoOn} />
            {!photoOn && <BodyDetails />}
            {!photoOn && <BodyReflections />}
          </g>
          <g id="windows">
            <SideWindows
              windowFD={windowFD}
              windowFP={windowFP}
              windowRD={windowRD}
              windowRP={windowRP}
              interactive={interactive}
              photo={photoOn}
            />
          </g>
          <g id="doors">
            <PassengerDoorAlerts
              passengerFront={doors.passengerFront}
              passengerRear={doors.passengerRear}
            />
            <DoorOverlay
              kind="rear"
              open={doors.driverRear}
              label="Driver Rear"
              interactive={interactive}
              photo={photoOn}
            />
            <DoorOverlay
              kind="front"
              open={doors.driverFront}
              label="Driver Front"
              interactive={interactive}
              photo={photoOn}
            />
          </g>
          <DriverSeatIndicator occupied={driverSeatOccupied} />
          <g id="lighting">
            <ChargePortIndicator
              open={chargePortOpen}
              charging={isCharging}
              interactive={interactive}
              photo={photoOn}
            />
            <HeadlightGlows on={headlights} hazards={hazards} turnSignal={turnSignal} driveIn={driveIn} photo={photoOn} />
            <TaillightGlows hazards={hazards} turnSignal={turnSignal} driveIn={driveIn} photo={photoOn} />
          </g>
          {!photoOn && (
            <g id="wheels">
              <WheelSVG cx={FRONT_WHEEL_CX} cy={WHEEL_CY} driveIn={driveIn} driving={isDriving} />
              <WheelSVG cx={REAR_WHEEL_CX} cy={WHEEL_CY} driveIn={driveIn} driving={isDriving} />
            </g>
          )}
          <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
        </svg>
      </motion.div>
    </TwinContext.Provider>
  );
}
