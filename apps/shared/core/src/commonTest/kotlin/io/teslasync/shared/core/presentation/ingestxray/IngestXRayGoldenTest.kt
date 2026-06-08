package io.teslasync.shared.core.presentation.ingestxray

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors
 * (apps/shared/core/spec/ingest-xray-value-kind-golden.json) through [IngestXRayValueKinds.format].
 * The same fixture is intended to pin the Windows C# port so the `value_kind` labelling cannot drift
 * across platforms (ADR-004). The vectors cover every mapped kind (0–10) plus the unmapped
 * `kind {n}` fallback (low, high and negative).
 */
class IngestXRayGoldenTest {
    @Serializable
    private data class GoldenScenario(
        val name: String,
        val kind: Int,
        val expected: String,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readIngestXRayValueKindGoldenJson())

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(
            all.size >= 13,
            "golden fixture should cover kinds 0..10 plus the unmapped fallback, got ${all.size}",
        )
    }

    @Test
    fun everyScenarioMatchesDerivationOutput() {
        for (scenario in scenarios()) {
            assertEquals(
                scenario.expected,
                IngestXRayValueKinds.format(scenario.kind),
                "scenario '${scenario.name}' value-kind label mismatch",
            )
        }
    }
}
