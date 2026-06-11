// The native Jetpack Compose + Material 3 Recent Drives List dashboard surface — a parity port of
// web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a title + route
// icon + freshness header with a "View all" affordance) wrapping a newest-first, scrollable drive feed:
// each row shows the distance + duration (left), the start/end addresses (centre, only when wide), and
// the SoC / battery-used / date (right) — or a friendly "No recent drives recorded" empty state. All
// data flows through the shared [RecentDrivesListWidgetViewModel] (P1/S8); SI distances are converted to
// the user's unit at this render boundary via the live [io.teslasync.android.data.UnitFormatter]. The
// view never performs HTTP. Every string resolves through the i18n catalog and every interactive
// element carries a TalkBack label.
//
// The Lucide `Route` and `ArrowUpRight` glyphs the web uses have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as the sibling CommandHistoryWidget);
// `Battery`, `Clock` and `MapPin` reuse the shared data-display glyph set and `Refresh` the feedback set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentDrivesListWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdriveslist

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.time.Instant
import io.teslasync.shared.core.units.formatDistance as formatSiDistance

private const val EM_DASH = "\u2014"
private const val DATE_PATTERN = "MMM d"
private const val DISTANCE_DECIMALS = 1
private const val LOADING_ROW_COUNT = 4
private const val LEFT_COLUMN_MIN_WIDTH = 72
private val MIN_TOUCH_TARGET = 44.dp

/**
 * Stateful entry point. Collects the shared [RecentDrivesListWidgetViewModel] state + the live [units]
 * formatter, records the one-shot `view.opened` diagnostic, and renders the surface for the given
 * [size]. A dashboard host supplies the view-model (wired via [RecentDrivesListWidgetViewModel.create]),
 * the per-row [onDriveClick] (web `<Link to={'/drives/' + id}>`) and the [onViewAll] navigation (web
 * `<Link to="/drives">`); [units] defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentDrivesListWidget(
    viewModel: RecentDrivesListWidgetViewModel,
    modifier: Modifier = Modifier,
    size: RecentDrivesSize = RecentDrivesListRegistration.defaultSize,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    onDriveClick: (Long) -> Unit = {},
    onViewAll: () -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    RecentDrivesListWidgetContent(
        state = state,
        size = size,
        distanceUnit = formatter.prefs.distance,
        onRefresh = viewModel::refresh,
        onDriveClick = onDriveClick,
        onViewAll = onViewAll,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the Recent Drives List surface — every state from the web source is reproduced
 * and none is ever hidden. Split out from [RecentDrivesListWidget] so each state can be rendered in a
 * snapshot/accessibility test without a view-model or network. [distanceUnit] supplies the SI→display
 * distance conversion + unit token at the render boundary.
 */
@Composable
fun RecentDrivesListWidgetContent(
    state: UiState<List<Drive>>,
    size: RecentDrivesSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
    onDriveClick: (Long) -> Unit = {},
    onViewAll: () -> Unit = {},
) {
    val title = stringResource(R.string.translation_widget_recentDrivesList)
    when {
        state.isLoading -> RecentDrivesLoading(modifier)
        state.isError -> RecentDrivesError(title = title, onRetry = onRefresh, kind = state.toQueryErrorKind(), modifier = modifier)
        else -> RecentDrivesLoaded(state, size, distanceUnit, title, onRefresh, onDriveClick, onViewAll, modifier)
    }
}

@Suppress("LongParameterList")
@Composable
private fun RecentDrivesLoaded(
    state: UiState<List<Drive>>,
    size: RecentDrivesSize,
    distanceUnit: DistanceUnitPref,
    title: String,
    onRefresh: () -> Unit,
    onDriveClick: (Long) -> Unit,
    onViewAll: () -> Unit,
    modifier: Modifier,
) {
    val locale = Locale.getDefault()
    val distancePrefs = remember(distanceUnit) { UnitPreferences.fromSettings(null).copy(distance = distanceUnit) }
    val dateFormatter = remember(locale) { DateTimeFormatter.ofPattern(DATE_PATTERN, locale).withZone(ZoneId.systemDefault()) }
    val display =
        remember(state.data, size, distancePrefs, dateFormatter) {
            RecentDrivesListProjection.project(
                drives = state.data ?: emptyList(),
                size = size,
                formatDistance = { meters -> formatSiDistance(meters, distancePrefs, DISTANCE_DECIMALS) },
                formatDate = { instant -> formatShortDate(dateFormatter, instant) },
            )
        }
    val emptyMessage = stringResource(R.string.translation_widget_noDrivesList)

    Column(modifier = modifier.fillMaxSize()) {
        RecentDrivesHeader(state = state, title = title, onRefresh = onRefresh, onViewAll = onViewAll)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (!display.hasItems) {
                EmptyState(message = emptyMessage, icon = RecentDrivesGlyphs.Route, modifier = Modifier.fillMaxWidth())
            } else {
                display.rows.forEach { row -> RecentDriveRowItem(row = row, isWide = display.isWide, onClick = onDriveClick) }
            }
        }
    }
}

@Composable
private fun RecentDrivesHeader(
    state: UiState<List<Drive>>,
    title: String,
    onRefresh: () -> Unit,
    onViewAll: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(RecentDrivesGlyphs.Route, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            PanelTitle(title, modifier = Modifier.semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
        ViewAllLink(label = stringResource(R.string.translation_widget_viewAll), onClick = onViewAll)
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
private fun ViewAllLink(
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .clip(MaterialTheme.shapes.small)
                .clickable(onClick = onClick)
                .heightIn(min = MIN_TOUCH_TARGET)
                .padding(horizontal = Spacing.xs)
                .semantics(mergeDescendants = true) { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        Icon(
            RecentDrivesGlyphs.ArrowUpRight,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RecentDriveRowItem(
    row: RecentDriveRow,
    isWide: Boolean,
    onClick: (Long) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .clickable { onClick(row.id) }
                .heightIn(min = MIN_TOUCH_TARGET)
                .padding(Spacing.sm)
                .clearAndSetSemantics {
                    contentDescription = row.contentDescription
                    role = Role.Button
                },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DriveDistanceColumn(row)
        if (isWide) {
            DriveAddressColumn(row, modifier = Modifier.weight(1f))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DriveBatteryColumn(row)
    }
}

@Composable
private fun DriveDistanceColumn(row: RecentDriveRow) {
    Column(
        modifier = Modifier.widthIn(min = LEFT_COLUMN_MIN_WIDTH.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = row.distanceText,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(DataDisplayGlyphs.Clock, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Caption(row.durationText)
        }
    }
}

@Composable
private fun DriveAddressColumn(
    row: RecentDriveRow,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        AddressRow(address = row.startAddress, tint = TeslaTokens.status.success)
        AddressRow(address = row.endAddress, tint = TeslaTokens.status.danger)
    }
}

@Composable
private fun AddressRow(
    address: String,
    tint: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Xs, tint = tint)
        Text(
            text = address,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DriveBatteryColumn(row: RecentDriveRow) {
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(
                DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(row.socText)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (row.batteryUsedText != null) {
                Text(
                    text = row.batteryUsedText,
                    style = MaterialTheme.typography.labelSmall,
                    color = TeslaTokens.status.info,
                )
            }
            Caption(row.dateText)
        }
    }
}

@Composable
private fun RecentDrivesLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_ROW_COUNT) {
            Skeleton(height = Spacing.xl3, rounded = true)
        }
    }
}

@Composable
private fun RecentDrivesError(
    title: String,
    onRetry: () -> Unit,
    kind: QueryErrorKind,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize().padding(Spacing.md)) {
        QueryError(kind = kind, resourceName = title, onRetry = onRetry)
    }
}

/** Locale/zone-aware month-short + day-numeric date (web `formatDateShort`); an unformattable instant renders the em dash. */
private fun formatShortDate(
    formatter: DateTimeFormatter,
    instant: Instant,
): String =
    runCatching { formatter.format(java.time.Instant.ofEpochMilli(instant.toEpochMilliseconds())) }
        .getOrDefault(EM_DASH)

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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans
 * on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render
 * time by the [Icon] tint — the same approach as the sibling CommandHistoryWidget.
 */
private object RecentDrivesGlyphs {
    /** lucide `route` — two waypoint nodes joined by an S-route (web header + empty-state icon). */
    val Route: ImageVector =
        driveVector("RecentDrivesRoute") {
            circlePath(6f, 19f, 3f)
            moveTo(9f, 19f)
            lineTo(14f, 19f)
            curveTo(18f, 19f, 18f, 12f, 14f, 12f)
            lineTo(10f, 12f)
            curveTo(6f, 12f, 6f, 5f, 10f, 5f)
            lineTo(15f, 5f)
            circlePath(18f, 5f, 3f)
        }

    /** lucide `arrow-up-right` — the "View all" outbound arrow. */
    val ArrowUpRight: ImageVector =
        driveVector("RecentDrivesArrowUpRight") {
            moveTo(7f, 17f)
            lineTo(17f, 7f)
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 17f)
        }
}

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f

private fun driveVector(
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
