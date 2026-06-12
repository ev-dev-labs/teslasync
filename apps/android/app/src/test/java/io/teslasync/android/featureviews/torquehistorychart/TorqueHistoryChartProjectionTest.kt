package io.teslasync.android.featureviews.torquehistorychart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Motor Torque history chart's pure logic — the native analogue of the web
 * component's data bindings (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx):
 * the `data.length <= 1 || !data.some(d => d.torque !== null)` content/empty boundary, the order-preserving
 * `time` / `torque` projection with its null gaps, the accessible-table `String(raw)` / `'—'` cell contract
 * (the surface passes no `col.format`), the `{ data }` → [UiState] overload projection, the `t(key, default)`
 * resolve-or-fallback, and the PII-safe `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 */
class TorqueHistoryChartProjectionTest {
    private val fullTrace =
        listOf(
            TorqueHistoryPoint(time = "09:00", torque = 120.0),
            TorqueHistoryPoint(time = "09:05", torque = null),
            TorqueHistoryPoint(time = "09:10", torque = -90.0),
            TorqueHistoryPoint(time = "09:15", torque = 210.5),
        )

    // ── Projection: axis values + order + null gaps (web <AreaChart data={data}>) ──

    @Test
    fun projectPreservesOrderAndCarriesTimesAndTorqueWithNullGaps() {
        val result = TorqueHistoryChartProjection.project(fullTrace)

        assertEquals(listOf("09:00", "09:05", "09:10", "09:15"), result.times)
        // The torque series keeps array order and preserves the null sample as a gap (web connectNulls).
        assertEquals(listOf(120.0, null, -90.0, 210.5), result.torqueValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectUsesInjectedCellFormatterForEachTableRowInOrder() {
        // A tagging stub pins that each torque cell flows through the injected formatter, in order.
        val result = TorqueHistoryChartProjection.project(fullTrace) { torque -> "C[$torque]" }

        assertEquals(
            listOf(
                listOf("09:00", "C[120.0]"),
                listOf("09:05", "C[null]"),
                listOf("09:10", "C[-90.0]"),
                listOf("09:15", "C[210.5]"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectDefaultTableRowsMirrorStringRawAndEmDashForNull() {
        val result = TorqueHistoryChartProjection.project(fullTrace)

        assertEquals(
            listOf(
                listOf("09:00", "120"),
                listOf("09:05", ChartFormat.EMPTY),
                listOf("09:10", "-90"),
                listOf("09:15", "210.5"),
            ),
            result.tableRows,
        )
    }

    // ── Content/empty boundary (web data.length <= 1 || !data.some(torque !== null)) ──

    @Test
    fun isRenderableRequiresMoreThanOneSampleAndANonNullReading() {
        assertFalse(TorqueHistoryChartProjection.isRenderable(emptyList()))
        assertFalse(TorqueHistoryChartProjection.isRenderable(listOf(TorqueHistoryPoint("09:00", 120.0))))
        // Two samples but every torque is null → not worth drawing (web `!data.some(torque !== null)`).
        assertFalse(
            TorqueHistoryChartProjection.isRenderable(
                listOf(TorqueHistoryPoint("09:00", null), TorqueHistoryPoint("09:05", null)),
            ),
        )
        // Two samples with at least one reading → renderable.
        assertTrue(
            TorqueHistoryChartProjection.isRenderable(
                listOf(TorqueHistoryPoint("09:00", null), TorqueHistoryPoint("09:05", 5.0)),
            ),
        )
    }

    @Test
    fun projectIsEmptyMatchesTheRenderableBoundary() {
        val allNull = listOf(TorqueHistoryPoint("09:00", null), TorqueHistoryPoint("09:05", null))
        assertTrue(TorqueHistoryChartProjection.project(emptyList()).isEmpty)
        assertTrue(TorqueHistoryChartProjection.project(listOf(fullTrace.first())).isEmpty)
        assertTrue(TorqueHistoryChartProjection.project(allNull).isEmpty)
        assertFalse(TorqueHistoryChartProjection.project(fullTrace).isEmpty)
    }

    // ── { data } → UiState overload (web component's single branch) ────────────────

    @Test
    fun projectUiStateMapsRenderableToContentAndEverythingElseToEmpty() {
        assertEquals(UiPhase.Content, TorqueHistoryChartProjection.projectUiState(fullTrace).phase)

        assertEquals(UiPhase.Empty, TorqueHistoryChartProjection.projectUiState(null).phase)
        assertEquals(UiPhase.Empty, TorqueHistoryChartProjection.projectUiState(emptyList()).phase)
        assertEquals(
            UiPhase.Empty,
            TorqueHistoryChartProjection.projectUiState(listOf(TorqueHistoryPoint("09:00", 120.0))).phase,
        )
        assertEquals(
            UiPhase.Empty,
            TorqueHistoryChartProjection
                .projectUiState(listOf(TorqueHistoryPoint("09:00", null), TorqueHistoryPoint("09:05", null)))
                .phase,
        )
    }

    @Test
    fun projectUiStateNullDataDegradesToAnEmptyListNeverNull() {
        // A null prop must not surface as null data — the empty state still has an (empty) list to render.
        assertEquals(emptyList<TorqueHistoryPoint>(), TorqueHistoryChartProjection.projectUiState(null).data)
    }

    // ── Accessible-table cell formatting (web raw == null ? '—' : String(raw)) ──────

    @Test
    fun formatTableCellRendersNullAsEmDash() {
        assertEquals(ChartFormat.EMPTY, TorqueHistoryChartProjection.formatTableCell(null))
    }

    @Test
    fun formatTableCellStringifiesValuesWithoutGrouping() {
        // String(raw) parity: whole numbers drop the fraction, large values are NOT locale-grouped.
        assertEquals("250", TorqueHistoryChartProjection.formatTableCell(250.0))
        assertEquals("1250", TorqueHistoryChartProjection.formatTableCell(1250.0))
        assertEquals("248.5", TorqueHistoryChartProjection.formatTableCell(248.5))
        assertEquals("-90", TorqueHistoryChartProjection.formatTableCell(-90.0))
    }

    @Test
    fun plainNumberMatchesJsStringNumberForWholeFractionalAndSignedZero() {
        assertEquals("0", TorqueHistoryChartProjection.plainNumber(0.0))
        // JS String(-0) === "0"; floor(-0.0) == -0.0 and toLong() drops the sign.
        assertEquals("0", TorqueHistoryChartProjection.plainNumber(-0.0))
        assertEquals("420", TorqueHistoryChartProjection.plainNumber(420.0))
        assertEquals("-12.25", TorqueHistoryChartProjection.plainNumber(-12.25))
    }

    @Test
    fun plainNumberCoercesNonFiniteToEmDashSoTheTableNeverShowsNaN() {
        assertEquals(ChartFormat.EMPTY, TorqueHistoryChartProjection.plainNumber(Double.NaN))
        assertEquals(ChartFormat.EMPTY, TorqueHistoryChartProjection.plainNumber(Double.POSITIVE_INFINITY))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, TorqueHistoryChartDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            TorqueHistoryChartDefaults.ARIA_LABEL,
            resolveOptional({ null }, KEY_ARIA, TorqueHistoryChartDefaults.ARIA_LABEL),
        )
        assertEquals(
            TorqueHistoryChartDefaults.ARIA_LABEL,
            resolveOptional({ "   " }, KEY_ARIA, TorqueHistoryChartDefaults.ARIA_LABEL),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTorqueHistoryChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TorqueHistoryChart"), fields)
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
