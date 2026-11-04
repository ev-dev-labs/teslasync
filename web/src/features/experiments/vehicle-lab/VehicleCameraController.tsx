import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import type { OrbitControls as OrbitControlsInstance } from 'three-stdlib'
import { CAMERA_PRESETS, type CameraPreset } from './cameraPresets'

export default function VehicleCameraController({ preset }: { preset: CameraPreset }) {
  const { camera, invalidate, gl } = useThree()
  const controls = useRef<OrbitControlsInstance>(null)
  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    orbit.listenToKeyEvents(gl.domElement)
    return () => orbit.stopListenToKeyEvents()
  }, [gl])
  useEffect(() => {
    const { position, target } = CAMERA_PRESETS[preset]
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(target[0], target[1], target[2])
    controls.current?.target.set(target[0], target[1], target[2])
    controls.current?.update()
    invalidate()
  }, [camera, invalidate, preset])

  return <OrbitControls ref={controls} makeDefault enableDamping={false} minDistance={2.5} maxDistance={14} maxPolarAngle={Math.PI / 2 - .02} />
}
