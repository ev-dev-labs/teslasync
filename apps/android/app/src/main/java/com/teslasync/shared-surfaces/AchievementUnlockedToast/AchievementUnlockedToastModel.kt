// Pure, framework-free model + projection + diagnostics for the AchievementUnlockedToast shared surface —
// the native analogue of everything the web source derives before returning JSX
// (web/src/components/feedback/AchievementUnlockedToast.tsx + its AchievementUnlockedToastStack). No Compose,
// no Android framework, no HTTP: every declaration here is exercised off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a celebratory,
// role="status" toast stack fed by the realtime `useAchievementUnlocks` queue (an SSE-driven, transient,
// newest-first, de-duped list of `achievement_unlocked` events). Each toast pairs an AchievementBadge with an
// "Achievement Unlocked" eyebrow, the name, the description, a "View →" deep link, and a dismiss control, plus
// a confetti burst that is suppressed under reduced motion. The stack renders one toast per queued unlock and
// nothing when the queue is empty; each toast auto-dismisses after `durationMs` (6s) and re-acks the unlock.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002, ADR-009): the surface binds the
// shared `AchievementUnlocksStore` (the `useAchievementUnlocks` port — the unlock queue) for its content, and
// the app-scoped live pipeline (`LiveSessionStore`, the `useLiveConnection` port) for the wire health the SSE
// unlocks ride on. The platform "every state renders" contract is honoured honestly off that real lifecycle —
// never an invented state (covenant: no silent drift): a queued unlock is [AchievementToastPhase.Content]; a
// live wire with an empty queue is [AchievementToastPhase.Empty]; a cold/never-connected or reconnecting wire
// with nothing cached is [AchievementToastPhase.Loading]; a dropped wire with nothing cached is
// [AchievementToastPhase.Error] (a retry/reconnect surface). The >2-minute stale window and a degraded wire
// while cached unlocks are still showing are carried as [AchievementToastFeed.stale] / [offline] so the
// content surfaces a freshness chip rather than blanking. Everything below is framework-free so the whole
// contract is covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AchievementUnlockedToast — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.featureviews.achievementbadge.AchievementData
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.achievementunlocks.AchievementUnlockedEvent
import io.teslasync.shared.core.presentation.achievementunlocks.LifetimeAchievement

/**
 * Canonical registry metadata for the AchievementUnlockedToast surface. The diagnostics [SLUG] is emitted
 * with the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates; [ID] is the
 * stable `viewModel` key a host binds the surface with.
 */
object AchievementUnlockedToastRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the toast stack with). */
    const val ID: String = "achievement-unlocked-toast"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AchievementUnlockedToast"

    /** Auto-dismiss lifetime per toast, mirroring the web `durationMs = 6000` default. */
    const val DEFAULT_DURATION_MS: Long = 6_000L
}

/**
 * The mutually-exclusive primary surface the toast stack renders — the native analogue of the web stack's
 * empty-vs-populated branch, widened to the platform loading/error states the SSE wire-health lifecycle makes
 * real. Every value paints a non-blank surface (no hidden states):
 *  - [Loading] the wire is connecting / reconnecting and nothing is cached yet — a "listening" skeleton;
 *  - [Empty] the wire is live but no unlock has arrived this session — a friendly empty state;
 *  - [Content] one or more queued unlocks — the celebratory toast stack;
 *  - [Error] the wire is down with nothing cached — a reconnect/retry surface.
 */
enum class AchievementToastPhase { Loading, Empty, Content, Error }

/**
 * One render-ready toast — the native analogue of a single web `<AchievementUnlockedToast>` in the stack.
 * Pure data (no Compose types): [id] is the `achievement.id` (the queue key, the dismiss target, and the
 * "View" deep-link argument), and [achievement] is the badge/name/description payload.
 */
data class AchievementToast(
    val id: String,
    val achievement: AchievementData,
)

/**
 * The fully-folded, render-ready state the composable paints — the native mirror of everything the web stack
 * decides between the `useAchievementUnlocks` queue, the wire health, and the rendered toasts. Pure data (no
 * Compose types) so the whole contract is unit-tested without a UI host.
 *
 * @property phase the primary surface to render.
 * @property toasts the queued unlocks as render-ready toasts, newest-first (web `events.map(...)`); empty
 *   except in [AchievementToastPhase.Content].
 * @property connection the underlying live wire health the unlocks stream over (carried for the chip + tests).
 * @property stale whether the open wire has gone silent past the freshness window (ADR-013) while cached
 *   unlocks are still showing — drives the content freshness chip + the auto-refresh.
 * @property offline whether the wire is degraded (reconnecting/down) while cached unlocks are still showing —
 *   the "last known + offline chip" surface; the toasts stay visible, never hidden.
 * @property refreshing whether a reconnect is in flight over existing content (web reconnecting wire).
 * @property lastMessageAtMillis client clock of the last live message, or `null` when none yet — feeds the
 *   content freshness chip's relative-time stamp.
 */
data class AchievementToastFeed(
    val phase: AchievementToastPhase,
    val toasts: List<AchievementToast>,
    val connection: LiveConnectionStatus,
    val stale: Boolean,
    val offline: Boolean,
    val refreshing: Boolean,
    val lastMessageAtMillis: Long?,
) {
    /** True while a first connection is in flight with nothing to show. */
    val isLoading: Boolean get() = phase == AchievementToastPhase.Loading

    /** True when there is at least one toast to celebrate. */
    val isContent: Boolean get() = phase == AchievementToastPhase.Content

    /** True when the wire is live but the queue is empty. */
    val isEmpty: Boolean get() = phase == AchievementToastPhase.Empty

    /** True when the wire is down with nothing cached — the retry surface. */
    val isError: Boolean get() = phase == AchievementToastPhase.Error

    /** True when a degraded-wire freshness chip (stale or offline) should accompany the content. */
    val showFreshnessChip: Boolean get() = isContent && (stale || offline)
}

/**
 * Pure projection of the unlock queue + live wire health into the render state — the native mirror of
 * everything the web stack decides before rendering its toasts. Framework-free so the whole contract is
 * covered by the JVM unit gate without a Compose host.
 */
object AchievementUnlockedToastProjection {
    /** The initial, pre-collection state: a cold start that has never connected and has no toasts. */
    fun loading(): AchievementToastFeed =
        AchievementToastFeed(
            phase = AchievementToastPhase.Loading,
            toasts = emptyList(),
            connection = LiveConnectionStatus.Unknown,
            stale = false,
            offline = false,
            refreshing = false,
            lastMessageAtMillis = null,
        )

    /**
     * Folds the newest-first [unlocks] queue (web `useAchievementUnlocks().recent`) and the live wire
     * [connection] / [stale] / [lastMessageAtMillis] into the render state. The queue decides content-vs-empty
     * exactly as the web stack does (`events.length`); the wire decides the loading/error chrome and the
     * stale/offline freshness flags, so every platform state renders off a real lifecycle without inventing
     * behaviour the source does not have.
     */
    fun project(
        unlocks: List<AchievementUnlockedEvent>,
        connection: LiveConnectionStatus,
        stale: Boolean,
        lastMessageAtMillis: Long? = null,
    ): AchievementToastFeed {
        val toasts = unlocks.map { it.toToast() }
        val hasContent = toasts.isNotEmpty()
        val degraded =
            connection == LiveConnectionStatus.Disconnected || connection == LiveConnectionStatus.Reconnecting
        val phase =
            when {
                hasContent -> AchievementToastPhase.Content
                connection == LiveConnectionStatus.Connected -> AchievementToastPhase.Empty
                connection == LiveConnectionStatus.Disconnected -> AchievementToastPhase.Error
                else -> AchievementToastPhase.Loading
            }
        return AchievementToastFeed(
            phase = phase,
            toasts = toasts,
            connection = connection,
            stale = stale && hasContent,
            offline = degraded && hasContent,
            refreshing = connection == LiveConnectionStatus.Reconnecting,
            lastMessageAtMillis = lastMessageAtMillis,
        )
    }
}

/**
 * Maps the shared [LifetimeAchievement] (the `useAchievementUnlocks` event payload) onto the
 * [AchievementData] the native AchievementBadge renders. The two carry identical fields (id, name,
 * description, icon, unlocked, unlocked_at, progress/target/current); this is the one structural seam between
 * the unlock-feed model and the badge surface.
 */
fun LifetimeAchievement.toAchievementData(): AchievementData =
    AchievementData(
        id = id,
        name = name,
        description = description,
        icon = icon,
        unlocked = unlocked,
        unlockedAt = unlockedAt,
        progress = progress,
        target = target,
        current = current,
    )

/** Folds one queued [AchievementUnlockedEvent] into a render-ready [AchievementToast]. */
fun AchievementUnlockedEvent.toToast(): AchievementToast =
    AchievementToast(id = achievement.id, achievement = achievement.toAchievementData())

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [AchievementUnlockedToastRegistration.SLUG] (P1/S11) — never an achievement name, id, or unlock timestamp,
 * so a diagnostics line can never leak a user's achievement posture. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordAchievementUnlockedToastOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AchievementUnlockedToastRegistration.SLUG))
}
