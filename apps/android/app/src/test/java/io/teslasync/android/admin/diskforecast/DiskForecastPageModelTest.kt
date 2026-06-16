package io.teslasync.android.admin.diskforecast

import io.teslasync.shared.core.presentation.operatorconfidence.DiskForecastResponse
import io.teslasync.shared.core.presentation.operatorconfidence.HypertableSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the framework-free DiskForecastPage model (the pure derivations the composable
 * renders): the severity-tier classification (web `SEVERITY_VARIANT` union), the fleet total/uncompressed/
 * compressed/growth roll-up and its share-of-total percentages (web `fleetTotals` memo + `(part / total) *
 * 100`), the typed-response projection (web `hypertables` read), and the HTTP-503 "subsystem not configured"
 * predicate (web `error.status === 503`). No Android/Compose types are touched.
 */
class DiskForecastPageModelTest {
    // ── DiskSeverityTone.from ─────────────────────────────────────────────────────

    @Test
    fun severityFoldsKnownTiers() {
        assertEquals(DiskSeverityTone.Ok, DiskSeverityTone.from("ok"))
        assertEquals(DiskSeverityTone.Warn, DiskSeverityTone.from("warn"))
        assertEquals(DiskSeverityTone.Critical, DiskSeverityTone.from("critical"))
    }

    @Test
    fun severityIsCaseInsensitive() {
        assertEquals(DiskSeverityTone.Critical, DiskSeverityTone.from("CRITICAL"))
    }

    @Test
    fun severityUnknownForUnrecognisedOrBlank() {
        assertEquals(DiskSeverityTone.Unknown, DiskSeverityTone.from("unknown"))
        assertEquals(DiskSeverityTone.Unknown, DiskSeverityTone.from(""))
        assertEquals(DiskSeverityTone.Unknown, DiskSeverityTone.from("mystery"))
    }

    // ── DiskFleetTotals.from ──────────────────────────────────────────────────────

    @Test
    fun totalsFoldEveryByteFieldAndGrowth() {
        val rows =
            listOf(
                hypertable(total = 1_000L, uncompressed = 600L, compressed = 400L, growth = 10.5),
                hypertable(total = 3_000L, uncompressed = 1_400L, compressed = 1_600L, growth = 4.5),
            )
        val totals = DiskFleetTotals.from(rows)
        assertEquals(4_000L, totals.totalBytes)
        assertEquals(2_000L, totals.uncompressedBytes)
        assertEquals(2_000L, totals.compressedBytes)
        assertEquals(15.0, totals.growthBytesPerDay, DELTA)
    }

    @Test
    fun totalsComputeShareOfTotalPercentages() {
        val rows = listOf(hypertable(total = 1_000L, uncompressed = 750L, compressed = 250L))
        val totals = DiskFleetTotals.from(rows)
        assertEquals(75.0, totals.uncompressedPercent!!, DELTA)
        assertEquals(25.0, totals.compressedPercent!!, DELTA)
    }

    @Test
    fun totalsPercentagesNullWhenNoBytes() {
        val totals = DiskFleetTotals.from(emptyList())
        assertNull(totals.uncompressedPercent)
        assertNull(totals.compressedPercent)
        assertEquals(DiskFleetTotals.EMPTY, totals)
    }

    // ── DiskForecastView.from ─────────────────────────────────────────────────────

    @Test
    fun viewEmptyWhenResponseNull() {
        val view = DiskForecastView.from(null)
        assertTrue(view.isEmpty)
        assertFalse(view.hasRows)
        assertEquals(DiskFleetTotals.EMPTY, view.totals)
    }

    @Test
    fun viewProjectsRowsAndFoldsTotals() {
        val response =
            DiskForecastResponse(
                hypertables =
                    listOf(
                        hypertable(name = "signal_log", total = 2_000L, uncompressed = 1_200L, compressed = 800L),
                        hypertable(name = "drives", total = 2_000L, uncompressed = 800L, compressed = 1_200L),
                    ),
            )
        val view = DiskForecastView.from(response)
        assertFalse(view.isEmpty)
        assertTrue(view.hasRows)
        assertEquals(2, view.rows.size)
        assertEquals(4_000L, view.totals.totalBytes)
        assertEquals(50.0, view.totals.uncompressedPercent!!, DELTA)
        assertEquals(50.0, view.totals.compressedPercent!!, DELTA)
    }

    // ── isSubsystemMissing ────────────────────────────────────────────────────────

    @Test
    fun subsystemMissingOnlyFor503() {
        assertTrue(isSubsystemMissing(503))
        assertFalse(isSubsystemMissing(null))
        assertFalse(isSubsystemMissing(200))
        assertFalse(isSubsystemMissing(500))
    }

    private fun hypertable(
        name: String = "signal_log",
        total: Long = 0L,
        uncompressed: Long = 0L,
        compressed: Long = 0L,
        chunks: Long = 0L,
        growth: Double = 0.0,
        estDaysToQuota: Double? = null,
        severity: String = "ok",
    ): HypertableSize =
        HypertableSize(
            hypertableName = name,
            totalBytes = total,
            uncompressedBytes = uncompressed,
            compressedBytes = compressed,
            chunkCount = chunks,
            growthBytesPerDay = growth,
            estDaysToQuota = estDaysToQuota,
            severity = severity,
        )

    private companion object {
        const val DELTA = 0.0001
    }
}
