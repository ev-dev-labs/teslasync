import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';
import type { VehicleTwinState, WindowState, TurnSignalState } from '@/lib/vehicleState';

// ── Size presets ────────────────────────────────────────────────────────

const SIZE_MAP = { sm: 240, md: 380, lg: 500 } as const;

export type VehicleTwinSize = keyof typeof SIZE_MAP;

export interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  className?: string;
}

// ── Color constants (Tailwind-compatible rgba, no CSS vars) ────────────

const C = {
  bodyTop: 'rgba(255,255,255,0.07)',
  bodySide: 'rgba(255,255,255,0.04)',
  bodyRear: 'rgba(255,255,255,0.03)',
  bodyStroke: 'rgba(255,255,255,0.12)',
  bodyHighlight: 'rgba(255,255,255,0.10)',
  glassClosed: 'rgba(100,200,255,0.08)',
  glassStroke: 'rgba(100,200,255,0.15)',
  glassOpen: 'rgba(0,0,0,0.3)',
  glassPartial: 'rgba(100,200,255,0.04)',
  glassUnknown: 'rgba(255,255,255,0.03)',
  doorClosed: 'rgba(255,255,255,0.08)',
  doorOpen: 'rgba(251,191,36,0.55)',
  doorUnknown: 'rgba(255,255,255,0.06)',
  headlightOff: 'rgba(255,255,255,0.08)',
  headlightOn: 'rgba(255,255,200,0.85)',
  headlightBeam: 'rgba(255,255,200,0.05)',
  headlightGlow: 'rgba(34,211,238,0.35)',
  taillightBase: 'rgba(239,68,68,0.3)',
  taillightActive: 'rgba(239,68,68,0.8)',
  amber: 'rgba(251,191,36,0.7)',
  amberFill: 'rgba(251,191,36,0.2)',
  chargeGreen: 'rgba(34,197,94,0.7)',
  chargeGreenFill: 'rgba(34,197,94,0.3)',
  lockedGreen: 'rgba(34,197,94,0.8)',
  unlockedRed: 'rgba(239,68,68,0.8)',
  sentryRed: 'rgba(239,68,68,0.7)',
  sentryGlow: 'rgba(239,68,68,0.3)',
  seatOccupied: 'rgba(34,211,238,0.25)',
  frunkTrunkOpen: 'rgba(251,191,36,0.25)',
  neutral: 'rgba(255,255,255,0.04)',
  shadow: 'rgba(0,0,0,0.35)',
  wheelDark: 'rgba(255,255,255,0.06)',
  wheelStroke: 'rgba(255,255,255,0.12)',
  tirePressureOk: 'rgba(34,197,94,0.6)',
  tirePressureLow: 'rgba(251,191,36,0.6)',
  tirePressureCritical: 'rgba(239,68,68,0.6)',
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────

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
    case 'open': return 'rgba(245,158,11,0.5)';
    case 'partial': return 'rgba(245,158,11,0.3)';
    case 'closed': return C.glassStroke;
    default: return 'rgba(255,255,255,0.06)';
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
  return open ? C.amber : C.doorClosed;
}

// ── SVG Sub-components (isometric 3/4 view) ────────────────────────────

function GroundShadow() {
  return (
    <ellipse
      cx={200}
      cy={330}
      rx={160}
      ry={18}
      fill={C.shadow}
      filter="url(#twin-shadow-blur)"
    />
  );
}

function WheelSVG({ cx, cy, visible }: { cx: number; cy: number; visible: 'full' | 'partial' }) {
  const rOuter = visible === 'full' ? 18 : 16;
  const rInner = visible === 'full' ? 10 : 9;
  return (
    <g>
      {/* Tire */}
      <ellipse cx={cx} cy={cy} rx={rOuter} ry={rOuter * 0.55}
        fill={C.wheelDark} stroke={C.wheelStroke} strokeWidth={1.2} />
      {/* Rim */}
      <ellipse cx={cx} cy={cy} rx={rInner} ry={rInner * 0.55}
        fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" strokeWidth={0.8} />
      {/* Spoke lines */}
      {[0, 60, 120].map(angle => {
        const rad = (angle * Math.PI) / 180;
        const dx = Math.cos(rad) * rInner * 0.8;
        const dy = Math.sin(rad) * rInner * 0.4;
        return (
          <line key={angle}
            x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy}
            stroke="rgba(255,255,255,0.06)" strokeWidth={0.6} />
        );
      })}
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
      {/* ── Left side panel (main visible side) ── */}
      <path
        d="M 62,175 L 62,305 Q 62,315 72,318 L 310,318 Q 322,318 325,305 L 338,175 Z"
        fill="url(#bodyGradSide)"
        stroke={C.bodyStroke}
        strokeWidth={1}
      />

      {/* Side panel body line / belt line */}
      <line x1={65} y1={192} x2={336} y2={192}
        stroke={C.bodyHighlight} strokeWidth={0.5} />

      {/* ── Roof (top face with perspective) ── */}
      <path
        d="M 100,68 L 78,155 L 310,155 L 332,68 Z"
        fill="url(#bodyGradRoof)"
        stroke={C.bodyStroke}
        strokeWidth={1}
      />

      {/* Roof centerline (subtle detail) */}
      <line x1={190} y1={72} x2={194} y2={152}
        stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />

      {/* ── Hood / Frunk (front top face) ── */}
      <path
        d="M 62,155 L 78,155 L 100,68 L 72,82 Q 60,92 58,120 Z"
        fill={frunkOpen ? C.frunkTrunkOpen : 'url(#bodyGradHood)'}
        stroke={frunkOpen ? C.amber : C.bodyStroke}
        strokeWidth={frunkOpen ? 1.5 : 1}
      />
      <AnimatePresence>
        {frunkOpen && (
          <motion.path
            d="M 72,82 Q 60,60 68,40 L 100,30 L 100,68 Z"
            fill={C.frunkTrunkOpen}
            stroke={C.amber}
            strokeWidth={1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>
      {interactive && (
        <foreignObject x={58} y={60} width={50} height={100}>
          <Tooltip content={`Frunk: ${frunkOpen === null ? 'Unknown' : frunkOpen ? 'Open' : 'Closed'}`} side="left">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}

      {/* ── Rear face (back of car visible in 3/4) ── */}
      <path
        d="M 325,155 L 338,175 L 338,305 Q 338,315 332,318 L 310,318 Q 322,318 325,305 L 332,175 Z"
        fill={C.bodyRear}
        stroke={C.bodyStroke}
        strokeWidth={0.8}
      />

      {/* ── Trunk/Liftgate rear section ── */}
      <path
        d="M 310,155 L 332,68 L 340,82 Q 342,110 340,140 L 338,175 L 325,155 Z"
        fill={trunkOpen ? C.frunkTrunkOpen : C.bodyRear}
        stroke={trunkOpen ? C.amber : C.bodyStroke}
        strokeWidth={trunkOpen ? 1.5 : 0.8}
      />
      <AnimatePresence>
        {trunkOpen && (
          <motion.path
            d="M 332,68 L 340,82 L 355,70 L 345,50 Z"
            fill={C.frunkTrunkOpen}
            stroke={C.amber}
            strokeWidth={1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>
      {interactive && (
        <foreignObject x={310} y={60} width={50} height={100}>
          <Tooltip content={`Trunk: ${trunkOpen === null ? 'Unknown' : trunkOpen ? 'Open' : 'Closed'}`} side="right">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}
    </g>
  );
}

function Windshield() {
  return (
    <path
      d="M 82,160 L 100,74 L 328,74 L 334,160 Z"
      fill={C.glassClosed}
      stroke={C.glassStroke}
      strokeWidth={0.8}
    />
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
  // Windows visible on the left (driver) side in isometric view
  const driverFrontPath = "M 68,172 L 80,162 L 80,228 L 68,232 Z";
  const driverRearPath = "M 68,238 L 80,234 L 80,295 L 68,300 Z";

  // Partial windows visible on the right (passenger) side at rear
  const passengerRearPath = "M 330,234 L 336,238 L 336,295 L 330,295 Z";

  return (
    <g>
      {/* Driver front window */}
      <motion.path
        d={driverFrontPath}
        fill={windowFill(wFD)}
        stroke={windowStroke(wFD)}
        strokeWidth={0.8}
        animate={{ opacity: wFD === 'open' ? 0.3 : 1 }}
        transition={{ duration: 0.4 }}
      />
      {interactive && (
        <foreignObject x={60} y={160} width={30} height={75}>
          <Tooltip content={`Front driver window: ${windowLabel(wFD)}`} side="left">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}

      {/* Driver rear window */}
      <motion.path
        d={driverRearPath}
        fill={windowFill(wRD)}
        stroke={windowStroke(wRD)}
        strokeWidth={0.8}
        animate={{ opacity: wRD === 'open' ? 0.3 : 1 }}
        transition={{ duration: 0.4 }}
      />
      {interactive && (
        <foreignObject x={60} y={232} width={30} height={70}>
          <Tooltip content={`Rear driver window: ${windowLabel(wRD)}`} side="left">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}

      {/* Passenger rear window (partially visible) */}
      <motion.path
        d={passengerRearPath}
        fill={windowFill(wRP)}
        stroke={windowStroke(wRP)}
        strokeWidth={0.6}
        animate={{ opacity: wRP === 'open' ? 0.3 : 1 }}
        transition={{ duration: 0.4 }}
      />

      {/* Passenger front (mostly hidden, just a sliver on the roof edge) */}
      <path
        d="M 330,172 L 336,175 L 336,230 L 330,228 Z"
        fill={windowFill(wFP)}
        stroke={windowStroke(wFP)}
        strokeWidth={0.5}
        opacity={0.5}
      />

      {/* B-pillar divider on driver side */}
      <line x1={68} y1={233} x2={80} y2={230}
        stroke={C.bodyStroke} strokeWidth={1.8} />

      {/* B-pillar divider on passenger side */}
      <line x1={330} y1={233} x2={336} y2={233}
        stroke={C.bodyStroke} strokeWidth={1.2} />
    </g>
  );
}

function DoorOverlay({
  y1,
  y2,
  open,
  label,
  interactive,
}: {
  y1: number;
  y2: number;
  open: boolean | null;
  label: string;
  interactive?: boolean;
}) {
  const x = 65;
  const stroke = doorStroke(open);

  return (
    <g>
      {/* Door seam on left side */}
      <line x1={x} y1={y1} x2={x} y2={y2}
        stroke={stroke}
        strokeWidth={open ? 2 : 1}
        strokeDasharray={open ? undefined : '3,3'} />

      {/* Door handle */}
      <rect x={x + 4} y={(y1 + y2) / 2 - 2} width={10} height={4} rx={2}
        fill={open ? C.amber : 'rgba(255,255,255,0.08)'} />

      {/* Door swung open (outward from left side) */}
      <AnimatePresence>
        {open && (
          <motion.path
            d={`M ${x},${y1 + 5} L ${x - 28},${y1 + 15} L ${x - 28},${y2 - 15} L ${x},${y2 - 5} Z`}
            fill={C.amberFill}
            stroke={C.amber}
            strokeWidth={1.2}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {interactive && (
        <foreignObject x={x - 30} y={y1} width={40} height={y2 - y1}>
          <Tooltip content={`${label}: ${open === null ? 'Unknown' : open ? 'Open' : 'Closed'}`} side="left">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}

      <title>{label}: {open === null ? 'Unknown' : open ? 'Open' : 'Closed'}</title>
    </g>
  );
}

function PassengerDoorSeams({
  passengerFront,
  passengerRear,
}: {
  passengerFront: boolean | null;
  passengerRear: boolean | null;
}) {
  // Only subtle seam lines visible on the far side
  return (
    <g opacity={0.5}>
      <line x1={333} y1={172} x2={333} y2={230}
        stroke={doorStroke(passengerFront)}
        strokeWidth={passengerFront ? 1.5 : 0.6}
        strokeDasharray={passengerFront ? undefined : '2,2'} />
      <line x1={333} y1={238} x2={333} y2={298}
        stroke={doorStroke(passengerRear)}
        strokeWidth={passengerRear ? 1.5 : 0.6}
        strokeDasharray={passengerRear ? undefined : '2,2'} />
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
  const leftAmber = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const rightAmber = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      {/* Left headlight (front-left, fully visible) */}
      <ellipse cx={66} cy={158} rx={8} ry={5}
        fill={on ? C.headlightOn : C.headlightOff} />
      {on && (
        <>
          <ellipse cx={66} cy={158} rx={12} ry={7}
            fill={C.headlightGlow} filter="url(#twin-glow)" />
          {/* Light beam cone */}
          <path d="M 66,158 L 30,140 L 30,176 Z"
            fill={C.headlightBeam} />
        </>
      )}

      {/* Right headlight (front-right, partially visible) */}
      <ellipse cx={332} cy={158} rx={6} ry={4}
        fill={on ? C.headlightOn : C.headlightOff} opacity={0.7} />
      {on && (
        <ellipse cx={332} cy={158} rx={9} ry={5}
          fill={C.headlightGlow} filter="url(#twin-glow)" opacity={0.5} />
      )}

      {/* Turn signal indicators (front corners) */}
      {leftAmber && (
        <motion.ellipse
          cx={60} cy={168} rx={5} ry={3}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
      {rightAmber && (
        <motion.ellipse
          cx={336} cy={168} rx={4} ry={2.5}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          opacity={0.6}
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
  const leftFlash = hazards === true || turnSignal === 'left' || turnSignal === 'both';
  const rightFlash = hazards === true || turnSignal === 'right' || turnSignal === 'both';

  return (
    <g>
      {/* Left taillight (visible at rear-left) */}
      <rect x={306} y={300} width={4} height={14} rx={2} fill={C.taillightBase} />
      {leftFlash && (
        <motion.rect
          x={306} y={300} width={4} height={14} rx={2}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}

      {/* Right taillight (on rear face) */}
      <rect x={334} y={298} width={3} height={12} rx={1.5} fill={C.taillightBase} />
      {rightFlash && (
        <motion.rect
          x={334} y={298} width={3} height={12} rx={1.5}
          fill={C.amber}
          animate={{ opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}

      {/* Rear light bar connecting taillights (Tesla signature) */}
      <line x1={309} y1={307} x2={334} y2={304}
        stroke={C.taillightBase} strokeWidth={1.2} />
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
  const cx = 295;
  const cy = 290;
  const fill = charging ? C.chargeGreenFill : open ? C.chargeGreenFill : C.neutral;
  const stroke = charging ? C.chargeGreen : open ? C.chargeGreen : C.bodyStroke;
  const label = charging ? 'Charging' : open ? 'Open' : open === false ? 'Closed' : 'Unknown';

  return (
    <g>
      <circle cx={cx} cy={cy} r={5}
        fill={fill} stroke={stroke} strokeWidth={1.2} />

      {/* Charging pulse rings */}
      {charging && (
        <>
          <motion.circle
            cx={cx} cy={cy} r={8}
            fill="none" stroke={C.chargeGreen} strokeWidth={1}
            animate={{ opacity: [0.8, 0, 0.8], r: [6, 14, 6] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* Lightning bolt */}
          <text x={cx - 3} y={cy + 3} fontSize="7" fill={C.chargeGreen}>⚡</text>
        </>
      )}

      {/* Open indicator ring */}
      {open && !charging && (
        <circle cx={cx} cy={cy} r={8}
          fill="none" stroke={C.chargeGreen} strokeWidth={0.8} />
      )}

      {interactive && (
        <foreignObject x={cx - 10} y={cy - 10} width={20} height={20}>
          <Tooltip content={`Charge port: ${label}`} side="right">
            <span className="block w-full h-full" />
          </Tooltip>
        </foreignObject>
      )}
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
  const iconSize = 16;
  // Position on the center of the roof
  const cx = 194;
  const cy = 110;

  return (
    <g>
      {/* Lock indicator (center of roof) */}
      {locked !== null && (
        <foreignObject
          x={cx - iconSize / 2}
          y={cy - iconSize / 2}
          width={iconSize}
          height={iconSize}
        >
          {interactive ? (
            <Tooltip content={locked ? 'Locked' : 'Unlocked'} side="top">
              <span className="flex items-center justify-center w-full h-full">
                {locked
                  ? <Lock className="w-3.5 h-3.5" fill={C.lockedGreen} stroke={C.lockedGreen} />
                  : <Unlock className="w-3.5 h-3.5" fill={C.unlockedRed} stroke={C.unlockedRed} />
                }
              </span>
            </Tooltip>
          ) : (
            <span className="flex items-center justify-center w-full h-full">
              {locked
                ? <Lock className="w-3.5 h-3.5" fill={C.lockedGreen} stroke={C.lockedGreen} />
                : <Unlock className="w-3.5 h-3.5" fill={C.unlockedRed} stroke={C.unlockedRed} />
              }
            </span>
          )}
        </foreignObject>
      )}

      {/* Sentry mode indicator (front of roof) */}
      {sentryMode && (
        <foreignObject x={cx - iconSize / 2} y={cy - 28} width={iconSize} height={iconSize}>
          <motion.span
            className="flex items-center justify-center w-full h-full"
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Shield className="w-3.5 h-3.5" fill={C.sentryRed} stroke={C.sentryRed} />
          </motion.span>
        </foreignObject>
      )}

      {/* Sentry mode glow ring on roof */}
      {sentryMode && (
        <motion.ellipse
          cx={cx} cy={cy - 20}
          rx={12} ry={6}
          fill="none"
          stroke={C.sentryGlow}
          strokeWidth={1}
          animate={{ opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </g>
  );
}

function DriverSeatIndicator({ occupied }: { occupied: boolean | null }) {
  if (!occupied) return null;
  // Positioned in the driver seat area on the left side
  return (
    <ellipse cx={120} cy={200} rx={6} ry={8}
      fill={C.seatOccupied} opacity={0.8} />
  );
}

// ── SVG Definitions (gradients, filters) ───────────────────────────────

function SvgDefs() {
  return (
    <defs>
      {/* Shadow blur */}
      <filter id="twin-shadow-blur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="8" />
      </filter>

      {/* Glow filter for active elements */}
      <filter id="twin-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Body side gradient — top lighter, bottom darker */}
      <linearGradient id="bodyGradSide" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
        <stop offset="60%" stopColor="rgba(255,255,255,0.04)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.05)" />
      </linearGradient>

      {/* Roof gradient — center lighter, edges darker */}
      <linearGradient id="bodyGradRoof" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
        <stop offset="50%" stopColor="rgba(255,255,255,0.07)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
      </linearGradient>

      {/* Hood gradient */}
      <linearGradient id="bodyGradHood" x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.09)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.05)" />
      </linearGradient>
    </defs>
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
  const aspect = 350 / 400;
  const height = useMemo(() => Math.round(width * aspect), [width, aspect]);

  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      role="img"
      aria-label="Vehicle digital twin showing current physical state"
    >
      <svg
        viewBox="0 0 400 350"
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        className="select-none"
      >
        <SvgDefs />

        {/* 1. Ground shadow */}
        <GroundShadow />

        {/* 2. Rear wheels (behind body) */}
        <WheelSVG cx={290} cy={318} visible="partial" />
        <WheelSVG cx={98} cy={318} visible="full" />

        {/* 3. Front wheels */}
        <WheelSVG cx={290} cy={178} visible="partial" />
        <WheelSVG cx={98} cy={178} visible="full" />

        {/* 4. Body shell (side, roof, hood, rear) */}
        <BodyShell frunkOpen={frunkOpen} trunkOpen={trunkOpen} interactive={interactive} />

        {/* 5. Windshield */}
        <Windshield />

        {/* 6. Side windows */}
        <SideWindows
          windowFD={windowFD}
          windowFP={windowFP}
          windowRD={windowRD}
          windowRP={windowRP}
          interactive={interactive}
        />

        {/* 7. Door overlays (driver side visible) */}
        <DoorOverlay
          y1={170}
          y2={230}
          open={doors.driverFront}
          label="Driver Front"
          interactive={interactive}
        />
        <DoorOverlay
          y1={237}
          y2={300}
          open={doors.driverRear}
          label="Driver Rear"
          interactive={interactive}
        />

        {/* 8. Passenger door seams (far side, subtle) */}
        <PassengerDoorSeams
          passengerFront={doors.passengerFront}
          passengerRear={doors.passengerRear}
        />

        {/* 9. Driver seat occupancy */}
        <DriverSeatIndicator occupied={driverSeatOccupied} />

        {/* 10. Headlights with beams */}
        <HeadlightGlows on={headlights} hazards={hazards} turnSignal={turnSignal} />

        {/* 11. Taillights */}
        <TaillightGlows hazards={hazards} turnSignal={turnSignal} />

        {/* 12. Charge port (left rear quarter) */}
        <ChargePortIndicator
          open={chargePortOpen}
          charging={isCharging}
          interactive={interactive}
        />

        {/* 13. Security overlay (lock + sentry) */}
        <SecurityOverlay locked={locked} sentryMode={sentryMode} interactive={interactive} />
      </svg>
    </div>
  );
}
