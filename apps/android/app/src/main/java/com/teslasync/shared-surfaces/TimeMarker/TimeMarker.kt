// The native Jetpack Compose + Material 3 TimeMarker shared surface — a parity port of
// web/src/components/charts/TimeMarker.tsx. The web surface is a vertical reference line on a time-series
// chart marking the timestamp of an alert (or any point-in-time event): a page that opts into alert
// drill-through reads `useAlertContext()` (the `?vehicle_id=…&t=…&signal=…` query the alert links carry),
// converts the alert moment to the chart's x value, and drops a severity-colored marker there so the user
// lands on the exact moment that fired. It is purely presentational — the page owns the data; the marker
// only paints, rendering nothing when there is no moment to mark (web `if (x == null || x === '') return
// null`). So there is no loading / error / stale / offline data state to paint (it fetches nothing); its
// real, fully-reproduced states are the empty placement (no moment) and a marked moment at each severity.
//
// This port keeps that contract end to end. Vico 2.0 has no public vertical-line decoration, so the atomic
// chart layer renders point-in-time markers as a severity-colored pin rail aligned by x-fraction (see
// components/charts/SURVEY.md); this surface resolves the alert moment to an x-INDEX on that rail and
// delegates the actual pin to the atomic `ChartMarkerRail` / `timeMarker` builder — it never imports a
// chart library itself. Every derivation flows through the pure reducers in TimeMarkerModel.kt
// ([resolveAlertMarkerContext], [timeMarkerPlacement], [timeMarkerSeverity], [severityForContext],
// [markerLabel]); this composable owns only the localized-label resolution and the one-shot `view.opened`
// diagnostic (P1/S11). It performs NO HTTP.
//
// The marker's accessible label defaults to the i18n catalog's "Alert" (alerts.toast.title) so no English
// literal ships in native code (the web hardcodes the literal `'Alert'`; the web component itself has no
// `t()` call, so the catalog carries no TimeMarker-specific key to add). The recharts-only props
// (strokeWidth, strokeDasharray, yAxisId) have no pin-rail analogue and are intentionally omitted; the
// behavioural `ifOverflow` prop is reproduced by [TimeMarkerOverflow].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TimeMarker) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemarker

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartMarkerRail
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.timeMarker
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `TimeMarker`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), resolves the localized marker label, derives the placement from the drill-through
 * [context] over the chart's [axisEpochMillis] domain, and renders the severity-colored pin (or nothing,
 * when there is no moment to mark). Performs no HTTP; the owning page supplies the already-resolved alert
 * [context] (web `useAlertContext()`) and the chart's sample times, exactly as the web page computes the
 * marker's x value before handing it to `<TimeMarker>`.
 *
 * @param context the alert drill-through context (web `useAlertContext()`); its timestamp is the moment to mark.
 * @param axisEpochMillis the chart's x-axis sample times (ascending); the marker pins to the nearest index.
 * @param modifier optional layout modifier for the marker rail.
 * @param label overrides the accessible marker label; defaults to the localized "Alert".
 * @param severity overrides the marker severity (web `severity` prop, normalized via [timeMarkerSeverity]);
 *   when null it is derived from the [context] (web `alertCtx.signal ? 'critical' : undefined`).
 * @param overflow recharts `ifOverflow` behaviour when the moment falls outside the window; defaults to
 *   extend-domain (the web default).
 * @param onClick optional tap handler for the marker pin (e.g. open the alert).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TimeMarker(
    context: AlertMarkerContext,
    axisEpochMillis: List<Long>,
    modifier: Modifier = Modifier,
    label: String? = null,
    severity: String? = null,
    overflow: TimeMarkerOverflow = TimeMarkerOverflow.ExtendDomain,
    onClick: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TimeMarkerDiagnostics.recordViewOpened(logger) }

    val defaultLabel = stringResource(R.string.translation_alerts_toast_title)
    val resolvedLabel = markerLabel(label, defaultLabel)
    val resolvedSeverity =
        if (severity != null) timeMarkerSeverity(severity) else severityForContext(context)
    val placement =
        remember(context, axisEpochMillis, resolvedSeverity, overflow) {
            timeMarkerPlacement(context, axisEpochMillis, resolvedSeverity, overflow)
        }

    TimeMarkerContent(
        placement = placement,
        label = resolvedLabel,
        modifier = modifier,
        onClick = onClick,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Renders the resolved [placement] as a single
 * severity-colored pin on the atomic `ChartMarkerRail`, carrying the accessible [label] (web marker label).
 * An invisible placement renders nothing, faithfully reproducing the web `return null` when there is no
 * moment to mark.
 */
@Composable
fun TimeMarkerContent(
    placement: TimeMarkerPlacement,
    label: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val index = placement.index
    if (!placement.visible || index == null) return
    val marker =
        timeMarker(
            index = index,
            severity = placement.severity.toMarkerSeverity(),
            label = label,
        )
    ChartMarkerRail(
        markers = listOf(marker),
        pointCount = placement.pointCount,
        modifier = modifier,
        onMarkerClick = onClick?.let { callback -> { callback() } },
    )
}

/** Maps the surface severity onto the atomic chart layer's [MarkerSeverity] (which resolves the token tint). */
private fun TimeMarkerSeverity.toMarkerSeverity(): MarkerSeverity =
    when (this) {
        TimeMarkerSeverity.Info -> MarkerSeverity.Info
        TimeMarkerSeverity.Warn -> MarkerSeverity.Warn
        TimeMarkerSeverity.Critical -> MarkerSeverity.Critical
        TimeMarkerSeverity.Success -> MarkerSeverity.Success
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────
// The surface's real states: a marked moment at each severity (info / warn / critical / success) and the
// empty state (no alert moment → no marker). Each preview renders the stateless [TimeMarkerContent] over a
// fixed rail so the pin's position + tint are visible without a live chart.

@Preview(name = "Marker — warn (default)", showBackground = true)
@Composable
private fun TimeMarkerWarnPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMarkerPreviewRail(severity = TimeMarkerSeverity.Warn, visible = true)
    }
}

@Preview(name = "Marker — info", showBackground = true)
@Composable
private fun TimeMarkerInfoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMarkerPreviewRail(severity = TimeMarkerSeverity.Info, visible = true)
    }
}

@Preview(name = "Marker — critical (drill-through signal)", showBackground = true)
@Composable
private fun TimeMarkerCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMarkerPreviewRail(severity = TimeMarkerSeverity.Critical, visible = true)
    }
}

@Preview(name = "Marker — success", showBackground = true)
@Composable
private fun TimeMarkerSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMarkerPreviewRail(severity = TimeMarkerSeverity.Success, visible = true)
    }
}

@Preview(name = "Empty — no alert moment", showBackground = true)
@Composable
private fun TimeMarkerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMarkerPreviewRail(severity = TimeMarkerSeverity.Warn, visible = false)
    }
}

@Composable
private fun TimeMarkerPreviewRail(
    severity: TimeMarkerSeverity,
    visible: Boolean,
) {
    val pointCount = 12
    val placement =
        TimeMarkerPlacement(
            visible = visible,
            index = if (visible) 7 else null,
            pointCount = pointCount,
            severity = severity,
        )
    Box(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
        TimeMarkerContent(
            placement = placement,
            label = stringResource(R.string.translation_alerts_toast_title),
        )
    }
}
