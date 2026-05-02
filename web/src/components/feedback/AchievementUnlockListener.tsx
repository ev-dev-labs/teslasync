import { useEffect, useMemo } from 'react'
import { useAchievementUnlocks } from '@/api/hooks/useAchievementUnlocks'
import { useAchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs'
import { AchievementUnlockedToastStack } from './AchievementUnlockedToast'

/**
 * AchievementUnlockListener — mounts at the app root, subscribes to the
 * realtime `achievement_unlocked` SSE stream, and renders the celebration
 * toast stack (Phase-40 / Prompt 63).
 *
 * Behaviour:
 * - When the user has disabled "Show celebration toasts" in settings, the
 *   stack still mounts (so `useAchievementUnlocks` keeps draining the SSE
 *   queue) but no visible toast is rendered. This way the dashboard widget
 *   and the inbox-style surfacing still receive the events; we just don't
 *   pop a transient celebration.
 * - Optional unlock chime: when `playSound` is enabled, a short procedural
 *   tone is generated via the WebAudio API (no audio asset required —
 *   keeps the bundle slim and works offline).
 */
export function AchievementUnlockListener() {
  const { recent, dismiss } = useAchievementUnlocks()
  const prefs = useAchievementCelebrationPrefs()

  // Procedural chime via WebAudio. Cached per mount so we don't allocate
  // an AudioContext until the user actually opts into sound.
  const audio = useMemo<{ ctx: AudioContext | null }>(() => ({ ctx: null }), [])

  useEffect(() => {
    if (!prefs.playSound) return
    if (recent.length === 0) return
    // Only play for the most recent unlock that hasn't been chimed; we treat
    // every render of `recent[0]` as the trigger because dismiss() removes
    // entries after they are acknowledged.
    try {
      type WindowWithLegacyAudio = Window & {
        webkitAudioContext?: typeof AudioContext
      }
      const Ctor = window.AudioContext || (window as WindowWithLegacyAudio).webkitAudioContext
      if (!Ctor) return
      if (!audio.ctx) audio.ctx = new Ctor()
      const ctx = audio.ctx
      const now = ctx.currentTime
      // Two-note "ding" — perfect fifth (E5 → B5).
      const noteFreqs = [659.25, 987.77]
      noteFreqs.forEach((freq, i) => {
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
  // We intentionally key on `recent.length` (not the full array) so we only
  // chime when a new event arrives, not on unrelated re-renders.
  }, [recent.length, prefs.playSound, audio])

  // Skip rendering the visible stack when the user has opted out, but still
  // keep the hook subscription live so the SSE queue is drained.
  if (!prefs.showToasts) return null

  return <AchievementUnlockedToastStack events={recent} onDismiss={dismiss} />
}
