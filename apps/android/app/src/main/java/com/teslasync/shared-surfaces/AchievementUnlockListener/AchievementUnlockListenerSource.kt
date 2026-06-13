// The single data port the AchievementUnlockListener shared surface binds to — the native analogue of the two
// hooks the web component composes (web/src/components/feedback/AchievementUnlockListener.tsx):
//   • `useAchievementUnlocks()`, the SSE consumer of the realtime `achievement_unlocked` stream, and
//   • `useAchievementCelebrationPrefs()`, the localStorage-backed celebration preferences.
// The view-model depends on this abstraction (a real adapter over the shared live/prefs layer in production, a
// fake in tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary,
// ADR-002).
//
// There is deliberately no concrete store binding here the way the data-layer ViewModels bind VehiclesStore /
// DashboardStore: the shared core's S8 layer ships the cache-then-network domain stores and the live signal
// pipeline, but no achievement-unlock *stream* store yet (the unlock SSE event is one of the live envelope
// kinds the LiveSessionStore already recognises — see `mergeLiveEvent`'s `achievement_unlocked` branch — but it
// is not yet projected into a typed feed). So the production adapter is wired by the host from (a) the live SSE
// `achievement_unlocked` frames and (b) the local celebration-prefs store, via [achievementUnlockListenerSource].
// A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockListener) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located factory alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import kotlinx.coroutines.flow.Flow

/**
 * The seam the AchievementUnlockListenerViewModel binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [unlocks] is the realtime unlock stream (web
 * `useAchievementUnlocks`); [celebrationPrefs] is the live preferences (web `useAchievementCelebrationPrefs`).
 * No HTTP touches the view.
 */
interface AchievementUnlockListenerSource {
    /**
     * The hot stream of realtime unlocks — the native analogue of the web `achievement_unlocked` SSE
     * subscription. Emits one [AchievementUnlock] per parsed frame for the lifetime of the subscription; the
     * view-model applies the de-dup + bound + dismiss queue logic on top (it is NOT pre-deduped here).
     */
    fun unlocks(): Flow<AchievementUnlock>

    /**
     * The live celebration preferences (web `useAchievementCelebrationPrefs`). Emits the current
     * [AchievementCelebrationPrefs] and re-emits whenever the user toggles a setting, so the surface reacts to
     * `showToasts` / `playSound` changes without a round-trip.
     */
    fun celebrationPrefs(): Flow<AchievementCelebrationPrefs>
}

/**
 * Builds an [AchievementUnlockListenerSource] from the two flows a host wires to the shared layer: [unlocks]
 * from the live SSE `achievement_unlocked` frames, and [celebrationPrefs] from the local celebration-prefs
 * store. This is the production seam; a test fake implements [AchievementUnlockListenerSource] directly instead.
 */
fun achievementUnlockListenerSource(
    unlocks: () -> Flow<AchievementUnlock>,
    celebrationPrefs: () -> Flow<AchievementCelebrationPrefs>,
): AchievementUnlockListenerSource =
    object : AchievementUnlockListenerSource {
        override fun unlocks(): Flow<AchievementUnlock> = unlocks()

        override fun celebrationPrefs(): Flow<AchievementCelebrationPrefs> = celebrationPrefs()
    }
