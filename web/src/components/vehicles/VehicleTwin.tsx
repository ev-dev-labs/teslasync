import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';

// ── Size presets ────────────────────────────────────────────────────────

const SIZE_MAP = { sm: 180, md: 300, lg: 420 } as const;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  className?: string;
}

// ── Color constants (Tailwind-compatible rgba, no CSS vars) ────────────

const C = {
  body: 'rgba(255,255,255,0.06)',
  bodyStroke: 'rgba(255,255,255,0.15)',
  cabin: 'rgba(255,255,255,0.03)',
  cabinStroke: 'rgba(255,255,255,0.10)',
  windowClosed: 'rgba(255,255,255,0.08)',
  windowOpen: 'rgba(255,255,255,0.01)',
  windowPartial: 'rgba(255,255,255,0.04)',
  windowUnknown: 'rgba(255,255,255,0.05)',
  doorClosed: 'rgba(255,255,255,0.12)',
  doorOpen: 'rgba(251,191,36,0.55)',
  doorUnknown: 'rgba(255,255,255,0.08)',
  headlightOff: 'rgba(255,255,255,0.08)',
  headlightOn: 'rgba(255,255,255,0.85)',
  headlightGlow: 'rgba(34,211,238,0.4)',
  taillightBase: 'rgba(239,68,68,0.25)',
  taillightActive: 'rgba(239,68,68,0.8)',
  amber: 'rgba(251,191,36,0.7)',
  amberGlow: 'rgba(251,191,36,0.35)',
  chargeGreen: 'rgba(34,197,94,0.7)',
  chargeGreenGlow: 'rgba(34,197,94,0.35)',
  lockedGreen: 'rgba(34,197,94,0.8)',
  unlockedRed: 'rgba(239,68,68,0.8)',
  sentryRed: 'rgba(239,68,68,0.7)',
  sentryGlow: 'rgba(239,68,68,0.3)',
  seatOccupied: 'rgba(34,211,238,0.25)',
  frunkTrunkOpen: 'rgba(251,191,36,0.3)',
  neutral: 'rgba(255,255,255,0.06)',
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────

function windowFill(state: WindowState): string {
  switch (state) {
    case 'closed': return C.windowClosed;
    case 'open': return C.windowOpen;
    case 'partial': return C.windowPartial;
    default: return C.windowUnknown;
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

function doorFill(open: boolean | null): string {
  if (open === null) return C.doorUnknown;
  return open ? C.doorOpen : C.doorClosed;
}

// ── SVG Sub-renderers ──────────────────────────────────────────────────

function BodyOutline() {
  return (
    <path
      d={`
        M 100 12
        C 130 8, 155 18, 160 42
        L 163 72
        L 165 130
        L 165 250
        L 163 308
        L 160 338
        C 155 362, 130 372, 100 372
        C 70 372, 45 362, 40 338
        L 37 308
        L 35 250
        L 35 130
        L 37 72
        L 40 42
        C 45 18, 70 8, 100 12
        Z
      `}
      fill={C.body}
      stroke={C.bodyStroke}
      strokeWidth={1.5}
    />
  );
}

function CabinArea() {
  return (
    <rect
      x={54}
      y={82}
      width={92}
      height={210}
      rx={10}
      fill={C.cabin}
      stroke={C.cabinStroke}
      strokeWidth={0.8}
    />
  );
}

function BPillar() {
  return (
    <line
      x1={54}
      y1={186}
      x2={146}
      y2={186}
      stroke={C.cabinStroke}
      strokeWidth={1.2}
    />
  );
}

function WindowRect({
  x, y, w, h, state, label, interactive,
}: {
  x: number; y: number; w: number; h: number;
  state: WindowState; label: string; interactive?: boolean;
}) {
  const fill = windowFill(state);
  const partialH = state === 'partial' ? h / 2 : h;
  const partialY = state === 'partial' ? y + h / 2 : y;

  const rect = (
    <motion.rect
      x={x}
      y={partialY}
      width={w}
      height={partialH}
      rx={3}
      fill={fill}
      animate={{ opacity: state === 'open' ? 0.3 : 1 }}
      transition={{ duration: 0.4 }}
    />
  );

  if (!interactive) return rect;
  return (
    <foreignObject x={x - 4} y={y - 4} width={w + 8} height={h + 8}>
      <Tooltip content={`${label}: ${windowLabel(state)}`} side="right">
        <span className="block w-full h-full" />
      </Tooltip>
    </foreignObject>
  );
}

function DoorIndicator({
  side, position, open, interactive,
}: {
  side: 'left' | 'right';
  position: 'front' | 'rear';
  open: boolean | null;
  interactive?: boolean;
}) {
  const x = side === 'left' ? 35 : 165;
  const y1 = position === 'front' ? 78 : 192;
  const y2 = position === 'front' ? 182 : 300;
  const wedgeDir = side === 'left' ? -1 : 1;
  const fill = doorFill(open);
  const label = `${side === 'left' ? 'Driver' : 'Passenger'} ${position}`;

  return (
    <g>
      {/* Door seam line */}
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={y2}
        stroke={fill}
        strokeWidth={open ? 2 : 1}
      />
      {/* Open door wedge indicator */}
      <AnimatePresence>
        {open && (
          <motion.path
            d={`M ${x} ${y1} L ${x + wedgeDir * 22} ${y1 + 20} L ${x + wedgeDir * 22} ${y2 - 20} L ${x} ${y2} Z`}
            fill={C.doorOpen}
            stroke={C.amber}
            strokeWidth={0.8}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{ transformOrigin: `${x}px ${(y1 + y2) / 2}px` }}
          />
        )}
      </AnimatePresence>
      {interactive && (
        <foreignObject
          x={side === 'left' ? x - 25 : x - 5}
          y={y1}
          width={30}
          height={y2 - y1}
        >
          <Tooltip content={`${label}: ${open === null ? 'Unknown' : open ? 'Open' : 'Closed'}`} side={side === 'left' ? 'left' : 'right'}>
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}
    </g>
  );
}

function Headlights({
  on, hazards, turnSignal,
}: {
  on: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
}) {
  const leftAmber = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const rightAmber = hazards === true || turnSignal === 'right' || turnSignal === 'both';
  const fill = on ? C.headlightOn : C.headlightOff;

  return (
    <g>
      {/* Left headlight */}
      <ellipse cx={55} cy={36} rx={12} ry={7} fill={fill} />
      {on && (
        <ellipse cx={55} cy={36} rx={16} ry={10} fill={C.headlightGlow} />
      )}

      {/* Right headlight */}
      <ellipse cx={145} cy={36} rx={12} ry={7} fill={fill} />
      {on && (
        <ellipse cx={145} cy={36} rx={16} ry={10} fill={C.headlightGlow} />
      )}

      {/* Left turn indicator */}
      {leftAmber && (
        <motion.ellipse
          cx={44}
          cy={48}
          rx={6}
          ry={4}
          fill={C.amber}
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}

      {/* Right turn indicator */}
      {rightAmber && (
        <motion.ellipse
          cx={156}
          cy={48}
          rx={6}
          ry={4}
          fill={C.amber}
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
    </g>
  );
}

function Taillights({
  hazards, turnSignal,
}: {
  hazards: boolean | null;
  turnSignal: TurnSignalState;
}) {
  const leftFlash = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const rightFlash = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      {/* Left taillight */}
      <rect x={43} y={338} width={22} height={7} rx={3} fill={C.taillightBase} />
      {leftFlash && (
        <motion.rect
          x={43}
          y={338}
          width={22}
          height={7}
          rx={3}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}

      {/* Right taillight */}
      <rect x={135} y={338} width={22} height={7} rx={3} fill={C.taillightBase} />
      {rightFlash && (
        <motion.rect
          x={135}
          y={338}
          width={22}
          height={7}
          rx={3}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
    </g>
  );
}

function FrunkTrunk({
  frunkOpen, trunkOpen, interactive,
}: {
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  interactive?: boolean;
}) {
  return (
    <g>
      {/* Frunk seam line */}
      <line
        x1={58}
        y1={62}
        x2={142}
        y2={62}
        stroke={frunkOpen ? C.amber : C.doorClosed}
        strokeWidth={frunkOpen ? 1.8 : 0.8}
      />
      {/* Frunk open highlight */}
      <AnimatePresence>
        {frunkOpen && (
          <motion.rect
            x={58}
            y={28}
            width={84}
            height={34}
            rx={6}
            fill={C.frunkTrunkOpen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>
      {interactive && (
        <foreignObject x={58} y={28} width={84} height={34}>
          <Tooltip content={`Frunk: ${frunkOpen === null ? 'Unknown' : frunkOpen ? 'Open' : 'Closed'}`} side="top">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}

      {/* Trunk seam line */}
      <line
        x1={58}
        y1={318}
        x2={142}
        y2={318}
        stroke={trunkOpen ? C.amber : C.doorClosed}
        strokeWidth={trunkOpen ? 1.8 : 0.8}
      />
      {/* Trunk open highlight */}
      <AnimatePresence>
        {trunkOpen && (
          <motion.rect
            x={58}
            y={320}
            width={84}
            height={38}
            rx={6}
            fill={C.frunkTrunkOpen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>
      {interactive && (
        <foreignObject x={58} y={318} width={84} height={38}>
          <Tooltip content={`Trunk: ${trunkOpen === null ? 'Unknown' : trunkOpen ? 'Open' : 'Closed'}`} side="bottom">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}
    </g>
  );
}

function ChargePort({
  open, charging, interactive,
}: {
  open: boolean | null;
  charging: boolean;
  interactive?: boolean;
}) {
  const fill = charging
    ? C.chargeGreen
    : open
      ? C.chargeGreen
      : C.neutral;

  const label = charging ? 'Charging' : open ? 'Open' : open === false ? 'Closed' : 'Unknown';

  return (
    <g>
      <circle cx={158} cy={348} r={5} fill={fill} stroke={C.bodyStroke} strokeWidth={0.8} />
      {/* Charging pulse glow */}
      {charging && (
        <motion.circle
          cx={158}
          cy={348}
          r={9}
          fill="none"
          stroke={C.chargeGreen}
          strokeWidth={1.5}
          animate={{ opacity: [0.8, 0.1, 0.8], r: [9, 13, 9] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* Open indicator ring */}
      {open && !charging && (
        <circle cx={158} cy={348} r={8} fill="none" stroke={C.chargeGreen} strokeWidth={1} />
      )}
      {interactive && (
        <foreignObject x={148} y={338} width={20} height={20}>
          <Tooltip content={`Charge port: ${label}`} side="right">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}
    </g>
  );
}

function SecurityOverlay({
  locked, sentryMode, interactive,
}: {
  locked: boolean | null;
  sentryMode: boolean | null;
  interactive?: boolean;
}) {
  const iconSize = 14;

  return (
    <g>
      {/* Lock/unlock indicator */}
      {locked !== null && (
        <foreignObject
          x={100 - iconSize / 2}
          y={195 - iconSize / 2}
          width={iconSize}
          height={iconSize}
        >
          {interactive ? (
            <Tooltip content={locked ? 'Locked' : 'Unlocked'} side="bottom">
              <span className="flex items-center justify-center w-full h-full">
                {locked
                  ? <Lock className="w-3 h-3" fill={C.lockedGreen} stroke={C.lockedGreen} />
                  : <Unlock className="w-3 h-3" fill={C.unlockedRed} stroke={C.unlockedRed} />
                }
              </span>
            </Tooltip>
          ) : (
            <span className="flex items-center justify-center w-full h-full">
              {locked
                ? <Lock className="w-3 h-3" fill={C.lockedGreen} stroke={C.lockedGreen} />
                : <Unlock className="w-3 h-3" fill={C.unlockedRed} stroke={C.unlockedRed} />
              }
            </span>
          )}
        </foreignObject>
      )}

      {/* Sentry mode indicator */}
      {sentryMode && (
        <foreignObject x={100 - iconSize / 2} y={172 - iconSize / 2} width={iconSize} height={iconSize}>
          <motion.span
            className="flex items-center justify-center w-full h-full"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Shield className="w-3 h-3" fill={C.sentryRed} stroke={C.sentryRed} />
          </motion.span>
        </foreignObject>
      )}
    </g>
  );
}

function DriverSeat({ occupied }: { occupied: boolean | null }) {
  if (!occupied) return null;
  return (
    <ellipse cx={75} cy={135} rx={8} ry={12} fill={C.seatOccupied} />
  );
}

// ── Main Component ─────────────────────────────────────────────────────

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
  const aspect = 380 / 200;
  const height = useMemo(() => Math.round(width * aspect), [width, aspect]);

  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      role="img"
      aria-label="Vehicle digital twin showing current physical state"
    >
      <svg
        viewBox="0 0 200 380"
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        className="select-none"
      >
        {/* Glow filter for headlights */}
        <defs>
          <filter id="twin-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Body outline */}
        <BodyOutline />

        {/* 2. Frunk / Trunk areas */}
        <FrunkTrunk frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} />

        {/* 3. Cabin greenhouse */}
        <CabinArea />
        <BPillar />

        {/* 4. Driver seat */}
        <DriverSeat occupied={driverSeatOccupied} />

        {/* 5. Windows */}
        <WindowRect x={55} y={88} w={40} h={92} state={windowFD} label="Front driver window" interactive={interactive} />
        <WindowRect x={105} y={88} w={40} h={92} state={windowFP} label="Front passenger window" interactive={interactive} />
        <WindowRect x={55} y={192} w={40} h={88} state={windowRD} label="Rear driver window" interactive={interactive} />
        <WindowRect x={105} y={192} w={40} h={88} state={windowRP} label="Rear passenger window" interactive={interactive} />

        {/* 6. Door indicators */}
        <DoorIndicator side="left" position="front" open={doors.driverFront} interactive={interactive} />
        <DoorIndicator side="right" position="front" open={doors.passengerFront} interactive={interactive} />
        <DoorIndicator side="left" position="rear" open={doors.driverRear} interactive={interactive} />
        <DoorIndicator side="right" position="rear" open={doors.passengerRear} interactive={interactive} />

        {/* 7. Headlights */}
        <Headlights on={headlights} hazards={hazards} turnSignal={turnSignal} />

        {/* 8. Taillights */}
        <Taillights hazards={hazards} turnSignal={turnSignal} />

        {/* 9. Charge port */}
        <ChargePort open={chargePortOpen} charging={isCharging} interactive={interactive} />

        {/* 10. Security overlay */}
        <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
      </svg>
    </div>
  );
}
