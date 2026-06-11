// The native Jetpack Compose + Material 3 Regen Braking dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx. It mirrors the web `WidgetShell` (a
// skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the freshness header
// — title + regen icon for the standard footprint, header-less chrome for the compact 1-column
// footprint) wrapping the web `WidgetGaugeHero`: a radial gauge of the recovery percentage (colored by
// the `regenColor` band) with the `${pct}%` label beneath it and, when the footprint is wider than one
// column, the three stat tiles (Total Recovered / Monthly Avg / Free Charges). When no regen card
// resolves it shows the friendly "No regen data" empty state. All data flows through the shared
// [RegenEfficiencyWidgetViewModel] (P1/S8); SI energy + power are formatted at this render boundary via
// the live [UnitFormatter] (web `useUnits`). The view never performs HTTP. Every string resolves
// through the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RegenEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.regenefficiency

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

private val GAUGE_SIZE_STANDARD = 100.dp
private val GAUGE_SIZE_COMPACT = 70.dp
private val SKELETON_HEADER_HEIGHT = 14.dp
private val SKELETON_GAUGE_HEIGHT = 96.dp
private val HERO_MIN_HEIGHT = 44.dp
private const val SKELETON_HEADER_WIDTH_FRACTION = 0.5f

/**
 * Stateful entry point. Collects the shared [RegenEfficiencyWidgetViewModel] state + the live unit
 * formatter, records the one-shot `view.opened` diagnostic, and renders the surface for the given
 * [size]. A dashboard host supplies the view-model (wired via [RegenEfficiencyWidgetViewModel.create]);
 * [units] defaults to the app's `LocalDataContainer` live formatter (web `useUnits`).
 */
@Composable
fun RegenEfficiencyWidget(
    viewModel: RegenEfficiencyWidgetViewModel,
    modifier: Modifier = Modifier,
    size: RegenEfficiencySize = RegenEfficiencyRegistration.defaultSize,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    RegenEfficiencyWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the header over
 * the gauge hero, or the "No regen data" empty state. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [prefs] supplies the SI energy + power formatting; [locale] drives the
 * free-charges grouping (tests pin a deterministic locale).
 */
@Composable
fun RegenEfficiencyWidgetContent(
    state: UiState<RegenEfficiencySnapshot?>,
    prefs: UnitPref,
    size: RegenEfficiencySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> RegenEfficiencyLoading()
            state.isError -> RegenEfficiencyError(state = state, onRetry = onRefresh)
            else -> RegenEfficiencyLoaded(state = state, prefs = prefs, size = size, onRefresh = onRefresh, locale = locale)
        }
    }
}

@Composable
private fun RegenEfficiencyLoaded(
    state: UiState<RegenEfficiencySnapshot?>,
    prefs: UnitPref,
    size: RegenEfficiencySize,
    onRefresh: () -> Unit,
    locale: Locale,
) {
    RegenEfficiencyHeader(state = state, size = size, onRefresh = onRefresh)
    val labels = rememberRegenEfficiencyLabels()
    val snapshot = state.data
    if (snapshot != null) {
        val display =
            remember(snapshot, size, prefs, labels, locale) {
                RegenEfficiencyProjection.project(snapshot, size, labels, prefs, locale)
            }
        RegenEfficiencyHero(display = display)
    } else {
        RegenEfficiencyEmpty()
    }
}

@Composable
private fun RegenEfficiencyHeader(
    state: UiState<*>,
    size: RegenEfficiencySize,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!size.isCompact) {
            Icon(
                imageVector = FeedbackGlyphs.Refresh,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(
                stringResource(R.string.translation_widget_regenEfficiency_title),
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
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
private fun RegenEfficiencyHero(display: RegenEfficiencyDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = HERO_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = display.gaugeValue,
            max = RegenEfficiencyProjection.GAUGE_MAX,
            label = display.gaugeLabel,
            unit = display.gaugeUnit,
            color = bandColor(display.band),
            size = if (display.isCompact) GAUGE_SIZE_COMPACT else GAUGE_SIZE_STANDARD,
        )
        if (!display.isCompact && display.stats.isNotEmpty()) {
            RegenStatRow(items = display.stats)
        }
    }
}

@Composable
private fun RegenStatRow(items: List<RegenStatItem>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Top,
    ) {
        items.forEach { item ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                MetricLabel(item.label)
                Heading(item.value, level = HeadingLevel.Sub)
            }
        }
    }
}

@Composable
private fun RegenEfficiencyEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_regenEfficiency_noData),
        icon = FeedbackGlyphs.Refresh,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RegenEfficiencyLoading() {
    val label = stringResource(R.string.translation_widget_regenEfficiency_title)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_HEADER_WIDTH_FRACTION, height = SKELETON_HEADER_HEIGHT)
        Skeleton(height = SKELETON_GAUGE_HEIGHT, rounded = true)
    }
}

@Composable
private fun RegenEfficiencyError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
    }
}

/**
 * Builds the localized [RegenEfficiencyLabels] from the i18n catalog (P1/S10) — the four
 * `widget.regenEfficiency.*` value/label keys the web component reads via `t('widget.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberRegenEfficiencyLabels(): RegenEfficiencyLabels {
    val totalRecovered = stringResource(R.string.translation_widget_regenEfficiency_totalKwh)
    val monthlyAvg = stringResource(R.string.translation_widget_regenEfficiency_monthlyAvg)
    val freeCharges = stringResource(R.string.translation_widget_regenEfficiency_freeCharges)
    val recovery = stringResource(R.string.translation_widget_regenEfficiency_recovery)
    return remember(totalRecovered, monthlyAvg, freeCharges, recovery) {
        RegenEfficiencyLabels(
            totalRecovered = totalRecovered,
            monthlyAvg = monthlyAvg,
            freeCharges = freeCharges,
            recovery = recovery,
        )
    }
}

/** Maps a [RegenBand] onto its semantic color (web `regenColor`: high → success, medium → warning, low → danger). */
@Composable
private fun bandColor(band: RegenBand): Color =
    when (band) {
        RegenBand.High -> TeslaTokens.status.success
        RegenBand.Medium -> TeslaTokens.status.warning
        RegenBand.Low -> TeslaTokens.status.danger
    }

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }
