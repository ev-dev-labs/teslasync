export const CAMERA_PRESETS = {
  front: { position: [0, 2.4, 7.5], target: [0, 1, 0] },
  rear: { position: [0, 2.4, -7.5], target: [0, 1, 0] },
  side: { position: [7.5, 2.4, 0], target: [0, 1, 0] },
  top: { position: [0, 9, .01], target: [0, 1, 0] },
  tires: { position: [3.4, .95, 3.4], target: [0, .43, 1.5] },
} as const

export type CameraPreset = keyof typeof CAMERA_PRESETS
