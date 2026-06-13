// The native Jetpack Compose + Material 3 SecuritySection feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx. The web component renders a
// GlassPanel titled "Security" (Shield header) containing — when a `SecurityEvent` is present — a responsive
// `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` of four <MetricCard>s (Locked [Lock/Unlock], Sentry [Eye],
// Doors [DoorClosed], Windows [Car]); otherwise a friendly "No security data available" empty state. This
// native port keeps that composition and additionally surfaces the cache-then-network states the P3 contract
// mandates (loading / empty / error / stale / offline) by binding the shared vehicles + latest-security +
// live-state feeds (P1/S8) through a [SecuritySectionViewModel]: a four-tile skeleton covers loading, a
// freshness chip + auto-refresh covers stale/offline, a `QueryError` covers a hard failure with no cache, and
// a no-event snapshot still renders the title + empty state (never a blank box). The view performs no HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) — all twelve keys exist and resolve at
// compile time.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecuritySection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitysection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The web `<FadeIn>` entry stagger (160 ms), matching the sibling vehicle-detail sections. */
private const val FADE_DELAY_MS = 160

/** The fixed four-tile footprint (Locked, Sentry, Doors, Windows). */
private const val TILE_COUNT = 4

/** Tailwind `sm` (640px) breakpoint — the web `sm:grid-cols-3` reflow. */
private val GRID_SM_BREAKPOINT: Dp = 640.dp

/** Tailwind `lg` (1024px) breakpoint — the web `lg:grid-cols-4` reflow. */
private val GRID_LG_BREAKPOINT: Dp = 1024.dp

/** Web `grid-cols-2`: two columns below the `sm` breakpoint. */
private const val GRID_COLUMNS_BASE = 2

/** Web `sm:grid-cols-3`: three columns at/above the `sm` breakpoint. */
private const val GRID_COLUMNS_SM = 3

/** Web `lg:grid-cols-4`: four columns at/above the `lg` breakpoint. */
private const val GRID_COLUMNS_LG = 4

/** Loading-tile height, sized to a populated [MetricCard] so the skeleton grid does not jump on load. */
private val TILE_SKELETON_HEIGHT: Dp = 84.dp

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * Stateful entry point. Binds the shared vehicles + latest-security + live-state feeds via [source] into a
 * [SecuritySectionViewModel], resolves the localized [SecuritySectionStrings], records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies [source] (an adapter over the shared S8
 * vehicles data layer) and a unique [instanceKey] per placement; an explicit [vehicleId] pins the tiles to one
 * vehicle (web `state.vehicle_id`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun SecuritySection(
    source: SecuritySectionSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SecuritySectionRegistration.SLUG,
) {
    val viewModel: SecuritySectionViewModel =
        viewModel(key = instanceKey, factory = SecuritySectionViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSecuritySectionStrings()

    SecuritySectionContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always renders the
 * "Security" title inside the GlassPanel (web parity), then the body: a four-tile skeleton while loading, a
 * `QueryError` with retry on a hard failure with no cache, otherwise the four-card grid (or the empty state
 * when no `SecurityEvent` is present). A stale/offline cached snapshot keeps the cards visible with a freshness
 * chip flagged and auto-refreshes.
 */
@Composable
fun SecuritySectionContent(
    state: UiState<SecuritySnapshot>,
    strings: SecuritySectionStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            SecurityHeader(title = strings.title)
            Spacer(modifier = Modifier.height(Spacing.md))
            SecurityBody(state = state, strings = strings, onRefresh = onRefresh)
        }
    }
}

/** The web Shield header (`text-[var(--neon-cyan)]` glyph + bold "Security" title). */
@Composable
private fun SecurityHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.primary,
        )
        SectionTitle(title)
    }
}

@Composable
private fun SecurityBody(
    state: UiState<SecuritySnapshot>,
    strings: SecuritySectionStrings,
    onRefresh: () -> Unit,
) {
    when {
        state.isLoading -> SecurityLoading()
        state.isError && !state.hasData ->
            QueryError(
                kind = queryErrorKindOf(state),
                resourceName = strings.title,
                onRetry = onRefresh,
                modifier = Modifier.fillMaxWidth(),
            )

        else -> SecurityLoaded(state = state, strings = strings)
    }
}

@Composable
private fun SecurityLoaded(
    state: UiState<SecuritySnapshot>,
    strings: SecuritySectionStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.fetchedAt != null || state.refreshing || state.hasError) {
            FreshnessRow(state)
        }
        val snapshot = state.data
        if (snapshot != null && snapshot.hasEvent) {
            val display = remember(snapshot, strings) { SecuritySectionProjection.project(snapshot, strings) }
            SecurityGrid(display = display, strings = strings)
        } else {
            EmptyState(message = strings.noData)
        }
    }
}

/**
 * The responsive tile grid — the native analogue of the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. Picks
 * 2 columns below the `sm` breakpoint, 3 below `lg`, and 4 at/above it, laying the four tiles out as weighted
 * rows so every card shares a uniform width; a short final row is padded with empty weighted slots.
 */
@Composable
private fun SecurityGrid(
    display: SecuritySectionDisplay,
    strings: SecuritySectionStrings,
    modifier: Modifier = Modifier,
) {
    val tiles = remember(display, strings) { securityTiles(display, strings) }
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowTiles.forEach { tile ->
                        MetricCard(
                            label = tile.label,
                            value = tile.value,
                            icon = tile.icon,
                            accent = accentColor(tile.accent),
                            iconContentDescription = null,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The four tiles in the web source order: Locked, Sentry, Doors, Windows — each with its lucide-parity glyph. */
private fun securityTiles(
    display: SecuritySectionDisplay,
    strings: SecuritySectionStrings,
): List<SecurityTileUi> =
    listOf(
        SecurityTileUi(
            label = strings.locked,
            value = display.lockedValue,
            accent = display.lockedAccent,
            icon = if (display.locked) DataDisplayGlyphs.Lock else SecuritySectionGlyphs.Unlock,
        ),
        SecurityTileUi(
            label = strings.sentry,
            value = display.sentryValue,
            accent = display.sentryAccent,
            icon = TeslaGlyphs.Eye,
        ),
        SecurityTileUi(
            label = strings.doors,
            value = display.doorsValue,
            accent = display.doorsAccent,
            icon = SecuritySectionGlyphs.DoorClosed,
        ),
        SecurityTileUi(
            label = strings.windows,
            value = display.windowsValue,
            accent = display.windowsAccent,
            icon = SecuritySectionGlyphs.Car,
        ),
    )

/** One render-ready tile descriptor — label + value + accent + leading glyph for a [MetricCard]. */
private data class SecurityTileUi(
    val label: String,
    val value: String,
    val accent: CardAccent,
    val icon: ImageVector,
)

@Composable
private fun SecurityLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
    ) {
        val columns = columnsFor(maxWidth)
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
private fun FreshnessRow(state: UiState<SecuritySnapshot>) {
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

/** Per-accent foreground color — green (engaged) onto the success token, cyan (neutral) onto the brand primary. */
@Composable
private fun accentColor(accent: CardAccent): Color =
    when (accent) {
        CardAccent.Engaged -> TeslaTokens.status.success
        CardAccent.Neutral -> MaterialTheme.colorScheme.primary
    }

/** Web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`: 2 columns below `sm`, 3 below `lg`, 4 at/above. */
private fun columnsFor(width: Dp): Int =
    when {
        width < GRID_SM_BREAKPOINT -> GRID_COLUMNS_BASE
        width < GRID_LG_BREAKPOINT -> GRID_COLUMNS_SM
        else -> GRID_COLUMNS_LG
    }

/**
 * Resolves the localized [SecuritySectionStrings] from the i18n catalog (P1/S10). All twelve keys exist and
 * resolve at compile time; [SecuritySectionStrings.windowsOpenTemplate] carries the raw `'%1$s open'` pattern
 * the projection interpolates the open-window count into. Remembered against the resolved strings so a locale
 * change re-projects the surface.
 */
@Composable
private fun rememberSecuritySectionStrings(): SecuritySectionStrings {
    val title = stringResource(R.string.translation_vehicles_detail_security)
    val locked = stringResource(R.string.translation_common_locked)
    val yes = stringResource(R.string.translation_common_yes)
    val no = stringResource(R.string.translation_common_no)
    val sentry = stringResource(R.string.translation_common_sentry)
    val active = stringResource(R.string.translation_common_active)
    val off = stringResource(R.string.translation_common_off)
    val doors = stringResource(R.string.translation_vehicles_detail_doors)
    val closed = stringResource(R.string.translation_common_closed)
    val windows = stringResource(R.string.translation_vehicles_detail_windows)
    val windowsOpenTemplate = stringResource(R.string.translation_vehicles_detail_windowsOpen)
    val noData = stringResource(R.string.translation_vehicles_detail_noSecurityData)
    return remember(title, locked, yes, no, sentry, active, off, doors, closed, windows, windowsOpenTemplate, noData) {
        SecuritySectionStrings(
            title = title,
            locked = locked,
            yes = yes,
            no = no,
            sentry = sentry,
            active = active,
            off = off,
            doors = doors,
            closed = closed,
            windows = windows,
            windowsOpenTemplate = windowsOpenTemplate,
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SecuritySectionStrings(
        title = "Security",
        locked = "Locked",
        yes = "Yes",
        no = "No",
        sentry = "Sentry",
        active = "Active",
        off = "Off",
        doors = "Doors",
        closed = "Closed",
        windows = "Windows",
        windowsOpenTemplate = "%1\$s open",
        noData = "No security data available",
    )

private fun previewSecurity(): JsonObject =
    buildJsonObject {
        put("door_state", "df_closed")
        put("fd_window", true)
        put("fp_window", "closed")
    }

private fun previewState(): VehicleState =
    VehicleState(
        batteryLevel = 80,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = 0.0,
        insideTemp = 21.0,
        isCharging = false,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 15.0,
        power = 0.0,
        ratedRange = 0.0,
        sentryMode = true,
        softwareVersion = "2025.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )

private fun previewSnapshot(): SecuritySnapshot = SecuritySnapshot(security = previewSecurity(), state = previewState())

@Preview(name = "Content — readings", showBackground = true)
@Composable
private fun SecurityContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content — wide (4-col)", showBackground = true, widthDp = 1080)
@Composable
private fun SecurityWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no data", showBackground = true)
@Composable
private fun SecurityEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(
            state = UiState(phase = UiPhase.Empty, data = SecuritySnapshot.EMPTY, fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading — skeleton", showBackground = true)
@Composable
private fun SecurityLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(state = UiState.loading(), strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun SecurityErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline — cached", showBackground = true)
@Composable
private fun SecurityOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecuritySectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = PREVIEW_STRINGS,
        )
    }
}
