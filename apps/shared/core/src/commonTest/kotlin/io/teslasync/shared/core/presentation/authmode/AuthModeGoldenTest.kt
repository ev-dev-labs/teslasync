package io.teslasync.shared.core.presentation.authmode

import io.teslasync.shared.core.data.repo.AuthModeResponse
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors (apps/shared/core/spec/auth-mode-golden.json)
 * through [AuthModeDerivations]. The same fixture pins the Windows C# port so the
 * `isForwardAuth` and `subject` derivations cannot drift across platforms (ADR-004).
 */
class AuthModeGoldenTest {
    @Serializable
    private data class GoldenResponse(
        val mode: String,
        val subject: String? = null,
    )

    @Serializable
    private data class GoldenExpected(
        val is_forward_auth: Boolean,
        val subject: String? = null,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val response: GoldenResponse? = null,
        val expected: GoldenExpected,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readAuthModeGoldenJson())

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(all.size >= 6, "golden fixture should cover null, open, forward-auth + boundaries, got ${all.size}")
    }

    @Test
    fun everyScenarioMatchesDerivationOutput() {
        for (scenario in scenarios()) {
            val response =
                scenario.response?.let {
                    AuthModeResponse(mode = it.mode, subject = it.subject)
                }
            assertEquals(
                scenario.expected.is_forward_auth,
                AuthModeDerivations.isForwardAuth(response),
                "scenario '${scenario.name}' isForwardAuth mismatch",
            )
            assertEquals(
                scenario.expected.subject,
                AuthModeDerivations.subject(response),
                "scenario '${scenario.name}' subject mismatch",
            )
        }
    }
}
