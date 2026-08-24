export const WORKSPACE_RANGE_EVENT = 'teslasync:workspace-range'
export const WORKSPACE_DENSITY_EVENT = 'teslasync:workspace-density'

export const WORKSPACE_RANGE_PRESETS = [
  'today',
  '7d',
  '30d',
  '90d',
  '1y',
  'all',
] as const

export const WORKSPACE_DENSITIES = [
  'compact',
  'comfortable',
  'spacious',
] as const

export type WorkspaceRangePreset = (typeof WORKSPACE_RANGE_PRESETS)[number]
export type WorkspaceDensity = (typeof WORKSPACE_DENSITIES)[number]

export function isWorkspaceRangePreset(value: unknown): value is WorkspaceRangePreset {
  return (
    typeof value === 'string' &&
    (WORKSPACE_RANGE_PRESETS as readonly string[]).includes(value)
  )
}

export function isWorkspaceDensity(value: unknown): value is WorkspaceDensity {
  return (
    typeof value === 'string' &&
    (WORKSPACE_DENSITIES as readonly string[]).includes(value)
  )
}

export function dispatchWorkspaceRangePreset(preset: WorkspaceRangePreset): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_RANGE_EVENT, { detail: { preset } }),
  )
}

export function dispatchWorkspaceDensity(density: WorkspaceDensity): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_DENSITY_EVENT, { detail: { density } }),
  )
}
