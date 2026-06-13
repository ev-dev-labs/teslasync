// Off-device unit tests for the FormatterPrefsBridge pure model: the locale + decimal-precision resolution (the
// web `resolveLocale(settings.locale)` + `settings.decimal_precision ?? 2`) and the settings-document lifecycle
// projection (resolved / fresh / refreshing / stale / offline). These cover every reproduced web branch + the
// native precision hardening off-device; run by the :android:testReleaseUnitTest gate. No Compose, no Android,
// no HTTP.

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatterPrefsBridgeModelTest {
    // ── resolve(): web resolveLocale + (decimal_precision ?? 2) ──────────────────────
    @Test
    fun resolveNullDocumentYieldsMetricDefaults() {
        val prefs = FormatterPrefsProjection.resolve(null)
        assertEquals("en-US", prefs.locale)
        assertEquals(2, prefs.decimalPrecision)
        assertEquals(DistanceUnitPref.KM, prefs.unitPref.distance)
        assertEquals(SpeedUnitPref.KMH, prefs.unitPref.speed)
        assertEquals(TemperatureUnitPref.CELSIUS, prefs.unitPref.temperature)
        assertEquals(PressureUnitPref.BAR, prefs.unitPref.pressure)
    }

    @Test
    fun resolveReadsLocalePrecisionAndUnits() {
        val prefs =
            FormatterPrefsProjection.resolve(
                buildJsonObject {
                    put("locale", "de-DE")
                    put("decimal_precision", 3)
                    put("unit_of_length", "mi")
                    put("unit_of_temp", "F")
                    put("unit_of_pressure", "psi")
                },
            )
        assertEquals("de-DE", prefs.locale)
        assertEquals(3, prefs.decimalPrecision)
        assertEquals(DistanceUnitPref.MI, prefs.unitPref.distance)
        assertEquals(SpeedUnitPref.MPH, prefs.unitPref.speed)
        assertEquals(TemperatureUnitPref.FAHRENHEIT, prefs.unitPref.temperature)
        assertEquals(PressureUnitPref.PSI, prefs.unitPref.pressure)
    }

    @Test
    fun resolveDefaultsPrecisionToTwoWhenAbsent() {
        val prefs = FormatterPrefsProjection.resolve(buildJsonObject { put("locale", "fr-FR") })
        assertEquals("fr-FR", prefs.locale)
        assertEquals(2, prefs.decimalPrecision)
    }

    @Test
    fun resolveKeepsZeroPrecision() {
        // web `0 ?? 2 === 0`: an explicit zero precision is honoured, not replaced by the default.
        val prefs = FormatterPrefsProjection.resolve(buildJsonObject { put("decimal_precision", 0) })
        assertEquals(0, prefs.decimalPrecision)
    }

    @Test
    fun resolveFallsBackToEnUsWhenLocaleBlank() {
        val prefs = FormatterPrefsProjection.resolve(buildJsonObject { put("locale", "   ") })
        assertEquals("en-US", prefs.locale)
    }

    @Test
    fun resolveGuardsInvalidPrecisionToDefault() {
        // Native hardening (shared UnitPreferences): a negative precision is treated as absent → the default 2.
        val prefs = FormatterPrefsProjection.resolve(buildJsonObject { put("decimal_precision", -1) })
        assertEquals(2, prefs.decimalPrecision)
    }

    // ── project(): settings UiState → FormatterPrefsState ────────────────────────────
    @Test
    fun projectLoadingIsUnresolvedWithDefaults() {
        val state = FormatterPrefsProjection.project(UiState.loading())
        assertFalse(state.resolved)
        assertEquals("en-US", state.prefs.locale)
        assertEquals(2, state.prefs.decimalPrecision)
        assertFalse(state.stale)
        assertFalse(state.offline)
        assertFalse(state.refreshing)
        assertNull(state.freshnessStamp)
    }

    @Test
    fun projectSuccessIsResolvedWithFreshPrefs() {
        val state =
            FormatterPrefsProjection.project(
                UiState(phase = UiPhase.Content, data = germanDoc(), fetchedAt = 1_000L),
            )
        assertTrue(state.resolved)
        assertEquals("de-DE", state.prefs.locale)
        assertEquals(3, state.prefs.decimalPrecision)
        assertFalse(state.stale)
        assertFalse(state.offline)
        assertFalse(state.refreshing)
        assertEquals(1_000L, state.freshnessStamp)
    }

    @Test
    fun projectLoadingWithCacheIsResolvedAndRefreshing() {
        val state =
            FormatterPrefsProjection.project(
                UiState(phase = UiPhase.Content, data = germanDoc(), fetchedAt = 900L, refreshing = true),
            )
        assertTrue(state.resolved)
        assertTrue(state.refreshing)
        assertFalse(state.stale)
        assertFalse(state.offline)
    }

    @Test
    fun projectStaleWithoutErrorIsStaleNotOffline() {
        val state =
            FormatterPrefsProjection.project(
                UiState(phase = UiPhase.Content, data = germanDoc(), stale = true, refreshing = true),
            )
        assertTrue(state.resolved)
        assertTrue(state.stale)
        assertFalse(state.offline)
    }

    @Test
    fun projectErrorWithCacheIsOffline() {
        val state =
            FormatterPrefsProjection.project(
                UiState(
                    phase = UiPhase.Content,
                    data = germanDoc(),
                    fetchedAt = 800L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            )
        assertTrue(state.resolved)
        assertTrue(state.offline)
        assertFalse(state.stale)
    }

    @Test
    fun projectErrorWithNoCacheIsUnresolvedWithDefaults() {
        val state =
            FormatterPrefsProjection.project(
                UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            )
        assertFalse(state.resolved)
        assertEquals("en-US", state.prefs.locale)
        assertEquals(2, state.prefs.decimalPrecision)
        assertFalse(state.stale)
        assertFalse(state.offline)
    }

    private fun germanDoc(): JsonElement =
        buildJsonObject {
            put("locale", "de-DE")
            put("decimal_precision", 3)
            put("unit_of_length", "mi")
        }
}
