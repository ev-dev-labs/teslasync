import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';

const SIZE_MAP = { sm: 300, md: 440, lg: 560 } as const;
const VIEWBOX_WIDTH = 560;
const VIEWBOX_HEIGHT = 280;
const ASPECT_RATIO = VIEWBOX_HEIGHT / VIEWBOX_WIDTH;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  className?: string;
}

const C = {
  bodyStroke: 'rgba(255,255,255,0.14)',
  bodyHighlight: 'rgba(255,255,255,0.18)',
  glassClosed: 'rgba(100,200,255,0.12)',
  glassStroke: 'rgba(100,200,255,0.24)',
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
  shadow: 'rgba(0,0,0,0.42)',
  wheelDark: 'rgba(2,6,23,0.92)',
  wheelSidewall: 'rgba(15,23,42,0.92)',
  wheelStroke: 'rgba(255,255,255,0.16)',
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

function WheelSVG({ cx, cy }: { cx: number; cy: number }) {
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <g>
      <circle cx={cx} cy={cy} r={38} fill={C.wheelDark} stroke={C.wheelStroke} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={29} fill={C.wheelSidewall} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={19} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2} />
      {spokes.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x2 = cx + Math.cos(rad) * 17;
        const y2 = cy + Math.sin(rad) * 17;

        return (
          <line
            key={angle}
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={5} fill="rgba(255,255,255,0.25)" />
      <circle cx={cx} cy={cy} r={40} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={5} />
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
        d="M 68 196 C 77 173 101 158 139 153 L 187 146 C 216 114 255 99 307 99 C 367 99 413 117 449 146 L 501 155 C 529 160 546 176 552 196 L 548 211 C 536 222 515 226 477 227 L 454 227 C 450 201 429 182 402 182 C 374 182 351 202 347 228 L 205 228 C 201 202 179 182 151 182 C 123 182 101 202 97 227 L 82 226 C 68 224 61 212 68 196 Z"
        fill="url(#twin-body-grad)"
        stroke={C.bodyStroke}
        strokeWidth={1.4}
      />
      <path
        d="M 91 190 C 150 181 226 178 307 180 C 400 182 481 187 543 198"
        fill="none"
        stroke={C.bodyHighlight}
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M 121 219 C 170 231 245 235 334 232 C 416 229 491 221 540 209"
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />

      <path
        d="M 207 145 C 238 128 280 120 324 123 C 369 126 407 136 437 148"
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1}
        strokeLinecap="round"
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
        d="M 439 147 C 471 149 512 159 545 180"
        fill="none"
        stroke={frunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={frunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {frunkOpen && (
          <motion.path
            d="M 442 146 C 478 120 523 132 553 166 L 543 178 C 513 160 478 153 442 153 Z"
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
        d="M 186 146 C 157 143 122 148 86 165"
        fill="none"
        stroke={trunkOpen ? C.doorOpen : 'rgba(255,255,255,0.08)'}
        strokeWidth={trunkOpen ? 1.8 : 1}
        strokeLinecap="round"
      />
      <AnimatePresence>
        {trunkOpen && (
          <motion.path
            d="M 187 146 C 154 117 113 124 83 154 L 96 164 C 124 146 158 142 187 154 Z"
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
        x={430}
        y={128}
        width={120}
        height={55}
        label={`Frunk: ${stateLabel(frunkOpen, 'Open', 'Closed')}`}
        side="right"
      />
      <InteractiveHotspot
        enabled={interactive}
        x={80}
        y={128}
        width={118}
        height={50}
        label={`Trunk: ${stateLabel(trunkOpen, 'Open', 'Closed')}`}
        side="left"
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
        d="M 194 145 C 217 119 252 106 299 104 L 294 149 L 204 150 Z"
        fill={windowFill(wRD)}
        stroke={windowStroke(wRD)}
        strokeWidth={1}
      />
      <path
        d="M 309 104 C 363 105 399 122 431 145 L 411 150 L 305 149 Z"
        fill={windowFill(wFD)}
        stroke={windowStroke(wFD)}
        strokeWidth={1}
      />
      <path
        d="M 299 105 L 305 149"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M 204 150 L 411 150"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
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
        x={301}
        y={101}
        width={134}
        height={55}
        label={`Front driver window: ${windowLabel(wFD)}`}
      />
      <InteractiveHotspot
        enabled={interactive}
        x={190}
        y={101}
        width={112}
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
    ? { x1: 313, y1: 151, x2: 306, y2: 222, handleX: 355, handleY: 173 }
    : { x1: 222, y1: 151, x2: 218, y2: 222, handleX: 258, handleY: 173 };
  const doorPath = isFront
    ? 'M 313 153 L 386 140 L 395 216 L 307 224 Z'
    : 'M 222 153 L 155 140 L 146 216 L 218 224 Z';
  const hotspot = isFront
    ? { x: 302, y: 150, width: 104, height: 76, side: 'right' as const }
    : { x: 145, y: 150, width: 86, height: 76, side: 'left' as const };

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
          d="M 312 154 L 384 130"
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
          d="M 222 154 L 156 130"
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
  const flashing = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      <path
        d="M 521 180 C 532 177 542 181 548 188"
        fill="none"
        stroke={on ? C.headlightOn : C.headlightOff}
        strokeWidth={3}
        strokeLinecap="round"
      />
      {on && (
        <>
          <ellipse cx={536} cy={184} rx={16} ry={7} fill={C.headlightGlow} filter="url(#twin-glow)" />
          <path d="M 544 184 L 560 168 L 560 205 Z" fill={C.headlightBeam} />
        </>
      )}
      {flashing && (
        <motion.ellipse
          cx={514}
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
  const flashing = hazards === true || turnSignal === 'left' || turnSignal === 'both';

  return (
    <g>
      <path
        d="M 74 184 C 82 178 91 178 99 184"
        fill="none"
        stroke={flashing ? C.amber : C.taillightBase}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d="M 78 193 C 86 196 95 196 104 194"
        fill="none"
        stroke={C.taillightActive}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.65}
      />
      {flashing && (
        <motion.path
          d="M 74 184 C 82 178 91 178 99 184"
          fill="none"
          stroke={C.amber}
          strokeWidth={4}
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
  const cx = 132;
  const cy = 165;
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
            r={10}
            fill="none"
            stroke={C.chargeGreen}
            strokeWidth={1}
            animate={{ opacity: [0.75, 0, 0.75], r: [8, 18, 8] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <path
            d="M 132 158 L 126 167 L 132 167 L 129 174 L 139 163 L 133 163 Z"
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
        side="left"
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
  const cy = 84;

  return (
    <g>
      {sentryMode && (
        <motion.ellipse
          cx={cx}
          cy={cy - 24}
          rx={18}
          ry={9}
          fill="none"
          stroke={C.sentryGlow}
          strokeWidth={1.4}
          animate={{ opacity: [0.7, 0.2, 0.7], rx: [14, 24, 14] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
      {sentryMode && (
        <foreignObject x={cx - iconSize / 2} y={cy - 34} width={iconSize} height={iconSize}>
          <Tooltip content="Sentry mode active" side="top">
            <motion.span
              className="flex items-center justify-center w-full h-full"
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
              <span className="flex items-center justify-center w-full h-full">
                {locked
                  ? <Lock className="w-4 h-4" fill={C.lockedGreen} stroke={C.lockedGreen} />
                  : <Unlock className="w-4 h-4" fill={C.unlockedRed} stroke={C.unlockedRed} />
                }
              </span>
            </Tooltip>
          ) : (
            <span className="flex items-center justify-center w-full h-full">
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
    <ellipse cx={336} cy={137} rx={9} ry={12} fill={C.seatOccupied} stroke="rgba(34,211,238,0.35)" />
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
        <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
        <stop offset="42%" stopColor="rgba(255,255,255,0.07)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.025)" />
      </linearGradient>
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
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        className="select-none"
      >
        <SvgDefs />
        <GroundShadow />
        <BodyShell frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} />
        <SideWindows
          windowFD={windowFD}
          windowFP={windowFP}
          windowRD={windowRD}
          windowRP={windowRP}
          interactive={interactive}
        />
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
        <DriverSeatIndicator occupied={driverSeatOccupied} />
        <ChargePortIndicator
          open={chargePortOpen}
          charging={isCharging}
          interactive={interactive}
        />
        <HeadlightGlows on={headlights} hazards={hazards} turnSignal={turnSignal} />
        <TaillightGlows hazards={hazards} turnSignal={turnSignal} />
        <WheelSVG cx={151} cy={226} />
        <WheelSVG cx={402} cy={226} />
        <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
      </svg>
    </div>
  );
}
