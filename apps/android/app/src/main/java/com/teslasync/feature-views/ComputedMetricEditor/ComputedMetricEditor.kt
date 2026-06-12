// The native Jetpack Compose + Material 3 ComputedMetricEditor feature view — a parity port of
// web/src/features/notifications/components/ComputedMetricEditor.tsx. The web component lays out (web
// `space-y-4`) a responsive grid of three dropdowns (metric / window / operator), a numeric threshold input,
// and a live-preview `GlassPanel` that reports the metric's current value and whether the rule would fire.
//
// Composition: `ComputedMetricEditor` is the stateful entry — it binds the shared Notifications feed via the
// [ComputedMetricEditorSource] into a [ComputedMetricEditorViewModel], records the one-shot `view.opened`
// diagnostic (P1/S11) on first composition, threads the controlled value back to the host through
// [onValueChange] (the web `onChange` prop), and collects the metric-registry [UiState] + editor value +
// preview state. `ComputedMetricEditorContent` is the stateless renderer that owns no data and is the
// unit/UI-test + `@Preview` entry point. The pure derivations live in ComputedMetricEditorModel.kt so this
// file stays a thin render layer.
//
// Every rendered state is reproduced: the metric Select carries the web "Loading metrics…" label while the
// registry loads, the web "Choose a metric" empty label when it resolves empty, a stale/offline chip with
// retry over cached metrics, and a `QueryError` with retry for a hard registry failure (the cache-then-network
// contract the web parent owns). The live preview reproduces the web idle / computing / error / value branches.
// Every chrome string resolves through the i18n facade (see [rememberComputedMetricEditorStrings]); the
// catalog-absent `previewIdle` / `previewValue` keys render their web default, exactly as the web does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ComputedMetricEditor) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.computedmetriceditor

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import java.util.Locale

/**
 * Stateful entry point — the faithful port of the web `ComputedMetricEditor({ value, onChange, metrics, loading })`.
 * It binds the shared metric-registry feed + preview mutation via [source] into a [ComputedMetricEditorViewModel],
 * records the one-shot `view.opened` diagnostic on first composition, threads the controlled value to the host
 * through [onValueChange] (the web `onChange`), and renders.
 *
 * @param source the cache-then-network Notifications seam (`NotificationsStore`/`NotificationsRepository` adapter).
 * @param vehicleId scopes the preview to one vehicle (web `vehicle_id`), or null for the whole fleet.
 * @param onValueChange observes the controlled editor value (the web `onChange` prop); defaults to a no-op.
 * @param locale the locale used to format the preview value (web `fmtNumber` browser locale).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey the ViewModel key; defaults to the surface slug so two placements never share a holder.
 */
@Composable
fun ComputedMetricEditor(
    source: ComputedMetricEditorSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    onValueChange: (ComputedMetricEditorValue) -> Unit = {},
    locale: Locale = Locale.getDefault(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = COMPUTED_METRIC_EDITOR_SLUG,
) {
    val viewModel: ComputedMetricEditorViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ComputedMetricEditorViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val metricsState by viewModel.metricsState.collectAsStateWithLifecycle()
    val value by viewModel.value.collectAsStateWithLifecycle()
    val previewState by viewModel.previewState.collectAsStateWithLifecycle()
    LaunchedEffect(value) { onValueChange(value) }

    ComputedMetricEditorContent(
        metricsState = metricsState,
        value = value,
        previewState = previewState,
        strings = rememberComputedMetricEditorStrings(),
        onSelectMetric = viewModel::selectMetric,
        onSelectWindow = viewModel::selectWindow,
        onSelectOperator = viewModel::selectOperator,
        onThresholdChange = viewModel::setThreshold,
        onRetry = viewModel::refreshMetrics,
        modifier = modifier,
        locale = locale,
    )
}

/**
 * Stateless renderer — the unit/UI-test and `@Preview` entry point. Lays out the web `space-y-4` column: the
 * three operand selectors (or a [QueryError] when the registry hard-failed), the threshold field, and the live
 * preview panel, with a stale/offline freshness chip on top. [locale] formats the preview value.
 */
@Composable
fun ComputedMetricEditorContent(
    metricsState: UiState<List<ComputedMetricSummary>>,
    value: ComputedMetricEditorValue,
    previewState: PreviewUiState,
    strings: ComputedMetricEditorStrings,
    onSelectMetric: (String) -> Unit,
    onSelectWindow: (String) -> Unit,
    onSelectOperator: (String) -> Unit,
    onThresholdChange: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    val context = LocalContext.current
    val lookup = remember(context) { { name: String -> context.optionalString(name) } }
    val display = remember(metricsState) { projectMetrics(metricsState) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ComputedMetricFreshness(display = display, strings = strings, onRetry = onRetry)
        when (display.surface) {
            MetricsSurface.Error ->
                QueryError(
                    kind = queryErrorKindFor(metricsState),
                    onRetry = onRetry,
                )
            MetricsSurface.Editor ->
                MetricSelectors(
                    display = display,
                    value = value,
                    strings = strings,
                    lookup = lookup,
                    onSelectMetric = onSelectMetric,
                    onSelectWindow = onSelectWindow,
                    onSelectOperator = onSelectOperator,
                )
        }
        ThresholdField(value = value, strings = strings, onThresholdChange = onThresholdChange)
        PreviewPanel(previewState = previewState, value = value, metrics = display.metrics, strings = strings, locale = locale)
    }
}

/**
 * An honest-freshness chip over cached metrics (ADR-013): an amber offline row (with a Retry affordance when a
 * failed refresh left the registry stale) when last-known metrics are shown. Nothing renders when the metrics
 * are fresh — the web has no chip because React Query refetches silently, but the native contract never paints
 * stale data as live.
 */
@Composable
private fun ComputedMetricFreshness(
    display: MetricsDisplay,
    strings: ComputedMetricEditorStrings,
    onRetry: () -> Unit,
) {
    if (!display.offline) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(
            text = strings.offline,
            modifier = Modifier.weight(1f),
            color = TeslaTokens.status.warning,
        )
        if (display.canRetry) {
            Button(
                label = strings.retry,
                onClick = onRetry,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The three operand selectors stacked for mobile (web `grid-cols-1 sm:grid-cols-3`). The metric Select shows
 * the "Loading metrics…" label while the registry loads and the "Choose a metric" label when it is empty; the
 * window + operator Selects are disabled until a metric is chosen (web `disabled={!selected}`). Each carries
 * its localized field label as both the visible label and the accessible name.
 */
@Composable
private fun MetricSelectors(
    display: MetricsDisplay,
    value: ComputedMetricEditorValue,
    strings: ComputedMetricEditorStrings,
    lookup: (String) -> String?,
    onSelectMetric: (String) -> Unit,
    onSelectWindow: (String) -> Unit,
    onSelectOperator: (String) -> Unit,
) {
    val hasMetric = display.metrics.any { it.id == value.metricId }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Select(
            options = display.metrics.map { SelectOption(it.id, metricOptionLabel(lookup, it)) },
            selectedValue = value.metricId.ifBlank { null },
            onSelect = onSelectMetric,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.metricLabel },
            label = strings.metricLabel,
            emptyLabel = if (display.loadingMetrics) strings.loadingMetrics else strings.metricEmptyLabel,
            enabled = !display.loadingMetrics,
        )
        Select(
            options = windowsFor(display.metrics, value.metricId).map { SelectOption(it, windowOptionLabel(lookup, it)) },
            selectedValue = value.metricWindow.ifBlank { null },
            onSelect = onSelectWindow,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.windowLabel },
            label = strings.windowLabel,
            emptyLabel = strings.windowEmptyLabel,
            enabled = hasMetric,
        )
        Select(
            options = operatorsFor(display.metrics, value.metricId).map { SelectOption(it, operatorOptionLabel(lookup, it)) },
            selectedValue = value.metricOp.ifBlank { null },
            onSelect = onSelectOperator,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.operatorLabel },
            label = strings.operatorLabel,
            enabled = hasMetric,
        )
    }
}

/** The numeric threshold field (web `Input type="number" step="any"`); kept as raw text for input parity. */
@Composable
private fun ThresholdField(
    value: ComputedMetricEditorValue,
    strings: ComputedMetricEditorStrings,
    onThresholdChange: (String) -> Unit,
) {
    Input(
        value = value.metricThreshold,
        onValueChange = onThresholdChange,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.thresholdLabel },
        label = strings.thresholdLabel,
        hint = strings.thresholdHint,
        keyboardType = KeyboardType.Decimal,
        singleLine = true,
    )
}

/**
 * The live-preview panel (web `GlassPanel p-3`): the "Live preview" caption above one of the four mutually
 * exclusive branches — the idle hint, the computing hint, the failure copy, or the resolved value sentence.
 */
@Composable
private fun PreviewPanel(
    previewState: PreviewUiState,
    value: ComputedMetricEditorValue,
    metrics: List<ComputedMetricSummary>,
    strings: ComputedMetricEditorStrings,
    locale: Locale,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Caption(text = strings.previewTitle)
        Spacer(Modifier.height(Spacing.xs))
        when (previewState) {
            PreviewUiState.Idle ->
                BodyText(text = strings.previewIdle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            PreviewUiState.Computing ->
                BodyText(text = strings.previewComputing, color = MaterialTheme.colorScheme.onSurfaceVariant)
            PreviewUiState.Failure ->
                BodyText(text = strings.previewError, color = TeslaTokens.status.danger)
            is PreviewUiState.Value ->
                BodyText(
                    text =
                        previewValueText(
                            strings = strings,
                            preview = previewState.preview,
                            suffix = suffixFor(metrics, value.metricId),
                            locale = locale,
                        ),
                )
        }
    }
}

/**
 * Resolves the localized [ComputedMetricEditorStrings] from the i18n facade (P1/S10). Every chrome key resolves
 * by name through the generated catalog (web `t(key)`), falling back to the web's English default for the
 * `previewIdle` / `previewValue` keys the catalog does not define — see the model header. Remembered against
 * the context so a locale change re-projects the surface.
 */
@Composable
private fun rememberComputedMetricEditorStrings(): ComputedMetricEditorStrings {
    val context = LocalContext.current
    return remember(context) {
        buildComputedMetricEditorStrings { name -> context.optionalString(name) }
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam that reproduces web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts), so the by-name
 * lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/** Folds the metric-registry failure onto a [QueryErrorKind] (network/timeout → offline, circuit-open → waiting). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content / loading / empty / error / offline) ─────────────────────────

private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewMetrics(): List<ComputedMetricSummary> =
    listOf(
        ComputedMetricSummary(
            id = "charge_cost_30d",
            label = "Charging cost (30d)",
            unit = "currency",
            windows = listOf("7d", "30d"),
            ops = listOf(">", ">=", "<"),
        ),
        ComputedMetricSummary(
            id = "efficiency_7d",
            label = "Efficiency (7d)",
            unit = "wh_per_mi",
            windows = listOf("7d"),
            ops = listOf(">", "<"),
        ),
    )

private fun previewStrings(): ComputedMetricEditorStrings = buildComputedMetricEditorStrings { null }

private fun previewSelectedValue(): ComputedMetricEditorValue =
    ComputedMetricEditorValue(metricId = "charge_cost_30d", metricWindow = "30d", metricOp = ">", metricThreshold = "200")

@Composable
private fun EditorStatePreview(
    state: UiState<List<ComputedMetricSummary>>,
    value: ComputedMetricEditorValue,
    previewState: PreviewUiState,
) {
    TeslaSyncTheme(dynamicColor = false) {
        ComputedMetricEditorContent(
            metricsState = state,
            value = value,
            previewState = previewState,
            strings = previewStrings(),
            onSelectMetric = {},
            onSelectWindow = {},
            onSelectOperator = {},
            onThresholdChange = {},
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "ComputedMetricEditor · value", showBackground = true)
@Composable
private fun ComputedMetricEditorValuePreview() {
    val preview = ComputedMetricPreview(value = 214.3, threshold = 200.0, wouldTrigger = true)
    EditorStatePreview(
        state = UiState(phase = UiPhase.Content, data = previewMetrics(), fetchedAt = PREVIEW_NOW),
        value = previewSelectedValue(),
        previewState = PreviewUiState.Value(preview),
    )
}

@Preview(name = "ComputedMetricEditor · idle", showBackground = true)
@Composable
private fun ComputedMetricEditorIdlePreview() {
    EditorStatePreview(
        state = UiState(phase = UiPhase.Content, data = previewMetrics(), fetchedAt = PREVIEW_NOW),
        value = ComputedMetricEditorValue(),
        previewState = PreviewUiState.Idle,
    )
}

@Preview(name = "ComputedMetricEditor · loading", showBackground = true)
@Composable
private fun ComputedMetricEditorLoadingPreview() {
    EditorStatePreview(
        state = UiState.loading(),
        value = ComputedMetricEditorValue(),
        previewState = PreviewUiState.Idle,
    )
}

@Preview(name = "ComputedMetricEditor · empty", showBackground = true)
@Composable
private fun ComputedMetricEditorEmptyPreview() {
    EditorStatePreview(
        state = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_NOW),
        value = ComputedMetricEditorValue(),
        previewState = PreviewUiState.Idle,
    )
}

@Preview(name = "ComputedMetricEditor · error", showBackground = true)
@Composable
private fun ComputedMetricEditorErrorPreview() {
    EditorStatePreview(
        state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
        value = ComputedMetricEditorValue(),
        previewState = PreviewUiState.Idle,
    )
}

@Preview(name = "ComputedMetricEditor · offline", showBackground = true)
@Composable
private fun ComputedMetricEditorOfflinePreview() {
    EditorStatePreview(
        state =
            UiState(
                phase = UiPhase.Content,
                data = previewMetrics(),
                fetchedAt = PREVIEW_NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        value = previewSelectedValue(),
        previewState = PreviewUiState.Computing,
    )
}
