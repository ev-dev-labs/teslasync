package io.teslasync.android.featureviews.teslachargingsessionsmap

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the TeslaChargingSessionsMap's pure logic — the native mirror of every
 * derivation the web component performs (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx and
 * its `useFormatting` / `convertEnergyFromSI` / `formatDateTime` helpers): the `/tesla/charging/sessions`
 * decode, the cache-then-network freshness preservation, the `center` memo, the `clusterPoints` markers
 * (title, info-window snippet, accessible label), and the screen-reader summary lines. Every formatter is
 * pinned to [Locale.US] + UTC so the assertions are deterministic; because the surface is presentational,
 * each projected value is exactly what the thin composable renders.
 */
class TeslaChargingSessionsMapProjectionTest {
    private val zone = ZoneOffset.UTC

    private fun strings(): ChargingSessionsMapStrings =
        ChargingSessionsMapStrings(
            mapLabel = "Charging sessions map",
            unknown = "Unknown",
            markerLabel = { name -> "$name charging session" },
            noData = "No location data available yet.",
        )

    /** A fully-populated session; tests vary single fields via [TeslaChargingSession.copy]. */
    private fun base(): TeslaChargingSession =
        TeslaChargingSession(
            sessionId = 1L,
            siteLocationName = "Fremont SC",
            chargeStartDatetime = "2026-04-04T15:45:00Z",
            totalEnergyAddedWh = 45_200.0,
            totalCost = 12.5,
            chargerType = "supercharger",
            latitude = 37.5,
            longitude = -122.2,
        )

    // ── parseChargingSessions(): decode the {sessions, summary} response ──────────

    @Test
    fun parseDecodesEverySessionFieldFromTheResponseObject() {
        val payload =
            buildJsonObject {
                putJsonArray("sessions") {
                    add(
                        buildJsonObject {
                            put("session_id", 7)
                            put("site_location_name", "Fremont SC")
                            put("charge_start_datetime", "2026-04-04T15:45:00Z")
                            put("total_energy_added_wh", 45_200.0)
                            put("total_cost", 12.5)
                            put("charger_type", "supercharger")
                            put("latitude", 37.5)
                            put("longitude", -122.2)
                        },
                    )
                    add(buildJsonObject { put("session_id", 8) })
                }
            }

        val sessions = (payload as JsonElement).parseChargingSessions()

        assertEquals(2, sessions.size)
        val first = sessions[0]
        assertEquals(7L, first.sessionId)
        assertEquals("Fremont SC", first.siteLocationName)
        assertEquals("2026-04-04T15:45:00Z", first.chargeStartDatetime)
        assertEquals(45_200.0, first.totalEnergyAddedWh!!, 0.0)
        assertEquals(12.5, first.totalCost!!, 0.0)
        assertEquals("supercharger", first.chargerType)
        assertEquals(37.5, first.latitude!!, 0.0)
        assertEquals(-122.2, first.longitude!!, 0.0)
        // The minimal row keeps every optional field null and defaults the id-less coordinate fields.
        val second = sessions[1]
        assertEquals(8L, second.sessionId)
        assertNull(second.siteLocationName)
        assertNull(second.totalEnergyAddedWh)
        assertNull(second.latitude)
    }

    @Test
    fun parseReturnsEmptyForANonObjectOrMissingSessionsArray() {
        assertTrue((JsonArray(emptyList()) as JsonElement).parseChargingSessions().isEmpty())
        assertTrue((JsonPrimitive("nope") as JsonElement).parseChargingSessions().isEmpty())
        assertTrue(buildJsonObject { put("summary", 1) }.parseChargingSessions().isEmpty())
    }

    // ── toChargingSessions(): preserve the cache-then-network freshness flags ─────

    @Test
    fun toChargingSessionsPreservesEveryFreshnessFlag() {
        val payload = buildJsonObject { putJsonArray("sessions") { add(buildJsonObject { put("session_id", 1) }) } }

        val loading = Resource.Loading(cached = payload as JsonElement, fetchedAt = 50L, stale = true).toChargingSessions()
        assertTrue(loading is Resource.Loading)
        assertEquals(1, loading.cached!!.size)
        assertTrue(loading.stale)

        val success = Resource.Success(data = payload, fetchedAt = 100L, stale = false).toChargingSessions()
        assertTrue(success is Resource.Success)
        assertEquals(100L, (success as Resource.Success).fetchedAt)
        assertEquals(1, success.data.size)

        val error = Resource.Error(cached = payload, fetchedAt = 100L, stale = true, error = ApiError.Timeout()).toChargingSessions()
        assertTrue(error is Resource.Error)
        assertEquals(1, error.cached!!.size)
        assertTrue((error as Resource.Error).stale)
        assertTrue(error.error is ApiError.Timeout)
    }

    // ── center(): the web `center` memo ──────────────────────────────────────────

    @Test
    fun centerFallsBackToSanFranciscoForAnEmptyList() {
        val center = TeslaChargingSessionsMapProjection.center(emptyList())
        assertEquals(FALLBACK_LATITUDE, center.lat, 0.0)
        assertEquals(FALLBACK_LONGITUDE, center.lng, 0.0)
    }

    @Test
    fun centerAveragesEveryCoordinate() {
        val center =
            TeslaChargingSessionsMapProjection.center(
                listOf(
                    base().copy(latitude = 10.0, longitude = 20.0),
                    base().copy(latitude = 20.0, longitude = 40.0),
                ),
            )
        assertEquals(15.0, center.lat, 1e-9)
        assertEquals(30.0, center.lng, 1e-9)
    }

    @Test
    fun centerCountsAMissingCoordinateAsZeroLikeTheWeb() {
        // web `s.latitude ?? 0`: the null-coordinate session still divides the sum.
        val center =
            TeslaChargingSessionsMapProjection.center(
                listOf(
                    base().copy(latitude = 10.0, longitude = 20.0),
                    base().copy(latitude = null, longitude = null),
                ),
            )
        assertEquals(5.0, center.lat, 1e-9)
        assertEquals(10.0, center.lng, 1e-9)
    }

    // ── renderable-location gate (the empty-map predicate) ───────────────────────

    @Test
    fun renderableLocationFollowsTheCoordinateValidity() {
        assertTrue(TeslaChargingSessionsMapProjection.hasRenderableLocation(base().copy(latitude = 37.5, longitude = -122.2)))
        // (0,0) is a valid coordinate — the web filter keeps it (`typeof number && !NaN`), so we do too.
        assertTrue(TeslaChargingSessionsMapProjection.hasRenderableLocation(base().copy(latitude = 0.0, longitude = 0.0)))
        assertFalse(TeslaChargingSessionsMapProjection.hasRenderableLocation(base().copy(latitude = null, longitude = null)))
        assertFalse(TeslaChargingSessionsMapProjection.hasRenderableLocation(base().copy(latitude = 91.0, longitude = 0.0)))
        assertFalse(
            TeslaChargingSessionsMapProjection.hasAnyRenderableLocation(listOf(base().copy(latitude = null, longitude = null))),
        )
        assertTrue(TeslaChargingSessionsMapProjection.hasAnyRenderableLocation(listOf(base().copy(latitude = 1.0, longitude = 2.0))))
    }

    // ── markers(): the web `clusterPoints` projection ────────────────────────────

    @Test
    fun markersProjectTitleSnippetAndAccessibleLabelLikeTheWebPopup() {
        val markers =
            TeslaChargingSessionsMapProjection.markers(listOf(base().copy(sessionId = 9L)), strings(), CURRENCY, Locale.US, zone)

        assertEquals(1, markers.size)
        val marker = markers.single()
        assertEquals("9", marker.id)
        assertEquals("Fremont SC", marker.title)
        assertEquals("Fremont SC charging session", marker.accessibleLabel)
        // snippet = local time • energy • cost • charger (the web popup body, uppercased charger).
        assertTrue(marker.snippet.contains("2026"))
        assertTrue(marker.snippet.contains("45.2 kWh"))
        assertTrue(marker.snippet.contains("\$12.50"))
        assertTrue(marker.snippet.contains("SUPERCHARGER"))
    }

    @Test
    fun markersDropSessionsWithoutACoordinate() {
        val markers =
            TeslaChargingSessionsMapProjection.markers(
                listOf(base().copy(sessionId = 1L), base().copy(sessionId = 2L, latitude = null, longitude = null)),
                strings(),
                CURRENCY,
                Locale.US,
                zone,
            )
        assertEquals(1, markers.size)
        assertEquals("1", markers.single().id)
    }

    @Test
    fun markerUsesUnknownFallbackForABlankSiteName() {
        val marker =
            TeslaChargingSessionsMapProjection
                .markers(listOf(base().copy(siteLocationName = "")), strings(), CURRENCY, Locale.US, zone)
                .single()
        assertEquals("Unknown", marker.title)
        assertEquals("Unknown charging session", marker.accessibleLabel)
    }

    @Test
    fun markerSnippetOmitsAbsentDetailsAndKeepsTheDashedDate() {
        val marker =
            TeslaChargingSessionsMapProjection
                .markers(
                    listOf(
                        base().copy(
                            chargeStartDatetime = null,
                            totalEnergyAddedWh = null,
                            totalCost = null,
                            chargerType = null,
                        ),
                    ),
                    strings(),
                    CURRENCY,
                    Locale.US,
                    zone,
                ).single()
        // Only the (missing ⇒ em dash) date line remains; no energy / cost / charger.
        assertEquals(EM_DASH, marker.snippet)
    }

    // ── summaryLines(): the screen-reader list alternative ───────────────────────

    @Test
    fun summaryLinesJoinTheAccessibleLabelWithTheDetails() {
        val markers = TeslaChargingSessionsMapProjection.markers(listOf(base()), strings(), CURRENCY, Locale.US, zone)
        val line = TeslaChargingSessionsMapProjection.summaryLines(markers).single()
        assertTrue(line.startsWith("Fremont SC charging session"))
        assertTrue(line.contains("45.2 kWh"))
    }

    // ── formatters ───────────────────────────────────────────────────────────────

    @Test
    fun fmtNumberGroupsAndRoundsHalfAwayFromZeroLikeIntl() {
        assertEquals("1,234.5", TeslaChargingSessionsMapProjection.fmtNumber(1_234.45, 1, Locale.US))
        assertEquals("46", TeslaChargingSessionsMapProjection.fmtNumber(45.5, 0, Locale.US))
    }

    @Test
    fun formatCurrencyPrefixesTheSymbolAndFallsBackToDollar() {
        assertEquals("\$12.50", TeslaChargingSessionsMapProjection.formatCurrency(12.5, "$", 2, Locale.US))
        assertEquals("\$5.00", TeslaChargingSessionsMapProjection.formatCurrency(5.0, "  ", 2, Locale.US))
    }

    @Test
    fun energyKwhConvertsWattHoursToKilowattHours() {
        assertEquals(1.5, TeslaChargingSessionsMapProjection.energyKwh(1_500.0), 0.0)
    }

    @Test
    fun formatDateTimeRendersAValidInstantAndDashesAnythingUnparseable() {
        val rendered = TeslaChargingSessionsMapProjection.formatDateTime("2026-04-04T15:45:00Z", Locale.US, zone)
        assertTrue(rendered.contains("2026"))
        assertEquals(EM_DASH, TeslaChargingSessionsMapProjection.formatDateTime(null, Locale.US, zone))
        assertEquals(EM_DASH, TeslaChargingSessionsMapProjection.formatDateTime("not-a-date", Locale.US, zone))
    }

    // ── project(): the assembled display ─────────────────────────────────────────

    @Test
    fun projectAssemblesTheContentDisplay() {
        val display =
            TeslaChargingSessionsMapProjection.project(
                listOf(base().copy(sessionId = 1L), base().copy(sessionId = 2L, latitude = 40.0, longitude = -74.0)),
                strings(),
                CURRENCY,
                Locale.US,
                zone,
            )
        assertTrue(display.hasMarkers)
        assertEquals(2, display.markers.size)
        assertEquals(2, display.summaryLines.size)
        assertEquals(MAP_ZOOM, display.zoom)
        assertEquals("Charging sessions map", display.mapLabel)
        assertEquals("Charging sessions map", display.mapContentDescription)
    }

    @Test
    fun projectSurfacesTheEmptyMapWhenNothingCanBePlotted() {
        val display =
            TeslaChargingSessionsMapProjection.project(
                listOf(base().copy(latitude = null, longitude = null)),
                strings(),
                CURRENCY,
                Locale.US,
                zone,
            )
        assertFalse(display.hasMarkers)
        assertTrue(display.markers.isEmpty())
        assertEquals("No location data available yet.", display.noDataText)
    }

    // ── currency prefs from /settings ────────────────────────────────────────────

    @Test
    fun currencyPrefsReadTheSettingsSymbolWithDollarFallback() {
        val euro = buildJsonObject { put("currency_symbol", "€") }
        assertEquals("€", ChargingSessionsCurrencyPrefs.fromSettings(euro).currencySymbol)
        assertEquals("$", ChargingSessionsCurrencyPrefs.fromSettings(buildJsonObject { put("currency_symbol", "  ") }).currencySymbol)
        assertEquals("$", ChargingSessionsCurrencyPrefs.fromSettings(null).currencySymbol)
    }

    private companion object {
        val CURRENCY = ChargingSessionsCurrencyPrefs("$")
    }
}
