package io.teslasync.shared.core.presentation.totp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors (apps/shared/core/spec/totp-golden.json) through
 * [TOTPDerivations]. The same fixture pins the Windows C# port so the status reshape
 * (`backup_codes_remaining ?? 0`), the step-up expiry parse (`new Date(expires_at).getTime()`), and
 * the conditional step-up body assembly cannot drift across platforms (ADR-004).
 */
class TOTPGoldenTest {
    @Serializable
    private data class StatusExpected(
        val activated: Boolean,
        val last_used_at: String? = null,
        val backup_codes_remaining: Int,
    )

    @Serializable
    private data class StatusScenario(
        val name: String,
        val payload: TOTPStatusPayload,
        val expected: StatusExpected,
    )

    @Serializable
    private data class SudoExpiryScenario(
        val name: String,
        val expires_at: String,
        val expected_millis: Long,
    )

    @Serializable
    private data class StepUpScenario(
        val name: String,
        val code: String? = null,
        val backup_code: String? = null,
        val expected: Map<String, String>,
    )

    @Serializable
    private data class GoldenFixture(
        val status: List<StatusScenario>,
        val sudoExpiry: List<SudoExpiryScenario>,
        val stepUpBody: List<StepUpScenario>,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): GoldenFixture = json.decodeFromString(readTotpGoldenJson())

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val f = fixture()
        assertTrue(f.status.size >= 4, "status fixture should cover absent/null/passthrough/not-enrolled, got ${f.status.size}")
        assertTrue(f.sudoExpiry.size >= 4, "sudoExpiry fixture should cover epoch/seconds/millis/offset, got ${f.sudoExpiry.size}")
        assertTrue(f.stepUpBody.size >= 5, "stepUpBody fixture should cover code/backup/both/empty/neither, got ${f.stepUpBody.size}")
    }

    @Test
    fun everyStatusScenarioMatchesDerivationOutput() {
        for (scenario in fixture().status) {
            val result =
                TOTPDerivations.statusResponse(
                    scenario.payload.activated,
                    scenario.payload.lastUsedAt,
                    scenario.payload.backupCodesRemaining,
                )
            assertEquals(scenario.expected.activated, result.activated, "scenario '${scenario.name}' activated mismatch")
            assertEquals(scenario.expected.last_used_at, result.lastUsedAt, "scenario '${scenario.name}' last_used_at mismatch")
            assertEquals(
                scenario.expected.backup_codes_remaining,
                result.backupCodesRemaining,
                "scenario '${scenario.name}' backup_codes_remaining mismatch",
            )
        }
    }

    @Test
    fun everySudoExpiryScenarioMatchesDerivationOutput() {
        for (scenario in fixture().sudoExpiry) {
            assertEquals(
                scenario.expected_millis,
                TOTPDerivations.sudoExpiryMillis(scenario.expires_at),
                "scenario '${scenario.name}' epoch-millis mismatch",
            )
        }
    }

    @Test
    fun everyStepUpBodyScenarioMatchesDerivationOutput() {
        for (scenario in fixture().stepUpBody) {
            val result = TOTPDerivations.stepUpBody(scenario.code, scenario.backup_code)
            assertEquals(scenario.expected, result, "scenario '${scenario.name}' body mismatch")
            assertEquals(
                scenario.expected.keys.toList(),
                result.keys.toList(),
                "scenario '${scenario.name}' key ordering mismatch",
            )
        }
    }
}
