package io.teslasync.shared.core.presentation.achievementunlocks

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * Pure, side-effect-free reduction logic for the AchievementUnlocks live feed,
 * extracted so the KMP state holder, its golden tests, and the future Windows
 * C# port all reduce identically (ADR-004). Mirrors the in-memory queue rules
 * of the web `useAchievementUnlocks` hook:
 *
 *  - newest-first ordering,
 *  - bounded to [MAX_RECENT] (oldest dropped first),
 *  - de-duplicated by `achievement.id` (a re-broadcast of an already-queued id
 *    is ignored rather than pushed again),
 *  - purely transient (no persistence).
 */
public object AchievementUnlocksReducer {
    /** Upper bound on the retained queue, matching the web `MAX_RECENT`. */
    public const val MAX_RECENT: Int = 25

    private val json: Json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

    /**
     * Folds [incoming] into [prev]. Returns [prev] unchanged when its
     * `achievement.id` is already queued (de-dup); otherwise prepends it
     * (newest-first) and truncates to [maxRecent].
     */
    public fun enqueue(
        prev: List<AchievementUnlockedEvent>,
        incoming: AchievementUnlockedEvent,
        maxRecent: Int = MAX_RECENT,
    ): List<AchievementUnlockedEvent> {
        if (prev.any { it.achievement.id == incoming.achievement.id }) return prev
        val next = listOf(incoming) + prev
        return if (next.size > maxRecent) next.subList(0, maxRecent).toList() else next
    }

    /** Removes the entry whose `achievement.id` equals [achievementId], if any. */
    public fun dismiss(
        prev: List<AchievementUnlockedEvent>,
        achievementId: String,
    ): List<AchievementUnlockedEvent> = prev.filterNot { it.achievement.id == achievementId }

    /**
     * Decodes the raw `achievement_unlocked` SSE `data:` object into a typed
     * [AchievementUnlockedEvent]. Returns `null` for a malformed payload or one
     * whose `achievement.id` is missing/empty — the same guard the web hook
     * applies (`!payload.achievement || !payload.achievement.id`) — so a single
     * bad frame is dropped rather than surfaced.
     */
    public fun decode(data: JsonObject): AchievementUnlockedEvent? =
        try {
            val event = json.decodeFromJsonElement(AchievementUnlockedEvent.serializer(), data)
            if (event.achievement.id.isEmpty()) null else event
        } catch (e: Exception) {
            null
        }
}
