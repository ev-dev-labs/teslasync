package io.teslasync.android.sharedsurfaces.areachartwrapper

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AreaChartWrapper surface's pure logic — the native analogue of the data
 * preparation the web component performs before handing rows to Recharts
 * (web/src/components/charts/AreaChartWrapper.tsx): the generic-cell → nullable-number coercion, the X-label
 * resolution (with the optional `xFormatter`), the per-series projection in row order, the accessible
 * fallback-table header/rows, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class AreaChartWrapperProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
        const val X_AXIS_LABEL: String = "Time"
        const val X_KEY: String = "t"
    }

    // ── toNullableDouble (Recharts implicit cell coercion) ───────────────────────

    @Test
    fun toNullableDoubleCoercesNumbersAndNumericStringsAndGapsEverythingElse() {
        assertEquals(80.0, coerce(80), EPS)
        assertEquals(72.5, coerce(72.5), EPS)
        assertEquals(305.0, coerce("305"), EPS)
        assertEquals(-1.5, coerce("-1.5"), EPS)
        // Non-numeric string, null, and other types are gaps (null) the chart bridges over.
        assertNull(AreaChartWrapperProjection.toNullableDouble("n/a"))
        assertNull(AreaChartWrapperProjection.toNullableDouble(null))
        assertNull(AreaChartWrapperProjection.toNullableDouble(true))
        // A non-finite number is a gap, never a plotted NaN/Infinity.
        assertNull(AreaChartWrapperProjection.toNullableDouble(Double.NaN))
        assertNull(AreaChartWrapperProjection.toNullableDouble(Double.POSITIVE_INFINITY))
    }

    /** Coerces and asserts non-null in one step, so the [assertEquals] delta overload gets a primitive double. */
    private fun coerce(value: Any?): Double =
        AreaChartWrapperProjection.toNullableDouble(value) ?: error("expected a finite number for $value")

    // ── formatX (web <XAxis dataKey tickFormatter>) ──────────────────────────────

    @Test
    fun formatXStringifiesThenAppliesFormatter() {
        // Identity formatter: the raw category label, stringified.
        assertEquals("08:00", AreaChartWrapperProjection.formatX("08:00") { it })
        assertEquals("42", AreaChartWrapperProjection.formatX(42) { it })
        // A null cell becomes the empty category, mirroring a missing Recharts category.
        assertEquals("", AreaChartWrapperProjection.formatX(null) { it })
        // The xFormatter is applied to the stringified value.
        assertEquals("@08:00", AreaChartWrapperProjection.formatX("08:00") { "@$it" })
    }

    // ── project (web chart data) ─────────────────────────────────────────────────

    @Test
    fun projectBuildsXLabelsAndPerSeriesColumnsInRowOrder() {
        val rows =
            listOf(
                AreaChartRow(X_KEY to "08:00", "soc" to 82, "range" to 305),
                AreaChartRow(X_KEY to "08:30", "soc" to 74, "range" to "271"),
            )
        val series =
            listOf(
                AreaSeries(key = "soc", label = "SOC %", colorArgb = 0x11223344),
                AreaSeries(key = "range", label = "Range"),
            )

        val projection = AreaChartWrapperProjection.project(rows, X_KEY, series)

        assertFalse(projection.isEmpty)
        assertEquals(listOf("08:00", "08:30"), projection.xLabels)
        assertEquals(2, projection.columns.size)
        assertEquals("soc", projection.columns[0].key)
        assertEquals("SOC %", projection.columns[0].label)
        assertEquals(0x11223344, projection.columns[0].colorArgb)
        assertEquals(listOf<Double?>(82.0, 74.0), projection.columns[0].values)
        // The second series has no color → palette-by-position fallback (null preserved).
        assertNull(projection.columns[1].colorArgb)
        // A numeric string coerces; row order is preserved.
        assertEquals(listOf<Double?>(305.0, 271.0), projection.columns[1].values)
    }

    @Test
    fun projectAppliesXFormatterToEveryLabel() {
        val rows = listOf(AreaChartRow(X_KEY to "a"), AreaChartRow(X_KEY to "b"))
        val series = listOf(AreaSeries(key = "v", label = "V"))

        val projection = AreaChartWrapperProjection.project(rows, X_KEY, series, xFormatter = { it.uppercase() })

        assertEquals(listOf("A", "B"), projection.xLabels)
    }

    @Test
    fun projectKeepsMissingSeriesCellsAsGaps() {
        val rows =
            listOf(
                AreaChartRow(X_KEY to "08:00", "soc" to 82),
                // Second row is missing the `soc` field entirely → a gap.
                AreaChartRow(X_KEY to "08:30"),
            )
        val series = listOf(AreaSeries(key = "soc", label = "SOC %"))

        val projection = AreaChartWrapperProjection.project(rows, X_KEY, series)

        assertEquals(listOf<Double?>(82.0, null), projection.columns.single().values)
    }

    @Test
    fun projectReturnsEmptyForNoRows() {
        val projection =
            AreaChartWrapperProjection.project(emptyList(), X_KEY, listOf(AreaSeries(key = "v", label = "V")))

        assertTrue(projection.isEmpty)
        assertTrue(projection.xLabels.isEmpty())
        assertTrue(projection.columns.isEmpty())
    }

    @Test
    fun projectReturnsEmptyForNoSeries() {
        val projection =
            AreaChartWrapperProjection.project(listOf(AreaChartRow(X_KEY to "08:00")), X_KEY, emptyList())

        assertTrue(projection.isEmpty)
        assertTrue(projection.columns.isEmpty())
    }

    // ── accessible fallback table (native ChartContainer a11y) ────────────────────

    @Test
    fun tableHeaderIsCategoryColumnThenSeriesLabels() {
        val projection =
            AreaChartWrapperProjection.project(
                rows = listOf(AreaChartRow(X_KEY to "08:00", "soc" to 82, "range" to 305)),
                xKey = X_KEY,
                series =
                    listOf(
                        AreaSeries(key = "soc", label = "SOC %"),
                        AreaSeries(key = "range", label = "Range"),
                    ),
            )

        assertEquals(
            listOf(X_AXIS_LABEL, "SOC %", "Range"),
            AreaChartWrapperProjection.tableHeader(X_AXIS_LABEL, projection),
        )
    }

    @Test
    fun tableRowsFormatValuesAndEmDashGaps() {
        val rows =
            listOf(
                AreaChartRow(X_KEY to "08:00", "soc" to 82),
                AreaChartRow(X_KEY to "08:30"),
            )
        val series = listOf(AreaSeries(key = "soc", label = "SOC %"))
        val projection = AreaChartWrapperProjection.project(rows, X_KEY, series)

        val table = AreaChartWrapperProjection.tableRows(projection) { value -> "v:$value" }

        assertEquals(
            listOf(
                listOf("08:00", "v:82.0"),
                // The missing cell renders as the em dash, never a blank or NaN.
                listOf("08:30", AREA_EM_DASH),
            ),
            table,
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        AreaChartWrapperDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AreaChartWrapper"), fields)
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
