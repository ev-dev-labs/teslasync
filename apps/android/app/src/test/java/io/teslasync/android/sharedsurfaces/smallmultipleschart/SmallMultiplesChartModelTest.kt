package io.teslasync.android.sharedsurfaces.smallmultipleschart

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SmallMultiplesChart's pure adapter — the native mirror of every data decision
 * the web component makes (web/src/components/charts/SmallMultiplesChart.tsx): one cell per series, finite-only
 * projection (NaN / ±∞ / null are gaps), the `hasData` full-scan, the shared index-aligned x-axis, stride
 * downsampling that always preserves first + last, and the `colorIndex ?? position` color resolution. Because the
 * composable is a thin render layer over this adapter, the per-branch assertions here double as the surface's
 * per-state coverage. Runs in the :android:testReleaseUnitTest gate.
 */
class SmallMultiplesChartModelTest {
    private fun rows(vararg entries: Pair<String, Map<String, Double?>>): List<SmallMultiplesRow> =
        entries.map { SmallMultiplesRow(it.first, it.second) }

    // ── projectCells: one cell per series, in order (web grid) ───────────────────────────────────────

    @Test
    fun projectsOneCellPerSeriesInOrder() {
        val data =
            rows(
                "t1" to mapOf("a" to 1.0, "b" to 100.0, "c" to null),
                "t2" to mapOf("a" to 2.0, "b" to 110.0, "c" to null),
            )
        val cells = projectCells(data, listOf("a", "b", "c"), DEFAULT_CAP)
        assertEquals(listOf("a", "b", "c"), cells.map { it.key })
    }

    @Test
    fun emptySeriesYieldsNoCells() {
        // The overall empty-grid state — the view renders its friendly empty placeholder.
        assertTrue(projectCells(rows("t1" to mapOf("a" to 1.0)), emptyList(), DEFAULT_CAP).isEmpty())
    }

    // ── hasData: finite presence, full scan (web `hasData`) ──────────────────────────────────────────

    @Test
    fun cellHasDataWhenSeriesHasAnyFiniteValueElseFalse() {
        val data =
            rows(
                "t1" to mapOf("a" to 1.0, "b" to null),
                "t2" to mapOf("a" to 2.0, "b" to null),
            )
        val cells = projectCells(data, listOf("a", "b"), DEFAULT_CAP).associateBy { it.key }
        assertTrue(cells.getValue("a").hasData)
        assertFalse("series with only nulls renders the No-data placeholder", cells.getValue("b").hasData)
    }

    @Test
    fun nonFiniteNumbersAreTreatedAsNoData() {
        // Web `isFinitePoint`: NaN / +∞ / -∞ / null are all gaps.
        val data =
            rows(
                "t1" to
                    mapOf(
                        "nan" to Double.NaN,
                        "posInf" to Double.POSITIVE_INFINITY,
                        "negInf" to Double.NEGATIVE_INFINITY,
                        "nul" to null,
                    ),
            )
        val cells = projectCells(data, listOf("nan", "posInf", "negInf", "nul"), DEFAULT_CAP)
        assertTrue(cells.none { it.hasData })
        assertTrue(cells.all { cell -> cell.values.all { it == null } })
    }

    @Test
    fun sparseSeriesAcrossManyRowsStillHasData() {
        // The web's headline perf case: a signal with one point among many rows still counts as having data.
        val data =
            (0 until 100).map { i ->
                SmallMultiplesRow("t$i", mapOf("sparse" to if (i == 73) 9.0 else null))
            }
        assertTrue(projectCells(data, listOf("sparse"), DEFAULT_CAP).single().hasData)
    }

    @Test
    fun filtersNonFinitePerIndexKeepingNullGaps() {
        val data =
            rows(
                "t1" to mapOf("a" to 1.0),
                "t2" to mapOf("a" to Double.NaN),
                "t3" to mapOf("a" to 3.0),
            )
        assertEquals(listOf(1.0, null, 3.0), projectCells(data, listOf("a"), DEFAULT_CAP).single().values)
    }

    // ── shared x-axis across cells (cross-cell cursor alignment precondition) ─────────────────────────

    @Test
    fun allCellsShareTheSameXAxis() {
        val data =
            rows(
                "t1" to mapOf("a" to 1.0, "b" to 5.0),
                "t2" to mapOf("a" to 2.0, "b" to 6.0),
            )
        val cells = projectCells(data, listOf("a", "b"), DEFAULT_CAP)
        assertEquals(listOf("t1", "t2"), cells[0].xLabels)
        assertEquals(cells[0].xLabels, cells[1].xLabels)
    }

    // ── strideIndices: identity, cap, first + last preservation (web `strideSample`) ─────────────────

    @Test
    fun strideIndicesReturnsIdentityWhenUnderCap() {
        assertEquals((0 until 5).toList(), strideIndices(5, 400))
    }

    @Test
    fun strideIndicesCapsAndAlwaysKeepsFirstAndLast() {
        val kept = strideIndices(2000, 50)
        assertTrue("kept near the cap", kept.size <= 51)
        assertEquals(0, kept.first())
        assertEquals(1999, kept.last())
    }

    @Test
    fun strideIndicesHandlesDegenerateSizes() {
        assertTrue(strideIndices(0, 400).isEmpty())
        assertTrue(strideIndices(5, 0).isEmpty())
    }

    @Test
    fun downsamplesDenseCellPointsToCapPreservingEnds() {
        val data = (0 until 2000).map { SmallMultiplesRow("t$it", mapOf("dense" to it.toDouble())) }
        val cell = projectCells(data, listOf("dense"), 50).single()
        assertTrue(cell.values.size <= 51)
        assertTrue(cell.hasData)
        assertEquals(0.0, cell.values.first())
        assertEquals(1999.0, cell.values.last())
    }

    // ── cellColorIndex: positional default, override, zero floor (web `colorIndex ?? i`, `max(0, idx)`) ─

    @Test
    fun cellColorIndexUsesPositionByDefault() {
        assertEquals(0, cellColorIndex(0, "a", null))
        assertEquals(3, cellColorIndex(3, "a", null))
    }

    @Test
    fun cellColorIndexHonorsOverrideAndFloorsAtZero() {
        assertEquals(7, cellColorIndex(2, "a", mapOf("a" to 7)))
        assertEquals(0, cellColorIndex(5, "a", mapOf("a" to -3)))
    }

    @Test
    fun isFiniteValueGuards() {
        assertTrue(isFiniteValue(1.0))
        assertFalse(isFiniteValue(null))
        assertFalse(isFiniteValue(Double.NaN))
        assertFalse(isFiniteValue(Double.POSITIVE_INFINITY))
    }

    private companion object {
        const val DEFAULT_CAP = 400
    }
}
