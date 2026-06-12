package io.teslasync.android.featureviews.batterylevelchart

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Battery-Level-at-Charge-Start chart's pure logic — the native analogue of
 * the web surface's derivations (web/src/features/charging/components/charging-list/BatteryLevelChart.tsx +
 * its helpers.ts `computeStartLevelDist`): the sessions → ten-band distribution adapter with its clamp and
 * fixed x-axis, the buckets → (xLabels, values, accessible-table rows) projection with its blank-panel
 * empty guard, the lifecycle-preserving feed mapping, the locale-grouped count formatting (web `fmtInt`),
 * and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class BatteryLevelChartProjectionTest {
    // ── bucketIndex (web Math.min(Math.floor(soc / 10), 9) + negative clamp) ──────

    @Test
    fun bucketIndexFloorsIntoTenBandsAndClampsTheExtremes() {
        assertEquals(0, BatteryLevelChartProjection.bucketIndex(0.0))
        assertEquals(0, BatteryLevelChartProjection.bucketIndex(9.99))
        assertEquals(1, BatteryLevelChartProjection.bucketIndex(10.0))
        assertEquals(5, BatteryLevelChartProjection.bucketIndex(55.0))
        assertEquals(9, BatteryLevelChartProjection.bucketIndex(95.0))
        // 100% floors to index 10 but clamps into the top 90-100% band (web Math.min(_, 9)).
        assertEquals(9, BatteryLevelChartProjection.bucketIndex(100.0))
        // A malformed negative SoC clamps into the first band instead of throwing.
        assertEquals(0, BatteryLevelChartProjection.bucketIndex(-5.0))
    }

    // ── distribution (web computeStartLevelDist) ──────────────────────────────────

    @Test
    fun distributionAlwaysReturnsTenAscendingBandsWithStableLabels() {
        val buckets = BatteryLevelChartProjection.distribution(emptyList())

        assertEquals(BUCKET_COUNT, buckets.size)
        assertEquals(
            listOf("0-10%", "10-20%", "20-30%", "30-40%", "40-50%", "50-60%", "60-70%", "70-80%", "80-90%", "90-100%"),
            buckets.map { it.range },
        )
        assertTrue(buckets.all { it.count == 0L })
    }

    @Test
    fun distributionCountsSessionsIntoTheirStartingBand() {
        val sessions =
            listOf(
                ChargingSessionStart(5.0),
                ChargingSessionStart(8.0),
                ChargingSessionStart(22.0),
                ChargingSessionStart(100.0),
            )

        val buckets = BatteryLevelChartProjection.distribution(sessions)

        assertEquals(2L, buckets[0].count) // 5% and 8% → 0-10%
        assertEquals(1L, buckets[2].count) // 22% → 20-30%
        assertEquals(1L, buckets[9].count) // 100% → 90-100%
        assertEquals(4L, buckets.sumOf { it.count })
    }

    // ── projectBuckets (render-ready inputs + blank-panel empty guard) ────────────

    @Test
    fun projectBucketsMapsLabelsValuesAndTableRowsPreservingOrder() {
        val buckets =
            listOf(
                StartLevelBucket("0-10%", 2),
                StartLevelBucket("10-20%", 0),
                StartLevelBucket("20-30%", 1_204),
            )

        val result = BatteryLevelChartProjection.projectBuckets(buckets) { count -> "#$count" }

        assertFalse(result.isEmpty)
        assertEquals(listOf("0-10%", "10-20%", "20-30%"), result.xLabels)
        assertEquals(listOf(2.0, 0.0, 1_204.0), result.values)
        assertEquals(
            listOf(
                listOf("0-10%", "#2"),
                listOf("10-20%", "#0"),
                listOf("20-30%", "#1204"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectBucketsIsEmptyWhenNoBandHoldsASession() {
        val allZero = BatteryLevelChartProjection.distribution(emptyList())

        val result = BatteryLevelChartProjection.projectBuckets(allZero) { it.toString() }

        assertTrue(result.isEmpty)
        // Even when empty, the ten stable x-axis labels are still projected (never a torn axis).
        assertEquals(BUCKET_COUNT, result.xLabels.size)
    }

    @Test
    fun projectFromSessionsRunsTheFullDistributionThenProjection() {
        val result =
            BatteryLevelChartProjection.project(
                sessions = listOf(ChargingSessionStart(15.0), ChargingSessionStart(18.0)),
            ) { count -> count.toString() }

        assertFalse(result.isEmpty)
        assertEquals(BUCKET_COUNT, result.values.size)
        assertEquals(2.0, result.values[1], 0.0) // both sessions in 10-20%
        assertEquals(0.0, result.values[0], 0.0)
    }

    // ── distributionState (lifecycle-preserving feed mapping) ─────────────────────

    @Test
    fun distributionStatePreservesEveryLifecycleFieldWhileBucketingThePayload() {
        val source =
            UiState(
                phase = UiPhase.Content,
                data = listOf(ChargingSessionStart(5.0), ChargingSessionStart(95.0)),
                fetchedAt = 1_700_000_000_000L,
                stale = true,
                refreshing = true,
                errorKind = ErrorKind.Network,
                httpStatus = 503,
            )

        val mapped = distributionState(source)

        assertEquals(UiPhase.Content, mapped.phase)
        assertEquals(1_700_000_000_000L, mapped.fetchedAt)
        assertTrue(mapped.stale)
        assertTrue(mapped.refreshing)
        assertEquals(ErrorKind.Network, mapped.errorKind)
        assertEquals(503, mapped.httpStatus)
        assertEquals(BUCKET_COUNT, mapped.data?.size)
        assertEquals(1L, mapped.data?.get(0)?.count) // 5% → 0-10%
        assertEquals(1L, mapped.data?.get(9)?.count) // 95% → 90-100%
    }

    @Test
    fun distributionStateLeavesANullPayloadNull() {
        val mapped = distributionState(UiState(UiPhase.Loading, data = null))

        assertEquals(UiPhase.Loading, mapped.phase)
        assertNull(mapped.data)
    }

    // ── Count formatting (web fmtInt parity) ──────────────────────────────────────

    @Test
    fun formatCountGroupsThousandsAndHandlesZero() {
        assertEquals("0", BatteryLevelChartProjection.formatCount(0, Locale.US))
        assertEquals("1,204", BatteryLevelChartProjection.formatCount(1_204, Locale.US))
        assertEquals("1,000,000", BatteryLevelChartProjection.formatCount(1_000_000, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordBatteryLevelChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "BatteryLevelChart"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
