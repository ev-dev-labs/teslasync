package io.teslasync.shared.core.presentation.sessions

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors (apps/shared/core/spec/sessions-golden.json)
 * through [SessionsDerivations.sessionResponse]. The same fixture pins the Windows C# port so the
 * `sessions ?? []` normalisation (null→empty, order-preserving, no filtering of revoked rows)
 * cannot drift across platforms (ADR-004).
 */
class SessionsGoldenTest {
    @Serializable
    private data class GoldenExpected(
        val ids: List<String>,
        val count: Int,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val sessions: List<ActiveSession>? = null,
        val expected: GoldenExpected,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readSessionsGoldenJson())

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(all.size >= 6, "golden fixture should cover null/absent/empty/single/order/revoked, got ${all.size}")
    }

    @Test
    fun everyScenarioMatchesDerivationOutput() {
        for (scenario in scenarios()) {
            val response = SessionsDerivations.sessionResponse(scenario.sessions)
            assertEquals(
                scenario.expected.ids,
                response.sessions.map { it.id },
                "scenario '${scenario.name}' id ordering mismatch",
            )
            assertEquals(
                scenario.expected.count,
                response.sessions.size,
                "scenario '${scenario.name}' count mismatch",
            )
        }
    }
}
