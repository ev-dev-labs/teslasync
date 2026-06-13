// The data seam the AchievementUnlockedToast surface binds to — the native analogue of the hooks the web
// source composes: `useAchievementUnlocks` (the realtime unlock queue) and the live-wire health
// (`useLiveConnection`) the SSE unlocks stream over. The view-model depends on this abstraction (a real
// adapter over the shared P1/S8 holders in production, a fake/static in tests), never on a concrete store or
// the SSE client, so the view performs NO HTTP and opens no stream itself (ADR-002, ADR-009).
//
// The unlock queue is sourced from the shared `AchievementUnlocksStore` (the `useAchievementUnlocks` port —
// newest-first, bounded, de-duped) and the wire health from the app-scoped `LiveSessionStore` (the single
// live pipeline holder every live surface observes, ADR-009). Both flow onto the PII-free
// [AchievementFeedSnapshot] the projection folds; no vehicle id and no signal payload ever cross this seam.
// [dismiss] re-acks an unlock on the shared queue (web `dismiss(id)`) and [reconnect] forces a fresh wire
// (web freshness retry) — the two store mutations the surface needs, kept behind the seam so the view never
// touches a store directly.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockedToast) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.live.LiveSessionStore
import io.teslasync.shared.core.presentation.achievementunlocks.AchievementUnlockedEvent
import io.teslasync.shared.core.presentation.achievementunlocks.AchievementUnlocksStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf

/**
 * The PII-free snapshot the surface folds — the unlock queue paired with the wire health it streams over. It
 * carries no vehicle id and no signal payload, only the celebratory unlocks and the wire-health signals the
 * toast stack + its freshness chip render.
 *
 * @property unlocks the newest-first unlock queue (web `useAchievementUnlocks().recent`).
 * @property connection the live wire health the unlocks stream over (web `useLiveConnection().status`).
 * @property stale whether the open wire has gone silent past the freshness window (ADR-013).
 * @property lastMessageAtMillis client clock of the last live message, or `null` when none yet.
 */
data class AchievementFeedSnapshot(
    val unlocks: List<AchievementUnlockedEvent>,
    val connection: LiveConnectionStatus,
    val stale: Boolean,
    val lastMessageAtMillis: Long? = null,
)

/**
 * The seam the [AchievementUnlockedToastViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store or the SSE client. [feed] is the cold, lifecycle-aware unlock-queue +
 * wire-health stream; [dismiss] re-acks an unlock; [reconnect] forces a fresh wire. No HTTP touches the view.
 */
interface AchievementUnlockedToastSource {
    /** The unlock queue + wire health as a stream of PII-free [AchievementFeedSnapshot]s. */
    fun feed(): Flow<AchievementFeedSnapshot>

    /** Re-acks the queued unlock for [achievementId] (web `dismiss(id)`); a no-op if absent. */
    fun dismiss(achievementId: String)

    /** Forces a fresh live connection now (web freshness retry / the error-surface reconnect). */
    fun reconnect()
}

/**
 * Binds the surface to the shared **P1/S8** holders — the [AchievementUnlocksStore] (the
 * `useAchievementUnlocks` queue) and the app-scoped [LiveSessionStore] (the single live pipeline holder every
 * live surface observes, ADR-009). The two feeds are combined onto the PII-free [AchievementFeedSnapshot]: the
 * queue drives the toasts, the session frame's connection/staleness/last-message drives the chrome.
 * [dismiss] / [reconnect] route to the same shared holders, so the surface mutates the canonical state every
 * other achievement/live surface shares. No HTTP touches the view.
 */
fun achievementUnlockedToastSource(
    unlocks: AchievementUnlocksStore,
    live: LiveSessionStore,
): AchievementUnlockedToastSource =
    object : AchievementUnlockedToastSource {
        override fun feed(): Flow<AchievementFeedSnapshot> =
            combine(unlocks.recent, live.state) { recent, session ->
                AchievementFeedSnapshot(
                    unlocks = recent,
                    connection = session.status,
                    stale = session.isStale,
                    lastMessageAtMillis = session.lastMessageAtMillis,
                )
            }

        override fun dismiss(achievementId: String) = unlocks.dismiss(achievementId)

        override fun reconnect() = live.reconnect()
    }

/**
 * Builds a source from explicit pieces — the host wiring seam used when a caller already holds the feed (and
 * the test double used to drive each state deterministically). Mirrors the contract of the store adapter
 * above; [dismiss] / [reconnect] default to no-ops for read-only previews.
 */
fun achievementUnlockedToastSource(
    feed: () -> Flow<AchievementFeedSnapshot>,
    dismiss: (String) -> Unit = {},
    reconnect: () -> Unit = {},
): AchievementUnlockedToastSource =
    object : AchievementUnlockedToastSource {
        override fun feed(): Flow<AchievementFeedSnapshot> = feed()

        override fun dismiss(achievementId: String) = dismiss(achievementId)

        override fun reconnect() = reconnect()
    }

/**
 * A static, single-emission source for previews, tests, and any caller that already holds a resolved
 * [snapshot]. Emits it once as the surface's whole feed.
 */
fun staticAchievementUnlockedToastSource(
    snapshot: AchievementFeedSnapshot,
    dismiss: (String) -> Unit = {},
    reconnect: () -> Unit = {},
): AchievementUnlockedToastSource = achievementUnlockedToastSource({ flowOf(snapshot) }, dismiss, reconnect)
