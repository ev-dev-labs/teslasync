// The native Jetpack Compose + Material 3 AutopilotSection feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx. The web component binds three
// per-vehicle reads and renders a GlassPanel titled "Autopilot & Cruise" containing — when any reading is
// present — a responsive `grid-cols-1 sm:grid-cols-3` of three <StatCard>s (Current Speed [Gauge], Cruise Set
// Speed [Navigation], Follow Distance [Navigation, no unit]); otherwise a friendly EmptyState. This native
// port keeps that composition and additionally surfaces the cache-then-network states the P3 contract mandates
// (loading / empty / error / stale / offline) by binding the shared vehicles + telemetry feeds (P1/S8) through
// an [AutopilotSectionViewModel]: a three-tile skeleton covers loading, a freshness chip + auto-refresh covers
// stale/offline, a `QueryError` covers a hard failure with no cache, and an all-empty snapshot still renders
// the title + empty state (never a blank box). The view performs no HTTP. Every visible string resolves
// through the i18n catalog (P1/S10) — the four `dynamics.*` labels at compile time and the catalog-absent
// `dynamics.autopilotNoData` via the by-name `t(key, default)` facade.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutopilotSection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.autopilotsection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
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
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** The web `<FadeIn delay={0.17}>` entry stagger (170 ms). */
private const val FADE_DELAY_MS = 170

/** The fixed three-tile footprint (Current Speed, Cruise Set Speed, Follow Distance). */
private const val TILE_COUNT = 3

/** Tailwind `sm` (640px) breakpoint — the web `grid-cols-1 sm:grid-cols-3` reflow (1 column below, 3 at/above). */
private val GRID_SM_BREAKPOINT: Dp = 640.dp

/** The single-column tile count below the `sm` breakpoint. */
private const val GRID_COLUMNS_BASE = 1

/** The three-column tile count at/above the `sm` breakpoint. */
private const val GRID_COLUMNS_SM = 3

/** Loading-tile height, sized to a populated [StatCard] so the skeleton grid does not jump on load. */
private val TILE_SKELETON_HEIGHT: Dp = 96.dp

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

private const val DEFAULT_LOCALE_TAG = "en-US"

/**
 * The localized microcopy this surface renders — resolved once at the Compose boundary so the projection +
 * layout stay framework-free. The four labels come from the i18n catalog (P1/S10); [noData] falls back to the
 * native English default when the catalog has no `dynamics.autopilotNoData` key (web `t(key, default)`).
 */
data class AutopilotSectionStrings(
    val title: String,
    val currentSpeed: String,
    val cruiseSetSpeed: String,
    val followDistance: String,
    val noData: String,
)

/**
 * Stateful entry point. Binds the shared vehicles + telemetry feeds via [source] into an
 * [AutopilotSectionViewModel], reads the live unit preference from the shared S8 SettingsStore (the native
 * binding of the web `useUnits` hook; metric defaults apply until settings load), resolves the localized
 * [AutopilotSectionStrings], records the one-shot `view.opened` diagnostic, and renders the surface. A host
 * supplies [source] (an adapter over the shared S8 vehicles + telemetry data layer) and a unique [instanceKey]
 * per placement; an explicit [vehicleId] pins the tiles to one vehicle (web `vehicleId` prop), otherwise the
 * first enrolled vehicle is used.
 */
@Composable
fun AutopilotSection(
    source: AutopilotSectionSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    instanceKey: String = AutopilotSectionRegistration.SLUG,
) {
    val viewModel: AutopilotSectionViewModel =
        viewModel(key = instanceKey, factory = AutopilotSectionViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val settingsResource by settings.collectAsStateWithLifecycle()
    val units = remember(settingsResource.cached) { UnitPreferences.fromSettings(settingsResource.cached) }
    val strings = rememberAutopilotSectionStrings()

    AutopilotSectionContent(
        state = state,
        units = units,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always renders the
 * "Autopilot & Cruise" title inside the GlassPanel (web parity), then the body: a three-tile skeleton while
 * loading, a `QueryError` with retry on a hard failure with no cache, otherwise the three-card grid (or the
 * empty state when no reading is present). A stale/offline cached snapshot keeps the cards visible with a
 * freshness chip flagged and auto-refreshes (web's 5s poll).
 */
@Composable
fun AutopilotSectionContent(
    state: UiState<AutopilotSnapshot>,
    units: UnitPref,
    strings: AutopilotSectionStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            SectionTitle(strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            AutopilotBody(state = state, units = units, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun AutopilotBody(
    state: UiState<AutopilotSnapshot>,
    units: UnitPref,
    strings: AutopilotSectionStrings,
    onRefresh: () -> Unit,
) {
    when {
        state.isLoading -> AutopilotLoading()
        state.isError && !state.hasData ->
            QueryError(
                kind = queryErrorKindOf(state),
                resourceName = strings.title,
                onRetry = onRefresh,
                modifier = Modifier.fillMaxWidth(),
            )

        else -> AutopilotLoaded(state = state, units = units, strings = strings)
    }
}

@Composable
private fun AutopilotLoaded(
    state: UiState<AutopilotSnapshot>,
    units: UnitPref,
    strings: AutopilotSectionStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.fetchedAt != null || state.refreshing || state.hasError) {
            FreshnessRow(state)
        }
        val snapshot = state.data
        if (snapshot != null && snapshot.hasAny) {
            val locale = remember(units.locale) { localeOf(units.locale) }
            val display = remember(snapshot, units, locale) { AutopilotSectionProjection.project(snapshot, units, locale) }
            AutopilotGrid(display = display, strings = strings)
        } else {
            EmptyState(message = strings.noData)
        }
    }
}

/**
 * The responsive tile grid — the native analogue of the web `grid-cols-1 sm:grid-cols-3`. Picks 1 column below
 * the `sm` breakpoint and 3 at/above it, laying the three tiles out as weighted rows so every card shares a
 * uniform width; a short final row is padded with empty weighted slots to keep the card sizing.
 */
@Composable
private fun AutopilotGrid(
    display: AutopilotDisplay,
    strings: AutopilotSectionStrings,
    modifier: Modifier = Modifier,
) {
    val tiles = autopilotTiles(display, strings)
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_BREAKPOINT) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowTiles.forEach { tile ->
                        StatCard(
                            label = tile.label,
                            value = tile.value,
                            unit = tile.unit,
                            icon = tile.icon,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The three tiles in the web source order: Current Speed (Gauge), Cruise Set Speed + Follow Distance (Navigation). */
private fun autopilotTiles(
    display: AutopilotDisplay,
    strings: AutopilotSectionStrings,
): List<AutopilotTileUi> =
    listOf(
        AutopilotTileUi(
            label = strings.currentSpeed,
            value = display.currentSpeedValue,
            unit = display.speedUnit,
            icon = DataDisplayGlyphs.Gauge,
        ),
        AutopilotTileUi(
            label = strings.cruiseSetSpeed,
            value = display.cruiseSetValue,
            unit = display.speedUnit,
            icon = AutopilotSectionGlyphs.Navigation,
        ),
        AutopilotTileUi(
            label = strings.followDistance,
            value = display.followDistanceValue,
            unit = null,
            icon = AutopilotSectionGlyphs.Navigation,
        ),
    )

/** One render-ready tile descriptor — label + value + optional unit + leading glyph for a [StatCard]. */
private data class AutopilotTileUi(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: ImageVector,
)

@Composable
private fun AutopilotLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
    ) {
        val columns = if (maxWidth >= GRID_SM_BREAKPOINT) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            List(TILE_COUNT) { it }.chunked(columns).forEach { rowCells ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowCells.forEach { _ ->
                        Skeleton(modifier = Modifier.weight(1f), height = TILE_SKELETON_HEIGHT, rounded = true)
                    }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun FreshnessRow(state: UiState<AutopilotSnapshot>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * Resolves the localized [AutopilotSectionStrings] from the i18n catalog (P1/S10). The four `dynamics.*`
 * labels resolve at compile time; the catalog-absent `dynamics.autopilotNoData` is read by-name and falls
 * back to [AutopilotSectionDefaults.NO_DATA], reproducing i18next's `t(key, default)`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberAutopilotSectionStrings(): AutopilotSectionStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_dynamics_autopilot)
    val currentSpeed = stringResource(R.string.translation_dynamics_currentSpeed)
    val cruiseSetSpeed = stringResource(R.string.translation_dynamics_cruiseSetSpeed)
    val followDistance = stringResource(R.string.translation_dynamics_followDistance)
    val noData = resolveOptional({ context.optionalString(it) }, KEY_NO_DATA, AutopilotSectionDefaults.NO_DATA)
    return remember(title, currentSpeed, cruiseSetSpeed, followDistance, noData) {
        AutopilotSectionStrings(
            title = title,
            currentSpeed = currentSpeed,
            cruiseSetSpeed = cruiseSetSpeed,
            followDistance = followDistance,
            noData = noData,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

/** Resolves the BCP-47 [tag] to a [Locale], falling back to en-US for a blank/absent tag (web display contract). */
private fun localeOf(tag: String?): Locale {
    val resolved = tag?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG
    return Locale.forLanguageTag(resolved)
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    AutopilotSectionStrings(
        title = "Autopilot & Cruise",
        currentSpeed = "Current Speed",
        cruiseSetSpeed = "Cruise Set Speed",
        followDistance = "Follow Distance",
        noData = "No cruise / autopilot telemetry received yet",
    )

private val PREVIEW_UNITS: UnitPref = UnitPreferences.fromSettings(null)

private fun previewSnapshot(): AutopilotSnapshot =
    AutopilotSnapshot(speedMps = 29.06, cruiseSetMps = 31.29, followDistanceRaw = "FollowDistance7")

@Preview(name = "Content — readings", showBackground = true)
@Composable
private fun AutopilotContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            units = PREVIEW_UNITS,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — wide (3-col)", showBackground = true, widthDp = 720)
@Composable
private fun AutopilotWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            units = PREVIEW_UNITS,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no data", showBackground = true)
@Composable
private fun AutopilotEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(
            state = UiState(phase = UiPhase.Empty, data = AutopilotSnapshot(), fetchedAt = 1L),
            units = PREVIEW_UNITS,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading — skeleton", showBackground = true)
@Composable
private fun AutopilotLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(state = UiState.loading(), units = PREVIEW_UNITS, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun AutopilotErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            units = PREVIEW_UNITS,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline — cached + stale", showBackground = true)
@Composable
private fun AutopilotOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutopilotSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            units = PREVIEW_UNITS,
            strings = PREVIEW_STRINGS,
        )
    }
}
