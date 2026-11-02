import { request } from './client'

export interface BootstrapSettings extends Record<string, unknown> {
  theme?: string
  mode?: string
  custom_primary?: string
  custom_accent?: string
}

let pendingSettings: Promise<BootstrapSettings | null> | null = null

/**
 * Shares the root providers' concurrent settings hydration request.
 * The promise is cleared after settlement so later explicit reloads still
 * observe current server state.
 */
export function getBootstrapSettings(): Promise<BootstrapSettings | null> {
  if (pendingSettings) return pendingSettings

  pendingSettings = request<BootstrapSettings>('/settings')
    .finally(() => {
      pendingSettings = null
    })

  return pendingSettings
}
