// Pure, framework-free model + reducer + surface classifier for the AchievementUnlockListener shared surface —
// the native analogue of everything the web component derives around its two hooks
// (web/src/components/feedback/AchievementUnlockListener.tsx → AchievementUnlockedToastStack).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface mounts at the app root, subscribes to the realtime `achievement_unlocked` SSE stream via
// `useAchievementUnlocks` (a newest-first, id-deduped, bounded in-memory queue with a `dismiss(id)`), reads the
// localStorage-backed `useAchievementCelebrationPrefs`, and renders `AchievementUnlockedToastStack`. Its three
// observable branches are reproduced here exactly (Honesty Covenant #9 — documented, not silent):
//   • `!prefs.showToasts`        => the visible stack is suppressed but the queue keeps draining (so the
//                                   dashboard widget / inbox surfacing still see events) => [ListenerSurface.Disabled]
//   • `showToasts && empty`      => the web renders an empty (zero-size) stack container => [ListenerSurface.Idle]
//   • `showToasts && non-empty`  => one celebration toast per pending unlock => [ListenerSurface.Celebrating]
//
// Mapping onto the P3 loading / empty / error / stale / offline vocabulary (templated state list): an unlock
// LISTENER is a fire-and-forget celebration overlay, not a data panel. The web component shows no spinner, no
// error card, and no stale/offline chrome — surfacing any of those at the app root would be a parity violation
// (and bad UX), and SSE connection health is owned by the dedicated live-connection UI, not by every consumer.
// So loading / error / stale / offline all collapse onto the dormant [ListenerSurface.Idle]/[Disabled] (an
// absent overlay — never a blank box), exactly as the accepted sibling AnimatedNumber surface documents having
// no such lifecycle. The reproduced web states (disabled / empty / celebrating) are each explicit, exhaustive,
// and unit-tested below.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AchievementUnlockListener — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling AIDriveCoaching / AnimatedNumber surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or any
 * achievement payload, so a diagnostics line can never leak the operator's fleet state.
 */
const val ACHIEVEMENT_UNLOCK_LISTENER_SLUG: String = "AchievementUnlockListener"

/**
 * Upper bound on the in-memory unlock queue — the native mirror of the web hook's `MAX_RECENT = 25`. Bounds
 * memory if the backend ever fires a burst (e.g. seed data on first run); the queue is purely transient and is
 * dropped when the holder clears.
 */
const val MAX_RECENT_UNLOCKS: Int = 25

/**
 * The listener's projection of the SSE `achievement` payload (web `LifetimeAchievement`) — the four fields the
 * celebration toast actually renders. The host adapter maps the richer wire object down to this; the toast shows
 * the [icon] badge, the [name], and the [description], and the View affordance deep-links by [id].
 *
 * @property id stable achievement identifier (web `achievement.id`); the de-dup key and the View deep-link key.
 * @property name the unlocked achievement's display name (web `achievement.name`).
 * @property description the achievement's one-line description (web `achievement.description`).
 * @property icon the achievement's emoji glyph (web `achievement.icon`); blank falls back to a party popper.
 */
data class Achievement(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
)

/**
 * One realtime unlock — the native analogue of the web `AchievementUnlockedEvent` (`vehicle_id`,
 * `unlocked_at`, `achievement`). [unlockedAt] is the raw ISO-8601 stamp from the wire (kept verbatim; the
 * listener does not render it) and [achievement] is the celebrated achievement.
 */
data class AchievementUnlock(
    val vehicleId: Long,
    val unlockedAt: String,
    val achievement: Achievement,
)

/**
 * The celebration preferences, mirroring the web `AchievementCelebrationPrefs` localStorage document and its
 * defaults. Only [showToasts] (gate the visible stack) and [playSound] (the unlock chime, opt-in) drive this
 * surface; [showOnDashboard] and [pushOnUnlock] are carried for parity (they belong to the dashboard widget /
 * push wiring) so the one prefs port stays faithful to the web shape.
 *
 * @property showToasts render the celebration toast on unlock (web default: on).
 * @property playSound play the unlock chime (web default: off — opt-in to avoid surprising users with audio).
 * @property showOnDashboard render the "Recently unlocked" widget content (web default: on).
 * @property pushOnUnlock gate push delivery for achievement events (web default: on).
 */
data class AchievementCelebrationPrefs(
    val showToasts: Boolean = true,
    val playSound: Boolean = false,
    val showOnDashboard: Boolean = true,
    val pushOnUnlock: Boolean = true,
)

/**
 * Folds one realtime [event] into the newest-first [queue], reproducing the web hook's `setRecent` reducer:
 * de-dup by `achievement.id` (a re-broadcast from a second SSE pod must not double-pop the celebration),
 * prepend the new unlock, and bound the result to [MAX_RECENT_UNLOCKS]. Returns [queue] unchanged when the id
 * is already queued, so the operation is idempotent per achievement.
 */
fun enqueueUnlock(
    queue: List<AchievementUnlock>,
    event: AchievementUnlock,
): List<AchievementUnlock> {
    if (queue.any { it.achievement.id == event.achievement.id }) return queue
    return (listOf(event) + queue).take(MAX_RECENT_UNLOCKS)
}

/**
 * Removes the unlock for [achievementId] from [queue] (web `dismiss(id)`), called once a toast has been shown or
 * the user dismisses it so re-renders never re-show an acknowledged celebration.
 */
fun dismissUnlock(
    queue: List<AchievementUnlock>,
    achievementId: String,
): List<AchievementUnlock> = queue.filterNot { it.achievement.id == achievementId }

/**
 * The render-ready projection of one queued unlock — the immutable data a single celebration toast draws. Kept
 * separate from [AchievementUnlock] so the view switches on a closed, test-built shape and never reaches back
 * into the wire model. [icon] is the resolved glyph (never blank — falls back to the party popper, web
 * `event.achievement.icon || '🎉'`).
 */
data class AchievementToast(
    val achievementId: String,
    val icon: String,
    val name: String,
    val description: String,
)

/** Web `event.achievement.icon || '🎉'` — the celebration glyph, falling back to a party popper when blank. */
const val FALLBACK_ACHIEVEMENT_ICON: String = "🎉"

/** Projects a queued [AchievementUnlock] into its render-ready [AchievementToast]. */
fun AchievementUnlock.toToast(): AchievementToast =
    AchievementToast(
        achievementId = achievement.id,
        icon = achievement.icon.ifBlank { FALLBACK_ACHIEVEMENT_ICON },
        name = achievement.name,
        description = achievement.description,
    )

/**
 * The immutable surface state the AchievementUnlockListenerViewModel exposes: the live celebration [prefs] (web
 * `useAchievementCelebrationPrefs`) and the newest-first unlock [queue] (web `useAchievementUnlocks.recent`).
 * The render boundary classifies this into a [ListenerSurface]; the queue keeps draining regardless of
 * [AchievementCelebrationPrefs.showToasts] so non-visible consumers still receive events (web parity).
 */
data class AchievementListenerState(
    val prefs: AchievementCelebrationPrefs = AchievementCelebrationPrefs(),
    val queue: List<AchievementUnlock> = emptyList(),
)

/**
 * The render-ready classification of [AchievementListenerState] — a closed set of mutually-exclusive surfaces
 * the view switches on, so every branch is exhaustively covered and unit-tested off-device. Reproduces the web
 * component's three observable branches; the dormant surfaces render no overlay at all (never a blank box).
 */
sealed interface ListenerSurface {
    /** Celebration toasts are disabled in prefs — the visible stack is suppressed (web `return null`). */
    data object Disabled : ListenerSurface

    /** Toasts are enabled but nothing is pending — the web renders an empty, zero-size stack container. */
    data object Idle : ListenerSurface

    /** One or more pending unlocks — the celebration stack, newest-first (web `recent.map(...)`). */
    data class Celebrating(
        val toasts: List<AchievementToast>,
    ) : ListenerSurface
}

/**
 * Selects the render-ready [ListenerSurface] for [state]. Pure (no Compose/clock): the gate
 * ([AchievementCelebrationPrefs.showToasts]) is checked before the queue, mirroring the web component's
 * early `if (!prefs.showToasts) return null` ahead of the stack render.
 */
fun classifyListener(state: AchievementListenerState): ListenerSurface =
    when {
        !state.prefs.showToasts -> ListenerSurface.Disabled
        state.queue.isEmpty() -> ListenerSurface.Idle
        else -> ListenerSurface.Celebrating(state.queue.map { it.toToast() })
    }

/**
 * Whether a newly-arrived unlock should fire the opt-in chime — the native decision behind the web effect that
 * keys on `recent.length` growing while `prefs.playSound` is on. True only when sound is enabled AND the queue
 * actually grew ([nextCount] > [previousCount]), so a de-duped re-broadcast (no growth) stays silent and an
 * unrelated re-render never re-chimes.
 */
fun shouldChime(
    prefs: AchievementCelebrationPrefs,
    previousCount: Int,
    nextCount: Int,
): Boolean = prefs.playSound && nextCount > previousCount

/**
 * Builds the merged accessibility announcement for one celebration toast from already-localized parts (web
 * `role="status"` + `aria-live="polite"` announces the eyebrow, name, and description as one polite block).
 * Kept pure so TalkBack-label presence is unit-tested without a Compose host.
 */
fun achievementToastLabel(
    eyebrow: String,
    name: String,
    description: String,
): String = "$eyebrow: $name. $description"
