package io.teslasync.shared.core.presentation.achievementunlocks

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors
 * (apps/shared/spec/achievement-unlocks-golden.json) through
 * [AchievementUnlocksReducer]. The same fixture pins the Windows C# port so the
 * de-dup / bound / ordering rules cannot drift across platforms (ADR-004).
 */
class AchievementUnlocksGoldenTest {
    @Serializable
    private data class GoldenOp(
        val op: String,
        val id: String,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val max_recent: Int,
        val ops: List<GoldenOp>,
        val expected_ids: List<String>,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readAchievementUnlocksGoldenJson())

    private fun eventOf(id: String): AchievementUnlockedEvent =
        AchievementUnlockedEvent(
            vehicleId = 1,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement = LifetimeAchievement(id = id, name = "n-$id"),
        )

    @Test
    fun goldenFileParsesAndIsNonEmpty() {
        val all = scenarios()
        assertTrue(all.size >= 7, "golden fixture should be comprehensive, got ${all.size}")
    }

    @Test
    fun everyScenarioMatchesReducerOutput() {
        for (scenario in scenarios()) {
            var state = emptyList<AchievementUnlockedEvent>()
            for (op in scenario.ops) {
                state =
                    when (op.op) {
                        "enqueue" ->
                            AchievementUnlocksReducer.enqueue(state, eventOf(op.id), scenario.max_recent)
                        "dismiss" -> AchievementUnlocksReducer.dismiss(state, op.id)
                        else -> error("unknown op ${op.op} in scenario ${scenario.name}")
                    }
            }
            assertEquals(
                scenario.expected_ids,
                state.map { it.achievement.id },
                "scenario '${scenario.name}' derivation mismatch",
            )
        }
    }
}
