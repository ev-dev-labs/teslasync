import { useCallback, useSyncExternalStore } from 'react'
import {
  getProductPreferencesServerSnapshot,
  getProductPreferencesStoreSnapshot,
  resetProductPreferences,
  subscribeProductPreferences,
  updateProductPreferences,
  type ProductPreferences,
} from '@/lib/productPreferences'

export interface UseProductPreferencesResult {
  preferences: ProductPreferences
  updatePreferences: (
    patch: Partial<ProductPreferences>,
  ) => ProductPreferences
  resetPreferences: () => ProductPreferences
}

export function useProductPreferences(): UseProductPreferencesResult {
  const preferences = useSyncExternalStore(
    subscribeProductPreferences,
    getProductPreferencesStoreSnapshot,
    getProductPreferencesServerSnapshot,
  )

  const updatePreferences = useCallback(
    (patch: Partial<ProductPreferences>) =>
      updateProductPreferences(patch),
    [],
  )
  const resetPreferences = useCallback(() => resetProductPreferences(), [])

  return {
    preferences,
    updatePreferences,
    resetPreferences,
  }
}
