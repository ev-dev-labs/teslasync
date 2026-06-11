// The native Jetpack Compose + Material 3 SecurityStatistics feature view — a parity port of
// web/src/features/admin/components/security-access/SecurityStatistics.tsx. The web component is purely
// presentational: its parent (the security & access admin page) computes the `SecurityStats` and the
// `sentryUptime` percentage from the vehicle's security-event history and passes them down with an
// `isLoading` flag. The component renders a titled `GlassPanel` holding either a seven-tile skeleton grid
// (loading), a seven `MetricCard` grid (lock/unlock, sentry uptime, door opens, window opens, HomeLink,
// guest mode, total), or a friendly `EmptyState` when the stats are missing.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). The host supplies the snapshot
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the
// security feed), so this feature view also renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline (cached "last known") — without ever fetching.
// The loading + content + empty branches reproduce the web component exactly. A web-parity overload that
// takes the raw `(securityStats, sentryUptime, isLoading)` props is also provided for hosts that already
// hold the computed stats.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityStatistics — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatistics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web `<FadeIn delay={0.25}>` — the panel's staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 250

/** Web `Array.from({ length: 7 })` — the seven loading skeleton tiles. */
private const val SKELETON_TILE_COUNT = 7

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

private val SKELETON_TILE_HEIGHT = 80.dp

// Responsive column counts, mirroring the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` and aligned to
// the Material window-size-class width breakpoints (compact < 600dp, medium < 840dp, expanded ≥ 840dp).
private val GRID_MEDIUM_MIN = 600.dp
private val GRID_EXPANDED_MIN = 840.dp
private const val GRID_COLS_COMPACT = 2
private const val GRID_COLS_MEDIUM = 3
private const val GRID_COLS_EXPANDED = 4

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the panel free of any English literal.
 */
data class SecurityStatisticsStrings(
    val title: String,
    val lockEvents: String,
    val sentryUptime: String,
    val doorOpens: String,
    val windowOpens: String,
    val homelink: String,
    val guestMode: String,
    val totalEvents: String,
    val noData: String,
)

/**
 * Stateful entry point for the security statistics panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared security feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [SecurityStatsSnapshot] (stats + sentry uptime).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SecurityStatistics(
    state: UiState<SecurityStatsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSecurityStatisticsOpened(logger) }
    SecurityStatisticsContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ securityStats, sentryUptime, isLoading })` props,
 * for hosts that already hold the computed stats. Projects them onto a [UiState] via
 * [SecurityStatisticsProjection.projectUiState] (loading / content / empty, with the web ternary
 * precedence) and delegates to the stateful entry, which records `view.opened`. There is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun SecurityStatistics(
    securityStats: SecurityStats?,
    sentryUptime: Double,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(securityStats, sentryUptime, isLoading) {
            val snapshot = securityStats?.let { SecurityStatsSnapshot(it, sentryUptime) }
            SecurityStatisticsProjection.projectUiState(snapshot, isLoading)
        }
    SecurityStatistics(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's loading/content/empty branches (a seven-tile skeleton grid, the seven `MetricCard` grid, or
 * an [EmptyState]) and adds the lifecycle chrome the host's feed implies: a hard-error retry surface and a
 * freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [locale] formats each tile value (web `fmtInt`).
 */
@Composable
fun SecurityStatisticsContent(
    state: UiState<SecurityStatsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SecurityStatisticsStrings = rememberSecurityStatisticsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            SectionTitle(strings.title, modifier = Modifier.padding(bottom = Spacing.md))
            when {
                state.isLoading -> SecurityStatisticsSkeletonGrid()
                state.isError -> SecurityStatisticsError(onRetry = onRetry)
                state.isEmpty || snapshot == null -> SecurityStatisticsEmpty(message = strings.noData)
                else -> SecurityStatisticsLoaded(snapshot = snapshot, state = state, locale = locale, strings = strings)
            }
        }
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the seven
 * `MetricCard` tiles. Split out so the freshness chrome the host's feed implies sits next to the web grid
 * without complicating the [SecurityStatisticsContent] branch ladder.
 */
@Composable
private fun SecurityStatisticsLoaded(
    snapshot: SecurityStatsSnapshot,
    state: UiState<SecurityStatsSnapshot>,
    locale: Locale,
    strings: SecurityStatisticsStrings,
) {
    val formatAge = rememberSecurityFreshnessFormatter()
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = formatAge,
            )
        }
    }
    val values = remember(snapshot, locale) { SecurityStatisticsProjection.metricValues(snapshot, locale) }
    SecurityGrid(itemCount = values.size) { index ->
        val item = values[index]
        MetricCard(
            label = strings.label(item.metric),
            value = item.value,
            modifier = Modifier.weight(1f),
            icon = item.metric.glyph(),
            accent = item.metric.accent(),
        )
    }
}

/** The web loading branch: seven shimmering tiles laid out in the same responsive grid as the cards. */
@Composable
private fun SecurityStatisticsSkeletonGrid() {
    SecurityGrid(itemCount = SKELETON_TILE_COUNT) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
}

/**
 * Empty state — web parity: the `common.noData` message with a pulse glyph (web `<Activity>`), so the panel
 * never collapses to a blank box. [EmptyState] exposes the message as its accessibility label so the
 * section is still announced when it holds no data.
 */
@Composable
private fun SecurityStatisticsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = SecurityStatisticsGlyphs.Activity,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SecurityStatisticsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A responsive grid of [itemCount] equal-width cells — the native analogue of the web
 * `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`. The column count tracks the available width via
 * Material window-size breakpoints; the trailing cells of a short final row are filled with weighted
 * spacers so every tile keeps a uniform width. [tile] receives the cell index and applies `weight(1f)`.
 */
@Composable
private fun SecurityGrid(
    itemCount: Int,
    tile: @Composable RowScope.(Int) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth < GRID_MEDIUM_MIN -> GRID_COLS_COMPACT
                maxWidth < GRID_EXPANDED_MIN -> GRID_COLS_MEDIUM
                else -> GRID_COLS_EXPANDED
            }
        val rowCount = (itemCount + columns - 1) / columns
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            for (rowIndex in 0 until rowCount) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    for (column in 0 until columns) {
                        val index = rowIndex * columns + column
                        if (index < itemCount) tile(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Builds the localized [SecurityStatisticsStrings] from the i18n catalog (P1/S10): the `admin.security.*`
 * and `common.noData` keys the web component reads through `useTranslation`. Resolved once at the Compose
 * boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberSecurityStatisticsStrings(): SecurityStatisticsStrings {
    val title = stringResource(R.string.translation_admin_security_statsTitle)
    val lockEvents = stringResource(R.string.translation_admin_security_stats_lockEvents)
    val sentryUptime = stringResource(R.string.translation_admin_security_stats_sentryUptime)
    val doorOpens = stringResource(R.string.translation_admin_security_stats_doorOpens)
    val windowOpens = stringResource(R.string.translation_admin_security_stats_windowOpens)
    val homelink = stringResource(R.string.translation_admin_security_stats_homelink)
    val guestMode = stringResource(R.string.translation_admin_security_stats_guestMode)
    val totalEvents = stringResource(R.string.translation_admin_security_stats_totalEvents)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(title, lockEvents, sentryUptime, doorOpens, windowOpens, homelink, guestMode, totalEvents, noData) {
        SecurityStatisticsStrings(
            title = title,
            lockEvents = lockEvents,
            sentryUptime = sentryUptime,
            doorOpens = doorOpens,
            windowOpens = windowOpens,
            homelink = homelink,
            guestMode = guestMode,
            totalEvents = totalEvents,
            noData = noData,
        )
    }
}

/** Resolves a tile's already-localized label from the bundled strings. */
private fun SecurityStatisticsStrings.label(metric: SecurityMetric): String =
    when (metric) {
        SecurityMetric.LockEvents -> lockEvents
        SecurityMetric.SentryUptime -> sentryUptime
        SecurityMetric.DoorOpens -> doorOpens
        SecurityMetric.WindowOpens -> windowOpens
        SecurityMetric.Homelink -> homelink
        SecurityMetric.GuestMode -> guestMode
        SecurityMetric.TotalEvents -> totalEvents
    }

/**
 * The tile accent — the native mirror of the web `MetricCard` `color` prop. Maps the web neon palette onto
 * the theme-invariant chart tokens by the same convention the sibling widgets use: green→battery,
 * blue→speed, amber→energy, purple→power, cyan→regen.
 */
private fun SecurityMetric.accent(): Color =
    when (this) {
        SecurityMetric.LockEvents -> TeslaTokens.chart.battery
        SecurityMetric.SentryUptime -> TeslaTokens.chart.speed
        SecurityMetric.DoorOpens -> TeslaTokens.chart.energy
        SecurityMetric.WindowOpens -> TeslaTokens.chart.energy
        SecurityMetric.Homelink -> TeslaTokens.chart.power
        SecurityMetric.GuestMode -> TeslaTokens.chart.energy
        SecurityMetric.TotalEvents -> TeslaTokens.chart.regen
    }

/** Resolves a tile's line glyph — the native analogue of the web lucide icon for that metric. */
private fun SecurityMetric.glyph(): ImageVector =
    when (this) {
        SecurityMetric.LockEvents -> SecurityStatisticsGlyphs.Lock
        SecurityMetric.SentryUptime -> SecurityStatisticsGlyphs.Eye
        SecurityMetric.DoorOpens -> SecurityStatisticsGlyphs.DoorOpen
        SecurityMetric.WindowOpens -> SecurityStatisticsGlyphs.Car
        SecurityMetric.Homelink -> SecurityStatisticsGlyphs.Home
        SecurityMetric.GuestMode -> SecurityStatisticsGlyphs.UserCheck
        SecurityMetric.TotalEvents -> SecurityStatisticsGlyphs.Activity
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSecurityFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time
 * by the [MetricCard] accent — the same approach as the sibling EnergyStatsWidget glyphs.
 */
private object SecurityStatisticsGlyphs {
    /** lucide `lock` — a shackle arch over a body (Lock/Unlock Events tile). */
    val Lock: ImageVector =
        securityVector("SecurityStatisticsLock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 21f)
            lineTo(5f, 21f)
            close()
            moveTo(7.5f, 11f)
            lineTo(7.5f, 7.5f)
            curveTo(7.5f, 4.5f, 9.5f, 3f, 12f, 3f)
            curveTo(14.5f, 3f, 16.5f, 4.5f, 16.5f, 7.5f)
            lineTo(16.5f, 11f)
        }

    /** lucide `eye` — an almond outline with a pupil (Sentry Uptime tile). */
    val Eye: ImageVector =
        securityVector("SecurityStatisticsEye") {
            moveTo(2f, 12f)
            curveTo(4.5f, 7f, 8f, 5f, 12f, 5f)
            curveTo(16f, 5f, 19.5f, 7f, 22f, 12f)
            curveTo(19.5f, 17f, 16f, 19f, 12f, 19f)
            curveTo(8f, 19f, 4.5f, 17f, 2f, 12f)
            close()
            moveTo(15f, 12f)
            curveTo(15f, 13.66f, 13.66f, 15f, 12f, 15f)
            curveTo(10.34f, 15f, 9f, 13.66f, 9f, 12f)
            curveTo(9f, 10.34f, 10.34f, 9f, 12f, 9f)
            curveTo(13.66f, 9f, 15f, 10.34f, 15f, 12f)
            close()
        }

    /** lucide `door-open` — a leaning door leaf, floor, and frame post (Door Open Events tile). */
    val DoorOpen: ImageVector =
        securityVector("SecurityStatisticsDoorOpen") {
            moveTo(4f, 21f)
            lineTo(4f, 4f)
            lineTo(14f, 2f)
            lineTo(14f, 21f)
            moveTo(2f, 21f)
            lineTo(22f, 21f)
            moveTo(18f, 21f)
            lineTo(18f, 7f)
            lineTo(14f, 7f)
            moveTo(11f, 12f)
            lineTo(11.2f, 12f)
        }

    /** lucide `car` — a cabin, body, and two wheels (Window Open Events tile, matching the web `Car`). */
    val Car: ImageVector =
        securityVector("SecurityStatisticsCar") {
            moveTo(5f, 12f)
            lineTo(6.5f, 7.5f)
            lineTo(17.5f, 7.5f)
            lineTo(19f, 12f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(9.5f, 16.5f)
            curveTo(9.5f, 17.33f, 8.83f, 18f, 8f, 18f)
            curveTo(7.17f, 18f, 6.5f, 17.33f, 6.5f, 16.5f)
            curveTo(6.5f, 15.67f, 7.17f, 15f, 8f, 15f)
            curveTo(8.83f, 15f, 9.5f, 15.67f, 9.5f, 16.5f)
            close()
            moveTo(17.5f, 16.5f)
            curveTo(17.5f, 17.33f, 16.83f, 18f, 16f, 18f)
            curveTo(15.17f, 18f, 14.5f, 17.33f, 14.5f, 16.5f)
            curveTo(14.5f, 15.67f, 15.17f, 15f, 16f, 15f)
            curveTo(16.83f, 15f, 17.5f, 15.67f, 17.5f, 16.5f)
            close()
        }

    /** lucide `home` — a roof, body, and door (HomeLink Detections tile). */
    val Home: ImageVector =
        securityVector("SecurityStatisticsHome") {
            moveTo(3f, 11f)
            lineTo(12f, 3f)
            lineTo(21f, 11f)
            moveTo(5f, 9.5f)
            lineTo(5f, 21f)
            lineTo(19f, 21f)
            lineTo(19f, 9.5f)
            moveTo(10f, 21f)
            lineTo(10f, 15f)
            lineTo(14f, 15f)
            lineTo(14f, 21f)
        }

    /** lucide `user-check` — a person with a check mark (Guest Mode Usage tile). */
    val UserCheck: ImageVector =
        securityVector("SecurityStatisticsUserCheck") {
            moveTo(12f, 8f)
            curveTo(12f, 9.66f, 10.66f, 11f, 9f, 11f)
            curveTo(7.34f, 11f, 6f, 9.66f, 6f, 8f)
            curveTo(6f, 6.34f, 7.34f, 5f, 9f, 5f)
            curveTo(10.66f, 5f, 12f, 6.34f, 12f, 8f)
            close()
            moveTo(3f, 20f)
            curveTo(3f, 16.5f, 5.7f, 14f, 9f, 14f)
            curveTo(11f, 14f, 12.8f, 15f, 14f, 16.5f)
            moveTo(16f, 11f)
            lineTo(18f, 13f)
            lineTo(22f, 9f)
        }

    /** lucide `activity` — the ECG pulse line (Total Events tile + empty-state glyph). */
    val Activity: ImageVector =
        securityVector("SecurityStatisticsActivity") {
            moveTo(2f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(22f, 12f)
        }
}

private fun securityVector(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SecurityStatisticsStrings(
        title = "Security Statistics",
        lockEvents = "Lock/Unlock Events",
        sentryUptime = "Sentry Uptime",
        doorOpens = "Door Open Events",
        windowOpens = "Window Open Events",
        homelink = "HomeLink Detections",
        guestMode = "Guest Mode Usage",
        totalEvents = "Total Events",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    SecurityStatsSnapshot(
        stats =
            SecurityStats(
                lockEvents = 42,
                doorOpenCount = 8,
                windowOpenCount = 3,
                homelinkCount = 17,
                guestCount = 2,
                total = 128,
            ),
        sentryUptimePct = 87.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun SecurityStatisticsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatisticsContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SecurityStatisticsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatisticsContent(state = UiState.loading(), onRetry = {}, locale = Locale.US, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SecurityStatisticsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatisticsContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SecurityStatisticsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatisticsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun SecurityStatisticsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatisticsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
