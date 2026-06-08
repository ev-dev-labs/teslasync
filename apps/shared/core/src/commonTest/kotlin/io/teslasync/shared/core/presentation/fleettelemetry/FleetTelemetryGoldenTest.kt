package io.teslasync.shared.core.presentation.fleettelemetry

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors
 * (apps/shared/core/spec/fleet-telemetry-coverage-golden.json) through
 * [FleetTelemetryCoverage.normalize]. The same fixture is intended to pin the Windows C# port so
 * the `?? []` / `?? {}` coalescing cannot drift across platforms (ADR-004). The vectors cover the
 * critical null-vs-present cases — a fully-absent raw, an empty object, all-three explicit nulls, a
 * partial-null mix, and verbatim pass-through of a populated payload.
 */
class FleetTelemetryGoldenTest {
    @Serializable
    private data class GoldenExpected(
        val categories: List<FleetTelemetryCategoryCoverage> = emptyList(),
        @SerialName("destination_totals") val destinationTotals: Map<String, Int> = emptyMap(),
        @SerialName("orphan_fields") val orphanFields: List<String> = emptyList(),
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val response: FleetTelemetryCoverageRaw? = null,
        val expected: GoldenExpected,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readFleetTelemetryCoverageGoldenJson())

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(
            all.size >= 6,
            "golden fixture should cover null, empty, explicit-null, partial-null + populated pass-through, got ${all.size}",
        )
    }

    @Test
    fun everyScenarioMatchesDerivationOutput() {
        for (scenario in scenarios()) {
            val expected =
                FleetTelemetryCoverageResponse(
                    categories = scenario.expected.categories,
                    destinationTotals = scenario.expected.destinationTotals,
                    orphanFields = scenario.expected.orphanFields,
                )
            assertEquals(
                expected,
                FleetTelemetryCoverage.normalize(scenario.response),
                "scenario '${scenario.name}' normalize mismatch",
            )
        }
    }
}
