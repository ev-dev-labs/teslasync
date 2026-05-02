import { createContext, useContext, useId, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';
import {
  FALLBACK_PAINT,
  type PaintPalette,
} from '@/lib/vehicleColors';
import { useVehiclePaint } from '@/hooks/useVehiclePaint';

const SIZE_MAP = { sm: 300, md: 440, lg: 560 } as const;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_MIN_Y = 52;
const VIEWBOX_HEIGHT = 220;
const ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH;
const DRIVE_IN_DURATION = 1.35;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

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
  hoodSurface: string;
  frontDoorSurface: string;
  rearDoorSurface: string;
  quarterSurface: string;
  rockerDepth: string;
  mirrorGrad: string;
  shoulderHighlight: string;
  softReflection: string;
  glassReflection: string;
  glassGrad: string;
  headlightLens: string;
  rimGrad: string;
  rimDepth: string;
  tireOuter: string;
}

function buildTwinIds(uid: string): TwinIds {
  const p = (suffix: string) => `${uid}-${suffix}`;
  return {
    shadowBlur: p('shadow-blur'),
    glow: p('glow'),
    bodyGrad: p('body-grad'),
    lowerShadow: p('lower-shadow'),
    hoodSurface: p('hood-surface'),
    frontDoorSurface: p('front-door-surface'),
    rearDoorSurface: p('rear-door-surface'),
    quarterSurface: p('quarter-surface'),
    rockerDepth: p('rocker-depth'),
    mirrorGrad: p('mirror-grad'),
    shoulderHighlight: p('shoulder-highlight'),
    softReflection: p('soft-reflection'),
    glassReflection: p('glass-reflection'),
    glassGrad: p('glass-grad'),
    headlightLens: p('headlight-lens'),
    rimGrad: p('rim-grad'),
    rimDepth: p('rim-depth'),
    tireOuter: p('tire-outer'),
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
  cladding: 'rgba(2,6,23,0.7)',
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
  shadow: 'rgba(0,0,0,0.48)',
  wheelDark: 'rgba(0,0,0,0.94)',
  wheelSidewall: 'rgba(7,12,24,0.96)',
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
        cx={286}
        cy={246}
        rx={230}
        ry={21}
        fill={C.shadow}
        filter={`url(#${ids.shadowBlur})`}
      />
      <ellipse
        cx={285}
        cy={239}
        rx={182}
        ry={9}
        fill="rgba(0,0,0,0.56)"
      />
    </g>
  );
}

function ChargingUnderglow() {
  const { ids } = useTwinCtx();
  return (
    <g pointerEvents="none">
      <motion.ellipse
        cx={292}
        cy={239}
        rx={190}
        ry={18}
        fill="rgba(34,197,94,0.18)"
        filter={`url(#${ids.glow})`}
        animate={{ opacity: [0.2, 0.55, 0.2], rx: [160, 205, 160] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 154 232 C 236 239 354 239 440 231"
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
  const blades = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];
  const lugs = [0, 72, 144, 216, 288];
  const shouldSpin = driveIn || driving;

  return (
    <g>
      <ellipse cx={cx + 8} cy={cy + 2} rx={44} ry={40} fill="rgba(0,0,0,0.46)" />
      <circle cx={cx} cy={cy} r={43} fill={`url(#${ids.tireOuter})`} />
      <circle cx={cx} cy={cy} r={39} fill={C.wheelDark} stroke={C.wheelStroke} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={34} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={30} fill={C.wheelSidewall} stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={32} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} />
      <path
        d={`M ${cx + 26} ${cy + 11} C ${cx + 30} ${cy + 16} ${cx + 29} ${cy + 23} ${cx + 24} ${cy + 27}`}
        fill="none"
        stroke="rgba(185,28,28,0.42)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d={`M ${cx + 18} ${cy + 18} C ${cx + 25} ${cy + 12} ${cx + 30} ${cy + 3} ${cx + 30} ${cy - 8}`}
        fill="none"
        stroke="rgba(239,68,68,0.7)"
        strokeWidth={5}
        strokeLinecap="round"
      />
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
        <circle cx={cx} cy={cy} r={36} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth={0.8} strokeDasharray="2,5" />
        <circle cx={cx} cy={cy} r={28} fill={`url(#${ids.rimDepth})`} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={25} fill={`url(#${ids.rimGrad})`} stroke="rgba(255,255,255,0.18)" strokeWidth={1.2} />
        {blades.map((angle) => (
          <g key={angle} transform={`rotate(${angle} ${cx} ${cy})`}>
            <path
              d={`M ${cx + 4} ${cy - 4} C ${cx + 11} ${cy - 19} ${cx + 23} ${cy - 26} ${cx + 31} ${cy - 18} C ${cx + 25} ${cy - 12} ${cx + 18} ${cy - 3} ${cx + 7} ${cy + 10} Z`}
              fill="rgba(2,6,23,0.82)"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth={0.6}
            />
            <path
              d={`M ${cx + 9} ${cy - 3} C ${cx + 17} ${cy - 13} ${cx + 24} ${cy - 17} ${cx + 28} ${cy - 14}`}
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={0.8}
              strokeLinecap="round"
            />
          </g>
        ))}
        <motion.path
          d={`M ${cx - 18} ${cy - 15} C ${cx - 5} ${cy - 27} ${cx + 18} ${cy - 24} ${cx + 27} ${cy - 10}`}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1.2}
          strokeLinecap="round"
          animate={{ opacity: [0.12, 0.42, 0.12] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <circle cx={cx} cy={cy} r={13} fill="rgba(3,7,18,0.88)" stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
        {lugs.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <circle
              key={angle}
              cx={cx + Math.cos(rad) * 7}
              cy={cy + Math.sin(rad) * 7}
              r={1.5}
              fill="rgba(203,213,225,0.45)"
            />
          );
        })}
        <circle cx={cx} cy={cy} r={6} fill="rgba(30,41,59,0.95)" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        <circle cx={cx - 9} cy={cy - 10} r={2.5} fill="rgba(255,255,255,0.25)" />
      </motion.g>
      <circle cx={cx} cy={cy} r={40} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={5} />
      <path
        d={`M ${cx - 33} ${cy - 14} C ${cx - 18} ${cy - 36} ${cx + 20} ${cy - 38} ${cx + 35} ${cy - 14}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </g>
  );
}

function Body3DDetails() {
  const { ids } = useTwinCtx();
  return (
    <g id="body-3d-details" pointerEvents="none">
      <path
        d="M 64 176 C 96 158 138 149 190 145 L 205 157 C 147 157 100 165 58 188 Z"
        fill={`url(#${ids.hoodSurface})`}
        opacity={0.72}
      />
      <path
        d="M 205 158 L 316 155 L 307 221 L 201 218 C 199 197 200 176 205 158 Z"
        fill={`url(#${ids.frontDoorSurface})`}
        opacity={0.72}
      />
      <path
        d="M 320 155 L 458 154 L 450 220 L 311 221 Z"
        fill={`url(#${ids.rearDoorSurface})`}
        opacity={0.68}
      />
      <path
        d="M 456 154 C 486 150 523 159 558 190 C 550 207 518 216 483 219 C 480 193 470 171 456 154 Z"
        fill={`url(#${ids.quarterSurface})`}
        opacity={0.72}
      />
      <path
        d="M 58 191 C 136 180 248 178 352 181 C 447 184 520 193 556 203"
        fill="none"
        stroke="rgba(255,255,255,0.24)"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <path
        d="M 74 205 C 167 198 296 197 390 200 C 469 203 526 209 554 217"
        fill="none"
        stroke="rgba(0,0,0,0.38)"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M 53 215 C 120 226 214 230 332 229 C 432 228 513 221 552 211 L 542 224 C 476 238 361 243 219 239 C 131 236 75 229 44 219 Z"
        fill={`url(#${ids.rockerDepth})`}
        opacity={0.82}
      />
      <path
        d="M 202 152 C 245 121 289 107 336 109 C 390 111 437 128 489 152"
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d="M 205 156 L 307 155"
        fill="none"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path
        d="M 320 154 L 456 154"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path
        d="M 254 174 L 275 173"
        fill="none"
        stroke="rgba(2,6,23,0.72)"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <path
        d="M 374 174 L 397 173"
        fill="none"
        stroke="rgba(2,6,23,0.72)"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <path
        d="M 58 189 C 70 181 85 178 101 181"
        fill="none"
        stroke="rgba(255,255,255,0.58)"
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M 524 158 C 541 163 553 174 559 188"
        fill="none"
        stroke="rgba(239,68,68,0.62)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d="M 50 205 C 45 197 47 190 55 181 C 65 169 83 162 112 158"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 496 151 C 528 156 552 173 559 192 C 562 205 551 216 531 221"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </g>
  );
}

function BodyShell({
  frunkOpen,
  trunkOpen,
  interactive,
}: {
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  interactive?: boolean;
}) {
  const { ids, bodyAccent } = useTwinCtx();
  return (
    <g>
      <path
        d="M 42 208 C 40 196 50 184 72 171 C 100 157 140 149 190 145 C 225 118 282 104 335 106 C 392 108 443 129 493 153 C 526 157 550 173 558 191 C 563 207 552 218 532 224 C 505 232 480 231 456 228 C 452 198 429 178 430 178 C 399 178 375 201 372 229 L 190 229 C 187 201 163 179 132 179 C 101 179 80 201 77 228 L 63 226 C 49 224 42 217 42 208 Z"
        fill={`url(#${ids.bodyGrad})`}
        stroke={bodyAccent.stroke}
        strokeWidth={1.4}
      />
      <path
        d="M 64 174 C 100 157 139 149 190 145 C 228 120 284 108 335 109 C 391 111 438 129 492 153"
        fill="none"
        stroke={bodyAccent.chrome}
        strokeWidth={3.4}
        strokeLinecap="round"
        opacity={0.36}
      />
      <path
        d="M 61 190 C 138 178 247 177 353 180 C 448 183 521 192 556 201"
        fill="none"
        stroke={bodyAccent.highlight}
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M 56 184 C 89 161 132 150 190 146"
        fill="none"
        stroke="rgba(255,255,255,0.09)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 459 150 C 492 153 536 169 558 190"
        fill="none"
        stroke="rgba(255,255,255,0.11)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 45 211 C 108 224 207 231 335 230 C 440 229 514 221 552 211"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 70 211 C 164 216 291 216 387 213 C 468 210 523 205 556 198 L 548 214 C 488 227 391 231 278 230 C 187 229 107 224 48 214 Z"
        fill={`url(#${ids.lowerShadow})`}
        opacity={0.72}
      />
      <path
        d="M 78 223 C 166 226 282 226 390 223 C 466 220 522 215 555 208"
        fill="none"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={2.2}
        strokeLinecap="round"
        opacity={0.55}
      />

      <path
        d="M 202 146 C 242 120 286 109 335 111 C 390 113 438 130 487 152"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 177 153 C 191 145 208 147 221 156 C 205 161 190 160 177 155 Z"
        fill={`url(#${ids.mirrorGrad})`}
        stroke="rgba(255,255,255,0.26)"
        strokeWidth={0.8}
      />
      <path
        d="M 177 153 C 193 150 209 152 219 156"
        fill="none"
        stroke="rgba(255,255,255,0.34)"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
      <path
        d="M 107 161 L 125 154 L 144 157 L 128 166 Z"
        fill="rgba(2,6,23,0.7)"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={0.8}
      />
      <path
        d="M 109 158 C 124 154 139 154 152 158"
        fill="none"
        stroke="rgba(255,255,255,0.26)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 466 150 C 477 169 483 190 486 219"
        fill="none"
        stroke="rgba(255,255,255,0.09)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 489 149 C 516 150 542 160 558 178 L 526 176 C 515 164 502 154 489 149 Z"
        fill="rgba(0,0,0,0.16)"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={0.8}
      />
      <path
        d="M 492 144 C 512 137 544 136 560 144 C 543 151 516 151 492 145 Z"
        fill="rgba(0,0,0,0.36)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.8}
      />
      <path
        d="M 504 139 C 527 134 551 137 562 145 C 542 149 519 148 500 145 Z"
        fill="rgba(2,6,23,0.78)"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={0.9}
      />

      <path
        d="M 74 228 C 79 195 103 173 132 173 C 164 173 188 198 192 228"
        fill="none"
        stroke={C.cladding}
        strokeWidth={13}
        strokeLinecap="round"
      />
      <path
        d="M 371 229 C 376 196 400 173 430 173 C 462 173 486 199 490 228"
        fill="none"
        stroke={C.cladding}
        strokeWidth={13}
        strokeLinecap="round"
      />
      <path
        d="M 78 227 C 82 199 104 178 132 178 C 161 178 184 200 188 228"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 376 228 C 380 200 402 178 430 178 C 460 178 482 201 486 228"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 76 205 C 104 194 166 193 195 204"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path
        d="M 374 205 C 405 193 463 194 491 205"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />

      <path
        d="M 62 176 C 100 156 139 148 190 145"
        fill="none"
        stroke={frunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={frunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {frunkOpen && (
          <motion.path
            d="M 62 176 C 92 146 140 134 190 145 L 181 158 C 132 153 93 161 62 184 Z"
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

      <path
        d="M 469 148 C 508 150 542 165 558 188"
        fill="none"
        stroke={trunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={trunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {trunkOpen && (
          <motion.path
            d="M 470 148 C 510 126 548 137 560 169 L 557 188 C 535 169 503 155 470 156 Z"
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
        x={50}
        y={128}
        width={135}
        height={55}
        label={`Frunk: ${stateLabel(frunkOpen, 'Open', 'Closed')}`}
        side="left"
      />
      <InteractiveHotspot
        enabled={interactive}
        x={455}
        y={128}
        width={100}
        height={50}
        label={`Trunk: ${stateLabel(trunkOpen, 'Open', 'Closed')}`}
        side="right"
      />
    </g>
  );
}

function BodyReflections() {
  const { ids } = useTwinCtx();
  return (
    <g id="body-reflections" pointerEvents="none">
      <motion.path
        d="M 65 185 C 140 169 246 166 356 170 C 452 174 525 184 557 198"
        fill="none"
        stroke={`url(#${ids.shoulderHighlight})`}
        strokeWidth={1.4}
        strokeLinecap="round"
        animate={{ opacity: [0.55, 0.86, 0.55] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 88 205 C 154 214 267 216 378 214 C 459 212 520 206 552 198"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <motion.path
        d="M 208 156 C 276 152 374 153 461 160 L 453 168 C 366 162 277 161 214 164 Z"
        fill={`url(#${ids.softReflection})`}
        animate={{ opacity: [0.38, 0.78, 0.38] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 118 176 C 230 160 398 164 526 186"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeDasharray="58 420"
        animate={{ strokeDashoffset: [0, -420], opacity: [0, 0.45, 0] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 230 192 C 293 187 387 188 458 195"
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M 73 178 C 106 161 149 153 190 153"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path
        d="M 486 154 C 519 160 546 174 558 190"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1.1}
        strokeLinecap="round"
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
}: {
  windowFD: WindowState;
  windowFP: WindowState;
  windowRD: WindowState;
  windowRP: WindowState;
  interactive?: boolean;
}) {
  const { ids } = useTwinCtx();
  const glassClosedRef = `url(#${ids.glassGrad})`;
  const passengerAlert = wFP === 'open' || wFP === 'partial' || wRP === 'open' || wRP === 'partial';

  return (
    <g>
      <path
        d="M 194 148 C 230 121 276 108 331 108 C 386 109 431 126 478 151 L 448 159 L 207 159 Z"
        fill="rgba(2,6,23,0.74)"
        stroke="rgba(2,6,23,0.82)"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path
        d="M 202 147 C 232 124 274 113 316 113 L 307 152 L 212 153 Z"
        fill={windowFill(wFD, glassClosedRef)}
        stroke={windowStroke(wFD)}
        strokeWidth={1.1}
      />
      <path
        d="M 327 113 C 382 114 424 128 469 149 L 441 153 L 318 152 Z"
        fill={windowFill(wRD, glassClosedRef)}
        stroke={windowStroke(wRD)}
        strokeWidth={1.1}
      />
      <path
        d="M 316 114 L 318 153"
        stroke="rgba(2,6,23,0.7)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M 212 153 L 441 153"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 222 139 C 286 126 381 128 448 143"
        fill="none"
        stroke={`url(#${ids.glassReflection})`}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <motion.path
        d="M 225 134 C 286 122 379 124 446 140"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray="42 260"
        animate={{ strokeDashoffset: [0, -260], opacity: [0.1, 0.42, 0.1] }}
        transition={{ duration: 6.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 245 134 C 265 123 288 117 310 115"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 348 116 L 334 148"
        fill="none"
        stroke="rgba(2,6,23,0.82)"
        strokeWidth={5.4}
        strokeLinecap="round"
      />
      <path
        d="M 475 149 L 443 156"
        fill="none"
        stroke="rgba(2,6,23,0.7)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d="M 377 122 C 407 128 432 138 455 148"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      {passengerAlert && (
        <motion.path
          d="M 210 141 C 268 126 363 126 449 144"
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
        y={101}
        width={118}
        height={55}
        label={`Front driver window: ${windowLabel(wFD)}`}
      />
      <InteractiveHotspot
        enabled={interactive}
        x={320}
        y={101}
        width={132}
        height={55}
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
}: {
  kind: 'front' | 'rear';
  open: boolean | null;
  label: string;
  interactive?: boolean;
}) {
  const isFront = kind === 'front';
  const seam = isFront
    ? { x1: 318, y1: 153, x2: 307, y2: 223, handleX: 254, handleY: 174 }
    : { x1: 444, y1: 153, x2: 450, y2: 222, handleX: 374, handleY: 174 };
  const doorPath = isFront
    ? 'M 318 154 L 232 138 L 213 217 L 307 224 Z'
    : 'M 444 154 L 501 140 L 514 216 L 450 224 Z';
  const hotspot = isFront
    ? { x: 208, y: 151, width: 112, height: 76, side: 'left' as const }
    : { x: 330, y: 151, width: 124, height: 76, side: 'right' as const };

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
      <line
        x1={seam.x1}
        y1={seam.y1}
        x2={seam.x2}
        y2={seam.y2}
        stroke={doorStroke(open)}
        strokeWidth={open ? 2 : 1}
        strokeDasharray={open ? undefined : '4,4'}
      />
      <rect
        x={seam.handleX}
        y={seam.handleY}
        width={17}
        height={4}
        rx={2}
        fill={open ? C.doorOpen : 'rgba(255,255,255,0.16)'}
      />
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
          d="M 318 154 L 233 136"
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
          d="M 444 154 L 501 138"
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
}: {
  on: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driveIn?: boolean;
}) {
  const { ids } = useTwinCtx();
  const flashing = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const headlightsActive = on === true || driveIn;

  return (
    <g>
      <path
        d="M 52 188 C 67 181 85 179 101 183"
        fill={`url(#${ids.headlightLens})`}
        stroke={headlightsActive ? C.headlightOn : C.headlightOff}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <path
        d="M 56 191 C 69 185 86 183 99 186"
        fill="none"
        stroke="rgba(147,197,253,0.55)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {headlightsActive && (
        <>
          <motion.ellipse
            cx={72}
            cy={186}
            rx={17}
            ry={7}
            fill={C.headlightGlow}
            filter={`url(#${ids.glow})`}
            animate={{ opacity: driveIn ? [0.1, 0.95, 0.22, 0.85, 0.28] : [0.35, 0.85, 0.35] }}
            transition={driveIn ? { duration: 1.35, ease: 'easeInOut' } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.path
            d="M 51 188 L 0 174 L 0 210 Z"
            fill={C.headlightBeam}
            animate={{ opacity: driveIn ? [0, 0.72, 0.18, 0.58, 0.12] : [0.45, 0.8, 0.45] }}
            transition={driveIn ? { duration: 1.35, ease: 'easeInOut' } : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
      {flashing && (
        <motion.ellipse
          cx={102}
          cy={193}
          rx={7}
          ry={4}
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
}: {
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driveIn?: boolean;
}) {
  const { ids } = useTwinCtx();
  const flashing = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      <path
        d="M 527 158 C 542 162 554 171 560 183"
        fill="rgba(127,29,29,0.25)"
        stroke={flashing ? C.amber : C.taillightBase}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <path
        d="M 531 167 C 543 172 553 178 559 185"
        fill="none"
        stroke={C.taillightActive}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.7}
      />
      <path
        d="M 532 161 C 543 165 554 173 559 181 C 549 177 540 172 531 169"
        fill="none"
        stroke="rgba(248,113,113,0.55)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {flashing && (
        <motion.path
          d="M 527 158 C 542 162 554 171 560 183"
          fill="none"
          stroke={C.amber}
          strokeWidth={3.2}
          strokeLinecap="round"
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
      {driveIn && (
        <>
          <motion.ellipse
            cx={546}
            cy={174}
            rx={24}
            ry={10}
            fill={C.taillightActive}
            filter={`url(#${ids.glow})`}
            animate={{ opacity: [0, 0.95, 0.18, 0.9, 0.22] }}
            transition={{ delay: 1.2, duration: 0.75, ease: 'easeOut' }}
          />
          <motion.path
            d="M 527 158 C 542 162 554 171 560 183"
            fill="none"
            stroke={C.taillightActive}
            strokeWidth={4.2}
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
}: {
  open: boolean | null;
  charging: boolean;
  interactive?: boolean;
}) {
  const { bodyAccent } = useTwinCtx();
  const cx = 498;
  const cy = 160;
  const fill = charging || open ? C.chargeGreenFill : C.neutral;
  const stroke = charging || open ? C.chargeGreen : bodyAccent.stroke;
  const label = charging ? 'Charging' : stateLabel(open, 'Open', 'Closed');

  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={fill} stroke={stroke} strokeWidth={1.3} />
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
            d="M 498 153 L 492 162 L 498 162 L 495 169 L 505 158 L 499 158 Z"
            fill={C.chargeGreen}
          />
        </>
      )}
      {open && !charging && (
        <circle cx={cx} cy={cy} r={11} fill="none" stroke={C.chargeGreen} strokeWidth={0.8} />
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
  const cx = 322;
  const cy = 132;
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
              className="flex items-center justify-center w-full h-full rounded-full bg-slate-950/45"
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
              <span className="flex items-center justify-center w-full h-full rounded-full bg-slate-950/45">
                {locked
                  ? <Lock className="w-4 h-4" fill={C.lockedGreen} stroke={C.lockedGreen} />
                  : <Unlock className="w-4 h-4" fill={C.unlockedRed} stroke={C.unlockedRed} />
                }
              </span>
            </Tooltip>
          ) : (
            <span className="flex items-center justify-center w-full h-full rounded-full bg-slate-950/45">
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
    <ellipse cx={246} cy={137} rx={9} ry={12} fill={C.seatOccupied} stroke="rgba(34,211,238,0.35)" />
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
      {/* Paint-derived: body + lower shadow + 4 surface variants share the
          paint's body / lower / surface stops. Mirror uses paint.mirror. */}
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
      <linearGradient id={ids.hoodSurface} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.surface[0]} />
        <stop offset="48%" stopColor={paint.surface[1]} />
        <stop offset="100%" stopColor={paint.surface[2]} />
      </linearGradient>
      <linearGradient id={ids.frontDoorSurface} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.surface[0]} />
        <stop offset="48%" stopColor={paint.surface[1]} />
        <stop offset="100%" stopColor={paint.surface[2]} />
      </linearGradient>
      <linearGradient id={ids.rearDoorSurface} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.surface[0]} />
        <stop offset="48%" stopColor={paint.surface[1]} />
        <stop offset="100%" stopColor={paint.surface[2]} />
      </linearGradient>
      <linearGradient id={ids.quarterSurface} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={paint.surface[0]} />
        <stop offset="52%" stopColor={paint.surface[1]} />
        <stop offset="100%" stopColor={paint.surface[2]} />
      </linearGradient>
      <linearGradient id={ids.rockerDepth} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={paint.lower[0]} />
        <stop offset="52%" stopColor={paint.lower[1]} />
        <stop offset="100%" stopColor={paint.lower[2]} />
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
      <linearGradient id={ids.glassGrad} x1="0" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="rgba(148,163,184,0.34)" />
        <stop offset="42%" stopColor="rgba(15,23,42,0.42)" />
        <stop offset="100%" stopColor="rgba(2,6,23,0.72)" />
      </linearGradient>
      <linearGradient id={ids.headlightLens} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
        <stop offset="55%" stopColor="rgba(147,197,253,0.18)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
      </linearGradient>
      <radialGradient id={ids.rimGrad} cx="45%" cy="40%" r="65%">
        <stop offset="0%" stopColor="rgba(71,85,105,0.62)" />
        <stop offset="50%" stopColor="rgba(15,23,42,0.9)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.96)" />
      </radialGradient>
      <radialGradient id={ids.rimDepth} cx="42%" cy="38%" r="68%">
        <stop offset="0%" stopColor="rgba(226,232,240,0.22)" />
        <stop offset="48%" stopColor="rgba(51,65,85,0.42)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.92)" />
      </radialGradient>
      <radialGradient id={ids.tireOuter} cx="42%" cy="35%" r="70%">
        <stop offset="0%" stopColor="rgba(51,65,85,0.72)" />
        <stop offset="46%" stopColor="rgba(2,6,23,0.96)" />
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
}: VehicleTwinProps) {
  const width = SIZE_MAP[size];
  const height = Math.round(width * ASPECT_RATIO);

  // Resolve paint: explicit `paint` prop wins, else fall back to the
  // per-vehicle override + Tesla-inferred paint via the hook. The hook is
  // safe to call with `null`/missing vehicleId — it just no-ops storage.
  const colorSource = exteriorColor ?? (vehicleColor && vehicleColor.length > 0 ? vehicleColor : null);
  const { paint: resolvedPaint } = useVehiclePaint(vehicleId ?? null, colorSource);
  const paint = paintOverride ?? resolvedPaint ?? FALLBACK_PAINT;

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
        className={cn('inline-flex items-center justify-center', className)}
        role="img"
        aria-label="Vehicle digital twin showing current physical state"
        initial={driveIn ? { x: '115%', opacity: 0.18, scale: 0.96 } : false}
        animate={driveIn ? { x: 0, opacity: 1, scale: 1 } : undefined}
        transition={driveIn ? { duration: DRIVE_IN_DURATION, ease: 'easeOut' } : undefined}
      >
        <svg
          viewBox={`0 ${VIEWBOX_MIN_Y} ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
          className="select-none"
        >
          <SvgDefs paint={paint} ids={ids} />
          <title>Tesla-inspired performance crossover side view digital twin</title>
          <desc>Original scalable layered SVG vehicle illustration with dynamic telemetry overlays for doors, windows, lights, lock, sentry mode, and charging status.</desc>
          <GroundShadow />
          {isCharging && <ChargingUnderglow />}
          <g id="body">
            <BodyShell frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} />
            <Body3DDetails />
            <BodyReflections />
          </g>
          <g id="windows">
            <SideWindows
              windowFD={windowFD}
              windowFP={windowFP}
              windowRD={windowRD}
              windowRP={windowRP}
              interactive={interactive}
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
            />
            <DoorOverlay
              kind="front"
              open={doors.driverFront}
              label="Driver Front"
              interactive={interactive}
            />
          </g>
          <DriverSeatIndicator occupied={driverSeatOccupied} />
          <g id="lighting">
            <ChargePortIndicator
              open={chargePortOpen}
              charging={isCharging}
              interactive={interactive}
            />
            <HeadlightGlows on={headlights} hazards={hazards} turnSignal={turnSignal} driveIn={driveIn} />
            <TaillightGlows hazards={hazards} turnSignal={turnSignal} driveIn={driveIn} />
          </g>
          <g id="wheels">
            <WheelSVG cx={132} cy={226} driveIn={driveIn} driving={isDriving} />
            <WheelSVG cx={430} cy={226} driveIn={driveIn} driving={isDriving} />
          </g>
          <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
        </svg>
      </motion.div>
    </TwinContext.Provider>
  );
}
