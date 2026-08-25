import {
  isWorkspaceRangePreset,
  type WorkspaceRangePreset,
} from '@/lib/workspacePreferences'

export const PRODUCT_PREFERENCES_STORAGE_KEY =
  'teslasync:product-preferences:v1'

const PRODUCT_PREFERENCES_VERSION = 1

export const PRODUCT_PERSONAS = [
  'owner',
  'fleet_operator',
  'analyst',
  'administrator',
] as const

export type ProductPersona = (typeof PRODUCT_PERSONAS)[number]

export const PRODUCT_LANDING_PAGES = [
  '/',
  '/action-center',
  '/vehicles',
  '/battery',
  '/charging',
  '/drives',
  '/analytics',
] as const

export type ProductLandingPage = (typeof PRODUCT_LANDING_PAGES)[number]

export interface ProductPreferences {
  persona: ProductPersona
  landingPage: ProductLandingPage
  defaultVehicleId: number | null
  defaultAnalysisRange: WorkspaceRangePreset
  contextualHelp: boolean
  releaseHighlights: boolean
}

interface StoredProductPreferences extends ProductPreferences {
  version: typeof PRODUCT_PREFERENCES_VERSION
}

export const DEFAULT_PRODUCT_PREFERENCES: Readonly<ProductPreferences> =
  Object.freeze({
    persona: 'owner',
    landingPage: '/',
    defaultVehicleId: null,
    defaultAnalysisRange: '7d',
    contextualHelp: true,
    releaseHighlights: true,
  })

function isProductPersona(value: unknown): value is ProductPersona {
  return (
    typeof value === 'string' &&
    (PRODUCT_PERSONAS as readonly string[]).includes(value)
  )
}

function isProductLandingPage(value: unknown): value is ProductLandingPage {
  return (
    typeof value === 'string' &&
    (PRODUCT_LANDING_PAGES as readonly string[]).includes(value)
  )
}

function sanitizeVehicleId(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null
}

export function sanitizeProductPreferences(
  value: unknown,
): ProductPreferences {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_PRODUCT_PREFERENCES }
  }

  const candidate = value as Record<string, unknown>
  return {
    persona: isProductPersona(candidate.persona)
      ? candidate.persona
      : DEFAULT_PRODUCT_PREFERENCES.persona,
    landingPage: isProductLandingPage(candidate.landingPage)
      ? candidate.landingPage
      : DEFAULT_PRODUCT_PREFERENCES.landingPage,
    defaultVehicleId: sanitizeVehicleId(candidate.defaultVehicleId),
    defaultAnalysisRange: isWorkspaceRangePreset(
      candidate.defaultAnalysisRange,
    )
      ? candidate.defaultAnalysisRange
      : DEFAULT_PRODUCT_PREFERENCES.defaultAnalysisRange,
    contextualHelp:
      typeof candidate.contextualHelp === 'boolean'
        ? candidate.contextualHelp
        : DEFAULT_PRODUCT_PREFERENCES.contextualHelp,
    releaseHighlights:
      typeof candidate.releaseHighlights === 'boolean'
        ? candidate.releaseHighlights
        : DEFAULT_PRODUCT_PREFERENCES.releaseHighlights,
  }
}

function readStoredPreferences(): ProductPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PRODUCT_PREFERENCES }
  }

  try {
    const raw = window.localStorage.getItem(PRODUCT_PREFERENCES_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PRODUCT_PREFERENCES }

    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !==
        PRODUCT_PREFERENCES_VERSION
    ) {
      return { ...DEFAULT_PRODUCT_PREFERENCES }
    }
    return sanitizeProductPreferences(parsed)
  } catch {
    return { ...DEFAULT_PRODUCT_PREFERENCES }
  }
}

let snapshot = readStoredPreferences()
let serializedSnapshot = JSON.stringify(snapshot)
let hasUnpersistedChanges = false
const listeners = new Set<() => void>()
let storageListenerAttached = false

function replaceSnapshot(next: ProductPreferences): boolean {
  const serialized = JSON.stringify(next)
  if (serialized === serializedSnapshot) return false
  snapshot = next
  serializedSnapshot = serialized
  return true
}

function refreshSnapshot(): boolean {
  return replaceSnapshot(readStoredPreferences())
}

function notifyListeners(): void {
  for (const listener of listeners) listener()
}

export function getProductPreferencesSnapshot(): ProductPreferences {
  return snapshot
}

export function getProductPreferencesStoreSnapshot(): ProductPreferences {
  return snapshot
}

export function getProductPreferencesServerSnapshot(): ProductPreferences {
  return DEFAULT_PRODUCT_PREFERENCES
}

export function subscribeProductPreferences(
  listener: () => void,
): () => void {
  if (!hasUnpersistedChanges) refreshSnapshot()
  listeners.add(listener)
  if (
    !storageListenerAttached &&
    typeof window !== 'undefined'
  ) {
    window.addEventListener('storage', handleStorage)
    storageListenerAttached = true
  }

  return () => {
    listeners.delete(listener)
    if (
      listeners.size === 0 &&
      storageListenerAttached &&
      typeof window !== 'undefined'
    ) {
      window.removeEventListener('storage', handleStorage)
      storageListenerAttached = false
    }
  }
}

function handleStorage(event: StorageEvent): void {
  if (
    event.key !== PRODUCT_PREFERENCES_STORAGE_KEY &&
    event.key !== null
  ) {
    return
  }
  hasUnpersistedChanges = false
  if (refreshSnapshot()) notifyListeners()
}

export function updateProductPreferences(
  patch: Partial<ProductPreferences>,
): ProductPreferences {
  const next = sanitizeProductPreferences({
    ...snapshot,
    ...patch,
  })

  if (typeof window !== 'undefined') {
    const stored: StoredProductPreferences = {
      version: PRODUCT_PREFERENCES_VERSION,
      ...next,
    }
    try {
      window.localStorage.setItem(
        PRODUCT_PREFERENCES_STORAGE_KEY,
        JSON.stringify(stored),
      )
      hasUnpersistedChanges = false
    } catch {
      // The current tab keeps the in-memory preference when storage is blocked.
      hasUnpersistedChanges = true
    }
  }

  if (replaceSnapshot(next)) notifyListeners()
  return next
}

export function resetProductPreferences(): ProductPreferences {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(PRODUCT_PREFERENCES_STORAGE_KEY)
      hasUnpersistedChanges = false
    } catch {
      // The current tab can still return to defaults when storage is blocked.
      hasUnpersistedChanges = true
    }
  }

  const next = { ...DEFAULT_PRODUCT_PREFERENCES }
  if (replaceSnapshot(next)) notifyListeners()
  return next
}
