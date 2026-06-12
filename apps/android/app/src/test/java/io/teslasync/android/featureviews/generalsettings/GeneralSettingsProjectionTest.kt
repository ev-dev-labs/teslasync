package io.teslasync.android.featureviews.generalsettings

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.settings.CarPreferences
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the GeneralSettings surface's pure logic — the native analogue of the web
 * component's pre-JSX derivations (web/src/features/settings/components/GeneralSettings.tsx +
 * web/src/lib/parseSettingEnum.ts): the settings-document form codec (decode with defaults, encode
 * preserving unknown keys), the decimal-precision preview, the numeric display formatter, the car-pref
 * parsing + sync-from-car derivation, and the cache-then-network → display projection across every state.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class GeneralSettingsProjectionTest {
    // ── Form codec ───────────────────────────────────────────────────────────────────

    @Test
    fun decodeFallsBackToDefaultsForNullOrEmpty() {
        assertEquals(GeneralSettingsForm.DEFAULT, GeneralSettingsFormCodec.decode(null))
        assertEquals(GeneralSettingsForm.DEFAULT, GeneralSettingsFormCodec.decode(Json.parseToJsonElement("{}")))
    }

    @Test
    fun decodeReadsEveryKnownField() {
        val form = GeneralSettingsFormCodec.decode(fullDocument())
        assertEquals("mi", form.distanceUnit)
        assertEquals("F", form.temperatureUnit)
        assertEquals("psi", form.pressureUnit)
        assertEquals("ideal", form.preferredRange)
        assertEquals(3, form.decimalPrecision)
        assertEquals("de", form.language)
        assertEquals("€", form.currencySymbol)
        assertEquals("de-DE", form.locale)
        assertEquals("user", form.tzDisplayDefault)
        assertEquals("America/Los_Angeles", form.timezoneUser)
        assertEquals(0.18, form.baseCostPerKwh, 0.0)
        assertEquals(4.20, form.gasPricePerUnit, 0.0)
        assertEquals("liter", form.gasUnit)
        assertEquals(30.0, form.gasEfficiencyMpg, 0.0)
    }

    @Test
    fun decodeClampsPrecisionToTheValidRange() {
        val tooHigh = Json.parseToJsonElement("""{ "decimal_precision": 99 }""")
        val negative = Json.parseToJsonElement("""{ "decimal_precision": -5 }""")
        assertEquals(MAX_PRECISION, GeneralSettingsFormCodec.decode(tooHigh).decimalPrecision)
        assertEquals(MIN_PRECISION, GeneralSettingsFormCodec.decode(negative).decimalPrecision)
    }

    @Test
    fun encodePreservesUnknownServerKeys() {
        // A document with fields the panel does NOT edit must round-trip them unchanged (full-replace PUT).
        val base =
            Json.parseToJsonElement(
                """{ "theme": "neon-cyan", "quiet_hours_enabled": true, "unit_of_length": "km" }""",
            )
        val form = GeneralSettingsFormCodec.decode(base).copy(distanceUnit = "mi")
        val encoded = GeneralSettingsFormCodec.encode(form, base)
        assertEquals("neon-cyan", encoded["theme"]?.jsonPrimitive?.contentOrNull)
        assertTrue(encoded["quiet_hours_enabled"]?.jsonPrimitive?.boolean == true)
        // The edited field wins.
        assertEquals("mi", encoded["unit_of_length"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun encodeThenDecodeRoundTripsTheEditableFields() {
        val original =
            GeneralSettingsForm.DEFAULT.copy(
                distanceUnit = "mi",
                temperatureUnit = "F",
                pressureUnit = "psi",
                decimalPrecision = 4,
                currencySymbol = "£",
                timezoneUser = "Europe/Berlin",
                baseCostPerKwh = 0.21,
                gasEfficiencyMpg = 32.0,
            )
        assertEquals(original, GeneralSettingsFormCodec.decode(GeneralSettingsFormCodec.encode(original, null)))
    }

    @Test
    fun encodeWritesNumericFieldsAsJsonNumbers() {
        val encoded = GeneralSettingsFormCodec.encode(GeneralSettingsForm.DEFAULT, null)
        assertEquals(0.12, (encoded["base_cost_per_kwh"] as JsonPrimitive).doubleOrNull)
        assertEquals(2.0, (encoded["decimal_precision"] as JsonPrimitive).doubleOrNull)
    }

    // ── Preview + numeric display ──────────────────────────────────────────────────────

    @Test
    fun decimalPreviewMatchesToFixed() {
        assertEquals("14", decimalPreview(0))
        assertEquals("14.25", decimalPreview(2))
        assertEquals("14.2485", decimalPreview(4))
    }

    @Test
    fun displayNumberDropsTrailingZeroForWholeValues() {
        assertEquals("25", displayNumber(25.0))
        assertEquals("0.12", displayNumber(0.12))
        assertEquals("3.5", displayNumber(3.5))
    }

    // ── Car-pref parsing (web `parseSettingEnum` / `isSettingX`) ─────────────────────────

    @Test
    fun classifyMapsKnownTokensAndFallsBack() {
        assertEquals(CarUnitLabel.Known(KnownCarUnit.MILES), CarUnitParsing.classify("DistanceUnitMiles", CarUnitParsing.Category.DISTANCE))
        assertEquals(CarUnitLabel.Known(KnownCarUnit.KILOMETERS), CarUnitParsing.classify("km", CarUnitParsing.Category.DISTANCE))
        assertEquals(
            CarUnitLabel.Known(KnownCarUnit.FAHRENHEIT),
            CarUnitParsing.classify("fahrenheit", CarUnitParsing.Category.TEMPERATURE),
        )
        assertEquals(CarUnitLabel.Known(KnownCarUnit.PSI), CarUnitParsing.classify("PressureUnitPsi", CarUnitParsing.Category.PRESSURE))
        // Forward-compat: an unknown token renders verbatim (web `return value`).
        assertEquals(CarUnitLabel.Raw("furlongs"), CarUnitParsing.classify("furlongs", CarUnitParsing.Category.DISTANCE))
        // Absent → em-dash sentinel (web `'—'`).
        assertEquals(CarUnitLabel.Dash, CarUnitParsing.classify(null, CarUnitParsing.Category.DISTANCE))
        assertEquals(CarUnitLabel.Dash, CarUnitParsing.classify("  ", CarUnitParsing.Category.PRESSURE))
    }

    @Test
    fun unitDetectorsMatchTheWebSubstringChecks() {
        assertTrue(CarUnitParsing.isMiles("DistanceUnitMiles"))
        assertFalse(CarUnitParsing.isMiles("DistanceUnitKilometers"))
        assertTrue(CarUnitParsing.isFahrenheit("TemperatureUnitFahrenheit"))
        assertTrue(CarUnitParsing.isPsi("PressureUnitPsi"))
        assertTrue(CarUnitParsing.isBar("PressureUnitBar"))
        assertFalse(CarUnitParsing.isBar(null))
    }

    // ── Sync from Car (web `syncUnitsFromCar`) ──────────────────────────────────────────

    @Test
    fun syncAppliesImperialUnitsAndFlagsChanged() {
        val result =
            computeSyncFromCar(
                CarPreferences(
                    distanceUnit = "DistanceUnitMiles",
                    temperatureUnit = "TemperatureUnitFahrenheit",
                    tirePressureUnit = "PressureUnitPsi",
                ),
                GeneralSettingsForm.DEFAULT,
            )
        assertTrue(result.changed)
        assertEquals("mi", result.form.distanceUnit)
        assertEquals("F", result.form.temperatureUnit)
        assertEquals("psi", result.form.pressureUnit)
    }

    @Test
    fun syncAppliesMetricUnitsWhenReported() {
        val result =
            computeSyncFromCar(
                CarPreferences(
                    distanceUnit = "DistanceUnitKilometers",
                    temperatureUnit = "TemperatureUnitCelsius",
                    tirePressureUnit = "PressureUnitBar",
                ),
                GeneralSettingsForm.DEFAULT.copy(distanceUnit = "mi", temperatureUnit = "F", pressureUnit = "psi"),
            )
        assertTrue(result.changed)
        assertEquals("km", result.form.distanceUnit)
        assertEquals("C", result.form.temperatureUnit)
        assertEquals("bar", result.form.pressureUnit)
    }

    @Test
    fun syncWithNoReportedUnitsIsNoChange() {
        val result = computeSyncFromCar(CarPreferences(), GeneralSettingsForm.DEFAULT)
        assertFalse(result.changed)
        assertEquals(GeneralSettingsForm.DEFAULT, result.form)
    }

    // ── Projection (cache-then-network → display) ────────────────────────────────────────

    @Test
    fun projectLoadingWithNoCacheShowsLoadingDefaults() {
        val display = GeneralSettingsProjection.project(state(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
        assertEquals(GeneralSettingsStatus.Loading, display.status)
        assertEquals(GeneralSettingsForm.DEFAULT, display.form)
    }

    @Test
    fun projectSuccessShowsTheServerForm() {
        val display = GeneralSettingsProjection.project(state(Resource.Success(fullDocument(), fetchedAt = 1L, stale = false)))
        assertEquals(GeneralSettingsStatus.Ready, display.status)
        assertEquals("mi", display.form.distanceUnit)
        assertFalse(display.stale)
    }

    @Test
    fun projectHardErrorWithNoCacheShowsError() {
        val display =
            GeneralSettingsProjection.project(
                state(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
            )
        assertEquals(GeneralSettingsStatus.Error, display.status)
        assertEquals(ErrorKind.Network, display.errorKind)
        assertTrue(display.canRetry)
    }

    @Test
    fun projectErrorWithCacheKeepsFormStaleAndOffline() {
        val display =
            GeneralSettingsProjection.project(
                state(Resource.Error(cached = fullDocument(), fetchedAt = 5L, stale = true, error = ApiError.Timeout())),
            )
        assertEquals(GeneralSettingsStatus.Ready, display.status)
        assertEquals("mi", display.form.distanceUnit)
        assertTrue(display.stale)
        assertTrue(display.offline)
        assertTrue(display.canRetry)
    }

    @Test
    fun projectMarksFormDirtyWhenOverrideDiffersAndNotSaving() {
        val server = Resource.Success(fullDocument(), fetchedAt = 1L, stale = false)
        val edited = GeneralSettingsFormCodec.decode(fullDocument()).copy(language = "fr")
        assertTrue(GeneralSettingsProjection.project(state(server, formOverride = edited)).isDirty)
        // A save in flight suppresses the dirty hint (web `settingsMut.isPending`).
        assertFalse(GeneralSettingsProjection.project(state(server, formOverride = edited, saving = true)).isDirty)
        // An override equal to the server doc is not dirty.
        val same = GeneralSettingsFormCodec.decode(fullDocument())
        assertFalse(GeneralSettingsProjection.project(state(server, formOverride = same)).isDirty)
    }

    @Test
    fun panelVisibilityFollowsCarPreferences() {
        val ready = Resource.Success(Json.parseToJsonElement("{}"), fetchedAt = 1L, stale = false)
        val withUnits = state(ready, car = CarPreferences(distanceUnit = "DistanceUnitMiles", use24HourTime = true))
        val display = GeneralSettingsProjection.project(withUnits)
        assertTrue(display.showSyncPanel)
        assertTrue(display.showClockPanel)
        assertTrue(display.carUses24HourClock)
        // No car data → both panels hidden.
        val none = GeneralSettingsProjection.project(state(ready, car = null))
        assertFalse(none.showSyncPanel)
        assertFalse(none.showClockPanel)
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────

    private fun state(
        settings: Resource<JsonElement>,
        formOverride: GeneralSettingsForm? = null,
        car: CarPreferences? = null,
        saving: Boolean = false,
    ): GeneralSettingsState =
        GeneralSettingsState(
            settings = settings,
            formOverride = formOverride,
            carPreferences = car,
            saving = saving,
            feedback = null,
        )

    private fun fullDocument(): JsonObject =
        Json.parseToJsonElement(
            """
            {
              "unit_of_length": "mi",
              "unit_of_temp": "F",
              "unit_of_pressure": "psi",
              "preferred_range": "ideal",
              "decimal_precision": 3,
              "language": "de",
              "currency_symbol": "€",
              "locale": "de-DE",
              "tz_display_default": "user",
              "timezone_user": "America/Los_Angeles",
              "base_cost_per_kwh": 0.18,
              "gas_price_per_unit": 4.20,
              "gas_unit": "liter",
              "gas_efficiency_mpg": 30
            }
            """.trimIndent(),
        ) as JsonObject
}
