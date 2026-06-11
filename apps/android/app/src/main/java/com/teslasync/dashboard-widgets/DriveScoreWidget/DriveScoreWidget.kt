// The native Jetpack Compose + Material 3 Drive Score dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DriveScoreWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `WidgetGaugeHero`: a radial score gauge (0–100, colour-banded by score) with — when the widget is not
// compact — an efficiency stat (Wh/km or Wh/mi) beneath it, and a friendly empty state when no analytics
// are available. All data flows through the shared [DriveScoreWidgetViewModel]; the SI Wh/km efficiency
// is score-derived + unit-converted at this render boundary via the live [DriveScoreDisplayPrefs]. The
// view never performs HTTP. Every string resolves through the i18n catalog and every interactive element
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveScoreWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescore

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val STANDARD_GAUGE_SIZE = 100.dp
private val COMPACT_GAUGE_SIZE = 70.dp
private val HERO_MIN_HEIGHT = 88.dp
private val LOADING_TITLE_HEIGHT = 12.dp
private const val LOADING_TITLE_FRACTION = 0.35f

// Score-band gauge colours — the exact web hex the `RadialGauge` arc receives
// (`score > 75 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444'`). These are data-driven chart colours
// (the direct analogue of CHART_COLORS), computed from the score, not static theme styling.
private val GOOD_COLOR = Color(0xFF10B981)
private val FAIR_COLOR = Color(0xFFF59E0B)
private val POOR_COLOR = Color(0xFFEF4444)

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [DriveScoreWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer) and a unique [instanceKey] per
 * placement.
 *
 * @param source the cache-then-network seam (fleet-analytics + settings adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveScoreWidget(
    source: DriveScoreSource,
    modifier: Modifier = Modifier,
    size: DriveScoreSize = DriveScoreRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DriveScoreRegistration.ID,
) {
    val viewModel: DriveScoreWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { DriveScoreWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    DriveScoreWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header above the gauge hero / empty state. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [prefs] supplies the SI→display conversion; [locale] drives number grouping
 * (tests pin a deterministic locale).
 */
@Composable
fun DriveScoreWidgetContent(
    state: UiState<JsonElement>,
    prefs: DriveScoreDisplayPrefs,
    size: DriveScoreSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberDriveScoreStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                DriveScoreLoading(compact = size.isCompact, label = stringResource(R.string.translation_common_loading))
            state.isError -> DriveScoreError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        DriveScoreProjection.project(parseDriveScore(state.data), prefs, strings, locale)
                    }
                DriveScoreReady(state = state, display = display, size = size, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun DriveScoreReady(
    state: UiState<JsonElement>,
    display: DriveScoreDisplay,
    size: DriveScoreSize,
    onRefresh: () -> Unit,
) {
    DriveScoreHeader(state = state, onRefresh = onRefresh)
    if (display.hasData) {
        DriveScoreHero(display = display, compact = size.isCompact)
    } else {
        DriveScoreEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun DriveScoreHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun DriveScoreHero(
    display: DriveScoreDisplay,
    compact: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = HERO_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
    ) {
        RadialGauge(
            value = display.gaugeValue,
            max = display.gaugeMax,
            label = display.scoreLabel,
            unit = "",
            color = gaugeColor(display.scoreBand),
            size = if (compact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE,
        )
        if (!compact) {
            DriveScoreEfficiencyStat(display = display)
        }
    }
}

@Composable
private fun DriveScoreEfficiencyStat(display: DriveScoreDisplay) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Caption(display.efficiencyLabel)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(text = display.efficiencyValue, maxLines = 1)
            Caption(display.efficiencyUnit)
        }
    }
}

@Composable
private fun DriveScoreEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DriveScoreLoading(
    compact: Boolean,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(
            widthFraction = 1f,
            height = if (compact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE,
            rounded = true,
        )
        if (!compact) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        }
    }
}

@Composable
private fun DriveScoreError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps a [ScoreBand] to its web gauge-arc hex colour. */
private fun gaugeColor(band: ScoreBand): Color =
    when (band) {
        ScoreBand.Good -> GOOD_COLOR
        ScoreBand.Fair -> FAIR_COLOR
        ScoreBand.Poor -> POOR_COLOR
    }

/**
 * Builds the localized [DriveScoreStrings] from the i18n catalog (P1/S10) — the three `widget.*` keys
 * the web component reads via `t('widget.score' | 'widget.efficiency' | 'widget.noScore')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberDriveScoreStrings(): DriveScoreStrings {
    val score = stringResource(R.string.translation_widget_score)
    val efficiency = stringResource(R.string.translation_widget_efficiency)
    val noData = stringResource(R.string.translation_widget_noScore)
    return remember(score, efficiency, noData) {
        DriveScoreStrings(score = score, efficiency = efficiency, noData = noData)
    }
}
