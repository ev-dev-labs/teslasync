import { motion } from 'framer-motion'
import clsx from 'clsx'
import { useTheme } from './ThemeProvider'

export type TeslaModel = 'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck'

interface TeslaCarVizProps {
  batteryLevel: number
  isCharging: boolean
  isLocked: boolean
  isClimateOn: boolean
  sentryMode: boolean
  speed: number
  className?: string
  size?: 'sm' | 'md' | 'lg'
  model?: TeslaModel
}

/** Parse a vehicle.model string like "Model 3 P", "Model Y", "Cybertruck" into a TeslaModel key */
// eslint-disable-next-line react-refresh/only-export-components
export function parseModelKey(modelStr?: string): TeslaModel {
  if (!modelStr) return 'model3'
  const s = modelStr.toLowerCase().replace(/\s+/g, '')
  if (s.includes('cybertruck') || s.includes('ct')) return 'cybertruck'
  if (s.includes('modelx') || s.includes('mx')) return 'modelx'
  if (s.includes('modely') || s.includes('my')) return 'modely'
  if (s.includes('models') || s.includes('ms')) return 'models'
  return 'model3'
}

/* Per-model layout positions */
const WHEEL_POS: Record<TeslaModel, {
  fx: number; rx: number; wy: number
  headX: number; headY: number; tailX: number; tailY: number
  batX: number; batY: number; lockX: number; lockY: number
}> = {
  model3:     { fx: 160, rx: 430, wy: 210, headX: 92,  headY: 185, tailX: 515, tailY: 180, batX: 150, batY: 170, lockX: 295, lockY: 110 },
  models:     { fx: 150, rx: 440, wy: 210, headX: 82,  headY: 185, tailX: 525, tailY: 180, batX: 150, batY: 170, lockX: 290, lockY: 108 },
  modely:     { fx: 160, rx: 430, wy: 215, headX: 90,  headY: 182, tailX: 518, tailY: 175, batX: 150, batY: 175, lockX: 295, lockY: 105 },
  modelx:     { fx: 155, rx: 435, wy: 218, headX: 85,  headY: 180, tailX: 520, tailY: 172, batX: 150, batY: 178, lockX: 290, lockY: 100 },
  cybertruck: { fx: 150, rx: 445, wy: 215, headX: 78,  headY: 170, tailX: 528, tailY: 155, batX: 150, batY: 175, lockX: 300, lockY: 115 },
}

/** Theme-aware color palette for SVG rendering */
function useSvgPalette() {
  const { mode } = useTheme()
  const isLight = mode.colorScheme === 'light'

  return {
    isLight,
    body: {
      fill: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)',
      stroke: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)',
    },
    glass: {
      fill: isLight ? 'rgba(0,120,200,0.08)' : 'rgba(0,240,255,0.03)',
      stroke: isLight ? 'rgba(0,120,200,0.25)' : 'rgba(0,240,255,0.12)',
    },
    wind: {
      fill: isLight ? 'rgba(0,120,200,0.1)' : 'rgba(0,240,255,0.05)',
      stroke: isLight ? 'rgba(0,120,200,0.3)' : 'rgba(0,240,255,0.15)',
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
      lineSubtle: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
    },
    battery: {
      bg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
      text: isLight ? 'rgba(0,0,0,0.7)' : 'white',
    },
    shadow: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)',
    headlightOff: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)',
    falconWing: {
      main: isLight ? 'rgba(0,120,200,0.15)' : 'rgba(0,240,255,0.08)',
      tip: isLight ? 'rgba(0,120,200,0.1)' : 'rgba(0,240,255,0.06)',
    },
    speedLine: isLight ? 'rgba(0,120,200,0.3)' : 'rgba(0,240,255,0.3)',
    lock: {
      bg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.4)',
    },
    climate: isLight ? 'rgba(0,120,200,0.4)' : 'rgba(0,240,255,0.4)',
    sentry: {
      ring1: isLight ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
      ring2: isLight ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
    },
    ambient: {
      sentry: isLight
        ? 'radial-gradient(circle, rgba(239,68,68,0.2) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(239,68,68,0.4) 0%, transparent 70%)',
      charging: isLight
        ? 'radial-gradient(circle, rgba(16,185,129,0.2) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%)',
      driving: isLight
        ? 'radial-gradient(circle, rgba(0,120,200,0.15) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(0,240,255,0.3) 0%, transparent 70%)',
      idle: isLight
        ? 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 70%)'
        : 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)',
    },
    statusInactive: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)',
    statusTextInactive: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)',
    tread: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)',
    miniBody: {
      fill: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
      stroke: isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.15)',
    },
    miniWheel: {
      fill: isLight ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.5)',
      stroke: isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
    },
    miniBatBg: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
  }
}

/** Renders the model-specific body, roof, and windshield paths */
function ModelBody({ model, driving: _driving, palette }: { model: TeslaModel; driving: boolean; palette: ReturnType<typeof useSvgPalette> }) {
  const bodyFill = palette.body.fill
  const bodyStroke = palette.body.stroke
  const glassFill = palette.glass.fill
  const glassStroke = palette.glass.stroke
  const windFill = palette.wind.fill
  const windStroke = palette.wind.stroke

  const bodies: Record<TeslaModel, { body: string; roof: string; wind: string }> = {
    /* Model 3 — compact sport sedan, low roofline, smooth curves */
    model3: {
      body: 'M80 200 C80 200 85 170 110 155 L170 120 C185 112 210 95 240 88 C270 81 320 78 360 80 C400 82 430 92 450 105 L490 130 C505 140 515 155 518 170 L520 200 L520 210 L80 210 Z',
      roof: 'M175 118 C190 108 215 95 245 88 C280 81 330 80 365 83 C395 86 420 95 440 108 L430 115 C415 108 390 100 360 98 C330 96 290 96 260 100 C230 104 205 112 190 118 Z',
      wind: 'M190 118 L230 96 C250 90 280 87 310 87 L365 90 L420 110 L410 114 C390 106 360 100 330 98 C300 96 270 97 245 102 L195 118 Z',
    },
    /* Model S — longer, sleeker fastback sedan with extended rear */
    models: {
      body: 'M70 200 C70 200 75 168 100 152 L155 118 C170 110 195 93 230 86 C265 79 320 76 370 78 C415 80 445 90 465 102 L505 128 C518 138 528 152 530 168 L532 200 L532 210 L70 210 Z',
      roof: 'M160 116 C175 106 200 93 235 86 C270 79 325 78 375 81 C410 84 440 94 458 106 L448 112 C432 104 405 96 375 94 C340 92 295 92 265 96 C235 100 210 110 195 116 Z',
      wind: 'M200 116 L240 93 C260 87 285 84 315 84 L375 88 L445 108 L435 112 C415 104 385 96 355 94 C325 92 295 93 270 98 L205 116 Z',
    },
    /* Model Y — raised crossover, taller greenhouse, slight curvature */
    modely: {
      body: 'M82 205 C82 205 87 172 112 155 L168 115 C183 106 208 88 238 80 C268 73 318 70 358 72 C398 74 428 84 448 98 L488 125 C503 135 513 150 516 165 L518 205 L518 215 L82 215 Z',
      roof: 'M172 113 C188 102 213 88 243 80 C278 73 328 72 363 75 C393 78 418 88 438 100 L428 107 C413 100 388 92 358 90 C328 88 288 88 258 92 C228 96 203 106 190 113 Z',
      wind: 'M192 113 L232 88 C252 82 278 78 308 78 L363 82 L425 103 L415 108 C396 100 368 92 340 90 C310 88 282 89 258 94 L198 113 Z',
    },
    /* Model X — tall SUV, falcon-wing doors, commanding height */
    modelx: {
      body: 'M78 210 C78 210 82 175 106 155 L160 110 C175 100 200 80 232 72 C264 65 315 62 358 64 C400 66 432 78 452 92 L492 118 C508 128 518 145 520 160 L522 210 L522 220 L78 220 Z',
      roof: 'M165 108 C182 96 208 80 240 72 C275 65 325 64 365 67 C400 70 428 82 448 96 L438 103 C422 94 396 84 365 82 C330 80 288 80 258 84 C228 88 206 98 194 108 Z',
      wind: 'M196 108 L236 82 C256 75 282 72 312 72 L368 76 L436 98 L426 104 C408 96 380 88 350 86 C320 84 290 85 265 90 L202 108 Z',
    },
    /* Cybertruck — angular, geometric, sharp edges, truck bed */
    cybertruck: {
      body: 'M68 200 L68 175 L90 165 L140 125 L220 100 L280 95 L420 95 L460 95 L520 120 L535 155 L538 175 L538 200 L538 210 L68 210 Z',
      roof: 'M145 123 L225 100 L282 95 L420 95 L415 100 L290 100 L230 104 L155 123 Z',
      wind: 'M155 123 L230 102 L290 98 L420 98 L418 95 L282 95 L225 100 L145 123 Z',
    },
  }

  const { body, roof, wind } = bodies[model]

  return (
    <g>
      <motion.path d={body} fill={bodyFill} stroke={bodyStroke} strokeWidth="1.5"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, ease: 'easeOut' }} />
      <path d={roof} fill={glassFill} stroke={glassStroke} strokeWidth="1" />
      <path d={wind} fill={windFill} stroke={windStroke} strokeWidth="0.8" />
      {/* Cybertruck truck bed separator line */}
      {model === 'cybertruck' && (
        <line x1="420" y1="95" x2="420" y2="200" stroke={palette.detail.lineFaint} strokeWidth="1" />
      )}
      {/* Cybertruck angular light bar */}
      {model === 'cybertruck' && (
        <line x1="90" y1="165" x2="535" y2="155" stroke={palette.detail.lineSubtle} strokeWidth="0.5" />
      )}
      {/* Model X falcon-wing door hinge hint */}
      {model === 'modelx' && (
        <g>
          <path d="M290 80 L290 65 C290 58 300 55 310 58 L340 68" fill="none" stroke={palette.falconWing.main} strokeWidth="0.8" />
          <path d="M340 68 L360 62 C365 60 370 62 370 67" fill="none" stroke={palette.falconWing.tip} strokeWidth="0.8" />
        </g>
      )}
    </g>
  )
}

export function TeslaCarViz({
  batteryLevel,
  isCharging,
  isLocked,
  isClimateOn,
  sentryMode,
  speed,
  className = '',
  size = 'md',
  model = 'model3',
}: TeslaCarVizProps) {
  const palette = useSvgPalette()
  const batteryColor = batteryLevel > 60 ? '#10b981' : batteryLevel > 25 ? '#f59e0b' : '#ef4444'
  const driving = speed > 0
  const sizeMap = { sm: 180, md: 280, lg: 380 }
  const w = sizeMap[size]
  const aspect = model === 'cybertruck' ? 0.56 : model === 'modelx' || model === 'modely' ? 0.55 : 0.52
  const h = w * aspect

  return (
    <div className={clsx('relative flex items-center justify-center', className)}>
      {/* Ambient glow behind car */}
      <div
        className="absolute rounded-full blur-[60px] opacity-30"
        style={{
          width: w * 0.7,
          height: h * 0.5,
          background: sentryMode
            ? palette.ambient.sentry
            : isCharging
            ? palette.ambient.charging
            : driving
            ? palette.ambient.driving
            : palette.ambient.idle,
        }}
      />

      <svg
        width={w}
        height={h}
        viewBox="0 0 560 290"
        fill="none"
        className="relative z-10"
      >
        {/* Ground shadow */}
        <ellipse cx="280" cy="270" rx={model === 'cybertruck' ? 240 : 220} ry="12" fill={palette.shadow} />

        {/* Model-specific car body */}
        <ModelBody model={model} driving={driving} palette={palette} />


        {/* Front wheel */}
        <g transform={`translate(${WHEEL_POS[model].fx}, ${WHEEL_POS[model].wy})`}>
          <circle r="32" fill={palette.wheel.outer} stroke={palette.wheel.outerStroke} strokeWidth="1" />
          <motion.circle
            r={model === 'cybertruck' ? 24 : 22}
            fill={palette.wheel.inner}
            stroke={palette.wheel.innerStroke}
            strokeWidth="2"
            animate={driving ? { rotate: 360 } : {}}
            transition={driving ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : {}}
          />
          <circle r="8" fill={palette.wheel.hub} stroke={palette.wheel.hubStroke} strokeWidth="1" />
          {model === 'cybertruck' && <>{/* Beefy tire tread lines */}
            {[-18,-12,-6,0,6,12,18].map(a => <line key={a} x1={a} y1="-24" x2={a} y2="-20" stroke={palette.tread} strokeWidth="2" />)}
          </>}
        </g>

        {/* Rear wheel */}
        <g transform={`translate(${WHEEL_POS[model].rx}, ${WHEEL_POS[model].wy})`}>
          <circle r="32" fill={palette.wheel.outer} stroke={palette.wheel.outerStroke} strokeWidth="1" />
          <motion.circle
            r={model === 'cybertruck' ? 24 : 22}
            fill={palette.wheel.inner}
            stroke={palette.wheel.innerStroke}
            strokeWidth="2"
            animate={driving ? { rotate: 360 } : {}}
            transition={driving ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : {}}
          />
          <circle r="8" fill={palette.wheel.hub} stroke={palette.wheel.hubStroke} strokeWidth="1" />
        </g>

        {/* Headlight */}
        <motion.ellipse
          cx={WHEEL_POS[model].headX} cy={WHEEL_POS[model].headY}
          rx={model === 'cybertruck' ? 4 : 8} ry={model === 'cybertruck' ? 3 : 12}
          fill={driving ? '#fffbe6' : palette.headlightOff}
          animate={driving ? { opacity: [0.8, 1, 0.8] } : {}}
          transition={driving ? { duration: 2, repeat: Infinity } : {}}
          style={driving ? { filter: 'drop-shadow(0 0 8px rgba(255,251,230,0.6))' } : {}}
        />

        {/* Headlight beam (when driving) */}
        {driving && (
          <motion.path
            d={`M${WHEEL_POS[model].headX - 7} ${WHEEL_POS[model].headY - 10} L${WHEEL_POS[model].headX - 55} ${WHEEL_POS[model].headY - 45} L${WHEEL_POS[model].headX - 55} ${WHEEL_POS[model].headY + 25} L${WHEEL_POS[model].headX - 7} ${WHEEL_POS[model].headY + 10} Z`}
            fill="rgba(255,251,230,0.04)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        {/* Tail light */}
        <motion.rect
          x={WHEEL_POS[model].tailX} y={WHEEL_POS[model].tailY} width={model === 'cybertruck' ? 8 : 6} height={model === 'cybertruck' ? 12 : 18} rx="3"
          fill="#ef4444"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ filter: 'drop-shadow(0 0 6px rgba(239,68,68,0.5))' }}
        />

        {/* Door handle / feature line */}
        {model === 'cybertruck' ? (
          <line x1="210" y1="150" x2="380" y2="150" stroke={palette.detail.lineFaint} strokeWidth="1" />
        ) : (
          <line x1="250" y1="138" x2="340" y2="135" stroke={palette.detail.line} strokeWidth="1" />
        )}

        {/* Battery indicator bar */}
        <rect x={WHEEL_POS[model].batX} y={WHEEL_POS[model].batY} width="260" height="8" rx="4" fill={palette.battery.bg} />
        <motion.rect
          x={WHEEL_POS[model].batX} y={WHEEL_POS[model].batY}
          rx="4"
          height="8"
          fill={batteryColor}
          initial={{ width: 0 }}
          animate={{ width: (batteryLevel / 100) * 260 }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${batteryColor})` }}
        />
        <text x={WHEEL_POS[model].batX + 135} y={WHEEL_POS[model].batY + 8} textAnchor="middle" fill={palette.battery.text} fontSize="6" fontWeight="bold" opacity="0.7">
          {batteryLevel}%
        </text>

        {/* Charging cable + plug animation */}
        {isCharging && (
          <g>
            <motion.path
              d={`M${WHEEL_POS[model].headX - 10} ${WHEEL_POS[model].headY + 5} L${WHEEL_POS[model].headX - 50} ${WHEEL_POS[model].headY + 5} C${WHEEL_POS[model].headX - 60} ${WHEEL_POS[model].headY + 5} ${WHEEL_POS[model].headX - 65} ${WHEEL_POS[model].headY} ${WHEEL_POS[model].headX - 65} ${WHEEL_POS[model].headY - 10} L${WHEEL_POS[model].headX - 65} ${WHEEL_POS[model].headY - 45}`}
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.5))' }}
            />
            <motion.circle
              cx={WHEEL_POS[model].headX - 65} cy={WHEEL_POS[model].headY - 50}
              r="6"
              fill="#10b981"
              animate={{ scale: [1, 1.3, 1], opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              style={{ filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.8))' }}
            />
            {/* Lightning bolt on charge indicator */}
            <motion.path
              d={`M${WHEEL_POS[model].headX - 67} ${WHEEL_POS[model].headY - 55} L${WHEEL_POS[model].headX - 64} ${WHEEL_POS[model].headY - 51} L${WHEEL_POS[model].headX - 66} ${WHEEL_POS[model].headY - 51} L${WHEEL_POS[model].headX - 63} ${WHEEL_POS[model].headY - 46} L${WHEEL_POS[model].headX - 66} ${WHEEL_POS[model].headY - 50} L${WHEEL_POS[model].headX - 64} ${WHEEL_POS[model].headY - 50} Z`}
              fill="white"
              opacity="0.9"
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </g>
        )}

        {/* Lock indicator */}
        <g transform={`translate(${WHEEL_POS[model].lockX}, ${WHEEL_POS[model].lockY})`}>
          <rect x="-10" y="-8" width="20" height="16" rx="4" fill={palette.lock.bg} />
          {isLocked ? (
            <g>
              <rect x="-5" y="-2" width="10" height="8" rx="2" fill="none" stroke="#10b981" strokeWidth="1.2" />
              <path d="M-3 -2 L-3 -5 A3 3 0 0 1 3 -5 L3 -2" fill="none" stroke="#10b981" strokeWidth="1.2" />
              <circle cx="0" cy="2" r="1" fill="#10b981" />
            </g>
          ) : (
            <g>
              <rect x="-5" y="-2" width="10" height="8" rx="2" fill="none" stroke="#f59e0b" strokeWidth="1.2" />
              <path d="M-3 -2 L-3 -5 A3 3 0 0 1 3 -5 L3 -6" fill="none" stroke="#f59e0b" strokeWidth="1.2" />
              <circle cx="0" cy="2" r="1" fill="#f59e0b" />
            </g>
          )}
        </g>

        {/* Climate waves */}
        {isClimateOn && (
          <g transform={`translate(${WHEEL_POS[model].lockX - 5}, ${WHEEL_POS[model].lockY + 18})`}>
            {[0, 1, 2].map(i => (
              <motion.path
                key={i}
                d={`M${-15 + i * 15} 0 C${-12 + i * 15} -4 ${-8 + i * 15} -4 ${-5 + i * 15} 0`}
                fill="none"
                stroke={palette.climate}
                strokeWidth="1.2"
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 0.6, 0], y: -8 }}
                transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
              />
            ))}
          </g>
        )}

        {/* Sentry mode ring */}
        {sentryMode && (
          <motion.circle
            cx="280" cy="160"
            r="90"
            fill="none"
            stroke={palette.sentry.ring1}
            strokeWidth="1"
            strokeDasharray="4 4"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          />
        )}
        {sentryMode && (
          <motion.circle
            cx="280" cy="160"
            r="95"
            fill="none"
            stroke={palette.sentry.ring2}
            strokeWidth="1"
            strokeDasharray="8 8"
            animate={{ rotate: -360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* Speed lines when driving */}
        {driving && (
          <g>
            {[0, 1, 2, 3].map(i => (
              <motion.line
                key={i}
                x1={530 + i * 8}
                y1={160 + i * 12}
                x2={560 + i * 8}
                y2={160 + i * 12}
                stroke={palette.speedLine}
                strokeWidth="1.5"
                strokeLinecap="round"
                animate={{ opacity: [0, 0.6, 0], x1: [530 + i * 8, 560 + i * 8] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Status indicators below car */}
      <div className="absolute bottom-0 flex items-center gap-3 text-[10px] font-medium">
        <StatusDot
          active={isCharging}
          color="#10b981"
          label={isCharging ? 'Charging' : 'Not Charging'}
          palette={palette}
        />
        <StatusDot
          active={isLocked}
          color={isLocked ? '#10b981' : '#f59e0b'}
          label={isLocked ? 'Locked' : 'Unlocked'}
          palette={palette}
        />
        {isClimateOn && <StatusDot active color="#00f0ff" label="Climate" palette={palette} />}
        {sentryMode && <StatusDot active color="#ef4444" label="Sentry" palette={palette} />}
      </div>
    </div>
  )
}

function StatusDot({ active, color, label, palette }: { active: boolean; color: string; label: string; palette: ReturnType<typeof useSvgPalette> }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: active ? color : palette.statusInactive,
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }}
      />
      <span style={{ color: active ? color : palette.statusTextInactive }}>{label}</span>
    </span>
  )
}

/** Mini version for cards/lists */
export function TeslaCarMini({ batteryLevel, isCharging, model }: { batteryLevel: number; isCharging: boolean; model?: TeslaModel }) {
  const palette = useSvgPalette()
  const color = batteryLevel > 60 ? '#10b981' : batteryLevel > 25 ? '#f59e0b' : '#ef4444'
  const m = model ?? 'model3'
  const miniPaths: Record<TeslaModel, string> = {
    model3:     'M8 22 C8 22 9 18 13 16 L20 12 C22 11 26 9 30 8.5 C34 8 40 7.8 44 8 C48 8.2 51 9.5 53 11 L57 14 C58.5 15 59.5 16.5 59.8 18 L60 22 L8 22 Z',
    models:     'M6 22 C6 22 7 17 11 15 L17 11 C19 10 24 8 28 7.5 C33 7 40 6.8 46 7 C50 7.2 53 8.5 55 10 L59 13 C60.5 14 61.5 15.5 61.8 17 L62 22 L6 22 Z',
    modely:     'M8 23 C8 23 9 17 13 14 L19 10 C21 9 25 7 29 6.5 C33 6 40 5.8 44 6 C48 6.2 51 7.5 53 9 L57 12 C58.5 13 59.5 14.5 59.8 16 L60 23 L8 23 Z',
    modelx:     'M7 24 C7 24 8 17 12 14 L18 9 C20 8 24 6 28 5.5 C32 5 39 4.8 44 5 C48 5.2 51 6.5 53 8 L57 11 C58.5 12 59.5 14 59.8 16 L60 24 L7 24 Z',
    cybertruck: 'M7 22 L7 17 L10 16 L16 12 L26 9 L34 8 L48 8 L52 8 L58 12 L60 16 L60 22 L7 22 Z',
  }
  return (
    <svg width="64" height={m === 'modelx' ? 34 : 32} viewBox={m === 'modelx' ? '0 0 64 34' : '0 0 64 32'} fill="none">
      <path
        d={miniPaths[m]}
        fill={palette.miniBody.fill}
        stroke={palette.miniBody.stroke}
        strokeWidth="0.8"
      />
      <circle cx="18" cy={m === 'modelx' ? 24 : 22} r="4" fill={palette.miniWheel.fill} stroke={palette.miniWheel.stroke} strokeWidth="0.5" />
      <circle cx="50" cy={m === 'modelx' ? 24 : 22} r="4" fill={palette.miniWheel.fill} stroke={palette.miniWheel.stroke} strokeWidth="0.5" />
      <rect x="18" y={m === 'modelx' ? 19 : 17} width="28" height="2" rx="1" fill={palette.miniBatBg} />
      <rect x="18" y={m === 'modelx' ? 19 : 17} width={28 * (batteryLevel / 100)} height="2" rx="1" fill={color} opacity="0.8" />
      {isCharging && (
        <circle cx="10" cy={m === 'modelx' ? 20 : 18} r="2" fill="#10b981" opacity="0.8">
          <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}
