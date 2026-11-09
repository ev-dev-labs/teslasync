interface NativeConnection {
  url?: unknown
  token?: unknown
}

interface NativeConnectionPlugin {
  load(): Promise<NativeConnection>
  save(connection: { url: string; token: string | null }): Promise<void>
  clear(): Promise<void>
}

export function nativeConnectionStorage(): NativeConnectionPlugin {
  const capacitor = (window as Window & {
    Capacitor?: { Plugins?: { ServerConnection?: NativeConnectionPlugin } }
  }).Capacitor
  const storage = capacitor?.Plugins?.ServerConnection
  if (!storage || typeof storage.load !== 'function' ||
      typeof storage.save !== 'function' || typeof storage.clear !== 'function') {
    throw new Error('Native connection storage is unavailable')
  }
  return storage
}
