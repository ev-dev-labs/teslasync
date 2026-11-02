import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Canvas } from '@react-three/fiber'
import { Button, Caption } from '@/components/ui'
import { useTheme } from '@/components/ui/ThemeProvider'
import { DATA_VISUAL_COLORS } from '@/lib/colors'
import { CAMERA_PRESETS, type CameraPreset } from './cameraPresets'
import VehicleCameraController from './VehicleCameraController'
import VehicleModelView from './VehicleModelView'
import type { VehicleLabState } from './vehicleLabState'
import VehicleTireLabels from './VehicleTireLabels'
import type { VehiclePart } from './partMapping'

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

const CAMERA_LABELS: Record<CameraPreset, string> = {
  front: 'Front', rear: 'Rear', side: 'Side', top: 'Top', tires: 'Tires',
}

export default function VehicleStudioCanvas({ state, onUnavailable, onSelect }: { state: VehicleLabState; onUnavailable: () => void; onSelect?: (part: VehiclePart) => void }) {
  const { t } = useTranslation()
  const { mode, theme } = useTheme()
  const [preset, setPreset] = useState<CameraPreset>('front')
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden', () => false)
  const palette = useMemo(() => ({
    body: theme.primary,
    trim: DATA_VISUAL_COLORS.canvasMuted,
    glass: DATA_VISUAL_COLORS.canvasMidnight,
    tyre: DATA_VISUAL_COLORS.canvasInk,
    headlight: DATA_VISUAL_COLORS.canvasWhite,
    taillight: DATA_VISUAL_COLORS.danger,
  }), [theme.primary])
  const canvasLabel = t('experiments.vehicleLab.canvas', 'Illustrative vehicle. Drag to orbit, pinch or scroll to zoom, use arrow keys to pan, or choose a camera view.')
  useEffect(() => {
    if (!canvas) return
    const lost = (event: Event) => { event.preventDefault(); onUnavailable() }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [canvas, onUnavailable])

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('experiments.vehicleLab.cameraViews', 'Camera views')} className="flex flex-wrap gap-2">
        {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map(view => (
          <Button key={view} variant={preset === view ? 'primary' : 'secondary'} className="min-h-11" aria-pressed={preset === view} onClick={() => setPreset(view)}>
            {t(`experiments.vehicleLab.camera.${view}`, CAMERA_LABELS[view])}
          </Button>
        ))}
      </div>
      <div className="h-[360px] overflow-hidden rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-1)] sm:h-[480px]">
        <Canvas
          dpr={[1, 2]}
          frameloop={visible ? 'demand' : 'never'}
          shadows="soft"
          camera={{ position: [...CAMERA_PRESETS.front.position], fov: 42, near: .1, far: 50 }}
          onCreated={({ gl }) => {
            gl.domElement.setAttribute('role', 'img')
            gl.domElement.setAttribute('aria-label', canvasLabel)
            gl.domElement.tabIndex = 0
            setCanvas(gl.domElement)
          }}
          onContextMenu={event => event.preventDefault()}
        >
          <color attach="background" args={[mode.surface1]} />
          <ambientLight intensity={.65} />
          <hemisphereLight args={[DATA_VISUAL_COLORS.canvasWhite, DATA_VISUAL_COLORS.blue, 1.1]} />
          <directionalLight position={[3, 8, 5]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-normalBias={.025} />
          <directionalLight position={[-4, 3, -5]} intensity={1.5} color={DATA_VISUAL_COLORS.blue} />
          <VehicleModelView palette={palette} state={state} onSelect={onSelect} />
          <VehicleTireLabels state={state} onSelect={onSelect} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[8, 64]} />
            <meshStandardMaterial color={mode.surface1} roughness={1} />
          </mesh>
          <VehicleCameraController preset={preset} />
        </Canvas>
      </div>
      <Caption as="p">{canvasLabel}</Caption>
    </div>
  )
}
