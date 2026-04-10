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
  model3:     { fx: 192, rx: 422, wy: 210, headX: 144, headY: 184, tailX: 472, tailY: 184, batX: 180, batY: 174, lockX: 310, lockY: 110 },
  models:     { fx: 190, rx: 424, wy: 210, headX: 140, headY: 184, tailX: 476, tailY: 184, batX: 178, batY: 174, lockX: 310, lockY: 110 },
  modely:     { fx: 192, rx: 422, wy: 210, headX: 144, headY: 182, tailX: 472, tailY: 182, batX: 180, batY: 172, lockX: 310, lockY: 108 },
  modelx:     { fx: 192, rx: 422, wy: 210, headX: 144, headY: 180, tailX: 472, tailY: 180, batX: 180, batY: 170, lockX: 310, lockY: 106 },
  cybertruck: { fx: 192, rx: 422, wy: 210, headX: 108, headY: 176, tailX: 480, tailY: 165, batX: 180, batY: 172, lockX: 310, lockY: 108 },
}

/** Theme-aware color palette for SVG rendering */
function useSvgPalette() {
  const { mode } = useTheme()
  const isLight = mode.colorScheme === 'light'

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
    wind: {
      fill: isLight ? 'rgba(0,120,200,0.12)' : 'rgba(15,23,42,0.85)',
      stroke: isLight ? 'rgba(0,120,200,0.2)' : 'rgba(255,255,255,0.1)',
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
    /* Model 3 — compact sport sedan, short nose, smooth fastback */
    model3: {
      body: 'M 148 210 Q 136 194 142 180 L 162 176 Q 174 172 184 162 Q 198 150 216 140 L 246 122 Q 270 116 304 114 L 358 116 Q 390 120 416 134 Q 440 150 456 168 Q 466 182 472 196 Q 474 204 474 210 L 148 210 Z',
      roof: 'M 222 144 L 250 124 Q 272 116 306 114 L 356 116 Q 388 120 412 134 L 432 150 L 430 158 Q 396 162 328 162 Q 264 162 242 160 L 224 152 Z',
      wind: 'M 226 148 L 254 128 Q 278 120 310 116 L 354 116 L 410 134 L 404 138 C 390 130 366 122 344 120 C 322 116 298 118 280 124 L 230 148 Z',
    },
    /* Model S — longer, sleeker fastback */
    models: {
      body: 'M 144 210 Q 132 194 138 180 L 158 176 Q 170 172 180 162 Q 194 150 212 140 L 244 122 Q 268 116 302 114 L 362 116 Q 394 120 420 134 Q 444 150 460 168 Q 470 182 476 196 Q 478 204 478 210 L 144 210 Z',
      roof: 'M 218 144 L 248 124 Q 270 116 304 114 L 360 116 Q 392 120 416 134 L 436 150 L 434 158 Q 400 162 330 162 Q 266 162 244 160 L 220 152 Z',
      wind: 'M 222 148 L 252 128 Q 276 120 308 116 L 358 116 L 414 134 L 408 138 C 394 130 370 122 348 120 C 326 116 302 118 282 124 L 226 148 Z',
    },
    /* Model Y — crossover, taller greenhouse */
    modely: {
      body: 'M 148 210 Q 136 194 142 178 L 162 174 Q 174 170 184 160 Q 198 148 216 138 L 246 120 Q 270 114 304 112 L 358 114 Q 390 118 416 132 Q 440 148 456 166 Q 466 180 472 194 Q 474 204 474 210 L 148 210 Z',
      roof: 'M 222 142 L 250 122 Q 272 114 306 112 L 356 114 Q 388 118 412 132 L 432 148 L 430 156 Q 396 160 328 160 Q 264 160 242 158 L 224 150 Z',
      wind: 'M 226 146 L 254 126 Q 278 118 310 114 L 354 114 L 410 132 L 404 136 C 390 128 366 120 344 118 C 322 114 298 116 280 122 L 230 146 Z',
    },
    /* Model X — tall SUV, falcon-wing doors */
    modelx: {
      body: 'M 148 210 Q 136 194 142 176 L 162 172 Q 174 168 184 158 Q 198 146 216 136 L 246 118 Q 270 112 304 110 L 358 112 Q 390 116 416 130 Q 440 146 456 164 Q 466 178 472 192 Q 474 202 474 210 L 148 210 Z',
      roof: 'M 222 140 L 250 120 Q 272 112 306 110 L 356 112 Q 388 116 412 130 L 432 146 L 430 154 Q 396 158 328 158 Q 264 158 242 156 L 224 148 Z',
      wind: 'M 226 144 L 254 124 Q 278 116 310 112 L 354 112 L 410 130 L 404 134 C 390 126 366 118 344 116 C 322 112 298 114 280 120 L 230 144 Z',
    },
    /* Cybertruck — angular, geometric, sharp edges */
    cybertruck: {
      body: 'M 104 210 L 109 200 L 121 186 L 170 166 L 220 152 L 434 152 L 468 164 L 483 182 L 487 200 L 488 210 L 104 210 Z',
      roof: 'M 225 156 L 259 152 L 419 152 L 439 164 L 434 178 L 234 178 L 228 168 Z',
      wind: 'M 230 160 L 262 152 L 420 152 L 436 162 L 432 170 L 240 170 L 232 164 Z',
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
        <line x1="420" y1="152" x2="420" y2="200" stroke={palette.detail.lineFaint} strokeWidth="1" />
      )}
      {/* Cybertruck angular light bar */}
      {model === 'cybertruck' && (
        <line x1="121" y1="180" x2="483" y2="170" stroke={palette.detail.lineSubtle} strokeWidth="0.5" />
      )}
      {/* Model X falcon-wing door hinge hint */}
      {model === 'modelx' && (
        <g>
          <path d="M300 104 L300 88 C300 81 310 78 320 81 L350 91" fill="none" stroke={palette.falconWing.main} strokeWidth="0.8" />
          <path d="M350 91 L370 85 C375 83 380 85 380 90" fill="none" stroke={palette.falconWing.tip} strokeWidth="0.8" />
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
        <ellipse cx="310" cy="270" rx={model === 'cybertruck' ? 240 : 200} ry="12" fill={palette.shadow} />

        {/* Model-specific car body */}
        <ModelBody model={model} driving={driving} palette={palette} />

        {/* Body detail lines — door seams, side skirt, roof highlight */}
        {model !== 'cybertruck' && (
          <g>
            {/* Roof highlight (shine line) */}
            <path
              d={model === 'models'
                ? 'M226 110 Q310 106 384 108'
                : model === 'modelx' || model === 'modely'
                ? 'M226 106 Q310 102 380 106'
                : 'M226 110 Q310 108 380 110'}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" strokeLinecap="round"
            />
            {/* Front door seam */}
            <line
              x1={model === 'models' ? 278 : 280} y1={model === 'modelx' ? 120 : model === 'modely' ? 122 : 126}
              x2={model === 'models' ? 276 : 278} y2="205"
              stroke={palette.detail.lineFaint} strokeWidth="0.8"
            />
            {/* Rear door seam */}
            <line
              x1={model === 'models' ? 352 : 348} y1={model === 'modelx' ? 122 : model === 'modely' ? 124 : 128}
              x2={model === 'models' ? 354 : 350} y2="205"
              stroke={palette.detail.lineFaint} strokeWidth="0.8"
            />
            {/* Side skirt line */}
            <path
              d={model === 'models'
                ? 'M148 204 Q240 208 310 208 Q424 208 474 204'
                : model === 'modelx' || model === 'modely'
                ? 'M152 206 Q240 210 310 210 Q420 210 470 206'
                : 'M152 204 Q240 208 310 208 Q420 208 470 204'}
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
          <line x1="210" y1="162" x2="380" y2="162" stroke={palette.detail.lineFaint} strokeWidth="1" />
        ) : (
          <line x1="254" y1="154" x2="340" y2="152" stroke={palette.detail.line} strokeWidth="1" />
        )}

        {/* Battery indicator bar */}
        <rect x={WHEEL_POS[model].batX} y={WHEEL_POS[model].batY} width="240" height="8" rx="4" fill={palette.battery.bg} />
        <motion.rect
          x={WHEEL_POS[model].batX} y={WHEEL_POS[model].batY}
          rx="4"
          height="8"
          fill={batteryColor}
          initial={{ width: 0 }}
          animate={{ width: (batteryLevel / 100) * 240 }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${batteryColor})` }}
        />
        <text x={WHEEL_POS[model].batX + 120} y={WHEEL_POS[model].batY + 8} textAnchor="middle" fill={palette.battery.text} fontSize="6" fontWeight="bold" opacity="0.7">
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
            cx="310" cy="160"
            r="90"
            fill="none"
            strokeWidth="1"
            strokeDasharray="4 4"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          />
        )}
        {sentryMode && (
          <motion.circle
            cx="310" cy="160"
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
