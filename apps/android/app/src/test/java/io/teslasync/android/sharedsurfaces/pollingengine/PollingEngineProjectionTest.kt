package io.teslasync.android.sharedsurfaces.pollingengine

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime

/**
 * Off-device unit coverage of [PollingProjection] + the model parsers — the pure data adapter the composable
 * renders. Exercises the web `getPollingStatus`/`getPollingSavings` parsing, the `SavingsCard` formatting +
 * cost-attribution split, the `VehicleActivity` mapping (activity/profile buckets + next-poll countdown), the
 * `!status?.enabled` gate, and the cache-then-network → projection envelope (loading / content / empty / hard
 * error / stale / offline), plus the classified error-kind mapping. Runs in the `:android:testReleaseUnitTest`
 * gate.
 */
class PollingEngineProjectionTest {
    // ── parsers ──────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun statusFromJsonReadsEnabledAndVehicles() {
        val json =
            buildJsonObject {
                put("enabled", true)
                putJsonObject("vehicles") {
                    putJsonObject("5YJ3E1EA7KF000001") {
                        put("activity", "active")
                        put("profile", "driving")
                        put("next_poll_after", "2026-06-13T07:45:00Z")
                    }
                }
            }
        val status = PollingStatusData.fromJson(json)
        assertTrue(status.enabled)
        assertEquals(1, status.vehicles.size)
        val vehicle = status.vehicles.single()
        assertEquals("5YJ3E1EA7KF000001", vehicle.vin)
        assertEquals("active", vehicle.activity)
        assertEquals("driving", vehicle.profile)
        assertEquals(parseEpoch("2026-06-13T07:45:00Z"), vehicle.nextPollAfterEpochMs)
    }

    @Test
    fun statusFromJsonDefaultsDisabledEmptyOnGarbage() {
        assertEquals(PollingStatusData(enabled = false, vehicles = emptyList()), PollingStatusData.fromJson(null))
        val disabled = PollingStatusData.fromJson(buildJsonObject {})
        assertFalse(disabled.enabled)
        assertTrue(disabled.vehicles.isEmpty())
    }

    @Test
    fun savingsFromJsonReadsStatsAndBreakdown() {
        val json =
            buildJsonObject {
                put("savings_percent", 42.5)
                put("estimated_savings", 12.3)
                put("polls_made", 1840.0)
                put("remaining_credit", 5.0)
                putJsonObject("savings_breakdown") {
                    put("fleet_telemetry", 50.0)
                    put("idle_detection", 30.0)
                    put("prediction", 15.0)
                    put("sleep_detection", 5.0)
                }
            }
        val savings = PollingSavingsData.fromJson(json)
        assertEquals(42.5, savings.savingsPercent, 0.0)
        assertEquals(12.3, savings.estimatedSavings, 0.0)
        assertEquals(1840.0, savings.pollsMade, 0.0)
        assertEquals(5.0, savings.remainingCredit, 0.0)
        assertEquals(100.0, savings.breakdown.total, 0.0)
    }

    // ── phase resolution (the web gate + visible branches + lifecycle) ────────────────────────────────

    @Test
    fun disabledEngineIsHidden() {
        val display = PollingProjection.project(statusOf(disabled()), noSavings(), NOW)
        assertEquals(PollingPhase.Hidden, display.phase)
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val status = Resource.Loading<PollingStatusData>(cached = null, fetchedAt = null, stale = false).toUiState { false }
        assertEquals(PollingPhase.Loading, PollingProjection.project(status, noSavings(), NOW).phase)
    }

    @Test
    fun enabledWithVehiclesIsContent() {
        val display = PollingProjection.project(statusOf(enabledWithVehicle()), noSavings(), NOW)
        assertEquals(PollingPhase.Content, display.phase)
        assertEquals(1, display.vehicles.size)
    }

    @Test
    fun enabledWithoutVehiclesIsEmpty() {
        val display = PollingProjection.project(statusOf(enabledNoVehicles()), noSavings(), NOW)
        assertEquals(PollingPhase.Empty, display.phase)
        assertTrue(display.vehicles.isEmpty())
    }

    @Test
    fun hardErrorWithNoCacheIsError() {
        val status =
            Resource
                .Error<PollingStatusData>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
                .toUiState { false }
        val display = PollingProjection.project(status, noSavings(), NOW)
        assertEquals(PollingPhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    // ── savings card formatting + breakdown ──────────────────────────────────────────────────────────

    @Test
    fun savingsViewFormatsStatsAndSplitsBreakdown() {
        val data =
            PollingSavingsData(
                savingsPercent = 42.5,
                estimatedSavings = 12.3,
                pollsMade = 1840.0,
                remainingCredit = 5.0,
                breakdown = PollingBreakdown(fleetTelemetry = 50.0, idleDetection = 30.0, prediction = 15.0, sleep = 5.0),
            )
        val savings = PollingProjection.project(statusOf(enabledWithVehicle()), success(data), NOW).savings
        requireNotNull(savings)
        assertEquals("42.5", savings.savingsPercentText)
        assertEquals("12.30", savings.estimatedSavingsText)
        assertEquals("1840", savings.pollsMadeText)
        assertEquals("5.00", savings.remainingCreditText)
        assertTrue(savings.hasBreakdown)
        assertEquals(0.5f, savings.segments.first { it.kind == BreakdownKind.FleetTelemetry }.fraction, 0.0001f)
        assertEquals(0.05f, savings.segments.first { it.kind == BreakdownKind.Sleep }.fraction, 0.0001f)
    }

    @Test
    fun savingsViewHasNoBreakdownWhenTotalZero() {
        val data = PollingSavingsData(0.0, 0.0, 0.0, 0.0, PollingBreakdown(0.0, 0.0, 0.0, 0.0))
        val savings = PollingProjection.savingsView(data)
        assertFalse(savings.hasBreakdown)
        assertTrue(savings.segments.all { it.fraction == 0f })
    }

    @Test
    fun savingsCardIsNullWhenSavingsFeedHasNoData() {
        val display = PollingProjection.project(statusOf(enabledWithVehicle()), noSavings(), NOW)
        assertNull(display.savings)
    }

    // ── vehicle rows: kind mapping + countdown ────────────────────────────────────────────────────────

    @Test
    fun vehicleRowMapsKindsAndCountdown() {
        val row =
            PollingProjection.vehicleRow(
                VehiclePollingStatus(
                    vin = "5YJ3E1EA7KF000099",
                    activity = "active",
                    profile = "driving",
                    nextPollAfterEpochMs = NOW + FIVE_SECONDS_MS,
                ),
                NOW,
            )
        assertEquals("KF000099", row.vinTail)
        assertEquals("active", row.activityRaw)
        assertEquals(PollingActivityKind.Active, row.activityKind)
        assertEquals(PollingProfileKind.Driving, row.profileKind)
        assertEquals("driving", row.profileRaw)
        assertEquals("5s", row.countdownText)
        assertFalse(row.isNow)
    }

    @Test
    fun countdownFormatsDurationsAndNow() {
        assertEquals("5s", PollingProjection.countdownOf(NOW + FIVE_SECONDS_MS, NOW).text)
        assertEquals("3m", PollingProjection.countdownOf(NOW + THREE_MINUTES_MS, NOW).text)
        assertEquals("2h 5m", PollingProjection.countdownOf(NOW + TWO_HOURS_FIVE_MIN_MS, NOW).text)
        assertTrue(PollingProjection.countdownOf(NOW - FIVE_SECONDS_MS, NOW).isNow)
        val unknown = PollingProjection.countdownOf(null, NOW)
        assertFalse(unknown.isNow)
        assertNull(unknown.text)
    }

    @Test
    fun activityAndProfileBucketsCoverTheWebSwitches() {
        assertEquals(PollingActivityKind.Active, PollingProjection.activityKindOf("critical"))
        assertEquals(PollingActivityKind.Moderate, PollingProjection.activityKindOf("moderate"))
        assertEquals(PollingActivityKind.Low, PollingProjection.activityKindOf("low"))
        assertEquals(PollingActivityKind.Sleeping, PollingProjection.activityKindOf("sleeping"))
        assertEquals(PollingActivityKind.Unknown, PollingProjection.activityKindOf("weird"))
        assertEquals(PollingProfileKind.Charging, PollingProjection.profileKindOf("charging"))
        assertEquals(PollingProfileKind.Other, PollingProjection.profileKindOf("custom"))
    }

    // ── freshness envelope ────────────────────────────────────────────────────────────────────────────

    @Test
    fun cachedStatusAfterFailedRefreshIsOffline() {
        val status =
            Resource
                .Error(cached = enabledWithVehicle(), fetchedAt = 5L, stale = true, error = ApiError.Timeout())
                .toUiState { false }
        val display = PollingProjection.project(status, noSavings(), NOW)
        assertEquals(PollingPhase.Content, display.phase)
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
        assertEquals(5L, display.freshnessStamp)
    }

    @Test
    fun cachedStatusPastTtlIsStaleAndRefreshing() {
        val status = Resource.Loading(cached = enabledWithVehicle(), fetchedAt = 9L, stale = true).toUiState { false }
        val display = PollingProjection.project(status, noSavings(), NOW)
        assertEquals(PollingPhase.Content, display.phase)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
    }

    // ── classified error-kind mapping ─────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    // ── number formatter ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun formatFixedIsLocaleFreeAndPadsDecimals() {
        assertEquals("42.5", PollingProjection.formatFixed(42.54, 1))
        assertEquals("12.30", PollingProjection.formatFixed(12.3, 2))
        assertEquals("1840", PollingProjection.formatFixed(1840.0, 0))
        assertEquals("0.00", PollingProjection.formatFixed(0.0, 2))
        assertEquals("-1.5", PollingProjection.formatFixed(-1.5, 1))
        assertEquals("0", PollingProjection.formatFixed(Double.NaN, 0))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        PollingProjection.queryErrorKind(
            PollingDisplay(phase = PollingPhase.Error, errorKind = errorKind, httpStatus = httpStatus),
        )

    private companion object {
        const val NOW = 1_000_000_000_000L
        const val FIVE_SECONDS_MS = 5_000L
        const val THREE_MINUTES_MS = 180_000L
        const val TWO_HOURS_FIVE_MIN_MS = 7_500_000L
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 503

        fun parseEpoch(value: String): Long = OffsetDateTime.parse(value).toInstant().toEpochMilli()

        fun disabled(): PollingStatusData = PollingStatusData(enabled = false, vehicles = emptyList())

        fun enabledNoVehicles(): PollingStatusData = PollingStatusData(enabled = true, vehicles = emptyList())

        fun enabledWithVehicle(): PollingStatusData =
            PollingStatusData(
                enabled = true,
                vehicles =
                    listOf(
                        VehiclePollingStatus(
                            vin = "5YJ3E1EA7KF000001",
                            activity = "active",
                            profile = "driving",
                            nextPollAfterEpochMs = NOW + FIVE_SECONDS_MS,
                        ),
                    ),
            )

        fun statusOf(data: PollingStatusData): UiState<PollingStatusData> =
            Resource.Success(data, fetchedAt = 1L, stale = false).toUiState { false }

        fun success(data: PollingSavingsData): UiState<PollingSavingsData> =
            Resource.Success(data, fetchedAt = 1L, stale = false).toUiState { false }

        fun noSavings(): UiState<PollingSavingsData> =
            Resource.Loading<PollingSavingsData>(cached = null, fetchedAt = null, stale = false).toUiState { false }
    }
}
