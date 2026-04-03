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
  model3:     { fx: 160, rx: 430, wy: 210, headX: 88,  headY: 180, tailX: 490, tailY: 175, batX: 150, batY: 170, lockX: 295, lockY: 106 },
  models:     { fx: 150, rx: 440, wy: 210, headX: 78,  headY: 180, tailX: 500, tailY: 175, batX: 150, batY: 170, lockX: 290, lockY: 104 },
  modely:     { fx: 160, rx: 430, wy: 215, headX: 88,  headY: 182, tailX: 490, tailY: 178, batX: 150, batY: 175, lockX: 295, lockY: 104 },
  modelx:     { fx: 155, rx: 435, wy: 218, headX: 84,  headY: 184, tailX: 492, tailY: 180, batX: 150, batY: 178, lockX: 290, lockY: 100 },
  cybertruck: { fx: 150, rx: 445, wy: 210, headX: 78,  headY: 170, tailX: 528, tailY: 155, batX: 150, batY: 175, lockX: 300, lockY: 115 },
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
    /* Model 3 — compact sport sedan, smooth curves, short nose */
    model3: {
      body: 'M84 210 Q64 178 94 166 L170 164 Q192 146 220 130 Q258 116 302 114 L386 114 Q418 116 446 130 Q468 146 484 166 Q494 178 498 194 Q500 204 500 210 L84 210 Z',
      roof: 'M196 140 Q216 128 248 120 Q282 114 325 114 L380 114 Q410 116 435 128 L445 134 L436 138 C418 130 390 122 360 120 C330 118 290 118 260 122 C230 126 210 134 200 140 Z',
      wind: 'M202 140 L238 120 Q260 114 292 114 L375 116 L432 132 L424 136 C408 128 380 120 350 118 C320 116 290 117 265 122 L208 140 Z',
    },
    /* Model S — longer, sleeker fastback */
    models: {
      body: 'M72 210 Q52 178 82 166 L168 164 Q188 146 216 130 Q254 116 300 114 L395 114 Q428 116 456 130 Q478 146 494 166 Q504 178 508 194 Q510 204 510 210 L72 210 Z',
      roof: 'M190 140 Q212 126 246 118 Q282 112 330 112 L390 112 Q418 114 442 126 L452 132 L444 136 C426 128 398 120 368 118 C335 116 295 116 265 120 C235 124 215 132 202 140 Z',
      wind: 'M198 140 L236 118 Q258 112 292 112 L385 114 L440 130 L432 134 C414 126 385 118 355 116 C325 114 295 115 270 120 L204 140 Z',
    },
    /* Model Y — crossover, taller greenhouse, slight curvature */
    modely: {
      body: 'M84 215 Q62 182 94 168 L170 166 Q192 148 220 132 Q258 118 302 116 L380 116 Q414 118 444 132 Q468 148 484 168 Q494 182 498 198 Q500 208 500 215 L84 215 Z',
      roof: 'M194 142 Q216 128 248 118 Q282 112 325 112 L375 112 Q408 114 434 128 L444 134 L436 138 C418 130 390 122 358 120 C328 118 288 118 258 122 C228 126 210 134 198 142 Z',
      wind: 'M200 142 L238 118 Q260 112 292 112 L370 114 L432 130 L424 136 C406 128 378 120 348 118 C318 116 288 117 264 122 L206 142 Z',
    },
    /* Model X — tall SUV, falcon-wing doors */
    modelx: {
      body: 'M80 218 Q58 184 90 170 L165 168 Q186 148 216 132 Q256 116 300 112 L380 112 Q416 114 446 132 Q470 148 486 170 Q496 184 500 200 Q502 210 502 218 L80 218 Z',
      roof: 'M190 140 Q214 124 248 114 Q284 108 328 108 L376 108 Q410 110 436 124 L446 130 L438 134 C420 126 392 118 362 116 C330 114 290 114 260 118 C230 122 212 130 198 140 Z',
      wind: 'M196 140 L236 114 Q258 108 290 108 L372 110 L434 128 L426 132 C408 124 380 116 350 114 C320 112 290 113 265 118 L202 140 Z',
    },
    /* Cybertruck — angular, geometric, sharp edges */
    cybertruck: {
      body: 'M68 210 L68 185 L90 175 L140 140 L220 118 L280 114 L420 114 L460 114 L520 138 L535 168 L538 185 L538 210 L68 210 Z',
      roof: 'M145 138 L225 118 L282 114 L420 114 L415 118 L290 118 L230 122 L155 138 Z',
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

        {/* Body detail lines — door seams, side skirt, roof highlight */}
        {model !== 'cybertruck' && (
          <g>
            {/* Roof highlight (shine line) */}
            <path
              d={model === 'models'
                ? 'M200 90 Q280 82 380 85'
                : model === 'modelx' || model === 'modely'
                ? 'M210 82 Q280 74 370 78'
                : 'M210 92 Q280 84 370 86'}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" strokeLinecap="round"
            />
            {/* Front door seam */}
            <line
              x1={model === 'models' ? 270 : 265} y1={model === 'modelx' ? 82 : model === 'modely' ? 85 : 90}
              x2={model === 'models' ? 268 : 260} y2="205"
              stroke={palette.detail.lineFaint} strokeWidth="0.8"
            />
            {/* Rear door seam */}
            <line
              x1={model === 'models' ? 355 : 345} y1={model === 'modelx' ? 85 : model === 'modely' ? 88 : 92}
              x2={model === 'models' ? 358 : 348} y2="205"
              stroke={palette.detail.lineFaint} strokeWidth="0.8"
            />
            {/* Side skirt line */}
            <path
              d={model === 'models'
                ? 'M115 200 Q200 208 330 208 Q440 208 510 200'
                : model === 'modelx' || model === 'modely'
                ? 'M115 205 Q200 213 330 213 Q440 213 505 205'
                : 'M110 200 Q200 208 330 208 Q430 208 505 200'}
              fill="none" stroke={palette.detail.lineFaint} strokeWidth="0.8"
            />
          </g>
        )}


        {/* Front wheel */}
        <g transform={`translate(${WHEEL_POS[model].fx}, ${WHEEL_POS[model].wy})`}>
          <circle r="32" fill={palette.wheel.outer} stroke={palette.wheel.outerStroke} strokeWidth="1.5" />
          <motion.g
            animate={driving ? { rotate: 360 } : {}}
            transition={driving ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : {}}
          >
            <circle r={model === 'cybertruck' ? 24 : 22} fill={palette.wheel.inner} stroke={palette.wheel.innerStroke} strokeWidth="2" />
            {/* 5-spoke design */}
            {[0, 72, 144, 216, 288].map(angle => (
              <line key={angle} x1="0" y1="0" x2="0" y2={model === 'cybertruck' ? -22 : -20}
                stroke={palette.wheel.hubStroke} strokeWidth="2.5" strokeLinecap="round"
                transform={`rotate(${angle})`} />
            ))}
          </motion.g>
          <circle r="8" fill={palette.wheel.hub} stroke={palette.wheel.hubStroke} strokeWidth="1.5" />
          <circle r="3" fill={palette.wheel.hubStroke} opacity="0.5" />
          {model === 'cybertruck' && <>{/* Beefy tire tread lines */}
            {[-18,-12,-6,0,6,12,18].map(a => <line key={a} x1={a} y1="-24" x2={a} y2="-20" stroke={palette.tread} strokeWidth="2" />)}
          </>}
        </g>

        {/* Rear wheel */}
        <g transform={`translate(${WHEEL_POS[model].rx}, ${WHEEL_POS[model].wy})`}>
          <circle r="32" fill={palette.wheel.outer} stroke={palette.wheel.outerStroke} strokeWidth="1.5" />
          <motion.g
            animate={driving ? { rotate: 360 } : {}}
            transition={driving ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : {}}
          >
            <circle r={model === 'cybertruck' ? 24 : 22} fill={palette.wheel.inner} stroke={palette.wheel.innerStroke} strokeWidth="2" />
            {[0, 72, 144, 216, 288].map(angle => (
              <line key={angle} x1="0" y1="0" x2="0" y2={model === 'cybertruck' ? -22 : -20}
                stroke={palette.wheel.hubStroke} strokeWidth="2.5" strokeLinecap="round"
                transform={`rotate(${angle})`} />
            ))}
          </motion.g>
          <circle r="8" fill={palette.wheel.hub} stroke={palette.wheel.hubStroke} strokeWidth="1.5" />
          <circle r="3" fill={palette.wheel.hubStroke} opacity="0.5" />
        </g>

        {/* Headlight — Tesla-style slim DRL strip + projector */}
        <g>
          {/* DRL strip (always on when awake) */}
          <motion.path
            d={model === 'cybertruck'
              ? `M${WHEEL_POS[model].headX} ${WHEEL_POS[model].headY - 3} L${WHEEL_POS[model].headX + 20} ${WHEEL_POS[model].headY - 5}`
              : `M${WHEEL_POS[model].headX - 2} ${WHEEL_POS[model].headY - 14} Q${WHEEL_POS[model].headX - 6} ${WHEEL_POS[model].headY} ${WHEEL_POS[model].headX - 2} ${WHEEL_POS[model].headY + 14}`}
            fill="none"
            stroke={driving ? '#ffffff' : palette.headlightOff}
            strokeWidth={model === 'cybertruck' ? 3 : 2.5}
            strokeLinecap="round"
            animate={driving ? { opacity: [0.85, 1, 0.85] } : {}}
            transition={driving ? { duration: 2.5, repeat: Infinity } : {}}
            style={driving ? { filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.7))' } : {}}
          />
          {/* Main projector lens */}
          <ellipse
            cx={WHEEL_POS[model].headX + (model === 'cybertruck' ? 5 : 2)}
            cy={WHEEL_POS[model].headY}
            rx={model === 'cybertruck' ? 3 : 4}
            ry={model === 'cybertruck' ? 2.5 : 6}
            fill={driving ? '#fffbe6' : palette.headlightOff}
            opacity={driving ? 0.9 : 0.5}
            style={driving ? { filter: 'drop-shadow(0 0 10px rgba(255,251,230,0.8))' } : {}}
          />
          {/* Amber turn signal accent */}
          <ellipse
            cx={WHEEL_POS[model].headX + (model === 'cybertruck' ? 10 : 6)}
            cy={WHEEL_POS[model].headY + (model === 'cybertruck' ? 0 : 12)}
            rx={model === 'cybertruck' ? 2 : 3}
            ry={model === 'cybertruck' ? 1.5 : 2}
            fill={driving ? '#fbbf24' : palette.headlightOff}
            opacity={driving ? 0.5 : 0.2}
          />
        </g>

        {/* Headlight beam cone (when driving) */}
        {driving && (
          <motion.path
            d={`M${WHEEL_POS[model].headX - 5} ${WHEEL_POS[model].headY - 8} L${WHEEL_POS[model].headX - 60} ${WHEEL_POS[model].headY - 40} L${WHEEL_POS[model].headX - 60} ${WHEEL_POS[model].headY + 20} L${WHEEL_POS[model].headX - 5} ${WHEEL_POS[model].headY + 8} Z`}
            fill="rgba(255,251,230,0.03)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        )}

        {/* Tail light — Tesla-style continuous LED strip */}
        <g>
          {/* Main tail light strip */}
          <motion.path
            d={model === 'cybertruck'
              ? `M${WHEEL_POS[model].tailX} ${WHEEL_POS[model].tailY - 8} L${WHEEL_POS[model].tailX} ${WHEEL_POS[model].tailY + 12}`
              : `M${WHEEL_POS[model].tailX + 3} ${WHEEL_POS[model].tailY - 2} Q${WHEEL_POS[model].tailX + 5} ${WHEEL_POS[model].tailY + 9} ${WHEEL_POS[model].tailX + 3} ${WHEEL_POS[model].tailY + 20}`}
            fill="none"
            stroke="#ef4444"
            strokeWidth={model === 'cybertruck' ? 4 : 3}
            strokeLinecap="round"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.6))' }}
          />
          {/* Inner brighter core */}
          <motion.path
            d={model === 'cybertruck'
              ? `M${WHEEL_POS[model].tailX} ${WHEEL_POS[model].tailY - 4} L${WHEEL_POS[model].tailX} ${WHEEL_POS[model].tailY + 8}`
              : `M${WHEEL_POS[model].tailX + 3} ${WHEEL_POS[model].tailY + 2} Q${WHEEL_POS[model].tailX + 4} ${WHEEL_POS[model].tailY + 9} ${WHEEL_POS[model].tailX + 3} ${WHEEL_POS[model].tailY + 16}`}
            fill="none"
            stroke="#ff6b6b"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.8"
          />
          {/* Tail light glow halo */}
          <ellipse
            cx={WHEEL_POS[model].tailX + 3}
            cy={WHEEL_POS[model].tailY + 9}
            rx="8"
            ry="14"
            fill="rgba(239,68,68,0.08)"
            style={{ filter: 'blur(4px)' }}
          />
        </g>

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
