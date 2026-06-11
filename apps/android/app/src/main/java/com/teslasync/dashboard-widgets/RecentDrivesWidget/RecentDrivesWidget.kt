// The native Jetpack Compose + Material 3 Recent Drives dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RecentDrivesWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a title + Route icon + freshness
// header with a "View all" affordance) wrapping the body the web renders: a scrolling list of up to five
// recent drives — each a tappable row showing the distance, the duration + start→end SoC, and the short
// date — or a friendly empty state. All data flows through the shared [RecentDrivesWidgetViewModel]; SI
// metres are converted to the user's distance unit at this render boundary via the live [UnitFormatter],
// and the short date via a locale/zone-aware formatter. The view never performs HTTP. Every string
// resolves through the i18n catalog and every interactive element carries a TalkBack label.
//
// The Lucide `Route` glyph the web uses has no shared-set equivalent, so it is authored here as a 24×24
// stroked vector (the same approach as the sibling MileageStatsWidget), keeping the iconography faithful
// without a feature-wide icon dependency. The "View all" arrow reuses the feedback layer's `ArrowRight`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentDrivesWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdrives

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Em dash shown when a start timestamp cannot be formatted (web `formatDateShort` fallback). */
private const val EM_DASH = "\u2014"

/** Locale-aware short-date skeleton: short month + numeric day (web `formatDateShort` → "Apr 4"). */
private const val DATE_PATTERN = "MMM d"

/** Minimum 44 dp touch target for each tappable drive row (Material accessibility). */
private val ROW_MIN_HEIGHT = 44.dp

/** Skeleton bar height while the first load is in flight. */
private val SKELETON_ROW_HEIGHT = 28.dp

/** Lower bound on the loading skeleton bar count (a short widget still shows a few). */
private const val MIN_SKELETON_ROWS = 3

/** Tighter inter-line spacing for the two-line drive row (distance above the subtitle). */
private val ROW_LINE_SPACING = 2.dp

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [RecentDrivesWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), a unique [instanceKey] per placement, and the navigation callbacks
 * ([onViewAll] → the web `Link to="/drives"`, [onOpenDrive] → the web `Link to="/drives/{id}"`). [units]
 * defaults to the app's `LocalDataContainer` live formatter (web `useUnits`).
 *
 * @param source the cache-then-network seam (vehicles + drives adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentDrivesWidget(
    source: RecentDrivesSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: RecentDrivesSize = RecentDrivesRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = RecentDrivesRegistration.ID,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    onViewAll: () -> Unit = {},
    onOpenDrive: (Long) -> Unit = {},
) {
    val viewModel: RecentDrivesWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { RecentDrivesWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    RecentDrivesWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        onViewAll = onViewAll,
        onOpenDrive = onOpenDrive,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the recent-drives list / empty body. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [prefs] supplies the SI-metre → display-unit distance conversion;
 * [locale]/[zone] drive the number grouping and the short-date formatter (tests pin deterministic values).
 */
@Composable
fun RecentDrivesWidgetContent(
    state: UiState<List<Drive>>,
    prefs: UnitPref,
    size: RecentDrivesSize,
    onRefresh: () -> Unit,
    onViewAll: () -> Unit,
    onOpenDrive: (Long) -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberRecentDrivesStrings(locale, zone)
    when {
        state.isLoading -> RecentDrivesLoading(size = size, label = stringResource(R.string.translation_a11y_loading), modifier = modifier)
        state.isError ->
            QueryError(
                kind = state.toQueryErrorKind(),
                resourceName = strings.title,
                onRetry = onRefresh,
                modifier = modifier.fillMaxSize(),
            )
        else -> {
            val display =
                remember(state.data, prefs, strings, locale) {
                    RecentDrivesProjection.project(state.data ?: emptyList(), prefs, strings, locale)
                }
            RecentDrivesLoaded(state, display, onRefresh, onViewAll, onOpenDrive, strings, modifier)
        }
    }
}

@Composable
private fun RecentDrivesLoaded(
    state: UiState<List<Drive>>,
    display: RecentDrivesDisplay,
    onRefresh: () -> Unit,
    onViewAll: () -> Unit,
    onOpenDrive: (Long) -> Unit,
    strings: RecentDrivesStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        RecentDrivesHeader(state = state, onRefresh = onRefresh, onViewAll = onViewAll, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(top = Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (display.hasItems) {
                display.items.forEach { row -> RecentDriveRow(row = row, onOpenDrive = onOpenDrive) }
            } else {
                RecentDrivesEmpty(strings)
            }
        }
    }
}

@Composable
private fun RecentDrivesHeader(
    state: UiState<List<Drive>>,
    onRefresh: () -> Unit,
    onViewAll: () -> Unit,
    strings: RecentDrivesStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(RecentDrivesGlyphs.Route, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
        ViewAllAction(label = strings.viewAll, onViewAll = onViewAll)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The web `Link to="/drives"` "View all →" affordance, as a Ghost text button + trailing arrow. */
@Composable
private fun ViewAllAction(
    label: String,
    onViewAll: () -> Unit,
) {
    Button(onClick = onViewAll, variant = ButtonVariant.Ghost, size = ButtonSize.Sm) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.width(Spacing.xs))
        Icon(FeedbackGlyphs.ArrowRight, contentDescription = null, size = IconSize.Xs)
    }
}

/** One tappable drive row (web `Link to="/drives/{id}"`): distance + duration/SoC subtitle + short date. */
@Composable
private fun RecentDriveRow(
    row: RecentDriveRow,
    onOpenDrive: (Long) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .semantics(mergeDescendants = true) {
                    contentDescription = row.contentDescription
                    role = Role.Button
                }.clickable { onOpenDrive(row.id) }
                .padding(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(ROW_LINE_SPACING)) {
            BodyText(row.primaryText, maxLines = 1)
            HelperText(row.subtitleText)
        }
        Caption(row.dateLabel)
    }
}

@Composable
private fun RecentDrivesEmpty(strings: RecentDrivesStrings) {
    EmptyState(
        message = strings.noDrives,
        icon = RecentDrivesGlyphs.Route,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RecentDrivesLoading(
    size: RecentDrivesSize,
    label: String,
    modifier: Modifier,
) {
    val bars = size.rows.coerceIn(MIN_SKELETON_ROWS, RecentDrivesRegistration.DEFAULT_LIMIT)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(bars) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/**
 * Builds the localized [RecentDrivesStrings] from the i18n catalog (P1/S10) — the three
 * `widget.recentDrives` / `widget.viewAll` / `widget.noDrives` keys the web reads via `t(...)`, the shared
 * refresh label, the minutes unit symbol (`DurationUnitPref.MINUTES`, so no English word is hard-coded),
 * and a locale/zone-aware `MMM d` short-date formatter (web `useDateFormat().formatDateShort`). Remembered
 * against the resolved strings + formatter so a locale/zone change re-projects the surface.
 */
@Composable
private fun rememberRecentDrivesStrings(
    locale: Locale,
    zone: ZoneId,
): RecentDrivesStrings {
    val title = stringResource(R.string.translation_widget_recentDrives)
    val viewAll = stringResource(R.string.translation_widget_viewAll)
    val noDrives = stringResource(R.string.translation_widget_noDrives)
    val refresh = stringResource(R.string.translation_common_refresh)
    val minutes = DurationUnitPref.MINUTES.label
    val formatter = remember(locale, zone) { DateTimeFormatter.ofPattern(DATE_PATTERN, locale).withZone(zone) }
    return remember(title, viewAll, noDrives, refresh, minutes, formatter) {
        RecentDrivesStrings(
            title = title,
            viewAll = viewAll,
            noDrives = noDrives,
            refreshLabel = refresh,
            minutesLabel = minutes,
            formatStartDate = { millis ->
                runCatching { formatter.format(Instant.ofEpochMilli(millis)) }.getOrDefault(EM_DASH)
            },
        )
    }
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

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Monochrome and recoloured at render time by the
 * [Icon] tint — the same approach as the sibling MileageStatsWidget.
 */
private object RecentDrivesGlyphs {
    /** lucide `route` — connected waypoints (the title + empty-state icon, web `<Route />`). */
    val Route: ImageVector =
        routeVector("RecentDrivesRoute") {
            moveTo(6f, 19f)
            lineTo(14f, 19f)
            curveTo(16.2f, 19f, 18f, 17.2f, 18f, 15f)
            curveTo(18f, 12.8f, 16.2f, 11f, 14f, 11f)
            lineTo(10f, 11f)
            curveTo(7.8f, 11f, 6f, 9.2f, 6f, 7f)
            curveTo(6f, 4.8f, 7.8f, 3f, 10f, 3f)
            lineTo(18f, 3f)
        }

    private fun routeVector(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}
