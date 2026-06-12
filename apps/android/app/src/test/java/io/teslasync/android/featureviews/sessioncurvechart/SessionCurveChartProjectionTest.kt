package io.teslasync.android.featureviews.sessioncurvechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Session Curve chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/charging/components/charging-curve/SessionCurveChart.tsx):
 * the curve → (xLabels, power values, accessible-table rows) projection with its empty guard and preserved
 * order, the soc label formatting (web `<XAxis dataKey="soc" />`), the one-decimal power formatting (web
 * `Math.round(p.power * 10) / 10`), the `t(key, default)` resolve-or-fallback for the two catalog-absent
 * strings, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class SessionCurveChartProjectionTest {
    private val points =
        listOf(
            CurvePoint(soc = 20.0, power = 150.0),
            CurvePoint(soc = 50.0, power = 120.5),
            CurvePoint(soc = 80.0, power = 0.0),
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsPointsPreservingOrderWithLabelsValuesAndTableRows() {
        val result =
            SessionCurveChartProjection.project(
                points = points,
                formatSoc = { soc -> "S($soc)" },
                formatPower = { power -> "P($power)" },
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("S(20.0)", "S(50.0)", "S(80.0)"), result.xLabels)
        assertEquals(listOf(150.0, 120.5, 0.0), result.powerValues)
        assertEquals(
            listOf(
                listOf("S(20.0)", "P(150.0)"),
                listOf("S(50.0)", "P(120.5)"),
                listOf("S(80.0)", "P(0.0)"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoPoints() {
        val result =
            SessionCurveChartProjection.project(
                points = emptyList(),
                formatSoc = { it.toString() },
                formatPower = { it.toString() },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.powerValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── SOC label formatting (web XAxis raw-number parity) ────────────────────────

    @Test
    fun formatSocShowsWholeValuesWithoutDecimalAndGroupsThousands() {
        assertEquals("20", SessionCurveChartProjection.formatSoc(20.0, Locale.US))
        assertEquals("0", SessionCurveChartProjection.formatSoc(0.0, Locale.US))
        assertEquals("1,000", SessionCurveChartProjection.formatSoc(1_000.0, Locale.US))
    }

    @Test
    fun formatSocKeepsOneDecimalForFractionalValues() {
        assertEquals("22.5", SessionCurveChartProjection.formatSoc(22.5, Locale.US))
        assertEquals("79.5", SessionCurveChartProjection.formatSoc(79.5, Locale.US))
    }

    @Test
    fun formatSocReturnsEmDashForNonFiniteInput() {
        assertEquals(EM_DASH, SessionCurveChartProjection.formatSoc(Double.NaN, Locale.US))
        assertEquals(EM_DASH, SessionCurveChartProjection.formatSoc(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── Power formatting (web Math.round(power * 10) / 10 parity) ──────────────────

    @Test
    fun formatPowerRoundsToOneDecimalAndGroupsThousands() {
        assertEquals("0.0", SessionCurveChartProjection.formatPower(0.0, Locale.US))
        assertEquals("148.5", SessionCurveChartProjection.formatPower(148.46, Locale.US))
        assertEquals("148.4", SessionCurveChartProjection.formatPower(148.44, Locale.US))
        assertEquals("1,234.5", SessionCurveChartProjection.formatPower(1_234.5, Locale.US))
    }

    @Test
    fun formatPowerReturnsEmDashForNonFiniteInput() {
        assertEquals(EM_DASH, SessionCurveChartProjection.formatPower(Double.NaN, Locale.US))
        assertEquals(EM_DASH, SessionCurveChartProjection.formatPower(Double.NEGATIVE_INFINITY, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional(
                lookup = { mapOf(KEY_SUBTITLE to "Catalog subtitle").get(it) },
                resourceName = KEY_SUBTITLE,
                fallback = SessionCurveChartDefaults.SUBTITLE,
            )
        assertEquals("Catalog subtitle", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            SessionCurveChartDefaults.SUBTITLE,
            resolveOptional({ null }, KEY_SUBTITLE, SessionCurveChartDefaults.SUBTITLE),
        )
        assertEquals(
            SessionCurveChartDefaults.ARIA_LABEL,
            resolveOptional({ "   " }, KEY_ARIA, SessionCurveChartDefaults.ARIA_LABEL),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSessionCurveChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SessionCurveChart"), fields)
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
