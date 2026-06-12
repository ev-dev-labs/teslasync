// The native Jetpack Compose + Material 3 SummaryStats feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/SummaryStats.tsx. The web component renders a
// `<FadeIn delay={0.4}>` around a `<StaggerContainer>` whose responsive `grid-cols-2 md:grid-cols-3
// lg:grid-cols-6` grid holds six `<StatCard>` tiles (Total Readings, Avg Torque, Peak Power, Peak Regen,
// Avg Power, Avg Motor Temp), each tile a labelled KPI card with a leading lucide icon and a bold value.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and the owning page's `useUnits`, mapped to
// the live S8 SettingsStore for the temperature unit + locale that back the web `toTemperatureDisplay` /
// `tempUnit` props). The owning DrivingDynamicsPage computes the cross-section `motorStats` and threads them
// in through the shared state-holder layer as a [UiState], so this feature view renders every lifecycle state
// that layer can carry — a loading skeleton grid, a hard error with retry, a friendly empty state (the web
// `motorStats === null` no-readings case), content, and stale/offline cached "last known" with a freshness
// chip + auto-refresh — without ever fetching, exactly like the sibling CostSummaryCards / DriveStatCards
// card-grid ports. The content branch reproduces the web tile grid verbatim (the `<FadeIn>` entrance and the
// `<StaggerContainer>`/`<StaggerItem>` cascade included) on the shared `StatCard`, the native counterpart of
// the web `data-display/StatCard`. A web-parity overload taking the raw `motorStats` prop (web
// `motorStats: MotorStats | null`) is provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummaryStats — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the tiles lay out six-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `md` breakpoint (768px): at or above this width the tiles lay out three-per-row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web base `grid-cols-2`: below the `md` breakpoint the tiles lay out two-per-row. */
private const val GRID_COLUMNS_LG = 6
private const val GRID_COLUMNS_MD = 3
private const val GRID_COLUMNS_BASE = 2

/** Loading tiles shown while the host's feed first loads — the full six-tile grid as skeletons. */
private const val SKELETON_TILE_COUNT = 6

/** Web `<FadeIn delay={0.4}>` — the resolved grid fades in 400ms after mount. */
private const val FADE_IN_DELAY_MS = 400

/** Blank value slot for the loading tiles (web `StatCard` loading shows skeleton chrome only). */
private const val LOADING_EMPTY_VALUE = ""

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the motor summary tiles. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live temperature-unit + locale preferences from the shared S8 SettingsStore (the native
 * binding of the web page's `useUnits` hook that feeds `toTemperatureDisplay`/`tempUnit`; Celsius/en-US
 * defaults apply until settings load), and renders every lifecycle [state] the shared motor-summary feed can
 * carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the [MotorSummaryStats].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the temperature unit + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SummaryStats(
    state: UiState<MotorSummaryStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SummaryStatsDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { SummaryStatsDisplayPrefs.from(settingsResource.cached) }
    SummaryStatsContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ motorStats, toTemperatureDisplay, tempUnit })` props,
 * for hosts that already hold the computed stats. A `null` [motorStats] is the web `motorStats === null` case
 * — it projects onto the empty [UiState] (the page's no-motor-readings branch). There is no fetch behind it,
 * so it offers no retry affordance.
 */
@Composable
fun SummaryStats(
    motorStats: MotorSummaryStats?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(motorStats) { SummaryStatsProjection.projectUiState(motorStats, isLoading = false) }
    SummaryStats(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip is
 * shown above the grid when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes —
 * mirroring the shared cache-then-network freshness contract. Inside it switches between a loading skeleton
 * grid, a hard-error retry surface, a friendly empty state (so the surface never blanks), and the resolved
 * StatCard grid.
 */
@Composable
fun SummaryStatsContent(
    state: UiState<MotorSummaryStats>,
    onRetry: () -> Unit,
    prefs: SummaryStatsDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: SummaryStatsStrings = rememberSummaryStatsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val stats = state.data
    val isDegraded = state.stale || state.refreshing || state.hasError
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stats != null && isDegraded) {
            SummaryStatsFreshnessRow(state = state)
        }
        when {
            state.isLoading -> SummaryStatsSkeletonGrid(strings = strings)
            state.isError -> SummaryStatsError(onRetry = onRetry)
            state.isEmpty || stats == null -> SummaryStatsEmpty()
            else -> SummaryStatsLoaded(stats = stats, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A right-aligned freshness chip reflecting refreshing/stale/offline over still-shown content, the native
 * expression of the shared [DataFreshness] contract (the web page's poll/`refetch`). Lives above the grid,
 * not next to a value.
 */
@Composable
private fun SummaryStatsFreshnessRow(state: UiState<MotorSummaryStats>) {
    val formatAge = rememberSummaryStatsFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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

/**
 * The content branch: the six StatCard tiles laid out in the web responsive grid, the whole grid fading in
 * (web `<FadeIn delay={0.4}>`) and each tile mounting through a [StaggerItem] so they animate in sequence
 * (web `<StaggerContainer>`/`<StaggerItem>`). Derives the render-ready cards once via the pure
 * [SummaryStatsProjection.cards].
 */
@Composable
private fun SummaryStatsLoaded(
    stats: MotorSummaryStats,
    prefs: SummaryStatsDisplayPrefs,
    strings: SummaryStatsStrings,
) {
    val cards = remember(stats, prefs, strings) { SummaryStatsProjection.cards(stats, prefs, strings) }
    FadeIn(delayMs = FADE_IN_DELAY_MS) {
        SummaryStatsGrid(itemCount = cards.size) { index, cellModifier ->
            val card = cards[index]
            StatCard(label = card.label, value = card.value, icon = card.icon.glyph(), modifier = cellModifier)
        }
    }
}

/**
 * The loading branch: six skeleton tiles in the same responsive grid, announced as "Loading" to TalkBack.
 * Each tile is the shared [StatCard] in its loading state (web `StatCard` `loading` skeleton), carrying its
 * resolved label so the grid stays meaningful even though the skeleton chrome hides it.
 */
@Composable
private fun SummaryStatsSkeletonGrid(strings: SummaryStatsStrings) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val labels =
        remember(strings) {
            listOf(
                strings.totalReadings,
                strings.avgTorque,
                strings.peakPower,
                strings.peakRegen,
                strings.avgPower,
                strings.avgMotorTemp,
            )
        }
    SummaryStatsGrid(
        itemCount = SKELETON_TILE_COUNT,
        animate = false,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) { index, cellModifier ->
        StatCard(label = labels[index], value = LOADING_EMPTY_VALUE, loading = true, modifier = cellModifier)
    }
}

/**
 * Empty state — the web `motorStats === null` no-motor-readings case, shown with the summary glyph so the
 * surface never collapses to a blank box. [EmptyState] exposes the message as its accessibility label, so the
 * section is still announced to TalkBack when it holds no data.
 */
@Composable
private fun SummaryStatsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = SummaryStatsGlyphs.BarChart3,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SummaryStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Lays out [itemCount] cells as the web responsive grid: six-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-6`), three-per-row at or above [GRID_MD_MIN_WIDTH] (`md:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). When [animate] is true each cell mounts through a [StaggerItem] (web
 * `<StaggerContainer>`/`<StaggerItem>`), keyed by its ordinal so the sequence is deterministic; the loading
 * grid passes false. Cells fill their column via [Modifier.weight], a partial trailing row is padded with
 * weighted spacers, and cells are spaced by `Spacing.md` (the native expression of the web `gap-4`).
 */
@Composable
private fun SummaryStatsGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    animate: Boolean = true,
    item: @Composable (Int, Modifier) -> Unit,
) {
    StaggerContainer(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val columns =
                when {
                    maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                    maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
                    else -> GRID_COLUMNS_BASE
                }
            val rows = (0 until itemCount).chunked(columns)
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                for (rowIndices in rows) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                        for (index in rowIndices) {
                            if (animate) {
                                StaggerItem(index = index, modifier = Modifier.weight(1f)) {
                                    item(index, Modifier.fillMaxWidth())
                                }
                            } else {
                                item(index, Modifier.weight(1f))
                            }
                        }
                        repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

/** Resolves the localized tile labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun rememberSummaryStatsStrings(): SummaryStatsStrings {
    val totalReadings = stringResource(R.string.translation_dynamics_totalReadings)
    val avgTorque = stringResource(R.string.translation_dynamics_avgTorque)
    val peakPower = stringResource(R.string.translation_dynamics_peakPower)
    val peakRegen = stringResource(R.string.translation_dynamics_peakRegen)
    val avgPower = stringResource(R.string.translation_dynamics_avgPower)
    val avgMotorTemp = stringResource(R.string.translation_dynamics_avgMotorTemp)
    return remember(totalReadings, avgTorque, peakPower, peakRegen, avgPower, avgMotorTemp) {
        SummaryStatsStrings(
            totalReadings = totalReadings,
            avgTorque = avgTorque,
            peakPower = peakPower,
            peakRegen = peakRegen,
            avgPower = avgPower,
            avgMotorTemp = avgMotorTemp,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSummaryStatsFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Resolves a tile's glyph — reusing the shared [DataDisplayGlyphs] where it carries the lucide equivalent. */
private fun SummaryStatIcon.glyph(): ImageVector =
    when (this) {
        SummaryStatIcon.BarChart3 -> SummaryStatsGlyphs.BarChart3
        // web lucide `Zap`; the shared set already carries the bolt glyph.
        SummaryStatIcon.Zap -> DataDisplayGlyphs.Bolt
        SummaryStatIcon.CornerDownRight -> SummaryStatsGlyphs.CornerDownRight
        SummaryStatIcon.TrendingDown -> DataDisplayGlyphs.TrendingDown
        SummaryStatIcon.Gauge -> DataDisplayGlyphs.Gauge
        SummaryStatIcon.Thermometer -> SummaryStatsGlyphs.Thermometer
    }

/**
 * The lucide glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `BarChart3`, `CornerDownRight` and `Thermometer`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — they
 * are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object SummaryStatsGlyphs {
    /** lucide `bar-chart-3` — an axis pair with three rising bars (Total Readings / empty-state tile). */
    val BarChart3: ImageVector =
        stroked("BarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 14f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
        }

    /** lucide `corner-down-right` — a right-angled arrow curving down then right (Peak Power tile). */
    val CornerDownRight: ImageVector =
        stroked("CornerDownRight") {
            moveTo(15f, 10f)
            lineTo(20f, 15f)
            lineTo(15f, 20f)
            moveTo(4f, 4f)
            lineTo(4f, 11f)
            curveTo(4f, 13.21f, 5.79f, 15f, 8f, 15f)
            lineTo(20f, 15f)
        }

    /** lucide `thermometer` — a rounded-top stem over a bulb (Avg Motor Temp tile). */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(14f, 14.76f)
            lineTo(14f, 5f)
            curveTo(14f, 3.9f, 13.1f, 3f, 12f, 3f)
            curveTo(10.9f, 3f, 10f, 3.9f, 10f, 5f)
            lineTo(10f, 14.76f)
            curveTo(8.79f, 15.69f, 8f, 17.15f, 8f, 18.8f)
            curveTo(8f, 21.12f, 9.79f, 23f, 12f, 23f)
            curveTo(14.21f, 23f, 16f, 21.12f, 16f, 18.8f)
            curveTo(16f, 17.15f, 15.21f, 15.69f, 14f, 14.76f)
            close()
        }

    private fun stroked(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STATS =
    MotorSummaryStats(
        totalReadings = 3451,
        avgTorque = 72.4,
        peakPower = 284.6,
        peakRegen = 96.2,
        avgPower = 41.8,
        avgMotorTemp = 49.0,
    )

@Preview(name = "Content — Celsius", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsCelsiusPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state = SummaryStatsProjection.projectUiState(PREVIEW_STATS, isLoading = false),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs(temperature = TemperatureUnitPref.CELSIUS, locale = Locale.US),
        )
    }
}

@Preview(name = "Content — Fahrenheit", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsFahrenheitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state = SummaryStatsProjection.projectUiState(PREVIEW_STATS, isLoading = false),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs(temperature = TemperatureUnitPref.FAHRENHEIT, locale = Locale.US),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state = SummaryStatsProjection.projectUiState(stats = null, isLoading = true),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state = SummaryStatsProjection.projectUiState(stats = null, isLoading = false),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs.DEFAULT,
        )
    }
}

@Preview(name = "Offline — stale last known", showBackground = true, widthDp = 720)
@Composable
private fun SummaryStatsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsContent(
            state =
                SummaryStatsProjection
                    .projectUiState(PREVIEW_STATS, isLoading = false)
                    .copy(stale = true, errorKind = ErrorKind.Network, fetchedAt = 1L),
            onRetry = {},
            prefs = SummaryStatsDisplayPrefs(temperature = TemperatureUnitPref.CELSIUS, locale = Locale.US),
        )
    }
}
