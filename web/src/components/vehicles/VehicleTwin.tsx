import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';

const SIZE_MAP = { sm: 300, md: 440, lg: 560 } as const;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_MIN_Y = 52;
const VIEWBOX_HEIGHT = 220;
const ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  className?: string;
}

const C = {
  bodyStroke: 'rgba(255,255,255,0.16)',
  bodyHighlight: 'rgba(255,255,255,0.2)',
  glassClosed: 'url(#twin-glass-grad)',
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

function windowFill(state: WindowState): string {
  switch (state) {
    case 'closed': return C.glassClosed;
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
  return (
    <ellipse
      cx={280}
      cy={244}
      rx={226}
      ry={20}
      fill={C.shadow}
      filter="url(#twin-shadow-blur)"
    />
  );
}

function ChargingUnderglow() {
  return (
    <g pointerEvents="none">
      <motion.ellipse
        cx={292}
        cy={239}
        rx={190}
        ry={18}
        fill="rgba(34,197,94,0.18)"
        filter="url(#twin-glow)"
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

function WheelSVG({ cx, cy }: { cx: number; cy: number }) {
  const blades = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];
  const lugs = [0, 72, 144, 216, 288];

  return (
    <g>
      <circle cx={cx} cy={cy} r={43} fill="rgba(0,0,0,0.58)" />
      <circle cx={cx} cy={cy} r={39} fill={C.wheelDark} stroke={C.wheelStroke} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={34} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={30} fill={C.wheelSidewall} stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
      <motion.circle
        cx={cx}
        cy={cy}
        r={36}
        fill="none"
        stroke="rgba(255,255,255,0.045)"
        strokeWidth={0.8}
        strokeDasharray="2,5"
        animate={{ strokeDashoffset: [0, -28] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
      />
      <circle cx={cx} cy={cy} r={32} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} />
      <path
        d={`M ${cx + 26} ${cy + 11} C ${cx + 30} ${cy + 16} ${cx + 29} ${cy + 23} ${cx + 24} ${cy + 27}`}
        fill="none"
        stroke="rgba(185,28,28,0.42)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={25} fill="url(#twin-rim-grad)" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2} />
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
      <circle cx={cx} cy={cy} r={40} fill="none" stroke="rgba(0,0,0,0.42)" strokeWidth={5} />
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
  return (
    <g>
      <path
        d="M 43 205 C 42 188 52 175 73 164 C 100 150 136 144 188 140 C 220 108 263 91 319 91 C 386 91 438 115 488 145 C 519 150 542 163 552 184 C 559 199 551 212 531 219 C 506 227 480 228 456 227 C 452 199 431 180 402 180 C 372 180 350 201 347 228 L 205 228 C 202 201 180 180 151 180 C 122 180 100 201 97 228 L 70 226 C 53 224 44 216 43 205 Z"
        fill="url(#twin-body-grad)"
        stroke={C.bodyStroke}
        strokeWidth={1.4}
      />
      <path
        d="M 72 190 C 147 179 244 177 342 180 C 435 183 506 190 548 199"
        fill="none"
        stroke={C.bodyHighlight}
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M 65 177 C 96 157 136 148 188 146"
        fill="none"
        stroke="rgba(255,255,255,0.09)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 433 143 C 475 148 521 162 548 185"
        fill="none"
        stroke="rgba(255,255,255,0.11)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 63 211 C 116 224 203 231 333 230 C 424 229 501 221 541 210"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 97 223 C 178 225 274 226 369 223 C 443 220 506 215 544 207"
        fill="none"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth={2.2}
        strokeLinecap="round"
        opacity={0.55}
      />

      <path
        d="M 198 143 C 234 116 278 103 329 104 C 377 105 416 118 451 143"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 168 151 C 181 144 197 146 207 154 C 193 158 178 157 168 153 Z"
        fill="rgba(255,255,255,0.09)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.8}
      />
      <path
        d="M 168 151 C 181 148 196 150 205 154"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
      <path
        d="M 445 145 C 460 164 469 188 472 218"
        fill="none"
        stroke="rgba(255,255,255,0.09)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 483 149 C 506 153 528 164 540 181 L 512 175 C 500 163 490 155 483 149 Z"
        fill="rgba(0,0,0,0.16)"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={0.8}
      />
      <path
        d="M 488 144 C 504 137 526 138 543 145 C 526 150 507 150 488 145 Z"
        fill="rgba(0,0,0,0.36)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.8}
      />
      <path
        d="M 98 160 L 112 154 L 128 157 L 115 164 Z"
        fill="rgba(0,0,0,0.34)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.8}
      />

      <path
        d="M 98 227 C 101 199 123 178 151 178 C 180 178 202 200 205 228"
        fill="none"
        stroke="rgba(0,0,0,0.48)"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d="M 347 228 C 350 200 373 178 402 178 C 431 178 453 200 456 227"
        fill="none"
        stroke="rgba(0,0,0,0.48)"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d="M 98 227 C 101 199 123 178 151 178 C 180 178 202 200 205 228"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M 347 228 C 350 200 373 178 402 178 C 431 178 453 200 456 227"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />

      <path
        d="M 69 168 C 105 151 146 143 190 141"
        fill="none"
        stroke={frunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={frunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {frunkOpen && (
          <motion.path
            d="M 72 165 C 102 134 151 127 190 141 L 184 153 C 143 149 104 156 72 172 Z"
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
        d="M 450 142 C 492 146 529 159 551 184"
        fill="none"
        stroke={trunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={trunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {trunkOpen && (
          <motion.path
            d="M 451 142 C 487 116 532 130 553 168 L 547 184 C 522 164 486 152 451 151 Z"
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
        x={58}
        y={128}
        width={120}
        height={55}
        label={`Frunk: ${stateLabel(frunkOpen, 'Open', 'Closed')}`}
        side="left"
      />
      <InteractiveHotspot
        enabled={interactive}
        x={430}
        y={128}
        width={118}
        height={50}
        label={`Trunk: ${stateLabel(trunkOpen, 'Open', 'Closed')}`}
        side="right"
      />
    </g>
  );
}

function BodyReflections() {
  return (
    <g id="body-reflections" pointerEvents="none">
      <motion.path
        d="M 79 184 C 144 169 236 166 340 170 C 434 174 511 184 544 195"
        fill="none"
        stroke="url(#twin-shoulder-highlight)"
        strokeWidth={1.4}
        strokeLinecap="round"
        animate={{ opacity: [0.55, 0.86, 0.55] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 113 205 C 170 213 262 216 356 214 C 430 212 497 205 536 196"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <motion.path
        d="M 211 155 C 267 151 354 152 432 159 L 425 167 C 346 161 273 160 218 163 Z"
        fill="url(#twin-soft-reflection)"
        animate={{ opacity: [0.38, 0.78, 0.38] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.path
        d="M 152 174 C 244 160 385 164 503 184"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeDasharray="58 420"
        animate={{ strokeDashoffset: [0, -420], opacity: [0, 0.45, 0] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 225 191 C 281 187 360 188 428 194"
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M 92 174 C 118 161 153 154 188 153"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      <path
        d="M 464 153 C 499 159 528 171 544 188"
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
  const passengerAlert = wFP === 'open' || wFP === 'partial' || wRP === 'open' || wRP === 'partial';

  return (
    <g>
      <path
        d="M 190 146 C 222 112 263 98 319 98 C 372 99 418 114 454 142 L 432 153 L 203 154 Z"
        fill="rgba(0,0,0,0.55)"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d="M 194 143 C 222 116 260 104 302 104 L 296 149 L 204 150 Z"
        fill={windowFill(wFD)}
        stroke={windowStroke(wFD)}
        strokeWidth={1}
      />
      <path
        d="M 312 104 C 364 105 410 119 448 143 L 426 150 L 307 149 Z"
        fill={windowFill(wRD)}
        stroke={windowStroke(wRD)}
        strokeWidth={1}
      />
      <path
        d="M 303 105 L 306 149"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M 204 150 L 426 150"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 214 140 C 271 127 366 129 425 141"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <motion.path
        d="M 217 133 C 272 119 363 121 424 137"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray="42 260"
        animate={{ strokeDashoffset: [0, -260], opacity: [0.1, 0.42, 0.1] }}
        transition={{ duration: 6.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <path
        d="M 238 133 C 254 122 273 115 294 112"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <path
        d="M 333 111 L 322 146"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M 360 119 C 388 124 411 133 431 144"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.1}
        strokeLinecap="round"
      />
      {passengerAlert && (
        <motion.path
          d="M 203 139 C 250 124 346 123 428 140"
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
        x={190}
        y={101}
        width={112}
        height={55}
        label={`Front driver window: ${windowLabel(wFD)}`}
      />
      <InteractiveHotspot
        enabled={interactive}
        x={306}
        y={101}
        width={134}
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
    ? { x1: 303, y1: 151, x2: 296, y2: 222, handleX: 250, handleY: 173 }
    : { x1: 417, y1: 150, x2: 421, y2: 221, handleX: 354, handleY: 173 };
  const doorPath = isFront
    ? 'M 303 153 L 219 136 L 207 216 L 296 224 Z'
    : 'M 417 152 L 488 137 L 501 216 L 421 224 Z';
  const hotspot = isFront
    ? { x: 190, y: 150, width: 116, height: 76, side: 'left' as const }
    : { x: 320, y: 150, width: 116, height: 76, side: 'right' as const };

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
          d="M 303 154 L 221 132"
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
          d="M 417 154 L 488 132"
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
}: {
  on: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
}) {
  const flashing = hazards === true || turnSignal === 'left' || turnSignal === 'both';

  return (
    <g>
      <path
        d="M 53 184 C 67 177 83 177 96 183"
        fill="url(#twin-headlight-lens)"
        stroke={on ? C.headlightOn : C.headlightOff}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <path
        d="M 56 187 C 68 183 83 182 94 186"
        fill="none"
        stroke="rgba(147,197,253,0.55)"
        strokeWidth={1}
        strokeLinecap="round"
      />
      {on && (
        <>
          <motion.ellipse
            cx={70}
            cy={184}
            rx={17}
            ry={7}
            fill={C.headlightGlow}
            filter="url(#twin-glow)"
            animate={{ opacity: [0.35, 0.85, 0.35] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.path
            d="M 52 184 L 0 168 L 0 204 Z"
            fill={C.headlightBeam}
            animate={{ opacity: [0.45, 0.8, 0.45] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
      {flashing && (
        <motion.ellipse
          cx={101}
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
}: {
  hazards: boolean | null;
  turnSignal: TurnSignalState;
}) {
  const flashing = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      <path
        d="M 516 162 C 531 164 543 171 550 181"
        fill="rgba(127,29,29,0.25)"
        stroke={flashing ? C.amber : C.taillightBase}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <path
        d="M 522 171 C 532 174 541 179 548 186"
        fill="none"
        stroke={C.taillightActive}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.7}
      />
      <path
        d="M 527 165 C 536 168 544 174 548 181 C 540 177 532 174 524 172"
        fill="none"
        stroke="rgba(248,113,113,0.55)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {flashing && (
        <motion.path
          d="M 516 162 C 531 164 543 171 550 181"
          fill="none"
          stroke={C.amber}
          strokeWidth={3.2}
          strokeLinecap="round"
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
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
  const cx = 474;
  const cy = 162;
  const fill = charging || open ? C.chargeGreenFill : C.neutral;
  const stroke = charging || open ? C.chargeGreen : C.bodyStroke;
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
            d="M 474 155 L 468 164 L 474 164 L 471 171 L 481 160 L 475 160 Z"
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
  const cx = 304;
  const cy = 130;
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

function SvgDefs() {
  return (
    <defs>
      <filter id="twin-shadow-blur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={8} />
      </filter>
      <filter id="twin-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={4} result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <linearGradient id="twin-body-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(51,65,85,0.72)" />
        <stop offset="42%" stopColor="rgba(30,41,59,0.64)" />
        <stop offset="100%" stopColor="rgba(15,23,42,0.72)" />
      </linearGradient>
      <linearGradient id="twin-shoulder-highlight" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
        <stop offset="18%" stopColor="rgba(255,255,255,0.18)" />
        <stop offset="64%" stopColor="rgba(255,255,255,0.12)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
      </linearGradient>
      <linearGradient id="twin-soft-reflection" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0)" />
        <stop offset="22%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="75%" stopColor="rgba(255,255,255,0.05)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </linearGradient>
      <linearGradient id="twin-glass-grad" x1="0" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="rgba(125,211,252,0.22)" />
        <stop offset="55%" stopColor="rgba(56,189,248,0.12)" />
        <stop offset="100%" stopColor="rgba(15,23,42,0.28)" />
      </linearGradient>
      <linearGradient id="twin-headlight-lens" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
        <stop offset="55%" stopColor="rgba(147,197,253,0.18)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
      </linearGradient>
      <radialGradient id="twin-rim-grad" cx="45%" cy="40%" r="65%">
        <stop offset="0%" stopColor="rgba(71,85,105,0.62)" />
        <stop offset="50%" stopColor="rgba(15,23,42,0.9)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.96)" />
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
  locked,
  sentryMode,
  headlights,
  hazards,
  turnSignal,
  driverSeatOccupied,
  size = 'md',
  interactive = false,
  className,
}: VehicleTwinProps) {
  const width = SIZE_MAP[size];
  const height = Math.round(width * ASPECT_RATIO);

  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      role="img"
      aria-label="Vehicle digital twin showing current physical state"
    >
      <svg
        viewBox={`0 ${VIEWBOX_MIN_Y} ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        className="select-none"
      >
        <SvgDefs />
        <title>Tesla-inspired performance crossover side view digital twin</title>
        <desc>Original scalable layered SVG vehicle illustration with dynamic telemetry overlays for doors, windows, lights, lock, sentry mode, and charging status.</desc>
        <GroundShadow />
        {isCharging && <ChargingUnderglow />}
        <g id="body">
          <BodyShell frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} />
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
          <HeadlightGlows on={headlights} hazards={hazards} turnSignal={turnSignal} />
          <TaillightGlows hazards={hazards} turnSignal={turnSignal} />
        </g>
        <g id="wheels">
          <WheelSVG cx={151} cy={226} />
          <WheelSVG cx={402} cy={226} />
        </g>
        <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
      </svg>
    </div>
  );
}
