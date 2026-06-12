package io.teslasync.android.featureviews.statheroslide

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the StatHeroSlide's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/review/StatHeroSlide.tsx `getStatConfig`): the
 * `field` switch (distance / energy / default), the SI → display distance conversion, the
 * `earthLaps = total_distance_km / 40075` comparison with its `>= 0.01` gate, the
 * `Math.round(total_energy_kwh / 30)` home-days estimate, and the unrecognised-field `📊` fallback. Also
 * covers the cache-then-network [UiState] projection (P1/S8) and the cached-JSON adapter. Because the
 * surface is purely presentational, each [StatHeroConfig] is exactly what the thin composable renders, so
 * these assertions double as the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class StatHeroSlideProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }
    private val delta = 1e-9

    // ── Field classification (web `field` string → typed branch) ────────────────────

    @Test
    fun fromRawMapsTheKnownFields() {
        assertEquals(StatHeroField.Distance, StatHeroField.fromRaw("distance"))
        assertEquals(StatHeroField.Energy, StatHeroField.fromRaw("energy"))
    }

    @Test
    fun fromRawFoldsAbsentOrUnknownFieldToUnknown() {
        // Web `getStatConfig` switch `default` branch: any other field renders the fallback.
        assertEquals(StatHeroField.Unknown, StatHeroField.fromRaw(null))
        assertEquals(StatHeroField.Unknown, StatHeroField.fromRaw(""))
        assertEquals(StatHeroField.Unknown, StatHeroField.fromRaw("co2"))
        // The web keys are exact lowercase; a differently-cased value misses and folds to the fallback.
        assertEquals(StatHeroField.Unknown, StatHeroField.fromRaw("Distance"))
    }

    // ── Distance branch ─────────────────────────────────────────────────────────────

    @Test
    fun distanceConvertsToKilometresAndComputesEarthLaps() {
        val config =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 40_075.0),
                StatHeroField.Distance,
                DistanceUnitPref.KM,
            )

        assertEquals("\uD83D\uDEE3\uFE0F", config.emoji)
        assertEquals(40_075.0, config.value, delta)
        assertEquals(0, config.decimals)
        assertEquals(StatHeroUnit.Label("km"), config.unit)
        assertTrue(config.comparison is StatHeroComparison.EarthLaps)
        // One full lap of the Earth → 100% around it.
        assertEquals(100.0, (config.comparison as StatHeroComparison.EarthLaps).percent, delta)
    }

    @Test
    fun distanceConvertsToMilesForTheImperialPreference() {
        // 1609.344 km → 1,000,000 m → 1,000 mi (the conversion happens at this display boundary, web useUnits).
        val config =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 1_609.344),
                StatHeroField.Distance,
                DistanceUnitPref.MI,
            )

        assertEquals(1_000.0, config.value, 1e-6)
        assertEquals(StatHeroUnit.Label("mi"), config.unit)
    }

    @Test
    fun distanceShowsTheAroundEarthComparisonAboveTheThreshold() {
        // 500 km → earthLaps ≈ 0.0125 (>= 0.01) → the around-the-Earth comparison.
        val config =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 500.0),
                StatHeroField.Distance,
                DistanceUnitPref.KM,
            )

        assertTrue(config.comparison is StatHeroComparison.EarthLaps)
    }

    @Test
    fun distanceShowsTheEncouragementBelowTheThreshold() {
        // 300 km → earthLaps ≈ 0.0075 (< 0.01) → "every kilometer counts"; zero distance does too.
        val small =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 300.0),
                StatHeroField.Distance,
                DistanceUnitPref.KM,
            )
        val zero =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 0.0),
                StatHeroField.Distance,
                DistanceUnitPref.KM,
            )

        assertEquals(StatHeroComparison.EveryKilometerCounts, small.comparison)
        assertEquals(0.0, zero.value, delta)
        assertEquals(StatHeroComparison.EveryKilometerCounts, zero.comparison)
    }

    // ── Energy branch ───────────────────────────────────────────────────────────────

    @Test
    fun energyPassesKwhThroughAndEstimatesHomeDays() {
        val config =
            StatHeroSlideProjection.project(
                StatHeroData(totalEnergyKwh = 2_890.0),
                StatHeroField.Energy,
                DistanceUnitPref.KM,
            )

        assertEquals("\u26A1", config.emoji)
        // Energy is already in the slide's display unit (kWh) on the wire — no conversion (web parity).
        assertEquals(2_890.0, config.value, delta)
        assertEquals(0, config.decimals)
        assertEquals(StatHeroUnit.EnergyCharged, config.unit)
        assertEquals(StatHeroComparison.EnergyDays(96), config.comparison)
    }

    @Test
    fun daysToPowerHomeRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        assertEquals(0, StatHeroSlideProjection.daysToPowerHome(0.0))
        assertEquals(1, StatHeroSlideProjection.daysToPowerHome(30.0))
        // 0.5 → 1 and 1.5 → 2 (JS Math.round + Kotlin roundToInt agree on ties towards +∞).
        assertEquals(1, StatHeroSlideProjection.daysToPowerHome(15.0))
        assertEquals(2, StatHeroSlideProjection.daysToPowerHome(45.0))
    }

    // ── Unknown branch (web `default`) ────────────────────────────────────────────────

    @Test
    fun unknownFieldProjectsTheFallback() {
        val config =
            StatHeroSlideProjection.project(
                StatHeroData(totalDistanceKm = 999.0, totalEnergyKwh = 999.0),
                StatHeroField.Unknown,
                DistanceUnitPref.KM,
            )

        assertEquals("\uD83D\uDCCA", config.emoji)
        assertEquals(0.0, config.value, delta)
        assertEquals(StatHeroUnit.None, config.unit)
        assertEquals(StatHeroComparison.None, config.comparison)
    }

    // ── Cache-then-network lifecycle (P1/S8) ──────────────────────────────────────────

    @Test
    fun projectUiStateMapsLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, StatHeroSlideProjection.projectUiState(null, isLoading = true).phase)
        // Loading wins outright, even with data present.
        assertEquals(UiPhase.Loading, StatHeroSlideProjection.projectUiState(StatHeroData(), isLoading = true).phase)
        val content = StatHeroSlideProjection.projectUiState(StatHeroData(totalEnergyKwh = 5.0), isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(5.0, content.data?.totalEnergyKwh ?: -1.0, delta)
        assertEquals(UiPhase.Empty, StatHeroSlideProjection.projectUiState(null, isLoading = false).phase)
    }

    // ── Adapter: cached API JSON → projection ─────────────────────────────────────────

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        // The data-adapter path: the owning carousel caches the raw /analytics/year-review row, which carries
        // far more columns than this slide reads. Decoding + projecting must yield the rendered hero.
        val json =
            """
            {
              "total_distance_km": 12345.0,
              "total_energy_kwh": 2890.0,
              "total_drives": 320,
              "co2_offset_kg": 1200,
              "fastest_speed_kmh": 200
            }
            """.trimIndent()
        val data = parseStatHero(lenientJson.parseToJsonElement(json))!!

        assertEquals(12_345.0, data.totalDistanceKm, delta)
        assertEquals(2_890.0, data.totalEnergyKwh, delta)

        val config =
            StatHeroSlideProjection.project(data, StatHeroField.Distance, DistanceUnitPref.KM)
        assertEquals(12_345.0, config.value, delta)
    }

    @Test
    fun parseStatHeroReturnsNullForAbsentOrNonObjectPayloads() {
        assertNull(parseStatHero(null))
        assertNull(parseStatHero(lenientJson.parseToJsonElement("{}")))
        assertNull(parseStatHero(lenientJson.parseToJsonElement("[]")))
        assertNull(parseStatHero(lenientJson.parseToJsonElement("42")))
    }

    @Test
    fun parseStatHeroDefaultsMissingFieldsToZero() {
        val data = parseStatHero(lenientJson.parseToJsonElement("""{ "total_distance_km": 500.0 }"""))!!

        assertEquals(500.0, data.totalDistanceKm, delta)
        assertEquals(0.0, data.totalEnergyKwh, delta)
    }
}
