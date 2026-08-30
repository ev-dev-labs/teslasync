import { Suspense, lazy, useEffect, useRef } from 'react'
import { useAchievementUnlocks } from '@/api/hooks/useAchievementUnlocks'
import { useAchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs'
import { OptionalSurfaceBoundary } from './_OptionalSurfaceBoundary'

// CLEAN-06 — the celebration STACK is deferred, the SUBSCRIPTION is not.
//
// This listener is mounted at the app root, so anything it statically imports
// is cold-start weight. Importing the stack eagerly pulled
// `AchievementUnlockedToast` and, through it,
// `features/analytics/components/AchievementBadge` into the startup closure:
// a feature-domain component that can only ever paint after an SSE
// `achievement_unlocked` event arrives, i.e. never during first paint.
//
// The hook subscription, the SSE queue draining, the chime and the seen-set
// bookkeeping all stay eager and synchronous, so no event can be missed and
// the audible celebration is not delayed. Only the visual stack is fetched,
// and only once there is something to show — `Suspense fallback={null}` keeps
// the intermediate frame identical to the "no unlocks" frame that renders
// today.
//
// A lazy import can also REJECT — a stale hashed chunk after a deploy, or an
// offline first-unlock. Suspense does not catch that; the rejection is thrown
// during render and, with only the root <ErrorBoundary> above it, would
// replace the entire application with an error page (and, because the shared
// boundary treats chunk errors as recoverable, force a hard reload five
// seconds later) — all for a decorative toast. `OptionalSurfaceBoundary`
// contains it: renders nothing, reloads nothing, reports once.
const AchievementUnlockedToastStack = lazy(() =>
  import('./AchievementUnlockedToast').then((m) => ({ default: m.AchievementUnlockedToastStack })),
)

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

  // Nothing queued: do not fetch the stack chunk at all. This is what keeps a
  // normal session — which never unlocks anything — from paying for the
  // celebration UI.
  if (recent.length === 0) return null

  return (
    <OptionalSurfaceBoundary name="AchievementCelebration">
      <Suspense fallback={null}>
        <AchievementUnlockedToastStack events={recent} onDismiss={dismiss} />
      </Suspense>
    </OptionalSurfaceBoundary>
  )
}
