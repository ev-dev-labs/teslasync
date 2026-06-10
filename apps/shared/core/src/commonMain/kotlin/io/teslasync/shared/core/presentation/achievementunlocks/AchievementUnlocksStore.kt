package io.teslasync.shared.core.presentation.achievementunlocks

import io.teslasync.shared.core.net.sse.LiveEvent
import io.teslasync.shared.core.net.sse.SseClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * UI-free shared state holder for the realtime AchievementUnlocks feed — the
 * cross-platform port of the web `useAchievementUnlocks` hook. Every native
 * AchievementUnlocks surface (Android/Apple via KMP, Windows via the C# port)
 * binds to this single holder rather than re-implementing the queue rules.
 *
 * It subscribes to the shared [SseClient] (the analog of the web `sseManager`),
 * keeps only `achievement_unlocked` frames, and maintains an in-memory queue
 * through [AchievementUnlocksReducer]: newest-first, bounded to [maxRecent],
 * de-duplicated by `achievement.id`. The queue is transient — restarting the
 * holder (or the app) clears it, matching the web hook's page-refresh semantics.
 *
 * Lifecycle mirrors the hook's mount/unmount: [start] opens the subscription
 * inside [scope]; [stop] (or cancelling [scope]) closes it. Consumers should
 * [dismiss] an entry once its celebration has been shown so re-renders do not
 * replay it.
 *
 * @property scope the coroutine scope the SSE collection runs in. Cancelling it
 *   tears the subscription down; the holder launches no work outside it.
 */
public class AchievementUnlocksStore(
    private val sseClient: SseClient,
    private val scope: CoroutineScope,
    private val maxRecent: Int = AchievementUnlocksReducer.MAX_RECENT,
) {
    init {
        require(maxRecent >= 1) { "maxRecent must be >= 1, was $maxRecent" }
    }

    private val _recent = MutableStateFlow<List<AchievementUnlockedEvent>>(emptyList())

    /** The current in-memory queue of unlocks, newest-first. */
    public val recent: StateFlow<List<AchievementUnlockedEvent>> = _recent.asStateFlow()

    private var job: Job? = null

    /**
     * Opens the live subscription and begins folding `achievement_unlocked`
     * events into [recent]. Idempotent: a second call while already running is
     * a no-op.
     */
    public fun start() {
        if (job?.isActive == true) return
        job =
            scope.launch {
                sseClient.subscribe().events.collect { event ->
                    if (event !is LiveEvent.AchievementUnlocked) return@collect
                    val payload = AchievementUnlocksReducer.decode(event.data) ?: return@collect
                    _recent.update { prev -> AchievementUnlocksReducer.enqueue(prev, payload, maxRecent) }
                }
            }
    }

    /** Closes the live subscription. The retained queue is left untouched. */
    public fun stop() {
        job?.cancel()
        job = null
    }

    /**
     * Removes the queued unlock for [achievementId] (no-op if absent) so an
     * already-acknowledged celebration is not replayed.
     */
    public fun dismiss(achievementId: String) {
        _recent.update { prev -> AchievementUnlocksReducer.dismiss(prev, achievementId) }
    }
}
