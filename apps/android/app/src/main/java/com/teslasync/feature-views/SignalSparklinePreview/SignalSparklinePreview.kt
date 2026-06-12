// The native Jetpack Compose + Material 3 SignalSparklinePreview feature view — a parity port of
// web/src/features/telemetry/components/SignalSparklinePreview.tsx. The web component is a last-hour mini-trend
// for ONE signal, used as a category-tree leaf's right slot: it owns a single `useSignalHistory` query, renders
// the Sparkline for a numeric kind, a compact `(kind)` chip for a non-numeric kind, a pulsing skeleton while
// loading, and an em-dash when fewer than two samples arrived. This native port keeps that composition and
// surfaces every state the P3 contract mandates (loading / empty / content / non-numeric / error / stale /
// offline / disabled) by binding the shared Signals feed (P1/S8) through a [SignalSparklinePreviewViewModel]:
// a hard failure with no cached series shows a retry affordance, a cached series served after a failed refresh
// stays visible with an offline affordance, and a stale series auto-refreshes. Values are the raw SI the
// backend serves (Phase-42); the view performs no HTTP. Every visible string resolves through the P1/S10 i18n
// catalog and every affordance carries a TalkBack label.
//
// Parity note — the web component's only textual surfaces are the kind discriminator chip (`{valueKind}`) and
// two `title` tooltips ("Non-numeric signal (kind)" / "No samples in last hour"); neither is a `t()` key (the
// web source hard-codes them). The native port renders the kind discriminator verbatim (it is data — the
// signal's value-kind, like the untranslated signal name) and routes the empty-state / loading / retry / stale
// / offline copy through existing P1/S10 catalog keys, because this surface's allowed-files forbid adding
// resources and the generated strings.xml is machine-authored — exactly the constraint the sibling
// SignalCatalogPanel documents.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalSparklinePreview) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalsparklinepreview

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.SignalKind
import java.util.Locale

/** Web `width = 80` — the compact inline footprint of the leaf-right sparkline slot. */
private val SPARKLINE_WIDTH: Dp = 80.dp

/** Web `height = 18` — the compact inline footprint of the leaf-right sparkline slot. */
private val SPARKLINE_HEIGHT: Dp = 18.dp

/**
 * The already-localized strings the preview renders. The web source hard-codes its `title` tooltips; on
 * Android they arrive through the P1/S10 i18n facade (`stringResource`) at the Compose boundary and are passed
 * in, keeping the projection locale-stable and free of any English literal.
 */
data class SignalSparklineStrings(
    val loading: String,
    val retry: String,
    val stale: String,
    val offline: String,
    val noData: String,
)

/** Resolves the preview's localized strings from the P1/S10 catalog at the Compose boundary. */
@Composable
private fun signalSparklineStrings(): SignalSparklineStrings =
    SignalSparklineStrings(
        loading = stringResource(R.string.translation_common_loading),
        retry = stringResource(R.string.translation_common_retry),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        noData = stringResource(R.string.translation_signalGap_noData),
    )

/**
 * Stateful entry point. Binds the shared Signals feed via [source] into a [SignalSparklinePreviewViewModel],
 * records the one-shot `view.opened` diagnostic, collects the projected [SignalSparklinePreviewState], and
 * renders. A parent (e.g. a signal category tree) supplies the [source] (an adapter over the shared S7/S8
 * Signals layer), the [vehicleId] + [signal] + [valueKind], and flips [enabled] on per-leaf as a category
 * expands. When [enabled] is `false` the preview renders nothing and opens no feed (web `if (!enabled) return
 * null` — the parent owns visibility), so a collapsed tree fires no requests and emits no diagnostics.
 *
 * @param source the cache-then-network Signals seam (`SignalsRepository`/`SignalsStore` adapter).
 * @param vehicleId the signal's vehicle (web `vehicleId` prop).
 * @param signal the canonical proto field name (web `signal` prop).
 * @param valueKind the signal's typed kind (web `valueKind` prop); a non-numeric kind renders the kind chip.
 * @param enabled the parent's per-leaf gate (web `enabled` prop).
 * @param color the sparkline stroke/fill color (web `color`, default teal accent → the brand palette head).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalSparklinePreview(
    source: SignalSparklinePreviewSource,
    vehicleId: Long,
    signal: String,
    valueKind: SignalKind,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    color: Color = paletteColor(0),
    width: Dp = SPARKLINE_WIDTH,
    height: Dp = SPARKLINE_HEIGHT,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = "$SIGNAL_SPARKLINE_PREVIEW_SLUG:$vehicleId:$signal",
) {
    // Web parity: a disabled leaf renders nothing and never opens the feed (the parent owns visibility), so a
    // collapsed category tree fires no requests and emits no `view.opened` diagnostic.
    if (!enabled) return

    val args = SignalSparklinePreviewArgs(vehicleId = vehicleId, signal = signal, valueKind = valueKind, enabled = enabled)
    val viewModel: SignalSparklinePreviewViewModel =
        viewModel(
            key = instanceKey,
            factory =
                viewModelFactory {
                    initializer { SignalSparklinePreviewViewModel(source, args, logger) }
                },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SignalSparklinePreviewContent(
        state = state,
        strings = signalSparklineStrings(),
        onRetry = viewModel::refresh,
        modifier = modifier,
        color = color,
        width = width,
        height = height,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Picks the same branch the web
 * ternary does (kind chip / skeleton / em-dash / sparkline), extended with the P3-mandated error / stale /
 * offline affordances. A stale (non-error) series auto-refreshes immediately (guarded against a fetch storm),
 * so the "stale" promise holds without a manual tap. [onRetry] backs the stale auto-refresh and the error
 * retry affordance.
 */
@Composable
fun SignalSparklinePreviewContent(
    state: SignalSparklinePreviewState,
    strings: SignalSparklineStrings,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = paletteColor(0),
    width: Dp = SPARKLINE_WIDTH,
    height: Dp = SPARKLINE_HEIGHT,
) {
    LaunchedEffect(state.mode, state.freshness, state.isFetching) {
        if (state.mode == SignalSparklineMode.Content && state.freshness == SparklineFreshness.Stale && !state.isFetching) {
            onRetry()
        }
    }
    when (state.mode) {
        SignalSparklineMode.Disabled -> Unit
        SignalSparklineMode.NonNumeric -> NonNumericChip(state.valueKind, modifier)
        SignalSparklineMode.Loading -> SparklineLoading(strings.loading, width, height, modifier)
        SignalSparklineMode.Error -> SparklineError(strings.retry, onRetry, modifier)
        SignalSparklineMode.Empty -> SparklineEmpty(strings.noData, modifier)
        SignalSparklineMode.Content -> SparklineTrend(state, strings, color, width, height, modifier)
    }
}

/**
 * Web non-numeric branch: a compact chip showing the value-kind discriminator (web `{valueKind}`). The
 * discriminator is data — the signal's type, like its untranslated name — so it renders verbatim and doubles
 * as the chip's accessible label.
 */
@Composable
private fun NonNumericChip(
    valueKind: SignalKind,
    modifier: Modifier,
) {
    Badge(text = valueKind.name.lowercase(Locale.ROOT), modifier = modifier, variant = BadgeVariant.Neutral)
}

/** Web loading branch: a pulsing skeleton sized to the sparkline footprint, labelled for TalkBack. */
@Composable
private fun SparklineLoading(
    loadingLabel: String,
    width: Dp,
    height: Dp,
    modifier: Modifier,
) {
    Box(modifier = modifier.size(width = width, height = height).semantics { contentDescription = loadingLabel }) {
        Skeleton(height = height, rounded = true)
    }
}

/**
 * P3 error branch (no cached series): a compact, tappable affordance that re-runs the fetch. Labelled and
 * exposed as a clickable node so TalkBack announces it and the retry is reachable.
 */
@Composable
private fun SparklineError(
    retryLabel: String,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Icon(
        imageVector = TeslaGlyphs.Warning,
        contentDescription = retryLabel,
        size = IconSize.Sm,
        tint = TeslaTokens.status.danger,
        modifier = modifier.clickable(onClick = onRetry).padding(Spacing.xs),
    )
}

/** Web empty branch: the em-dash glyph, with the localized "no data" meaning as its accessible label. */
@Composable
private fun SparklineEmpty(
    noDataLabel: String,
    modifier: Modifier,
) {
    Caption(text = EM_DASH, modifier = modifier.clearAndSetSemantics { contentDescription = noDataLabel })
}

/**
 * Web content branch: the Sparkline, labelled with the signal name for TalkBack. When the cached series is
 * stale or offline (served after a failed refresh — ADR-013) a compact freshness affordance trails it so the
 * staleness is never silent, while the last-known line still draws (web parity: TanStack keeps `data`).
 */
@Composable
private fun SparklineTrend(
    state: SignalSparklinePreviewState,
    strings: SignalSparklineStrings,
    color: Color,
    width: Dp,
    height: Dp,
    modifier: Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Sparkline(
            data = state.series,
            modifier = Modifier.semantics { contentDescription = state.signal },
            color = color,
            width = width,
            height = height,
        )
        when (state.freshness) {
            SparklineFreshness.Offline -> FreshnessIcon(DataDisplayGlyphs.WifiOff, strings.offline, TeslaTokens.status.danger)
            SparklineFreshness.Stale -> FreshnessIcon(DataDisplayGlyphs.AlertTriangle, strings.stale, TeslaTokens.status.warning)
            SparklineFreshness.Fresh -> Unit
        }
    }
}

/** A tiny trailing freshness affordance (stale / offline) carrying its localized state as a TalkBack label. */
@Composable
private fun FreshnessIcon(
    glyph: ImageVector,
    label: String,
    tint: Color,
) {
    Icon(imageVector = glyph, contentDescription = label, size = IconSize.Xs, tint = tint)
}

// ── Previews ────────────────────────────────────────────────────────────────────────────────────────────

private val PREVIEW_STRINGS =
    SignalSparklineStrings(
        loading = "Loading\u2026",
        retry = "Retry",
        stale = "Stale",
        offline = "Offline",
        noData = "No signal data available",
    )

private fun previewState(
    mode: SignalSparklineMode,
    valueKind: SignalKind = SignalKind.Float,
    series: List<Double> = emptyList(),
    freshness: SparklineFreshness = SparklineFreshness.Fresh,
): SignalSparklinePreviewState =
    SignalSparklinePreviewState(
        mode = mode,
        valueKind = valueKind,
        signal = "VehicleSpeed",
        series = series,
        freshness = freshness,
        isFetching = false,
        updatedAtMillis = if (mode == SignalSparklineMode.Content) 1L else null,
        errorKind = null,
    )

private val PREVIEW_SERIES = listOf(12.0, 18.0, 16.0, 22.0, 19.0, 24.0, 28.0, 25.0)

@Preview(name = "Content", showBackground = true)
@Composable
private fun SignalSparklinePreviewContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(
            previewState(SignalSparklineMode.Content, series = PREVIEW_SERIES),
            PREVIEW_STRINGS,
            onRetry = {},
        )
    }
}

@Preview(name = "Stale", showBackground = true)
@Composable
private fun SignalSparklinePreviewStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(
            previewState(SignalSparklineMode.Content, series = PREVIEW_SERIES, freshness = SparklineFreshness.Stale),
            PREVIEW_STRINGS,
            onRetry = {},
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun SignalSparklinePreviewOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(
            previewState(SignalSparklineMode.Content, series = PREVIEW_SERIES, freshness = SparklineFreshness.Offline),
            PREVIEW_STRINGS,
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SignalSparklinePreviewLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(previewState(SignalSparklineMode.Loading), PREVIEW_STRINGS, onRetry = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SignalSparklinePreviewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(previewState(SignalSparklineMode.Empty), PREVIEW_STRINGS, onRetry = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalSparklinePreviewErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(previewState(SignalSparklineMode.Error), PREVIEW_STRINGS, onRetry = {})
    }
}

@Preview(name = "Non-numeric", showBackground = true)
@Composable
private fun SignalSparklinePreviewNonNumericPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSparklinePreviewContent(
            previewState(SignalSparklineMode.NonNumeric, valueKind = SignalKind.String),
            PREVIEW_STRINGS,
            onRetry = {},
        )
    }
}
