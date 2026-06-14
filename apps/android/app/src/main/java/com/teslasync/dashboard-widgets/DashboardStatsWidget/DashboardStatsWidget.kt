// The native Jetpack Compose + Material 3 Dashboard Stats surface — a parity port of
// web/src/features/dashboard/widgets/DashboardStatsWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, otherwise a header with an icon + uppercase title + a freshness chip)
// wrapping one of the three bodies the web renders by footprint: the compact big trip count + "active"
// (cols<=1), the standard four-tile stat grid + the "Current State" status badge, and the wide layout (the
// standard layout plus the up-to-five "Recent Transitions"); a friendly empty state shows when the fleet
// summary is missing. All data flows through the shared [DashboardStatsWidgetViewModel] (P1/S8); the view
// never performs HTTP. There is no hard-error surface — a failed query only tints the freshness chip — exactly
// as the web shell behaves (it passes `isError` but no `error` string). Every string resolves through the i18n
// catalog (P1/S10) and every interactive element + folded row carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DashboardStatsWidget) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, glyph set, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.dashboardstats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.android.widgetprimitives.widgetstatgrid.StatGridItem
import io.teslasync.android.widgetprimitives.widgetstatgrid.WidgetStatGridContent
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Test tag on the surface root (present in every state) so on-device UI tests can locate the widget. */
const val DASHBOARD_STATS_TEST_TAG: String = "dashboard-stats"

private val ROW_MIN_HEIGHT = 44.dp
private val LOADING_TITLE_HEIGHT = 12.dp
private const val LOADING_TITLE_FRACTION = 0.45f
private val LOADING_BODY_HEIGHT = 96.dp
private val LOADING_LINE_HEIGHT = 14.dp
private const val LOADING_LINE_FRACTION = 0.8f

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [DashboardStatsWidgetViewModel], records the
 * one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host supplies
 * [source] (an adapter over the shared P1/S8 data layer), an optional [vehicleId] (web `WidgetProps.vehicleId`;
 * `null`/non-positive uses the first enrolled vehicle), and a unique [instanceKey] per placement.
 */
@Composable
fun DashboardStatsWidget(
    source: DashboardStatsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: DashboardStatsSize = DashboardStatsRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DashboardStatsRegistration.ID,
) {
    val viewModel: DashboardStatsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = DashboardStatsWidgetViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DashboardStatsWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `WidgetShell`
 * loading skeleton, then the compact / standard / wide body (or the empty state), with a freshness chip that
 * reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the web freshness
 * contract. [nowMillis] + [locale] drive the relative ages + number grouping.
 */
@Composable
fun DashboardStatsWidgetContent(
    state: UiState<DashboardStatsSnapshot>,
    size: DashboardStatsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberDashboardStatsStrings()
    val formatAge = rememberFreshnessFormatter()

    GlassPanel(modifier = modifier.testTag(DASHBOARD_STATS_TEST_TAG), padding = PanelPadding.Md) {
        if (state.isLoading) {
            DashboardStatsLoading(compact = size.isCompact)
            return@GlassPanel
        }

        val display =
            remember(state.data, size, strings, nowMillis, locale) {
                DashboardStatsProjection.project(
                    snapshot = state.data ?: EMPTY_SNAPSHOT,
                    size = size,
                    strings = strings,
                    nowMillis = nowMillis,
                    locale = locale,
                )
            }

        DashboardStatsHeader(
            compact = size.isCompact,
            title = strings.title,
            state = state,
            formatAge = formatAge,
            onRefresh = onRefresh,
        )

        if (display.hasData) {
            DashboardStatsBody(display = display)
        } else {
            EmptyState(
                message = display.emptyMessage,
                icon = DashboardStatsGlyphs.LayoutDashboard,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The titled header (icon + title) or the title-less freshness row — the web `WidgetShell` header ternary. */
@Composable
private fun DashboardStatsHeader(
    compact: Boolean,
    title: String,
    state: UiState<*>,
    formatAge: (FreshnessAge) -> String,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (compact) {
            Spacer(modifier = Modifier.weight(1f))
        } else {
            Icon(
                DashboardStatsGlyphs.LayoutDashboard,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = compact,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
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

/** The footprint-selected body: the compact big number, or the standard stat grid + status + recent transitions. */
@Composable
private fun DashboardStatsBody(display: DashboardStatsDisplay) {
    if (display.isCompact) {
        DashboardStatsCompact(display = display)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            WidgetStatGridContent(
                stats = display.statTiles.map { StatGridItem(label = it.label, value = it.value) },
                compact = false,
                cols = STAT_GRID_COLS,
            )
            DashboardStatsCurrentState(display = display)
            if (display.isWide && display.recentTransitions.isNotEmpty()) {
                DashboardStatsRecentTransitions(display = display)
            }
        }
    }
}

/** The compact (cols<=1) body — the single big trip count over the "active" label (web `isCompact` branch). */
@Composable
private fun DashboardStatsCompact(display: DashboardStatsDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.compactValue)
        Caption(display.compactLabel)
    }
}

/** The "Current State" row — the muted label + the FSM status badge (web `StatusBadge status={fsmState}`). */
@Composable
private fun DashboardStatsCurrentState(display: DashboardStatsDisplay) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.currentStateContentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(display.currentStateLabel)
        StatusBadge(status = display.fsmState, size = ChipSize.Sm)
    }
}

/** The wide-only "Recent Transitions" list — each row a neutral state badge + the relative age (web wide block). */
@Composable
private fun DashboardStatsRecentTransitions(display: DashboardStatsDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(display.recentTransitionsLabel)
        display.recentTransitions.forEach { transition ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = ROW_MIN_HEIGHT)
                        .clearAndSetSemantics { contentDescription = transition.contentDescription },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Badge(text = transition.label, variant = BadgeVariant.Neutral)
                Spacer(modifier = Modifier.weight(1f))
                Caption(transition.timeText)
            }
        }
    }
}

/** The loading skeleton chrome — a short title bar over a body block + a trailing line (web `WidgetShell` loading). */
@Composable
private fun DashboardStatsLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (!compact) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        }
        Skeleton(height = LOADING_BODY_HEIGHT, rounded = true)
        if (!compact) {
            Skeleton(widthFraction = LOADING_LINE_FRACTION, height = LOADING_LINE_HEIGHT)
        }
    }
}

/**
 * Builds the localized [DashboardStatsStrings] from the i18n catalog (P1/S10): the nine
 * `widget.dashboardStats.*` keys the web component reads, plus the three shared `freshness_*` format strings
 * the relative-age formatter consumes (they match the web `formatRelative` `Xm/Xh/Xd ago` exactly).
 */
@Composable
private fun rememberDashboardStatsStrings(): DashboardStatsStrings {
    val title = stringResource(R.string.translation_widget_dashboardStats_title)
    val vehicles = stringResource(R.string.translation_widget_dashboardStats_vehicles)
    val trips = stringResource(R.string.translation_widget_dashboardStats_trips)
    val sessions = stringResource(R.string.translation_widget_dashboardStats_sessions)
    val fsmState = stringResource(R.string.translation_widget_dashboardStats_fsmState)
    val active = stringResource(R.string.translation_widget_dashboardStats_active)
    val currentState = stringResource(R.string.translation_widget_dashboardStats_currentState)
    val recentTransitions = stringResource(R.string.translation_widget_dashboardStats_recentTransitions)
    val noData = stringResource(R.string.translation_widget_dashboardStats_noData)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutesAgo = stringResource(R.string.translation_freshness_minutes)
    val hoursAgo = stringResource(R.string.translation_freshness_hours)
    val daysAgo = stringResource(R.string.translation_freshness_days)
    return remember(
        title,
        vehicles,
        trips,
        sessions,
        fsmState,
        active,
        currentState,
        recentTransitions,
        noData,
    ) {
        DashboardStatsStrings(
            title = title,
            vehicles = vehicles,
            trips = trips,
            sessions = sessions,
            fsmState = fsmState,
            active = active,
            currentState = currentState,
            recentTransitions = recentTransitions,
            noData = noData,
            justNow = justNow,
            minutesAgo = minutesAgo,
            hoursAgo = hoursAgo,
            daysAgo = daysAgo,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip shows (`translation_freshness_*`), shared with
 * the sibling widgets. Kept separate from [DashboardStatsStrings] because it is a render-only concern.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** Standard target column count for the stat grid (web `WidgetStatGrid cols={2}`). */
private const val STAT_GRID_COLS = 2

/** The empty snapshot passed to the projection when the fold produced no data (drives the empty surface). */
private val EMPTY_SNAPSHOT = DashboardStatsSnapshot(dashStats = null, fsmState = EM_DASH, transitions = emptyList())

/**
 * The single glyph this surface references — the web header + empty-state `lucide-react` `LayoutDashboard`
 * (four panes), authored here as a 24×24 round-capped stroked [ImageVector] (Android ships no lucide
 * equivalent without the frozen `material-icons-extended` artifact). Authoring it keeps the surface
 * self-contained within its allowed-files directory, recolored at render time by the shared `Icon` tint.
 */
private object DashboardStatsGlyphs {
    /** lucide `LayoutDashboard` — one tall pane + a wide pane up top, mirrored below. */
    val LayoutDashboard: ImageVector =
        glyph("DashboardStatsLayoutDashboard") {
            rect(3f, 3f, 10f, 12f)
            rect(14f, 3f, 21f, 8f)
            rect(14f, 12f, 21f, 21f)
            rect(3f, 16f, 10f, 21f)
        }
}

/** A rectangle from the top-left ([left], [top]) to the bottom-right ([right], [bottom]) as four closed lines. */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = pathBuilder,
            )
        }.build()

// ── Previews (tooling-only; the sample data is never shipped UI) ────────────────────────────────────────────

private fun previewSnapshot(fsmState: String = "driving"): DashboardStatsSnapshot =
    DashboardStatsSnapshot(
        dashStats = DashboardStats(totalVehicles = 3, totalChargingSessions = 214, totalTrips = 1_286),
        fsmState = fsmState,
        transitions =
            listOf(
                RawTransition("charging", 0L),
                RawTransition("driving", 0L),
                RawTransition("asleep", 0L),
            ),
    )

private fun previewState(
    phase: UiPhase,
    snapshot: DashboardStatsSnapshot?,
): UiState<DashboardStatsSnapshot> = UiState(phase = phase, data = snapshot, fetchedAt = 1L)

@Preview(name = "DashboardStats · standard", showBackground = true, widthDp = 320)
@Composable
private fun DashboardStatsStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardStatsWidgetContent(
            state = previewState(UiPhase.Content, previewSnapshot()),
            size = DashboardStatsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DashboardStats · wide", showBackground = true, widthDp = 460)
@Composable
private fun DashboardStatsWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardStatsWidgetContent(
            state = previewState(UiPhase.Content, previewSnapshot()),
            size = DashboardStatsSize(cols = 4, rows = 4),
            onRefresh = {},
        )
    }
}

@Preview(name = "DashboardStats · compact", showBackground = true, widthDp = 180)
@Composable
private fun DashboardStatsCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardStatsWidgetContent(
            state = previewState(UiPhase.Content, previewSnapshot()),
            size = DashboardStatsSize(cols = 1, rows = 2),
            onRefresh = {},
        )
    }
}

@Preview(name = "DashboardStats · empty", showBackground = true, widthDp = 320)
@Composable
private fun DashboardStatsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardStatsWidgetContent(
            state = previewState(UiPhase.Empty, EMPTY_SNAPSHOT),
            size = DashboardStatsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DashboardStats · loading", showBackground = true, widthDp = 320)
@Composable
private fun DashboardStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardStatsWidgetContent(
            state = UiState.loading(),
            size = DashboardStatsRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}
