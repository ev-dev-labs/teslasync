export const MIN_SIDEBAR_WIDTH = 240
export const MAX_SIDEBAR_WIDTH = 420
export const DEFAULT_SIDEBAR_WIDTH = 272
export const SIDEBAR_WIDTH_STORAGE_KEY = 'teslasync-sidebar-width'

export function clampSidebarWidth(width: number) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width))
}
