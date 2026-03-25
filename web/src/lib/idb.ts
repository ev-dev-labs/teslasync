import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface TeslaSyncDB extends DBSchema {
  vehicles: {
    key: number
    value: {
      id: number
      vehicle_id: number
      vin: string
      display_name: string
      model: string
      state: string
      updated_at: string
      _cached_at: number
    }
    indexes: { 'by-vin': string }
  }
  'vehicle-states': {
    key: number
    value: {
      vehicle_id: number
      battery_level: number
      rated_range: number
      ideal_range: number
      odometer: number
      latitude: number
      longitude: number
      speed: number | null
      inside_temp: number | null
      outside_temp: number | null
      is_climate_on: boolean
      is_locked: boolean
      sentry_mode: boolean
      software_version: string
      _cached_at: number
    }
  }
  drives: {
    key: number
    value: {
      id: number
      vehicle_id: number
      start_date: string
      end_date: string
      distance: number
      duration_min: number
      start_range_km: number
      end_range_km: number
      start_battery_level: number
      end_battery_level: number
      speed_max: number
      _cached_at: number
    }
    indexes: { 'by-vehicle': number; 'by-date': string }
  }
  charges: {
    key: number
    value: {
      id: number
      vehicle_id: number
      start_date: string
      end_date: string
      charge_energy_added: number
      start_battery_level: number
      end_battery_level: number
      charger_power: number
      cost: number | null
      duration_min: number
      _cached_at: number
    }
    indexes: { 'by-vehicle': number; 'by-date': string }
  }
  alerts: {
    key: number
    value: {
      id: number
      vehicle_id: number
      type: string
      severity: string
      title: string
      message: string
      read: boolean
      created_at: string
      _cached_at: number
    }
    indexes: { 'by-vehicle': number }
  }
  'sync-queue': {
    key: string
    value: {
      id: string
      type: 'command' | 'export' | 'setting'
      vehicleId?: number
      command?: string
      params?: Record<string, unknown>
      payload?: Record<string, unknown>
      timestamp: number
      status: 'pending' | 'syncing' | 'failed'
      retries: number
      error?: string
    }
  }
  'cache-meta': {
    key: string
    value: {
      key: string
      cachedAt: number
      expiresAt: number
    }
  }
}

const DB_NAME = 'teslasync'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<TeslaSyncDB>> | null = null

export function getDB(): Promise<IDBPDatabase<TeslaSyncDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TeslaSyncDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Vehicles
        if (!db.objectStoreNames.contains('vehicles')) {
          const vehicleStore = db.createObjectStore('vehicles', { keyPath: 'id' })
          vehicleStore.createIndex('by-vin', 'vin', { unique: true })
        }
        // Vehicle states
        if (!db.objectStoreNames.contains('vehicle-states')) {
          db.createObjectStore('vehicle-states', { keyPath: 'vehicle_id' })
        }
        // Drives
        if (!db.objectStoreNames.contains('drives')) {
          const driveStore = db.createObjectStore('drives', { keyPath: 'id' })
          driveStore.createIndex('by-vehicle', 'vehicle_id')
          driveStore.createIndex('by-date', 'start_date')
        }
        // Charges
        if (!db.objectStoreNames.contains('charges')) {
          const chargeStore = db.createObjectStore('charges', { keyPath: 'id' })
          chargeStore.createIndex('by-vehicle', 'vehicle_id')
          chargeStore.createIndex('by-date', 'start_date')
        }
        // Alerts
        if (!db.objectStoreNames.contains('alerts')) {
          const alertStore = db.createObjectStore('alerts', { keyPath: 'id' })
          alertStore.createIndex('by-vehicle', 'vehicle_id')
        }
        // Sync queue
        if (!db.objectStoreNames.contains('sync-queue')) {
          db.createObjectStore('sync-queue', { keyPath: 'id' })
        }
        // Cache metadata
        if (!db.objectStoreNames.contains('cache-meta')) {
          db.createObjectStore('cache-meta', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

// Cache tiers (in seconds)
const CACHE_TIERS = {
  hot: 60 * 60,           // 1 hour
  warm: 24 * 60 * 60,     // 1 day
  cold: 7 * 24 * 60 * 60, // 7 days
} as const

type CacheTier = keyof typeof CACHE_TIERS

export async function cacheVehicles(vehicles: TeslaSyncDB['vehicles']['value'][]) {
  const db = await getDB()
  const tx = db.transaction('vehicles', 'readwrite')
  const now = Date.now()
  await Promise.all([
    ...vehicles.map(v => tx.store.put({ ...v, _cached_at: now })),
    tx.done,
  ])
}

export async function getCachedVehicles(): Promise<TeslaSyncDB['vehicles']['value'][]> {
  const db = await getDB()
  return db.getAll('vehicles')
}

export async function cacheVehicleState(state: TeslaSyncDB['vehicle-states']['value']) {
  const db = await getDB()
  await db.put('vehicle-states', { ...state, _cached_at: Date.now() })
}

export async function getCachedVehicleState(vehicleId: number) {
  const db = await getDB()
  return db.get('vehicle-states', vehicleId)
}

export async function cacheDrives(drives: TeslaSyncDB['drives']['value'][]) {
  const db = await getDB()
  const tx = db.transaction('drives', 'readwrite')
  const now = Date.now()
  await Promise.all([
    ...drives.map(d => tx.store.put({ ...d, _cached_at: now })),
    tx.done,
  ])
}

export async function getCachedDrives(vehicleId?: number): Promise<TeslaSyncDB['drives']['value'][]> {
  const db = await getDB()
  if (vehicleId) {
    return db.getAllFromIndex('drives', 'by-vehicle', vehicleId)
  }
  return db.getAll('drives')
}

export async function cacheCharges(charges: TeslaSyncDB['charges']['value'][]) {
  const db = await getDB()
  const tx = db.transaction('charges', 'readwrite')
  const now = Date.now()
  await Promise.all([
    ...charges.map(c => tx.store.put({ ...c, _cached_at: now })),
    tx.done,
  ])
}

export async function getCachedCharges(vehicleId?: number) {
  const db = await getDB()
  if (vehicleId) return db.getAllFromIndex('charges', 'by-vehicle', vehicleId)
  return db.getAll('charges')
}

export async function cacheAlerts(alerts: TeslaSyncDB['alerts']['value'][]) {
  const db = await getDB()
  const tx = db.transaction('alerts', 'readwrite')
  const now = Date.now()
  await Promise.all([
    ...alerts.map(a => tx.store.put({ ...a, _cached_at: now })),
    tx.done,
  ])
}

export async function getCachedAlerts() {
  const db = await getDB()
  return db.getAll('alerts')
}

// Sync queue operations
export async function addToSyncQueue(item: Omit<TeslaSyncDB['sync-queue']['value'], 'id' | 'timestamp' | 'status' | 'retries'>) {
  const db = await getDB()
  const entry: TeslaSyncDB['sync-queue']['value'] = {
    ...item,
    id: `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    status: 'pending',
    retries: 0,
  }
  await db.put('sync-queue', entry)
  // Request background sync if available
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready
    try {
      await (reg as any).sync.register(item.type === 'command' ? 'sync-commands' : 'sync-export-jobs')
    } catch {
      // Background sync not available — will sync on next online event
    }
  }
  return entry
}

export async function getSyncQueue(): Promise<TeslaSyncDB['sync-queue']['value'][]> {
  const db = await getDB()
  return db.getAll('sync-queue')
}

export async function removeSyncQueueItem(id: string) {
  const db = await getDB()
  await db.delete('sync-queue', id)
}

export async function updateSyncQueueItem(id: string, updates: Partial<TeslaSyncDB['sync-queue']['value']>) {
  const db = await getDB()
  const item = await db.get('sync-queue', id)
  if (item) {
    await db.put('sync-queue', { ...item, ...updates })
  }
}

// Cache metadata
export async function setCacheMeta(key: string, tier: CacheTier = 'warm') {
  const db = await getDB()
  const now = Date.now()
  await db.put('cache-meta', {
    key,
    cachedAt: now,
    expiresAt: now + CACHE_TIERS[tier] * 1000,
  })
}

export async function isCacheValid(key: string): Promise<boolean> {
  const db = await getDB()
  const meta = await db.get('cache-meta', key)
  if (!meta) return false
  return Date.now() < meta.expiresAt
}

// Storage quota management
export async function getStorageEstimate(): Promise<{ usage: number; quota: number; percent: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage || 0
    const quota = estimate.quota || 0
    return { usage, quota, percent: quota > 0 ? (usage / quota) * 100 : 0 }
  }
  return { usage: 0, quota: 0, percent: 0 }
}

// Evict old data based on tier
export async function evictExpiredCache() {
  const db = await getDB()
  const now = Date.now()
  const maxAge = CACHE_TIERS.cold * 1000

  // Evict old drives
  const drives = await db.getAll('drives')
  const tx1 = db.transaction('drives', 'readwrite')
  for (const drive of drives) {
    if (now - drive._cached_at > maxAge) {
      await tx1.store.delete(drive.id)
    }
  }
  await tx1.done

  // Evict old charges
  const charges = await db.getAll('charges')
  const tx2 = db.transaction('charges', 'readwrite')
  for (const charge of charges) {
    if (now - charge._cached_at > maxAge) {
      await tx2.store.delete(charge.id)
    }
  }
  await tx2.done

  // Evict old alerts
  const alerts = await db.getAll('alerts')
  const tx3 = db.transaction('alerts', 'readwrite')
  for (const alert of alerts) {
    if (now - alert._cached_at > maxAge) {
      await tx3.store.delete(alert.id)
    }
  }
  await tx3.done

  // Clean expired cache metadata
  const metas = await db.getAll('cache-meta')
  const tx4 = db.transaction('cache-meta', 'readwrite')
  for (const meta of metas) {
    if (now > meta.expiresAt) {
      await tx4.store.delete(meta.key)
    }
  }
  await tx4.done
}

// Clear all cached data
export async function clearAllCachedData() {
  const db = await getDB()
  const stores = ['vehicles', 'vehicle-states', 'drives', 'charges', 'alerts', 'cache-meta'] as const
  for (const store of stores) {
    await db.clear(store)
  }
}
