import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { openDB } from 'idb'

const DB_NAME = 'teslasync-query-cache'
const STORE_NAME = 'query-client'
const KEY = 'persistedClient'

export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      const db = await openDB(DB_NAME, 1, {
        upgrade(database) {
          database.createObjectStore(STORE_NAME)
        },
      })
      await db.put(STORE_NAME, client, KEY)
    },
    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        const db = await openDB(DB_NAME, 1, {
          upgrade(database) {
            database.createObjectStore(STORE_NAME)
          },
        })
        return await db.get(STORE_NAME, KEY)
      } catch {
        return undefined
      }
    },
    removeClient: async () => {
      try {
        const db = await openDB(DB_NAME, 1, {
          upgrade(database) {
            database.createObjectStore(STORE_NAME)
          },
        })
        await db.delete(STORE_NAME, KEY)
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}
