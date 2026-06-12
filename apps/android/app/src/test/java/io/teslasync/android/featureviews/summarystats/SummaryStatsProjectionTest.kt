package io.teslasync.android.featureviews.summarystats

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SummaryStats pure projection — the native port of the web component's
 * `({ motorStats, toTemperatureDisplay, tempUnit })` render contract
 * (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx): the `(stats, isLoading)` lifecycle
 * adapter, the ordered six-tile list with the web `fmtNumber` formatting, the hard-coded Nm / kW unit
 * suffixes and the bare (un-grouped) Total Readings count, the SI-Celsius → display temperature conversion
 * with the single-degree suffix (the web "49.0°°C" double-degree regression pinned), the per-tile icon, the
 * settings-derived display preferences (temperature unit + locale), the accessible non-blank tile content,
 * and the PII-safe `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate; no Compose, no device.
 *
 * Together these cases cover the surface's adapter (every [UiPhase] the host can thread), each rendered state
 * (loading / content / empty / offline projection), the per-state card values, and the accessibility label
 * contract the merged-semantics tiles expose to TalkBack.
 */
class SummaryStatsProjectionTest {
    private val prefs =
        SummaryStatsDisplayPrefs(temperature = TemperatureUnitPref.CELSIUS, locale = Locale.US)

    private val strings =
        SummaryStatsStrings(
            totalReadings = "Total Readings",
            avgTorque = "Avg Torque",
            peakPower = "Peak Power",
            peakRegen = "Peak Regen",
            avgPower = "Avg Power",
            avgMotorTemp = "Avg Motor Temp",
        )

    private val stats =
        MotorSummaryStats(
            totalReadings = 3451,
            avgTorque = 72.4,
            peakPower = 284.6,
            peakRegen = 96.2,
            avgPower = 41.8,
            avgMotorTemp = 49.0,
        )

    private fun cards(
        s: MotorSummaryStats = stats,
        p: SummaryStatsDisplayPrefs = prefs,
    ): List<SummaryStatCard> = SummaryStatsProjection.cards(s, p, strings)

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── (stats, isLoading) → lifecycle UiState adapter ──────────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithStats() {
        val state = SummaryStatsProjection.projectUiState(stats, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenStatsPresentAndNotLoading() {
        val state = SummaryStatsProjection.projectUiState(stats, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(stats, state.data)
    }

    @Test
    fun emptyWhenNoStatsAndNotLoading() {
        val state = SummaryStatsProjection.projectUiState(stats = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun staleContentSurfacesAsOfflineLastKnownWithRetry() {
        // The composable keeps the cards visible and shows a freshness chip when content is stale + errored.
        val state =
            SummaryStatsProjection
                .projectUiState(stats, isLoading = false)
                .copy(stale = true, errorKind = ErrorKind.Network)
        assertTrue(state.isOffline)
        assertTrue(state.hasError)
        assertTrue(state.canRetry)
        assertFalse(state.isError)
    }

    // ── cards: order, count, icons (web StatCard props) ─────────────────────────────────────────────────

    @Test
    fun sixCardsInWebSourceOrder() {
        val icons = cards().map { it.icon }
        assertEquals(
            listOf(
                SummaryStatIcon.BarChart3,
                SummaryStatIcon.Zap,
                SummaryStatIcon.CornerDownRight,
                SummaryStatIcon.TrendingDown,
                SummaryStatIcon.Gauge,
                SummaryStatIcon.Thermometer,
            ),
            icons,
        )
    }

    @Test
    fun cardLabelsMatchTheResolvedCatalogStringsInOrder() {
        assertEquals(
            listOf("Total Readings", "Avg Torque", "Peak Power", "Peak Regen", "Avg Power", "Avg Motor Temp"),
            cards().map { it.label },
        )
    }

    // ── cards: formatted values ─────────────────────────────────────────────────────────────────────────

    @Test
    fun totalReadingsRendersBareCountWithoutGrouping() {
        // Web `value={motorStats?.totalReadings ?? 0}` — React renders a numeric child bare (no grouping).
        val card = cards(stats.copy(totalReadings = 12345))[0]
        assertEquals("Total Readings", card.label)
        assertEquals("12345", card.value)
    }

    @Test
    fun torqueAndPowerCardsCarryFmtNumberValuesWithHardCodedUnits() {
        val list = cards()
        // Web `${fmtNumber(v, 1)} Nm` / `${fmtNumber(v, 1)} kW`.
        assertEquals("72.4 Nm", list[1].value)
        assertEquals("284.6 kW", list[2].value)
        assertEquals("96.2 kW", list[3].value)
        assertEquals("41.8 kW", list[4].value)
    }

    @Test
    fun avgMotorTempUsesCelsiusSuffixWithoutConversionForCelsiusPref() {
        // Web `${fmtNumber(toTemperatureDisplay(avgMotorTemp), 1)}${tempUnit}` with Celsius identity convert.
        val card = cards()[5]
        assertEquals("Avg Motor Temp", card.label)
        assertEquals("49.0\u00B0C", card.value)
    }

    @Test
    fun avgMotorTempConvertsSiCelsiusToFahrenheitForFahrenheitPref() {
        // 49°C → 120.2°F via the shared convertTempFromSI (the native toTemperatureDisplay).
        val card = cards(p = prefs.copy(temperature = TemperatureUnitPref.FAHRENHEIT))[5]
        assertEquals("120.2\u00B0F", card.value)
    }

    @Test
    fun avgMotorTempCarriesExactlyOneDegreeSign() {
        // Regression pin: the web bug rendered "49.0°°C"; the suffix already carries the degree sign.
        for (pref in listOf(TemperatureUnitPref.CELSIUS, TemperatureUnitPref.FAHRENHEIT)) {
            val value = cards(p = prefs.copy(temperature = pref))[5].value
            assertFalse("must not double the degree sign", value.contains("\u00B0\u00B0"))
            assertEquals(1, value.count { it == '\u00B0' })
        }
    }

    @Test
    fun valuesUseLocaleGroupingExceptTheBareReadingsCount() {
        val germany = prefs.copy(locale = Locale.GERMANY)
        val large = stats.copy(totalReadings = 12345, peakPower = 1284.6, avgMotorTemp = 1234.5)
        val list = cards(large, germany)
        // German grouping/decimal separators on the fmtNumber tiles…
        assertEquals("1.284,6 kW", list[2].value)
        assertEquals("1.234,5\u00B0C", list[5].value)
        // …but the Total Readings count stays bare (React numeric child, locale-independent).
        assertEquals("12345", list[0].value)
    }

    @Test
    fun nonFiniteFiguresRenderAsZeroNotEmDash() {
        // Web `fmtNumber` maps NaN/Infinity to 0 via `safeNumber` (never the ChartFormat em-dash).
        val broken =
            stats.copy(
                avgTorque = Double.NaN,
                peakPower = Double.POSITIVE_INFINITY,
                avgMotorTemp = Double.NaN,
            )
        val list = cards(broken)
        assertEquals("0.0 Nm", list[1].value)
        assertEquals("0.0 kW", list[2].value)
        assertEquals("0.0\u00B0C", list[5].value)
    }

    // ── helpers: formatReadings / formatTemperature ─────────────────────────────────────────────────────

    @Test
    fun formatTemperatureHonorsPrefAndAppliesSafeNumberGuard() {
        assertEquals("0.0\u00B0C", SummaryStatsProjection.formatTemperature(0.0, prefs))
        assertEquals(
            "32.0\u00B0F",
            SummaryStatsProjection.formatTemperature(0.0, prefs.copy(temperature = TemperatureUnitPref.FAHRENHEIT)),
        )
        // Non-finite Celsius → converted Infinity → safeNumber → "0.0".
        assertEquals("0.0\u00B0C", SummaryStatsProjection.formatTemperature(Double.NEGATIVE_INFINITY, prefs))
    }

    @Test
    fun formatReadingsIsBareToString() {
        assertEquals("0", SummaryStatsProjection.formatReadings(0))
        assertEquals("9876543", SummaryStatsProjection.formatReadings(9_876_543))
    }

    // ── SummaryStatsDisplayPrefs.from (web useUnits derivation) ─────────────────────────────────────────

    @Test
    fun displayPrefsDefaultToCelsiusEnUs() {
        val defaults = SummaryStatsDisplayPrefs.from(null)
        assertEquals(TemperatureUnitPref.CELSIUS, defaults.temperature)
        assertEquals(Locale.forLanguageTag("en-US"), defaults.locale)
        assertEquals(defaults, SummaryStatsDisplayPrefs.DEFAULT)
    }

    @Test
    fun displayPrefsResolveFahrenheitAndLocaleFromSettings() {
        val settings =
            buildJsonObject {
                put("unit_of_temp", "F")
                put("locale", "de-DE")
            }
        val resolved = SummaryStatsDisplayPrefs.from(settings)
        assertEquals(TemperatureUnitPref.FAHRENHEIT, resolved.temperature)
        assertEquals(Locale.forLanguageTag("de-DE"), resolved.locale)
    }

    @Test
    fun displayPrefsTreatNonFahrenheitTempAsCelsius() {
        val settings = buildJsonObject { put("unit_of_temp", "C") }
        assertEquals(TemperatureUnitPref.CELSIUS, SummaryStatsDisplayPrefs.from(settings).temperature)
    }

    @Test
    fun nonObjectSettingsFallBackToDefaults() {
        // A JSON primitive (not the expected object) resolves to the cold-start defaults rather than throwing.
        val resolved = SummaryStatsDisplayPrefs.from(JsonPrimitive("not-an-object"))
        assertEquals(TemperatureUnitPref.CELSIUS, resolved.temperature)
        assertEquals(Locale.forLanguageTag("en-US"), resolved.locale)
    }

    // ── Accessibility: every tile carries non-blank spoken content (the merged semantics node) ──────────

    @Test
    fun everyCardHasNonBlankLabelAndValueForTalkBack() {
        cards().forEach { card ->
            assertTrue("label must be non-blank for TalkBack", card.label.isNotBlank())
            assertTrue("value must be non-blank for TalkBack", card.value.isNotBlank())
        }
    }

    // ── Diagnostics (P1/S11): view.opened carries only the surface slug ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        SummaryStatsDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        val (event, fields) = logger.events.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SummaryStats"), fields)
    }

    @Test
    fun diagnosticsSlugIsStable() {
        assertEquals("SummaryStats", SummaryStatsDiagnostics.SLUG)
    }
}
