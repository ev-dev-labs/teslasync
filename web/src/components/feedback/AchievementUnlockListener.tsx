import { useEffect, useRef } from 'react'
import { useAchievementUnlocks } from '@/api/hooks/useAchievementUnlocks'
import { useAchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs'
import { AchievementUnlockedToastStack } from './AchievementUnlockedToast'

type WindowWithLegacyAudio = Window & {
  webkitAudioContext?: typeof AudioContext
}

// Two-note "ding" — perfect fifth (E5 → B5), staggered by 120ms.
const CHIME_NOTE_FREQS = [659.25, 987.77] as const

/**
 * AchievementUnlockListener — mounts at the app root, subscribes to the
 * realtime `achievement_unlocked` SSE stream, and renders the celebration
 * toast stack ().
 *
 * Behaviour:
 * - When the user has disabled "Show celebration toasts" in settings, the
 * stack still mounts (so `useAchievementUnlocks` keeps draining the SSE
 * queue) but no visible toast is rendered. This way the dashboard widget
 * and the inbox-style surfacing still receive the events; we just don't
 * pop a transient celebration.
 * - Optional unlock chime: when `playSound` is enabled, a short procedural
 * tone is generated via the WebAudio API (no audio asset required —
 * keeps the bundle slim and works offline).
 */
export function AchievementUnlockListener() {
  const { recent, dismiss } = useAchievementUnlocks()
  const prefs = useAchievementCelebrationPrefs()

  // Lazily-created AudioContext, retained across renders. useRef (not useMemo)
  // because React is free to discard a memoised value and recompute it — a
  // dropped context would leak the underlying audio device and be re-created
  // on the next unlock.
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Achievement ids we've already chimed for. This is what lets us fire the
  // sound only when the queue GROWS (a genuinely new unlock) and stay silent
  // when it SHRINKS (the user dismissing one of several stacked toasts).
  const chimedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = recent.map(e => e.achievement.id)
    // A "new" unlock is any queued id we haven't chimed for yet.
    const hasNewUnlock = currentIds.some(id => !chimedIdsRef.current.has(id))
    // Re-key the seen-set to exactly the live queue. Marking ids seen even when
    // sound is off means flipping the toggle on later won't retro-chime the
    // existing backlog; pruning to `currentIds` keeps the set bounded (and lets
    // a re-surfaced unlock chime again).
    chimedIdsRef.current = new Set(currentIds)

    if (!prefs.playSound || !hasNewUnlock) return

    // Procedural chime via WebAudio — no audio asset required, keeps the bundle
    // slim and works offline.
    try {
      const Ctor = window.AudioContext || (window as WindowWithLegacyAudio).webkitAudioContext
      if (!Ctor) return
      if (!audioCtxRef.current) audioCtxRef.current = new Ctor()
      const ctx = audioCtxRef.current
      // Autoplay policy can leave a freshly-created context suspended until a
      // user gesture; toggling the setting is one, so resume best-effort.
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      const now = ctx.currentTime
      CHIME_NOTE_FREQS.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now + i * 0.12)
        gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + i * 0.12)
        osc.stop(now + i * 0.12 + 0.5)
      })
    } catch {
      // WebAudio not available (SSR, locked-down browser, autoplay policy
      // blocking before user gesture). Silently no-op — the visual
      // celebration is the primary affordance.
    }
  }, [recent, prefs.playSound])

  // Close the AudioContext on unmount so we don't leak an audio device handle
  // for a listener that lives at the app root for the whole session.
  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      if (!ctx || ctx.state === 'closed') return
      try {
        const result = ctx.close() as Promise<void> | undefined
        if (result && typeof result.catch === 'function') {
          result.catch(() => {})
        }
      } catch {
        // Best-effort teardown — nothing actionable if close() throws.
      }
    }
  }, [])

  // Skip rendering the visible stack when the user has opted out, but still
  // keep the hook subscription live so the SSE queue is drained.
  if (!prefs.showToasts) return null

  return <AchievementUnlockedToastStack events={recent} onDismiss={dismiss} />
}
