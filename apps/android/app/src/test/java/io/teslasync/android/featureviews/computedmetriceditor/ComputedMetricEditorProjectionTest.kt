package io.teslasync.android.featureviews.computedmetriceditor

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ComputedMetricEditor's pure logic — the native analogue of every derivation
 * the web component performs before returning JSX
 * (web/src/features/notifications/components/ComputedMetricEditor.tsx): the `ALL_OPS` set, the `opLabel` /
 * `opKey` / `unitSuffix` helpers, the `parseFloat` + `Number.isFinite` readiness guard, the `handleMetric`
 * reset, the preview-request gate, the i18n key folding + resolve-or-fallback (including the catalog-absent
 * `previewIdle` / `previewValue` keys), the `{{value}}{{suffix}}{{verdict}}` interpolation, the `fmtNumber(2)`
 * formatting, the per-row option labels, and the metric-registry surface projection. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ComputedMetricEditorProjectionTest {
    // ── Operator + unit helpers (web ALL_OPS / opLabel / opKey / unitSuffix) ──────────

    @Test
    fun allOpsMatchTheWebSetInOrder() {
        assertEquals(
            listOf(">", ">=", "<", "<=", "=", "!=", "%_change_>", "%_change_<"),
            ALL_OPS,
        )
    }

    @Test
    fun opLabelHumanizesPercentChangeOnly() {
        assertEquals(">", opLabel(">"))
        assertEquals("<=", opLabel("<="))
        assertEquals("% change >", opLabel("%_change_>"))
        assertEquals("% change <", opLabel("%_change_<"))
    }

    @Test
    fun opKeyMapsEveryOperatorToItsStableSubKey() {
        assertEquals("gt", opKey(">"))
        assertEquals("gte", opKey(">="))
        assertEquals("lt", opKey("<"))
        assertEquals("lte", opKey("<="))
        assertEquals("eq", opKey("="))
        assertEquals("neq", opKey("!="))
        assertEquals("pctGt", opKey("%_change_>"))
        assertEquals("pctLt", opKey("%_change_<"))
    }

    @Test
    fun unitSuffixMatchesTheWebMapping() {
        assertEquals("", unitSuffix("currency"))
        assertEquals("/mi", unitSuffix("currency_per_mi"))
        assertEquals("kWh", unitSuffix("kwh"))
        assertEquals("Wh/mi", unitSuffix("wh_per_mi"))
        assertEquals("mi", unitSuffix("mi"))
        assertEquals("km", unitSuffix("km"))
        assertEquals("h", unitSuffix("h"))
        assertEquals("", unitSuffix("count"))
        assertEquals("%", unitSuffix("%"))
        assertEquals("widgets", unitSuffix("widgets"))
    }

    // ── parseFloat parity + readiness ─────────────────────────────────────────────────

    @Test
    fun jsParseFloatMirrorsLeadingNumericParse() {
        assertEquals(200.0, jsParseFloat("200"))
        assertEquals(200.0, jsParseFloat("  200  "))
        assertEquals(200.0, jsParseFloat("200abc"))
        assertEquals(0.5, jsParseFloat(".5"))
        assertEquals(-3.2, jsParseFloat("-3.2"))
        assertEquals(1000.0, jsParseFloat("1e3"))
        assertNull(jsParseFloat(""))
        assertNull(jsParseFloat("abc"))
        assertNull(jsParseFloat("Infinity"))
    }

    @Test
    fun readyRequiresMetricWindowOperatorAndFiniteThreshold() {
        assertFalse(ComputedMetricEditorValue().isReady())
        assertFalse(value(metricId = "m", metricWindow = "30d", metricOp = ">").isReady())
        assertFalse(value(metricId = "m", metricWindow = "30d", metricOp = ">", threshold = "abc").isReady())
        assertTrue(value(metricId = "m", metricWindow = "30d", metricOp = ">", threshold = "200").isReady())
        assertEquals(200.0, value(threshold = "200").thresholdValue())
        assertNull(value(threshold = "").thresholdValue())
    }

    // ── handleMetric reset (web handleMetric) ──────────────────────────────────────────

    @Test
    fun selectingMetricSeedsFirstWindowAndOperator() {
        val metrics = listOf(metric(id = "cost", windows = listOf("7d", "30d"), ops = listOf(">=", "<")))
        val next = handleMetricSelection(value(metricOp = ">"), "cost", metrics)

        assertEquals("cost", next.metricId)
        assertEquals("7d", next.metricWindow)
        assertEquals(">=", next.metricOp)
    }

    @Test
    fun selectingMetricWithNoOperatorsKeepsCurrentOperator() {
        val metrics = listOf(metric(id = "cost", windows = emptyList(), ops = emptyList()))
        val next = handleMetricSelection(value(metricOp = "!="), "cost", metrics)

        assertEquals("cost", next.metricId)
        assertEquals("", next.metricWindow)
        assertEquals("!=", next.metricOp)
    }

    @Test
    fun selectingUnknownMetricClearsWindowAndKeepsOperator() {
        val next = handleMetricSelection(value(metricOp = ">"), "ghost", emptyList())

        assertEquals("ghost", next.metricId)
        assertEquals("", next.metricWindow)
        assertEquals(">", next.metricOp)
    }

    // ── Preview request gate (web useEffect mutate) ─────────────────────────────────────

    @Test
    fun previewRequestIsNullUntilReady() {
        assertNull(previewRequest(value(metricId = "m", metricWindow = "30d", metricOp = ">")))
    }

    @Test
    fun previewRequestCarriesEverySiOperand() {
        val request = previewRequest(value(metricId = "m", metricWindow = "30d", metricOp = ">", threshold = "200", vehicleId = 7L))

        assertEquals("m", request?.metricId)
        assertEquals("30d", request?.metricWindow)
        assertEquals(">", request?.metricOp)
        assertEquals(200.0, request?.metricThreshold)
        assertEquals(7L, request?.vehicleId)
        assertEquals("computed_metric", request?.kind)
    }

    // ── Metric/window/operator option lists (web selected?.* ?? ...) ────────────────────

    @Test
    fun windowsAndOperatorsTrackTheSelectedMetric() {
        val metrics = listOf(metric(id = "cost", windows = listOf("7d"), ops = listOf("=", "!=")))

        assertEquals(listOf("7d"), windowsFor(metrics, "cost"))
        assertEquals(listOf("=", "!="), operatorsFor(metrics, "cost"))
        assertEquals(emptyList<String>(), windowsFor(metrics, "ghost"))
        assertEquals(ALL_OPS, operatorsFor(metrics, "ghost"))
        assertEquals(ALL_OPS, operatorsFor(listOf(metric(id = "cost", ops = emptyList())), "cost"))
    }

    @Test
    fun suffixForResolvesTheSelectedMetricUnit() {
        val metrics = listOf(metric(id = "cost", unit = "kwh"))
        assertEquals("kWh", suffixFor(metrics, "cost"))
        assertEquals("", suffixFor(metrics, "ghost"))
    }

    // ── i18n facade: fold + resolve + interpolate ───────────────────────────────────────

    @Test
    fun foldCatalogKeyMatchesGeneratedResourceNames() {
        assertEquals(
            "translation_notifications_alertStudio_computedMetric_metric",
            foldCatalogKey("notifications.alertStudio.computedMetric.metric"),
        )
        // The web key whose identifier literally ends in the empty-label word folds to the present resource.
        assertEquals(
            "translation_notifications_alertStudio_computedMetric_metricPlaceholder",
            foldCatalogKey("notifications.alertStudio.computedMetric.metricPlaceholder"),
        )
    }

    @Test
    fun resolveOptionalPrefersCatalogValueThenFallsBack() {
        assertEquals("Localized", resolveOptional({ "Localized" }, "translation_x", "Default"))
        assertEquals("Default", resolveOptional({ null }, "translation_x", "Default"))
        assertEquals("Default", resolveOptional({ "  " }, "translation_x", "Default"))
    }

    @Test
    fun renderTemplateInterpolatesKnownTokensOnly() {
        val out = renderTemplate("a {{x}} b {{y}} c {{z}}", mapOf("x" to "1", "y" to "2"))
        assertEquals("a 1 b 2 c {{z}}", out)
    }

    // ── Strings builder (web t(key, default) with catalog-absent fallbacks) ─────────────

    @Test
    fun buildStringsFallsBackToWebDefaultsWhenCatalogEmpty() {
        val s = buildComputedMetricEditorStrings { null }

        assertEquals("Metric", s.metricLabel)
        assertEquals("Choose a metric", s.metricEmptyLabel)
        assertEquals("Window", s.windowLabel)
        assertEquals("Choose a window", s.windowEmptyLabel)
        assertEquals("Operator", s.operatorLabel)
        assertEquals("Threshold", s.thresholdLabel)
        assertEquals("e.g. 200", s.thresholdHint)
        assertEquals("Live preview", s.previewTitle)
        // previewIdle / previewValue are catalog-absent in the web too — the web inline fallback renders.
        assertEquals("Pick a metric, window, operator, and threshold to preview.", s.previewIdle)
        assertEquals(
            "Right now this metric is {{value}}{{suffix}} \u2014 would {{verdict}} fire.",
            s.previewTemplate,
        )
        assertEquals("Failed to preview metric", s.previewError)
        assertEquals("", s.verdictWould)
        assertEquals("NOT", s.verdictWouldNot)
    }

    @Test
    fun buildStringsResolvesPresentKeysLiveFromCatalog() {
        val catalog =
            mapOf(
                "translation_notifications_alertStudio_computedMetric_metric" to "Métrica",
                "translation_common_retry" to "Reintentar",
            )
        val s = buildComputedMetricEditorStrings { catalog[it] }

        assertEquals("Métrica", s.metricLabel)
        assertEquals("Reintentar", s.retry)
        // Absent keys still fall back to the web default.
        assertEquals("Live preview", s.previewTitle)
    }

    @Test
    fun optionLabelsFallBackToApiTokenAndOperatorLabel() {
        val metric = metric(id = "cost", label = "Charging cost")

        assertEquals("Charging cost", metricOptionLabel({ null }, metric))
        assertEquals("30d", windowOptionLabel({ null }, "30d"))
        assertEquals(">", operatorOptionLabel({ null }, ">"))
        assertEquals("% change >", operatorOptionLabel({ null }, "%_change_>"))
        // A catalog override wins over the fallback.
        val catalog = mapOf("translation_notifications_alertStudio_metricOps_gt" to "greater than")
        assertEquals("greater than", operatorOptionLabel({ catalog[it] }, ">"))
    }

    // ── Preview value sentence (web previewValue interpolation) ─────────────────────────

    @Test
    fun previewValueTextRendersTriggeringSentenceWithEmptyVerdict() {
        val s = buildComputedMetricEditorStrings { null }
        val preview = ComputedMetricPreview(value = 214.3, threshold = 200.0, wouldTrigger = true)

        assertEquals(
            "Right now this metric is 214.30 \u2014 would  fire.",
            previewValueText(s, preview, suffix = "", locale = Locale.US),
        )
    }

    @Test
    fun previewValueTextRendersNonTriggeringSentenceWithSuffix() {
        val s = buildComputedMetricEditorStrings { null }
        val preview = ComputedMetricPreview(value = 10.0, threshold = 50.0, wouldTrigger = false)

        assertEquals(
            "Right now this metric is 10.00 kWh \u2014 would NOT fire.",
            previewValueText(s, preview, suffix = "kWh", locale = Locale.US),
        )
    }

    @Test
    fun formatPreviewNumberMatchesFmtNumberTwoDecimals() {
        assertEquals("1,234.50", formatPreviewNumber(1234.5, Locale.US))
        assertEquals("42.57", formatPreviewNumber(42.567, Locale.US))
        assertEquals("0.00", formatPreviewNumber(0.0, Locale.US))
        assertEquals("-5.00", formatPreviewNumber(-5.0, Locale.US))
    }

    // ── Metric-registry surface projection (web cache-then-network lifecycle) ───────────

    @Test
    fun projectLoadingShowsEditorWithLoadingLabel() {
        val display = projectMetrics(UiState.loading())

        assertEquals(MetricsSurface.Editor, display.surface)
        assertTrue(display.loadingMetrics)
        assertTrue(display.metrics.isEmpty())
        assertFalse(display.offline)
    }

    @Test
    fun projectContentShowsEditorWithMetrics() {
        val metrics = listOf(metric(id = "cost"))
        val display = projectMetrics(UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 100L))

        assertEquals(MetricsSurface.Editor, display.surface)
        assertFalse(display.loadingMetrics)
        assertEquals(metrics, display.metrics)
        assertFalse(display.offline)
    }

    @Test
    fun projectEmptyStillShowsEditor() {
        val display = projectMetrics(UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 100L))

        assertEquals(MetricsSurface.Editor, display.surface)
        assertFalse(display.loadingMetrics)
        assertTrue(display.metrics.isEmpty())
    }

    @Test
    fun projectHardErrorShowsErrorSurfaceWithRetry() {
        val display = projectMetrics(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))

        assertEquals(MetricsSurface.Error, display.surface)
        assertTrue(display.canRetry)
    }

    @Test
    fun projectOfflineKeepsEditorWithCachedMetricsAndChip() {
        val metrics = listOf(metric(id = "cost"))
        val display =
            projectMetrics(
                UiState(
                    phase = UiPhase.Content,
                    data = metrics,
                    fetchedAt = 100L,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            )

        assertEquals(MetricsSurface.Editor, display.surface)
        assertTrue(display.offline)
        assertTrue(display.canRetry)
        assertFalse(display.refreshing)
        assertEquals(metrics, display.metrics)
    }

    @Test
    fun projectRefreshingFlagsTheBackgroundReload() {
        val metrics = listOf(metric(id = "cost"))
        val display =
            projectMetrics(UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 100L, refreshing = true))

        assertTrue(display.refreshing)
        assertFalse(display.offline)
    }

    // ── Diagnostics (P1/S11 PII-safe view.opened) ───────────────────────────────────────

    @Test
    fun diagnosticsEmitSlugWithNoPayload() {
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        ComputedMetricEditorDiagnostics.recordViewOpened(recordingLogger(events))

        assertEquals(1, events.size)
        assertEquals("view.opened", events.single().first)
        assertEquals(mapOf("surface" to "ComputedMetricEditor"), events.single().second)
    }

    private companion object {
        fun value(
            metricId: String = "",
            metricWindow: String = "",
            metricOp: String = "",
            threshold: String = "",
            vehicleId: Long? = null,
        ): ComputedMetricEditorValue =
            ComputedMetricEditorValue(
                metricId = metricId,
                metricWindow = metricWindow,
                metricOp = metricOp,
                metricThreshold = threshold,
                vehicleId = vehicleId,
            )

        fun metric(
            id: String,
            label: String = "Label",
            unit: String = "count",
            windows: List<String> = listOf("30d"),
            ops: List<String> = listOf(">"),
        ): ComputedMetricSummary = ComputedMetricSummary(id = id, label = label, unit = unit, windows = windows, ops = ops)

        fun recordingLogger(sink: MutableList<Pair<String, Map<String, String>>>): Logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    sink += event to fields
                }
            }
    }
}
