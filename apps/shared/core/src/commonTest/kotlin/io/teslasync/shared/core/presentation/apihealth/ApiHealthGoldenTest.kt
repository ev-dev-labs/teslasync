package io.teslasync.shared.core.presentation.apihealth

import io.teslasync.shared.core.data.repo.ApiHealthProbe
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors
 * (apps/shared/core/spec/api-health-golden.json) through [ApiHealth.deriveState]. The same
 * fixture pins the Windows C# port so the `ok | degraded | offline | unknown` bucketing and the
 * `unknown` (no-probe) composition cannot drift across platforms (ADR-004).
 */
class ApiHealthGoldenTest {
    @Serializable
    private data class GoldenProbe(
        val ok: Boolean,
        val latency_ms: Long,
        val checked_at: String,
    )

    @Serializable
    private data class GoldenExpected(
        val status: String,
        val latency_ms: Long? = null,
        val last_checked_at: String? = null,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val probe: GoldenProbe? = null,
        val expected: GoldenExpected,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readApiHealthGoldenJson())

    private fun statusOf(label: String): ApiHealthStatus =
        when (label) {
            "ok" -> ApiHealthStatus.OK
            "degraded" -> ApiHealthStatus.DEGRADED
            "offline" -> ApiHealthStatus.OFFLINE
            "unknown" -> ApiHealthStatus.UNKNOWN
            else -> error("unknown status label '$label'")
        }

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(all.size >= 8, "golden fixture should cover every tier + boundaries, got ${all.size}")
    }

    @Test
    fun everyScenarioMatchesDeriverOutput() {
        for (scenario in scenarios()) {
            val probe =
                scenario.probe?.let {
                    ApiHealthProbe(ok = it.ok, latencyMs = it.latency_ms, checkedAt = it.checked_at)
                }
            val actual = ApiHealth.deriveState(probe)
            val expected =
                ApiHealthState(
                    status = statusOf(scenario.expected.status),
                    latencyMs = scenario.expected.latency_ms,
                    lastCheckedAt = scenario.expected.last_checked_at,
                )
            assertEquals(expected, actual, "scenario '${scenario.name}' derivation mismatch")
        }
    }
}
