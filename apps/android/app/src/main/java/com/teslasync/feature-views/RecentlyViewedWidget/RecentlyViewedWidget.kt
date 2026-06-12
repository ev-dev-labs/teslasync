// The native Jetpack Compose + Material 3 Recently Viewed feature view — a parity port of
// web/src/features/dashboard/components/RecentlyViewedWidget.tsx. It mirrors the web `GlassPanel` with a
// clock-iconed "Recently Viewed" title over either a list of recently-visited routes — each a tappable
// row carrying a kind glyph, the captured title, and a short relative-time label (`Just now` / `Xm` /
// `Xh` / `Xd`) — or, when there are none, the web's plain non-actionable hint (never a blank box, never a
// CTA-bearing empty state). A brief skeleton precedes the first client-store read.
//
// All data flows through the shared [RecentlyViewedWidgetViewModel] (P1/S8); the view performs no HTTP
// and no storage access. Navigation is hoisted to the host via [onOpenPath] (web `<Link to={path}>`).
// Every string resolves through the i18n catalog (P1/S10) and every row is a single TalkBack node with
// the Button role. The one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// The Lucide `Compass`, `CalendarDays`, and `FileText` glyphs have no shared-set equivalent, so they are
// authored here as 24×24 stroked vectors (the same approach as the sibling RecentDrivesListWidget); the
// vehicle/drive/charging/geofence rows + the title clock reuse the shared Nav / data-display glyph sets.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentlyViewedWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentlyviewed

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LOADING_ROW_COUNT = 3
private const val TITLE_MAX_LINES = 1
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f
private const val DOT_LENGTH = 0.1f
private val LOADING_ROW_HEIGHT = 18.dp
private val MIN_TOUCH_TARGET = 44.dp

/**
 * Stateful entry point. Resolves the read-only [RecentPagesStore] (a SharedPreferences-backed adapter by
 * default), spins up the [RecentlyViewedWidgetViewModel], records the one-shot `view.opened` diagnostic,
 * collects its state, and renders the surface. A host supplies [onOpenPath] (wired to its
 * `NavHostController`, web `<Link to={path}>`); [limit] caps the rows (web `RECENT_PAGES_DISPLAY_LIMIT`).
 *
 * @param store override for the recent-pages seam; production defaults to the SharedPreferences store.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param onOpenPath invoked with the tapped row's path; the host performs the navigation.
 */
@Composable
fun RecentlyViewedWidget(
    modifier: Modifier = Modifier,
    limit: Int = RecentlyViewedRegistration.DISPLAY_LIMIT,
    logger: Logger = LocalDataContainer.current.logger,
    store: RecentPagesStore? = null,
    instanceKey: String = RecentlyViewedRegistration.SLUG,
    onOpenPath: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val resolvedStore = store ?: remember(context) { SharedPreferencesRecentPagesStore(context) }
    val viewModel: RecentlyViewedWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { RecentlyViewedWidgetViewModel(resolvedStore, logger, limit) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    RecentlyViewedWidgetContent(
        state = state,
        strings = rememberRecentlyViewedStrings(),
        onOpenPath = onOpenPath,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the snapshot/UI-test entry point. Every state the web source renders is reproduced
 * and none is hidden: the title row is always present; below it a [RecentlyViewedUiState.Loading] skeleton,
 * the [RecentlyViewedUiState.Empty] hint, or the [RecentlyViewedUiState.Content] row list. [now] formats
 * each row's age (web `now = Date.now()` at render) and is injectable so tests stay deterministic.
 */
@Composable
fun RecentlyViewedWidgetContent(
    state: RecentlyViewedUiState,
    strings: RecentlyViewedStrings,
    modifier: Modifier = Modifier,
    now: Long = System.currentTimeMillis(),
    onOpenPath: (String) -> Unit = {},
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        RecentlyViewedHeader(title = strings.widgetTitle)
        Spacer(modifier = Modifier.height(Spacing.sm))
        when (state) {
            RecentlyViewedUiState.Loading -> RecentlyViewedLoading()
            RecentlyViewedUiState.Empty -> RecentlyViewedEmpty(message = strings.empty)
            is RecentlyViewedUiState.Content ->
                RecentlyViewedList(
                    rows = RecentlyViewedProjection.rows(state.entries, now, strings),
                    onOpenPath = onOpenPath,
                )
        }
    }
}

@Composable
private fun RecentlyViewedHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(text = title, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun RecentlyViewedLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) {
            Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun RecentlyViewedEmpty(message: String) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun RecentlyViewedList(
    rows: List<RecentlyViewedRow>,
    onOpenPath: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        rows.forEach { row -> RecentlyViewedRowItem(row = row, onOpenPath = onOpenPath) }
    }
}

@Composable
private fun RecentlyViewedRowItem(
    row: RecentlyViewedRow,
    onOpenPath: (String) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .clickable { onOpenPath(row.path) }
                .heightIn(min = MIN_TOUCH_TARGET)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .clearAndSetSemantics {
                    contentDescription = row.contentDescription
                    role = Role.Button
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = glyphForKind(row.kind),
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        Text(
            text = row.title,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = TITLE_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = row.relativeLabel,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = TITLE_MAX_LINES,
        )
    }
}

/**
 * Builds the localized [RecentlyViewedStrings] from the i18n catalog (P1/S10) — the native analogue of
 * the web `t('recentPages.*', default)` calls. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberRecentlyViewedStrings(): RecentlyViewedStrings {
    val widgetTitle = stringResource(R.string.translation_recentPages_widgetTitle)
    val empty = stringResource(R.string.translation_recentPages_empty)
    val justNow = stringResource(R.string.translation_recentPages_justNow)
    val shortMinute = stringResource(R.string.translation_recentPages_shortMinute)
    val shortHour = stringResource(R.string.translation_recentPages_shortHour)
    val shortDay = stringResource(R.string.translation_recentPages_shortDay)
    return remember(widgetTitle, empty, justNow, shortMinute, shortHour, shortDay) {
        RecentlyViewedStrings(
            widgetTitle = widgetTitle,
            empty = empty,
            justNow = justNow,
            shortMinute = shortMinute,
            shortHour = shortHour,
            shortDay = shortDay,
        )
    }
}

/**
 * Maps a [RecentPageKind] onto its row glyph — the native analogues of the web Lucide icons (`Car`,
 * `Route`, `BatteryCharging`, `Compass`, `MapPinned`, `CalendarDays`, `FileText`). The vehicle / drive /
 * charging / geofence glyphs reuse the shared sets; trip / year-review / page are authored locally.
 */
private fun glyphForKind(kind: RecentPageKind): ImageVector =
    when (kind) {
        RecentPageKind.Vehicle -> NavGlyphs.Car
        RecentPageKind.Drive -> NavGlyphs.Route
        RecentPageKind.Charging -> DataDisplayGlyphs.BatteryCharging
        RecentPageKind.Trip -> RecentlyViewedGlyphs.Compass
        RecentPageKind.Geofence -> DataDisplayGlyphs.MapPin
        RecentPageKind.YearReview -> RecentlyViewedGlyphs.CalendarDays
        RecentPageKind.Page -> RecentlyViewedGlyphs.FileText
    }

/**
 * Self-contained line glyphs for the kinds the shared sets do not cover, authored as 24×24 stroked
 * vectors (the web library leans on lucide-react, which has no bundled Android equivalent). Each is
 * monochrome and recoloured at render time by the [Icon] tint.
 */
private object RecentlyViewedGlyphs {
    /** lucide `compass` — the trip row glyph. */
    val Compass: ImageVector =
        glyph("RecentlyViewedCompass") {
            circlePath(12f, 12f, 9f)
            moveTo(15.5f, 8.5f)
            lineTo(13f, 13f)
            lineTo(8.5f, 15.5f)
            lineTo(11f, 11f)
            close()
        }

    /** lucide `calendar-days` — the year-review row glyph. */
    val CalendarDays: ImageVector =
        glyph("RecentlyViewedCalendarDays") {
            rect(4f, 5f, 20f, 20f)
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(8f, 3f)
            lineTo(8f, 6f)
            moveTo(16f, 3f)
            lineTo(16f, 6f)
            dot(8.5f, 13f)
            dot(12f, 13f)
            dot(15.5f, 13f)
            dot(8.5f, 16.5f)
            dot(12f, 16.5f)
        }

    /** lucide `file-text` — the default/page row glyph. */
    val FileText: ImageVector =
        glyph("RecentlyViewedFileText") {
            moveTo(7f, 3f)
            lineTo(14f, 3f)
            lineTo(19f, 8f)
            lineTo(19f, 21f)
            lineTo(7f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 8f)
            lineTo(19f, 8f)
            moveTo(9.5f, 12.5f)
            lineTo(16f, 12.5f)
            moveTo(9.5f, 16f)
            lineTo(13.5f, 16f)
        }
}

private fun glyph(
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + DOT_LENGTH, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
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
