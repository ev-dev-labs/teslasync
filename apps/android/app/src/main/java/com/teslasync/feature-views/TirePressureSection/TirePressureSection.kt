// The native Jetpack Compose + Material 3 TirePressureSection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx. The web component takes a
// `TirePressureSnapshot` prop and renders a `GlassPanel` titled "Tire Pressure" (CircleDot icon) containing,
// when the snapshot is present, a responsive grid of four per-corner tiles (Front Left / Front Right / Rear Left
// / Rear Right); each tile is a nested `GlassPanel` showing the corner's localized label, the formatted current
// pressure, and a status `Badge` (Normal / Low / Critical / No Data). When the snapshot is null it renders a
// friendly "No tire pressure data available" empty state. This native port keeps that exact composition and
// additionally surfaces the cache-then-network states the P3 contract mandates (loading / empty / error / stale /
// offline) by binding the shared latest-tire-pressure feed (P1/S8) through a [TirePressureSectionViewModel]: the
// title always renders, a skeleton covers the first load, a `QueryError` covers a hard failure with no cache, a
// freshness chip + auto-refresh covers stale/offline, and an absent snapshot still renders the titled panel with
// the empty state (never a blank box). The view performs no HTTP. Pressures are Pa→kPa→display converted at this
// render boundary via the shared [UnitFormatter] (web `useUnits()`); every visible string resolves through the
// i18n catalog (P1/S10); and every tile carries a merged TalkBack label.
//
// The native icon uses the sanctioned [DataDisplayGlyphs.Gauge] tire glyph (the sibling TirePressurePanel's
// mapping for the same domain); the web `CircleDot` is decorative (`contentDescription = null`), so semantic
// parity is preserved through the title text. The tile value uses the neutral [MetricValue] role (web
// `text-[var(--text-primary)]`); the band color lives only in the `Badge`, exactly as the web tile does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TirePressureSection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The entry stagger (50 ms), matching the sibling telemetry panels' `<FadeIn>`. */
private const val FADE_DELAY_MS: Int = 50

private val SKELETON_TILE_HEIGHT: Dp = 92.dp
private const val SKELETON_TILE_ROWS: Int = 2

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `TirePressureSection({ tireData })`. Binds the shared
 * latest-tire-pressure feed via [source] into a [TirePressureSectionViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), resolves the live display-[UnitFormatter] (web `useUnits()`, P1/S8) and the
 * localized [TirePressureSectionStrings] (P1/S10), and renders. A host supplies the selected [vehicleId] (the web
 * prop's source); a `null`/non-positive id falls back to the first enrolled vehicle and, when none resolves,
 * renders the empty state.
 */
@Composable
fun TirePressureSection(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: TirePressureSectionSource = LocalDataContainer.current.vehiclesStore.asTirePressureSectionSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TIRE_PRESSURE_SECTION_SLUG,
) {
    val viewModel: TirePressureSectionViewModel =
        viewModel(key = instanceKey, factory = TirePressureSectionViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val strings = rememberTirePressureSectionStrings()

    TirePressureSectionContent(
        state = state,
        formatter = formatter,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the `vehicles.detail.*` /
 * `common.*` keys the web component reads via `t(...)`. Every key exists in the catalog, so all resolve at
 * compile time.
 */
@Composable
fun rememberTirePressureSectionStrings(): TirePressureSectionStrings =
    TirePressureSectionStrings(
        title = stringResource(R.string.translation_vehicles_detail_tirePressure),
        frontLeft = stringResource(R.string.translation_vehicles_detail_tireFl),
        frontRight = stringResource(R.string.translation_vehicles_detail_tireFr),
        rearLeft = stringResource(R.string.translation_vehicles_detail_tireRl),
        rearRight = stringResource(R.string.translation_vehicles_detail_tireRr),
        normal = stringResource(R.string.translation_common_normal),
        low = stringResource(R.string.translation_common_low),
        critical = stringResource(R.string.translation_common_critical),
        noData = stringResource(R.string.translation_common_noData),
        noTireData = stringResource(R.string.translation_vehicles_detail_noTireData),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel` +
 * gauge "Tire Pressure" title always render; then the skeleton body while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the full tile grid when a snapshot is present (web
 * `tireData` truthy), or the friendly empty state otherwise. A stale/offline cached snapshot keeps its body
 * visible with a freshness chip flagged and auto-refreshes. No surface is ever blank.
 */
@Composable
fun TirePressureSectionContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    strings: TirePressureSectionStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            TirePressureSectionHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                state.isLoading -> TirePressureSectionLoadingBody()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> TirePressureSectionLoaded(snapshot = state.data, formatter = formatter, strings = strings)
            }
        }
    }
}

/** The web header `<div className="flex items-center gap-2">` — gauge glyph + title, with a freshness chip once a fetch has run. */
@Composable
private fun TirePressureSectionHeader(
    title: String,
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
        Spacer(modifier = Modifier.weight(1f))
        if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberRelativeAgeFormatter(),
            )
        }
    }
}

/** The loaded branch: the full four-corner tile grid (web `tireData` truthy) or the friendly empty state. */
@Composable
private fun TirePressureSectionLoaded(
    snapshot: JsonElement?,
    formatter: UnitFormatter,
    strings: TirePressureSectionStrings,
    modifier: Modifier = Modifier,
) {
    val display =
        remember(snapshot, formatter, strings) {
            TirePressureSectionProjection.project(snapshot, formatter, strings)
        }
    if (!display.hasData) {
        EmptyState(message = strings.noTireData, icon = DataDisplayGlyphs.Gauge, modifier = modifier.fillMaxWidth())
        return
    }
    TireCornerTileGrid(tiles = display.tiles, modifier = modifier)
}

/** Web `grid grid-cols-2 sm:grid-cols-4` — the four per-corner tiles laid out as two rows of two. */
@Composable
private fun TireCornerTileGrid(
    tiles: List<TireCornerTile>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            tiles.getOrNull(0)?.let { TireCornerTileView(tile = it, modifier = Modifier.weight(1f)) }
            tiles.getOrNull(1)?.let { TireCornerTileView(tile = it, modifier = Modifier.weight(1f)) }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            tiles.getOrNull(2)?.let { TireCornerTileView(tile = it, modifier = Modifier.weight(1f)) }
            tiles.getOrNull(3)?.let { TireCornerTileView(tile = it, modifier = Modifier.weight(1f)) }
        }
    }
}

/**
 * A single corner tile — the web `<GlassPanel className="p-4 text-center">` cell with a muted label, a bold
 * neutral value, and a status `Badge`. The whole tile is one merged TalkBack node (label + value + status).
 */
@Composable
private fun TireCornerTileView(
    tile: TireCornerTile,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = tile.contentDescription },
        padding = PanelPadding.Md,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricLabel(tile.label)
            MetricValue(tile.valueText)
            Badge(text = tile.statusText, variant = badgeVariantOf(tile.tone))
        }
    }
}

/** The first-load skeleton body — two rows of two tile blocks (the grid the content fills). */
@Composable
private fun TirePressureSectionLoadingBody(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_TILE_ROWS) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
            }
        }
    }
}

/** Maps the web `tirePressureVariant` tone onto the shared [Badge] variant. */
private fun badgeVariantOf(tone: TireBadgeTone): BadgeVariant =
    when (tone) {
        TireBadgeTone.Success -> BadgeVariant.Success
        TireBadgeTone.Warning -> BadgeVariant.Warning
        TireBadgeTone.Danger -> BadgeVariant.Danger
        TireBadgeTone.Neutral -> BadgeVariant.Neutral
    }

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through (P1/S10
 * `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

// ── Previews — one per rendered state (content / empty / loading / error / offline). ───────────────────────

private val PREVIEW_STRINGS =
    TirePressureSectionStrings(
        title = "Tire Pressure",
        frontLeft = "Front Left",
        frontRight = "Front Right",
        rearLeft = "Rear Left",
        rearRight = "Rear Right",
        normal = "Normal",
        low = "Low",
        critical = "Critical",
        noData = "No Data",
        noTireData = "No tire pressure data available",
    )

/** A mixed snapshot: FL normal, FR soft-low, RL critical, RR absent → one of each badge state. */
private fun previewMixedTires(): JsonElement =
    buildJsonObject {
        put("front_left", 250_000.0)
        put("front_right", 230_000.0)
        put("rear_left", 180_000.0)
    }

@Preview(name = "Tire section · content", showBackground = true, widthDp = 420)
@Composable
private fun TirePressureSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(phase = UiPhase.Content, data = previewMixedTires(), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire section · empty", showBackground = true, widthDp = 420)
@Composable
private fun TirePressureSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(phase = UiPhase.Empty, data = null, fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire section · loading", showBackground = true, widthDp = 420)
@Composable
private fun TirePressureSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire section · error", showBackground = true, widthDp = 420)
@Composable
private fun TirePressureSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire section · offline", showBackground = true, widthDp = 420)
@Composable
private fun TirePressureSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressureSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewMixedTires(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}
