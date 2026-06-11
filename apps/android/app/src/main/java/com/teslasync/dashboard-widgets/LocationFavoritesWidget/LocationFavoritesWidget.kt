// The native Jetpack Compose + Material 3 Favorite Locations dashboard surface — a parity port of
// web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a retry surface on hard failure, otherwise a freshness + refresh header —
// titled with a map-pin icon for the standard footprint, bare for the compact footprint) wrapping one
// of: the compact location badge (an emoji + a toned badge for where the car is parked), or the full
// view (the location badge row with an optional `→ destination` hint, then the ranked list of the
// most-visited places — or the "No favorite locations" empty body when there are no rows). All data
// flows through the shared [LocationFavoritesWidgetViewModel] (P1/S8); the view never performs HTTP.
// Every string resolves through the i18n catalog and every interactive element + the location emoji
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationFavoritesWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationfavorites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
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
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 4
private const val BAR_ALPHA = 0.15f
private val ROW_MIN_HEIGHT = 44.dp
private val COMPACT_MIN_HEIGHT = 44.dp

/**
 * Stateful entry point. Binds the cache-then-network combined feed via [source] into a
 * [LocationFavoritesWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8
 * Locations + Vehicles data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network combined-feed seam (a [StoreLocationFavoritesSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LocationFavoritesWidget(
    source: LocationFavoritesSource,
    modifier: Modifier = Modifier,
    size: LocationFavoritesSize = LocationFavoritesRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LocationFavoritesRegistration.ID,
) {
    val viewModel: LocationFavoritesWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LocationFavoritesWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    LocationFavoritesWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness +
 * refresh header over the compact location badge or the full badge-row + ranked-list / empty body.
 *
 * @param nowMillis the wall clock used for the per-row "last visited" relative labels; defaulted from
 *   the system clock and overridable for deterministic tests.
 */
@Composable
fun LocationFavoritesWidgetContent(
    state: UiState<LocationFavoritesData>,
    size: LocationFavoritesSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    val strings = rememberLocationFavoritesStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display =
                remember(state.data, size, nowMillis, strings) {
                    LocationFavoritesProjection.project(state.data, size, nowMillis, strings)
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<LocationFavoritesData>,
    size: LocationFavoritesSize,
    display: LocationFavoritesDisplay,
    onRefresh: () -> Unit,
    strings: LocationFavoritesStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, onRefresh = onRefresh, strings = strings)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            if (display.isCompact) CompactLocationBadge(display) else FullBody(display)
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<LocationFavoritesData>,
    size: LocationFavoritesSize,
    onRefresh: () -> Unit,
    strings: LocationFavoritesStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!size.isCompact) {
            Icon(
                LocationFavoritesGlyphs.MapPin,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.speed,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatFreshnessAge,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Compact: bare location badge (web `isCompact` body) --
@Composable
private fun CompactLocationBadge(display: LocationFavoritesDisplay) {
    Column(
        modifier = Modifier.fillMaxSize().heightIn(min = COMPACT_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        LocationEmoji(display, large = true)
        Badge(display.badgeLabel, variant = badgeVariantFor(display.badgeKind))
    }
}

// -- Full: badge row + ranked list / empty body (web standard layout) --
@Composable
private fun FullBody(display: LocationFavoritesDisplay) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        BadgeRow(display)
        if (display.hasItems) {
            RankedLocationList(display.rows)
        } else {
            EmptyState(
                message = display.emptyMessage,
                icon = LocationFavoritesGlyphs.MapPin,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun BadgeRow(display: LocationFavoritesDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = ROW_MIN_HEIGHT),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        LocationEmoji(display, large = false)
        Badge(display.badgeLabel, variant = badgeVariantFor(display.badgeKind))
        if (display.destinationName != null) {
            BodyText(
                text = "\u2192 ${display.destinationName}",
                maxLines = 1,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun RankedLocationList(rows: List<RankedLocationRow>) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        rows.forEachIndexed { index, row -> RankedLocationRowView(rank = index + 1, row = row) }
    }
}

@Composable
private fun RankedLocationRowView(
    rank: Int,
    row: RankedLocationRow,
) {
    val barColor = TeslaTokens.chart.speed.copy(alpha = BAR_ALPHA)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription }
                .drawBehind {
                    if (row.barFraction > 0f) {
                        drawRect(color = barColor, size = Size(size.width * row.barFraction, size.height))
                    }
                },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(rank.toString())
            BodyText(text = row.label, modifier = Modifier.weight(1f), maxLines = 1)
            BodyText(text = row.formattedValue)
        }
    }
}

@Composable
private fun LocationEmoji(
    display: LocationFavoritesDisplay,
    large: Boolean,
) {
    Text(
        text = display.badgeEmoji,
        style = if (large) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { contentDescription = display.badgeLabel },
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
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
 * Map a [LocationBadgeKind] to its [Badge] tone — the native analogue of the web `locationBadge`
 * variant (Home → success, Other → warning, Work/Favorite → neutral).
 */
private fun badgeVariantFor(kind: LocationBadgeKind): BadgeVariant =
    when (kind) {
        LocationBadgeKind.Home -> BadgeVariant.Success
        LocationBadgeKind.Other -> BadgeVariant.Warning
        LocationBadgeKind.Work, LocationBadgeKind.Favorite -> BadgeVariant.Neutral
    }

/**
 * Builds the localized [LocationFavoritesStrings] from the i18n catalog (P1/S10): the title + the
 * home/work/favorite/other badge labels + the "No favorite locations" message (the six
 * `widget.locationFavorites.*` keys), the header refresh/refreshing/offline microcopy, and the shared
 * `freshness.*` relative-time patterns used both for the per-row "last visited" label and the header
 * freshness chip's relative-time formatter.
 */
@Composable
private fun rememberLocationFavoritesStrings(): LocationFavoritesStrings {
    val title = stringResource(R.string.translation_widget_locationFavorites_title)
    val home = stringResource(R.string.translation_widget_locationFavorites_home)
    val work = stringResource(R.string.translation_widget_locationFavorites_work)
    val favorite = stringResource(R.string.translation_widget_locationFavorites_favorite)
    val other = stringResource(R.string.translation_widget_locationFavorites_other)
    val noData = stringResource(R.string.translation_widget_locationFavorites_noData)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        home,
        work,
        favorite,
        other,
        noData,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        LocationFavoritesStrings(
            title = title,
            home = home,
            work = work,
            favorite = favorite,
            other = other,
            noData = noData,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            relativeJustNow = justNow,
            relativeMinutesFmt = minutes,
            relativeHoursFmt = hours,
            relativeDaysFmt = days,
            formatFreshnessAge = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

/**
 * Self-contained map-pin glyph for the header + empty state, authored as a 24×24 stroked vector (the
 * web library leans on lucide-react's `MapPin`, which has no bundled Android equivalent). Monochrome
 * and recolored at render time by the [Icon] tint.
 */
private object LocationFavoritesGlyphs {
    /** Teardrop location pin with a hollow center (web lucide `MapPin`). */
    val MapPin: ImageVector =
        locationFavoritesVector("LocationFavoritesMapPin") {
            moveTo(12f, 21f)
            curveTo(7f, 16f, 5f, 12.5f, 5f, 9.5f)
            arcTo(7f, 7f, 0f, true, true, 19f, 9.5f)
            curveTo(19f, 12.5f, 17f, 16f, 12f, 21f)
            close()
            moveTo(9.5f, 9.5f)
            arcTo(2.5f, 2.5f, 0f, false, true, 14.5f, 9.5f)
            arcTo(2.5f, 2.5f, 0f, false, true, 9.5f, 9.5f)
            close()
        }
}

private fun locationFavoritesVector(
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
