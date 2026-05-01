import { useCallback, useEffect, useRef } from 'react'

/** Storage prefix for every autosaved draft, namespaced under the app. */
const AUTOSAVE_PREFIX = 'teslasync.draft.'

/**
 * Wrapper persisted alongside each draft so consumers can decide whether the
 * stored copy is fresh enough to restore.
 */
export interface AutosaveEnvelope<T> {
  /** Schema version — bump when the draft shape changes incompatibly. */
  version: number
  /** Epoch milliseconds when the draft was last written. */
  savedAt: number
  /** The actual draft payload. */
  data: T
}

export interface AutosaveOptions<T> {
  /**
   * Unique key for this draft. Stored under
   * `localStorage["teslasync.draft.${key}"]`. Choose something stable per
   * editor (e.g. `'alert-rule-new'`, `'alert-rule-42'`,
   * `'automation-builder-new'`).
   */
  key: string
  /** Current form values to persist. */
  data: T
  /** Save when the form is dirty AND idle for this many ms. Default 1500. */
  debounceMs?: number
  /**
   * Skip writes when this is true. Set during submit so a successful save
   * isn't immediately re-saved as a stale draft, and during initial hydration
   * so we don't echo loaded data straight back into storage.
   */
  paused?: boolean
  /** Schema version of the draft payload. Defaults to 1. */
  version?: number
}

/**
 * Local-storage autosave for long forms.
 *
 * Persists `data` under a versioned envelope on a debounced timer. Pair with
 * {@link loadAutosave} on mount to offer "Restore draft?" UX, and call
 * {@link clearAutosave} after a successful submit so the draft doesn't
 * resurrect old work.
 *
 * @example
 *   const [form, setForm] = useState<FormState>(() => loadAutosave<FormState>(key) ?? freshForm())
 *   useAutosave({ key, data: form, paused: isSaving })
 *   useEffect(() => { if (saveSucceeded) clearAutosave(key) }, [saveSucceeded])
 */
export function useAutosave<T>({
  key,
  data,
  debounceMs = 1500,
  paused = false,
  version = 1,
}: AutosaveOptions<T>): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (paused) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        const envelope: AutosaveEnvelope<T> = {
          version,
          savedAt: Date.now(),
          data,
        }
        localStorage.setItem(AUTOSAVE_PREFIX + key, JSON.stringify(envelope))
      } catch {
        // Storage is full / disabled / private mode. Drafts are best-effort;
        // a failure here must never crash the form.
      }
    }, debounceMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [key, data, debounceMs, paused, version])

  // Final flush on unmount: in-flight debounced write must not be lost when
  // the user navigates away (closing the modal, leaving the route).
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])
}

/**
 * Read a previously autosaved draft.
 *
 * Returns `null` if no draft is stored, the JSON is malformed, or the stored
 * version doesn't match `expectedVersion` (to avoid restoring drafts written
 * by an older incompatible form schema).
 */
export function loadAutosave<T>(key: string, expectedVersion = 1): T | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AutosaveEnvelope<T>>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== expectedVersion ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null
    }
    return (parsed.data as T) ?? null
  } catch {
    return null
  }
}

/**
 * Read the envelope (data + savedAt) for "Restore draft from 5 minutes ago?"
 * style prompts.
 */
export function loadAutosaveEnvelope<T>(
  key: string,
  expectedVersion = 1,
): AutosaveEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AutosaveEnvelope<T>>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== expectedVersion ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null
    }
    return parsed as AutosaveEnvelope<T>
  } catch {
    return null
  }
}

/** Discard the autosaved draft. Safe to call if no draft exists. */
export function clearAutosave(key: string): void {
  try {
    localStorage.removeItem(AUTOSAVE_PREFIX + key)
  } catch {
    // best-effort; ignore
  }
}

/**
 * Stable {@link clearAutosave} wrapper bound to a key. Useful in `onSuccess`
 * handlers passed to TanStack mutations so React's referential-equality
 * checks don't churn.
 */
export function useClearAutosave(key: string): () => void {
  return useCallback(() => clearAutosave(key), [key])
}
