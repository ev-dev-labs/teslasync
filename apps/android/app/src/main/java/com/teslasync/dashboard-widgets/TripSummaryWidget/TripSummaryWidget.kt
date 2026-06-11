// The native Jetpack Compose + Material 3 Trip Summary dashboard surface — a parity port of
// web/src/features/dashboard/widgets/TripSummaryWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, a retry surface on a hard error, otherwise a title + navigation icon
// + freshness + refresh header) wrapping either a friendly empty state ("No trips recorded yet") or the
// body: a "Last Trip" panel (a Last-Trip badge + short start date, the trip name, and a 2-column /
// 4-column stat grid of Distance / Duration / Drives / Charge Stops) followed — when there is more than
// one of the three most-recent trips — by the "Recent Trips" list (each row the name + date, plus, at
// standard width, the distance + duration + an "{n} drv" badge; distance only when compact). All data
// flows through the shared [TripSummaryWidgetViewModel]; the view never performs HTTP. SI distance is
// converted to the user's unit at this render boundary via the live [UnitFormatter] (web `useUnits`).
// Every string resolves through the i18n catalog (P1/S10) and every interactive element carries a
// TalkBack label.
//
// The Lucide `Navigation` and `Route` glyphs the web uses have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as the sibling SoftwareUpdateHistoryWidget);
// the web `MapPin` maps to `DataDisplayGlyphs.MapPin`, `Clock` to `DataDisplayGlyphs.Clock`, and `Zap` to
// `DataDisplayGlyphs.Bolt`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TripSummaryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tripsummary

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

private val MIN_TOUCH_TARGET = 44.dp
private const val COMPACT_GRID_COLUMNS = 2
private const val STANDARD_GRID_COLUMNS = 4
private const val LOADING_BAR_COUNT = 3
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_HERO_HEIGHT = 88.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val GLYPH_STROKE_WIDTH = 2f
private const val GLYPH_VIEWPORT = 24f

/**
 * Stateful entry point. Binds the shared trips feed via [source] into a [TripSummaryWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live [units] formatter, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (a [tripSummarySource] adapter over
 * the shared S7/S8 Trips layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network trips seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TripSummaryWidget(
    source: TripSummarySource,
    modifier: Modifier = Modifier,
    size: TripSummarySize = TripSummaryRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = TripSummaryRegistration.ID,
) {
    val viewModel: TripSummaryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { TripSummaryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    TripSummaryWidgetContent(
        state = state,
        size = size,
        formatter = formatter,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the empty / last-trip + recent-trips body. [zone] + [locale] are injectable for
 * deterministic date/number rendering in tests.
 */
@Composable
fun TripSummaryWidgetContent(
    state: UiState<List<Trip>>,
    size: TripSummarySize,
    formatter: UnitFormatter,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
) {
    val strings = rememberTripSummaryStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val trips = state.data ?: emptyList()
            val display =
                remember(trips, formatter, zone, locale, strings) {
                    TripSummaryProjection.project(trips, strings, formatter, zone, locale)
                }
            LoadedChrome(state, size, display, strings, onRefresh, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<Trip>>,
    size: TripSummarySize,
    display: TripSummaryDisplay,
    strings: TripSummaryStrings,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(title = strings.title, state = state, onRefresh = onRefresh)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            val card = display.lastTrip
            if (!display.hasTrips || card == null) {
                TripSummaryEmpty(display.emptyMessage)
            } else {
                LastTripPanel(card = card, compact = size.isCompact)
                if (display.recentRows.isNotEmpty()) {
                    RecentTripsList(title = display.recentTitle, rows = display.recentRows, compact = size.isCompact)
                }
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = NavigationGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeTimeFormatter(),
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
private fun LastTripPanel(
    card: LastTripCard,
    compact: Boolean,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.lg))
                .padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Badge(text = card.badge, variant = BadgeVariant.Neutral)
            Caption(card.date)
        }
        BodyText(card.title, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
        LastTripStatsGrid(card = card, compact = compact)
    }
}

@Composable
private fun LastTripStatsGrid(
    card: LastTripCard,
    compact: Boolean,
) {
    val stats =
        listOf(
            card.distance to DataDisplayGlyphs.MapPin,
            card.duration to DataDisplayGlyphs.Clock,
            card.drives to RouteGlyph,
            card.chargeStops to DataDisplayGlyphs.Bolt,
        )
    val columns = if (compact) COMPACT_GRID_COLUMNS else STANDARD_GRID_COLUMNS
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        stats.chunked(columns).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                rowStats.forEach { (stat, glyph) ->
                    StatCard(
                        label = stat.label,
                        value = stat.value,
                        icon = glyph,
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(columns - rowStats.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun RecentTripsList(
    title: String,
    rows: List<RecentTripRow>,
    compact: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(title)
        rows.forEach { row -> RecentTripRowView(row = row, compact = compact) }
    }
}

@Composable
private fun RecentTripRowView(
    row: RecentTripRow,
    compact: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.md))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .clearAndSetSemantics { contentDescription = row.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            BodyText(row.title, maxLines = 1)
            Caption(row.date)
        }
        if (compact) {
            BodyText(row.distance, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                BodyText(row.distance, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Caption(row.duration)
                Badge(text = row.drivesBadge, variant = BadgeVariant.Neutral)
            }
        }
    }
}

@Composable
private fun TripSummaryEmpty(message: String) {
    EmptyState(
        message = message,
        icon = NavigationGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_HERO_HEIGHT, rounded = true)
        repeat(LOADING_BAR_COUNT) { Skeleton(height = Spacing.lg, rounded = true) }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/**
 * Builds the localized [TripSummaryStrings] from the i18n catalog (P1/S10) — the ten `widget.*` keys the
 * web component reads. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberTripSummaryStrings(): TripSummaryStrings {
    val title = stringResource(R.string.translation_widget_tripSummary)
    val noTrips = stringResource(R.string.translation_widget_noTrips)
    val lastTrip = stringResource(R.string.translation_widget_lastTrip)
    val tripUnnamed = stringResource(R.string.translation_widget_tripUnnamed)
    val distance = stringResource(R.string.translation_widget_distance)
    val duration = stringResource(R.string.translation_widget_duration)
    val drives = stringResource(R.string.translation_widget_drives)
    val chargeStops = stringResource(R.string.translation_widget_chargeStops)
    val recentTrips = stringResource(R.string.translation_widget_recentTrips)
    val drivesShort = stringResource(R.string.translation_widget_drivesShort)
    return remember(title, noTrips, lastTrip, tripUnnamed, distance, duration, drives, chargeStops, recentTrips, drivesShort) {
        TripSummaryStrings(
            title = title,
            noTrips = noTrips,
            lastTrip = lastTrip,
            tripUnnamed = tripUnnamed,
            distance = distance,
            duration = duration,
            drives = drives,
            chargeStops = chargeStops,
            recentTrips = recentTrips,
            drivesShort = drivesShort,
        )
    }
}

/**
 * The localized relative-time formatter for the header freshness chip — maps each [FreshnessAge] bucket
 * onto the `translation_freshness_*` catalog strings so the chip carries no English microcopy.
 */
@Composable
private fun rememberRelativeTimeFormatter(): (FreshnessAge) -> String {
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

// ── Authored Lucide glyphs (no shared-set equivalent) ────────────────────────────────────────────────

/** The web Lucide `Navigation` glyph: a paper-plane / compass arrow (header + empty-state marker). */
private val NavigationGlyph: ImageVector =
    strokedGlyph("Navigation") {
        moveTo(3f, 11f)
        lineTo(22f, 2f)
        lineTo(13f, 21f)
        lineTo(11f, 13f)
        close()
    }

/** The web Lucide `Route` glyph: two waypoint dots joined by a stepped path (the Drives stat marker). */
private val RouteGlyph: ImageVector =
    strokedGlyph("Route") {
        circlePath(6f, 18.5f, 2.5f)
        moveTo(6f, 16f)
        lineTo(6f, 12f)
        lineTo(18f, 12f)
        lineTo(18f, 7.5f)
        circlePath(18f, 5f, 2.5f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circlePath(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ──

// Six logical fields vary across the preview trips; @Suppress keeps this preview-only fixture readable.
@Suppress("LongParameterList")
private fun previewTrip(
    id: Long,
    name: String?,
    distanceMeters: Double,
    startDate: String,
    endDate: String?,
    driveCount: Long,
    chargeCount: Long,
): Trip =
    Trip(
        id = id,
        vehicleId = 1L,
        name = name,
        startDate = startDate,
        endDate = endDate,
        startedAt = startDate,
        endedAt = endDate,
        totalDistanceM = distanceMeters,
        totalEnergyWh = 18_000.0,
        totalDurationS = 3_900L,
        totalCost = 4.20,
        driveCount = driveCount,
        chargeCount = chargeCount,
        createdAt = startDate,
    )

private fun previewTrips(): List<Trip> =
    listOf(
        previewTrip(1, "Home → Office", 23_400.0, "2026-06-09T08:05:00Z", "2026-06-09T09:10:00Z", 2, 1),
        previewTrip(2, "Weekend road trip", 184_200.0, "2026-06-06T07:00:00Z", "2026-06-06T12:40:00Z", 5, 3),
        previewTrip(3, null, 9_100.0, "2026-06-04T18:20:00Z", "2026-06-04T18:46:00Z", 1, 0),
    )

private fun previewContentState(
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<List<Trip>> =
    UiState(
        phase = UiPhase.Content,
        data = previewTrips(),
        fetchedAt = 1_749_460_000_000L,
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "TripSummary · standard", showBackground = true)
@Composable
private fun TripSummaryStandardPreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = previewContentState(),
            size = TripSummaryRegistration.DEFAULT_SIZE,
            formatter = UnitFormatter.default(),
            onRefresh = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}

@Preview(name = "TripSummary · compact", showBackground = true)
@Composable
private fun TripSummaryCompactPreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = previewContentState(),
            size = TripSummarySize(cols = 1, rows = 2),
            formatter = UnitFormatter.default(),
            onRefresh = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}

@Preview(name = "TripSummary · empty", showBackground = true)
@Composable
private fun TripSummaryEmptyPreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 1_749_460_000_000L),
            size = TripSummaryRegistration.DEFAULT_SIZE,
            formatter = UnitFormatter.default(),
            onRefresh = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}

@Preview(name = "TripSummary · loading", showBackground = true)
@Composable
private fun TripSummaryLoadingPreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = UiState.loading(),
            size = TripSummaryRegistration.DEFAULT_SIZE,
            formatter = UnitFormatter.default(),
            onRefresh = {},
        )
    }
}

@Preview(name = "TripSummary · error", showBackground = true)
@Composable
private fun TripSummaryErrorPreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = TripSummaryRegistration.DEFAULT_SIZE,
            formatter = UnitFormatter.default(),
            onRefresh = {},
        )
    }
}

@Preview(name = "TripSummary · offline (cached)", showBackground = true)
@Composable
private fun TripSummaryOfflinePreview() {
    TeslaSyncTheme {
        TripSummaryWidgetContent(
            state = previewContentState(stale = true, errorKind = ErrorKind.Network),
            size = TripSummaryRegistration.DEFAULT_SIZE,
            formatter = UnitFormatter.default(),
            onRefresh = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}
