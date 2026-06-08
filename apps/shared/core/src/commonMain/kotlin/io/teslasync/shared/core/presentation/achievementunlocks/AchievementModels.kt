package io.teslasync.shared.core.presentation.achievementunlocks

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A gamified lifetime milestone badge, mirroring the web `LifetimeAchievement`
 * interface (web/src/api/hooks/useAnalytics.ts) and the Go `Achievement` struct
 * (internal/api/lifetime/handler.go). All numeric fields are SI/unitless counts
 * — conversion, when any, happens only at the display boundary (S5).
 *
 * Optional fields carry lenient defaults so a partial server payload still
 * decodes; only [id] is treated as required by the unlock pipeline.
 */
@Serializable
public data class LifetimeAchievement(
    val id: String,
    val name: String = "",
    val description: String = "",
    val icon: String = "",
    val unlocked: Boolean = false,
    @SerialName("unlocked_at") val unlockedAt: String? = null,
    val progress: Double = 0.0,
    val target: Double = 0.0,
    val current: Double = 0.0,
)

/**
 * The `achievement_unlocked` SSE payload, mirroring the Go
 * `achievementUnlockedEvent` struct and the web `AchievementUnlockedEvent`
 * interface. Keys arrive snake_case on the raw SSE stream (no camelCase
 * transform), matched here via [SerialName].
 *
 * [vehicleId] is `0` for a fleet-wide unlock. Defaults keep decoding lenient
 * for these non-identifying fields, exactly as the web hook only guards on
 * `achievement.id`.
 */
@Serializable
public data class AchievementUnlockedEvent(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    @SerialName("unlocked_at") val unlockedAt: String = "",
    val achievement: LifetimeAchievement,
)
