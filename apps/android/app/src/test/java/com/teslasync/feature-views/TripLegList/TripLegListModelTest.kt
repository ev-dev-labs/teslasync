// Off-device unit coverage for the TripLegList feature view's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the settings -> display-prefs adapter (distance unit, currency symbol, precision,
// locale — the web `useUnits` + `useFormatting` derivation), the per-leg/per-stop projection (the web
// `convertDistanceFromSI(...).toFixed(1)` distance, the verbatim `Math.round(leg.duration_s)` leg duration vs the
// `Math.round(charge_duration_s / 60)` charge duration, `formatEnergy` precision 1, `Math.round` SOC, the
// `formatCurrency` cost, the `idx < stops.length` charge-stop pairing), the lifecycle classifier the composable
// switches on (per-state coverage), the accessibility announcements (a11y-label coverage), and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripleglist

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TripLegListModelTest {
    private val metric = TripLegDisplayPrefs.DEFAULT
    private val imperial = TripLegDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))

    // €/1-decimal settings: exercises the non-default currency symbol + precision derivation.
    private val euro = TripLegDisplayPrefs.from(Json.parseToJsonElement("""{"currency_symbol":"€","decimal_precision":1}"""))

    private val strings =
        TripLegListStrings(
            title = "Route Breakdown",
            empty = "Plan a trip to see the route breakdown",
            distance = "Distance",
            duration = "Duration",
            energy = "Energy",
            battery = "Battery",
            recommended = "Recommended stop point \u2014 actual charger locations may vary",
            min = "min",
        )

    // A clean leg: 12 km in 1800 s, 9 kWh used, 80% -> 60%.
    private val leg =
        TripLeg(
            from = TripWaypoint(name = "Home", lat = 37.421, lng = -122.084),
            to = TripWaypoint(name = "Work", lat = 36.25, lng = -120.24),
            distanceM = 12_000.0,
            durationS = 1_800.0,
            energyWh = 9_000.0,
            startSoc = 80.0,
            arrivalSoc = 60.0,
        )

    private val stop =
        TripChargeStop(
            name = "Harris Ranch",
            chargeFromSoc = 30.0,
            chargeToSoc = 80.0,
            chargeDurationS = 1_500.0,
            energyWh = 27_000.0,
            cost = 12.5,
            isRecommended = true,
        )

    private fun rows(
        snapshot: TripRouteBreakdown,
        prefs: TripLegDisplayPrefs,
    ) = TripLegListProjection.rows(snapshot, prefs, strings)

    private fun firstRow(
        snapshot: TripRouteBreakdown,
        prefs: TripLegDisplayPrefs,
    ) = rows(snapshot, prefs).first()

    // ── Settings -> display-prefs adapter (web `useUnits` + `useFormatting`) ─────

    @Test
    fun defaultPrefsAreMetricDollarTwoDecimalsEnUs() {
        assertEquals(DistanceUnitPref.KM, metric.units.distance)
        assertEquals("$", metric.currencySymbol)
        assertEquals(2, metric.precision)
        assertEquals("en-US", metric.locale.toLanguageTag())
    }

    @Test
    fun imperialSettingsSelectMiles() {
        assertEquals(DistanceUnitPref.MI, imperial.units.distance)
    }

    @Test
    fun currencyAndPrecisionResolveFromSettings() {
        assertEquals("€", euro.currencySymbol)
        assertEquals(1, euro.precision)
    }

    @Test
    fun blankCurrencySymbolUsesDollarFallback() {
        val prefs = TripLegDisplayPrefs.from(Json.parseToJsonElement("""{"currency_symbol":"  "}"""))
        assertEquals("$", prefs.currencySymbol)
    }

    // ── Leg value projection: metric (web conversions + formats) ─────────────────

    @Test
    fun legValuesMatchTheWebFormattingForMetricUnits() {
        val row = firstRow(TripRouteBreakdown(listOf(leg), emptyList()), metric)
        assertEquals(1, row.index)
        assertEquals("Home", row.fromText)
        assertEquals("Work", row.toText)
        assertEquals("12.0 km", row.distanceText)
        // Faithful web parity: the leg duration renders Math.round(duration_s) with the "min" label (no / 60).
        assertEquals("1800 min", row.durationText)
        assertEquals("9.0 kWh", row.energyText)
        assertEquals("80%", row.startSocText)
        assertEquals("60%", row.arrivalSocText)
        assertFalse(row.arrivalLow)
    }

    @Test
    fun distanceConvertsThroughTheImperialBoundary() {
        // 12000 m -> 7.4565 mi -> toFixed(1) "7.5".
        assertEquals("7.5 mi", firstRow(TripRouteBreakdown(listOf(leg), emptyList()), imperial).distanceText)
    }

    @Test
    fun arrivalBelowTwentyIsFlaggedLowOnTheRawValueButTheDisplayedPercentIsRounded() {
        val low = leg.copy(arrivalSoc = 19.6)
        val row = firstRow(TripRouteBreakdown(listOf(low), emptyList()), metric)
        // Web compares the raw arrival_soc (< 20) but renders Math.round(arrival_soc).
        assertTrue(row.arrivalLow)
        assertEquals("20%", row.arrivalSocText)
    }

    @Test
    fun arrivalExactlyTwentyIsNotFlaggedLow() {
        val row = firstRow(TripRouteBreakdown(listOf(leg.copy(arrivalSoc = 20.0)), emptyList()), metric)
        assertFalse(row.arrivalLow)
    }

    @Test
    fun blankWaypointNameFallsBackToSignedCoordinates() {
        val anon = leg.copy(from = TripWaypoint(name = "", lat = 37.421, lng = -122.084))
        // Web: name || `${lat.toFixed(2)}, ${lng.toFixed(2)}` — the latitude keeps its sign, no grouping.
        assertEquals("37.42, -122.08", firstRow(TripRouteBreakdown(listOf(anon), emptyList()), metric).fromText)
    }

    // ── Charge-stop projection + `idx < stops.length` pairing ────────────────────

    @Test
    fun chargeStopValuesMatchTheWebFormatting() {
        val row = firstRow(TripRouteBreakdown(listOf(leg), listOf(stop)), metric)
        val charge = row.chargeStop
        assertNotNull(charge)
        requireNotNull(charge)
        assertEquals("Harris Ranch", charge.name)
        // Web: Math.round(charge_duration_s / 60) -> 1500 / 60 = 25 min.
        assertEquals("25 min", charge.durationText)
        assertEquals("30% \u2192 80%", charge.socText)
        assertEquals("27.0 kWh", charge.energyText)
        assertEquals("$12.50", charge.costText)
        assertTrue(charge.isRecommended)
    }

    @Test
    fun costHonorsTheUserCurrencyAndPrecision() {
        val charge = firstRow(TripRouteBreakdown(listOf(leg), listOf(stop)), euro).chargeStop
        requireNotNull(charge)
        assertEquals("€12.5", charge.costText)
    }

    @Test
    fun noChargeStopIsAttachedWhenThereAreNone() {
        assertNull(firstRow(TripRouteBreakdown(listOf(leg), emptyList()), metric).chargeStop)
    }

    @Test
    fun onlyLegsWithAMatchingStopIndexGetACharger() {
        // Two legs, one stop: stop attaches to leg 0 only (web `idx < stops.length`).
        val twoLegs = TripRouteBreakdown(listOf(leg, leg.copy(startSoc = 60.0, arrivalSoc = 30.0)), listOf(stop))
        val projected = rows(twoLegs, metric)
        assertEquals(2, projected.size)
        assertNotNull(projected[0].chargeStop)
        assertNull(projected[1].chargeStop)
    }

    @Test
    fun extraChargeStopsBeyondTheLegCountAreDropped() {
        // One leg, two stops: only the leg is rendered and it carries the first stop (web map over legItems).
        val breakdown = TripRouteBreakdown(listOf(leg), listOf(stop, stop.copy(name = "Kettleman City")))
        val projected = rows(breakdown, metric)
        assertEquals(1, projected.size)
        assertEquals("Harris Ranch", projected[0].chargeStop?.name)
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────

    @Test
    fun projectUiStateCoversLoadingContentAndEmpty() {
        val populated = TripRouteBreakdown(listOf(leg), listOf(stop))
        assertEquals(UiPhase.Loading, TripLegListProjection.projectUiState(populated, isLoading = true).phase)
        assertEquals(UiPhase.Empty, TripLegListProjection.projectUiState(null, isLoading = false).phase)
        // Web `legItems.length === 0` -> empty even when the snapshot object is present.
        val noLegs = TripRouteBreakdown(emptyList(), emptyList())
        assertEquals(UiPhase.Empty, TripLegListProjection.projectUiState(noLegs, isLoading = false).phase)
        val content = TripLegListProjection.projectUiState(populated, isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(populated, content.data)
    }

    @Test
    fun offlineCachedStateStaysContentAndStillProjectsRows() {
        val populated = TripRouteBreakdown(listOf(leg), listOf(stop))
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = populated,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        assertEquals(1, rows(offline.data!!, metric).size)
    }

    // ── i18n / a11y announcements (web `t('tripPlanner.legs.*')`) ─────────────────

    @Test
    fun legAnnouncementComposesTheSuppliedI18nLabelsAndValues() {
        val announce = firstRow(TripRouteBreakdown(listOf(leg), emptyList()), metric).announce
        assertTrue(announce.startsWith("1"))
        assertTrue(announce.contains("Home \u2192 Work"))
        assertTrue(announce.contains("Distance, 12.0 km"))
        assertTrue(announce.contains("Duration, 1800 min"))
        assertTrue(announce.contains("Energy, 9.0 kWh"))
        assertTrue(announce.contains("Battery, 80% \u2192 60%"))
    }

    @Test
    fun chargeStopAnnouncementIncludesTheRecommendedNoteOnlyWhenRecommended() {
        val recommended = firstRow(TripRouteBreakdown(listOf(leg), listOf(stop)), metric).chargeStop
        requireNotNull(recommended)
        assertTrue(recommended.announce.contains("Harris Ranch"))
        assertTrue(recommended.announce.contains(strings.recommended))

        val plain = firstRow(TripRouteBreakdown(listOf(leg), listOf(stop.copy(isRecommended = false))), metric).chargeStop
        requireNotNull(plain)
        assertFalse(plain.announce.contains(strings.recommended))
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        TripLegListDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "TripLegList"), record.fields)
        assertEquals("TripLegList", TripLegListDiagnostics.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
