// The native Jetpack Compose + Material 3 LifetimeStatsPage analytics surface — a parity port of
// web/src/features/analytics/pages/LifetimeStatsPage.tsx, the all-time driving-achievements dashboard. It reproduces
// the page's eleven panels (the distance hero, the four total stat-cards, fun-facts, the savings-vs-gasoline
// comparison, environmental impact, personal records, the activity summary, and the achievement gallery), every data
// state (loading / empty / error / success, plus the cache-then-network stale/offline tier), and every visible
// string (resolved from the generated res/values catalog `lifetime.*`, ADR-014).
//
// Composition: [LifetimeStatsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the lifetime feed + the live display preferences);
// [LifetimeStatsPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip /
// vehicle scope picker — then the loading / error / loaded body). The loaded body draws every panel from the single
// decoded [LifetimeStats]; all decode + formatting lives in the framework-free model (LifetimeStatsPageModel.kt), so
// this file only resolves i18n + draws. SI values are converted to the user's units only here at the display
// boundary via the model's `prefs.fromKm`/`fromKmh`/`currency`/`number` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.lifetimestats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.ProgressRing
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.achievementbadge.AchievementBadge
import io.teslasync.android.featureviews.achievementbadge.AchievementBadgeSize
import io.teslasync.android.featureviews.achievementbadge.AchievementData
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import androidx.compose.ui.unit.dp
import kotlin.math.floor
import kotlin.math.min

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Achievement badges per grid row on a phone-width surface (web responsive 2/3/4/6-up grid). */
private const val ACHIEVEMENTS_PER_ROW = 3

/** The CO₂ progress-ring target: 1000 kg = 100 % (web `Math.min((co2 / 1000) * 100, 100)`). */
private const val CO2_RING_TARGET_KG = 1000.0

/** Web "cups of coffee saved" divisor (`Math.round(total_savings / 5)`). */
private const val COFFEE_PRICE = 5.0

/** Half, for replicating JS `Math.round(x)` = `floor(x + 0.5)` without a non-SI cast. */
private const val HALF = 0.5

/** A "full" progress percentage (web ring `max={100}`). */
private const val FULL_PERCENT = 100.0

/** Hard-coded unit symbols the web reads as literals (never i18n): `unit="kWh"` / `Wh/km` / `kg` / `%`. */
private const val ENERGY_UNIT = "kWh"
private const val EFFICIENCY_UNIT = "Wh/km"
private const val CO2_UNIT = "kg"
private const val PERCENT_UNIT = "%"

/** The em dash shown for a missing day / hour / efficiency value (web `'—'`). */
private const val EM_DASH = "\u2014"

private val SAVINGS_BAR_HEIGHT = 24.dp
private val CO2_RING_SIZE = 64.dp
private val CO2_RING_STROKE = 5.dp
private val ACHIEVEMENT_ROW_GAP = Spacing.sm

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [LifetimeStatsPageViewModel] over the supplied [source] (the host wires the shared
 * Analytics + Settings holders + the active-vehicle selection via [lifetimeStatsPageSourceOf]). [logger] defaults to
 * the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun LifetimeStatsPage(
    source: LifetimeStatsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: LifetimeStatsPageViewModel =
        viewModel(
            key = LifetimeStatsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { LifetimeStatsPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    LifetimeStatsPageContent(
        state = state,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker),
 * then the state-dependent body — a centered loader on a first load, a ret[r]yable error panel on a hard failure, or
 * the eleven loaded panels otherwise. The hero + the four stat cards always render their (possibly zero) totals; the
 * remaining sections show their friendly empty-state composable when the payload carries no meaningful data.
 */
@Composable
fun LifetimeStatsPageContent(
    state: UiState<LifetimeStats>,
    prefs: LifetimeStatsDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        LifetimeChrome(state = state)

        when {
            state.isLoading -> LifetimeLoading()
            state.isError -> LifetimeError(onRetry = onRetry)
            else -> LifetimeBody(stats = state.data ?: LifetimeStats.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — the title + subtitle (web `PageContainer` title/subtitle) and the actions row. */
@Composable
private fun LifetimeChrome(state: UiState<LifetimeStats>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_lifetime_title))
                BodyText(
                    stringResource(R.string.translation_lifetime_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto` — the cagg-driven freshness chip.
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<VehicleSelect />` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun LifetimeLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun LifetimeError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the eleven panels in their web order, each entering with a staggered fade. */
@Composable
private fun LifetimeBody(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { HeroPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { KeyStatsGrid(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { FunFactsPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { SavingsPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { EnvironmentalPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { RecordsPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { ActivityPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { AchievementsPanel(stats) }
    }
}

// ── Panel 1 — Hero ─────────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel1 — the distance hero (web hero `<GlassPanel className="p-8 text-center">`). */
@Composable
private fun HeroPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(
                    LifetimeStatsGlyphs.Car,
                    contentDescription = null,
                    size = IconSize.Xl,
                    tint = MaterialTheme.colorScheme.primary,
                )
                AnimatedNumber(value = prefs.fromKm(stats.totalDistanceKm), decimals = 0)
                Caption(prefs.distanceLabel)
            }
            BodyText(
                stringResource(R.string.translation_lifetime_heroSubtitle, prefs.integer(stats.totalDrives)),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (stats.earthCircumferences > 0.0) {
                BodyText(
                    "\uD83C\uDF0E " +
                        stringResource(R.string.translation_lifetime_earthCompare, prefs.number(stats.earthCircumferences, 2)),
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (stats.ownershipDays > 0.0) {
                HelperText(
                    stringResource(
                        R.string.translation_lifetime_since,
                        prefs.formatDate(stats.firstDriveDate) ?: EM_DASH,
                        prefs.integer(stats.ownershipDays),
                    ),
                )
            }
        }
    }
}

// ── Panels 2-5 — Key stat cards ─────────────────────────────────────────────────────────────────────────────

/** Total-Drives / Total-Distance / Total-Energy / Total-Savings — the web 4-up `<StatCard>` grid (2 columns). */
@Composable
private fun KeyStatsGrid(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_lifetime_totalDrives),
                value = prefs.integer(stats.totalDrives),
                icon = LifetimeStatsGlyphs.Car,
                sublabel = prefs.number(stats.totalDrivingHours, 1) + " " + stringResource(R.string.translation_lifetime_hours),
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_lifetime_totalDistance),
                value = prefs.number(prefs.fromKm(stats.totalDistanceKm), 0),
                unit = prefs.distanceLabel,
                icon = LifetimeStatsGlyphs.Gauge,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_lifetime_totalEnergy),
                value = prefs.number(stats.totalEnergyKwh, 1),
                unit = ENERGY_UNIT,
                icon = LifetimeStatsGlyphs.Zap,
                sublabel = prefs.integer(stats.totalChargeSessions) + " " + stringResource(R.string.translation_lifetime_sessions),
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_lifetime_totalSavings),
                value = prefs.currency(stats.totalSavings, decimals = 0),
                icon = LifetimeStatsGlyphs.DollarSign,
                sublabel = stringResource(R.string.translation_lifetime_vsGas),
            )
        }
    }
}

// ── Panel 6 — Fun facts ─────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel6 — the four fun-fact tiles, or the empty state when no meaningful data has accrued. */
@Composable
private fun FunFactsPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    SectionPanel(icon = LifetimeStatsGlyphs.Flame, iconTint = TeslaTokens.status.warning, title = stringResource(R.string.translation_lifetime_funFacts)) {
        if (stats.hasData) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                    FunFactCard(
                        modifier = Modifier.weight(1f),
                        icon = LifetimeStatsGlyphs.Globe,
                        iconTint = TeslaTokens.status.info,
                        value = prefs.number(stats.earthCircumferences * FULL_PERCENT, 1),
                        unit = PERCENT_UNIT,
                        label = stringResource(R.string.translation_lifetime_earthProgress),
                    )
                    FunFactCard(
                        modifier = Modifier.weight(1f),
                        icon = LifetimeStatsGlyphs.Moon,
                        iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
                        value = prefs.number(stats.moonTrips * FULL_PERCENT, 2),
                        unit = PERCENT_UNIT,
                        label = stringResource(R.string.translation_lifetime_moonProgress),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                    FunFactCard(
                        modifier = Modifier.weight(1f),
                        icon = LifetimeStatsGlyphs.TreePine,
                        iconTint = TeslaTokens.status.success,
                        value = prefs.integer(stats.treesEquivalent),
                        unit = "",
                        label = stringResource(R.string.translation_lifetime_treesPlanted),
                    )
                    FunFactCard(
                        modifier = Modifier.weight(1f),
                        icon = LifetimeStatsGlyphs.Home,
                        iconTint = TeslaTokens.status.warning,
                        value = prefs.number(stats.homesEquivalentDays, 1),
                        unit = stringResource(R.string.translation_lifetime_days),
                        label = stringResource(R.string.translation_lifetime_homesPowered),
                    )
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noData))
        }
    }
}

// ── Panel 7 — Savings comparison ────────────────────────────────────────────────────────────────────────────

/** GlassPanel7 — the EV-vs-gasoline savings bars, or the empty state when there is no gasoline comparison. */
@Composable
private fun SavingsPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    SectionPanel(
        icon = LifetimeStatsGlyphs.DollarSign,
        iconTint = TeslaTokens.status.success,
        title = stringResource(R.string.translation_lifetime_savingsComparison),
    ) {
        if (stats.gasEquivalentCost > 0.0) {
            SavingsBar(
                evCost = stats.totalChargingCost,
                gasCost = stats.gasEquivalentCost,
                savings = stats.totalSavings,
                co2Kg = stats.co2OffsetKg,
                prefs = prefs,
            )
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noSavingsData))
        }
    }
}

// ── Panel 8 — Environmental impact ──────────────────────────────────────────────────────────────────────────

/** GlassPanel8 — the CO₂ ring + trees + coffees tiles, or the empty state. */
@Composable
private fun EnvironmentalPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    SectionPanel(
        icon = LifetimeStatsGlyphs.Leaf,
        iconTint = TeslaTokens.status.success,
        title = stringResource(R.string.translation_lifetime_environmentalImpact),
    ) {
        if (stats.hasData) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    ProgressRing(
                        value = min(stats.co2OffsetKg / CO2_RING_TARGET_KG * FULL_PERCENT, FULL_PERCENT),
                        max = FULL_PERCENT,
                        size = CO2_RING_SIZE,
                        strokeWidth = CO2_RING_STROKE,
                        color = TeslaTokens.status.success,
                        contentDescription =
                            prefs.number(stats.co2OffsetKg, 0) + " " + CO2_UNIT + " " +
                                stringResource(R.string.translation_lifetime_co2Offset),
                    )
                    Column {
                        AnimatedNumber(value = stats.co2OffsetKg, decimals = 0, suffix = " $CO2_UNIT")
                        HelperText(stringResource(R.string.translation_lifetime_co2Offset))
                    }
                }
                EnvironmentalStat(
                    emoji = "\uD83C\uDF33",
                    value = prefs.integer(stats.treesEquivalent),
                    label = stringResource(R.string.translation_lifetime_treesEquiv),
                )
                EnvironmentalStat(
                    emoji = "\u2615",
                    value = prefs.integer(floor(stats.totalSavings / COFFEE_PRICE + HALF)),
                    label = stringResource(R.string.translation_lifetime_coffeesEquiv),
                )
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noData))
        }
    }
}

// ── Panel 9 — Personal records ──────────────────────────────────────────────────────────────────────────────

/** GlassPanel9 — the longest-drive / highest-speed / biggest-charge records, or the empty state. */
@Composable
private fun RecordsPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    SectionPanel(
        icon = LifetimeStatsGlyphs.Award,
        iconTint = MaterialTheme.colorScheme.tertiary,
        title = stringResource(R.string.translation_lifetime_personalRecords),
    ) {
        if (stats.hasData) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                RecordCard(
                    icon = LifetimeStatsGlyphs.Car,
                    iconTint = MaterialTheme.colorScheme.primary,
                    title = stringResource(R.string.translation_lifetime_longestDrive),
                    value = prefs.number(prefs.fromKm(stats.longestDriveRecord.value), 1) + " " + prefs.distanceLabel,
                    date = prefs.formatDate(stats.longestDriveRecord.date),
                )
                RecordCard(
                    icon = LifetimeStatsGlyphs.Gauge,
                    iconTint = TeslaTokens.status.danger,
                    title = stringResource(R.string.translation_lifetime_highestSpeed),
                    value = prefs.number(prefs.fromKmh(stats.highestSpeedRecord.value), 0) + " " + prefs.speedLabel,
                    date = prefs.formatDate(stats.highestSpeedRecord.date),
                )
                RecordCard(
                    icon = LifetimeStatsGlyphs.BatteryCharging,
                    iconTint = TeslaTokens.status.success,
                    title = stringResource(R.string.translation_lifetime_biggestCharge),
                    value = prefs.number(stats.maxChargeRecord.value, 1) + " " + ENERGY_UNIT,
                    date = prefs.formatDate(stats.maxChargeRecord.date),
                )
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noData))
        }
    }
}

// ── Panel 10 — Activity summary ─────────────────────────────────────────────────────────────────────────────

/** GlassPanel10 — the most-active-day / peak-hour / days-on-road / avg-efficiency mini-stats, or the empty state. */
@Composable
private fun ActivityPanel(
    stats: LifetimeStats,
    prefs: LifetimeStatsDisplayPrefs,
) {
    SectionPanel(
        icon = LifetimeStatsGlyphs.Clock,
        iconTint = TeslaTokens.status.info,
        title = stringResource(R.string.translation_lifetime_activitySummary),
    ) {
        if (stats.hasData) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                    MiniStat(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_lifetime_mostActiveDay),
                        value = stats.mostActiveDayOfWeek.ifBlank { EM_DASH },
                    )
                    MiniStat(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_lifetime_mostActiveHour),
                        value = stats.mostActiveHour?.let { "$it:00" } ?: EM_DASH,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                    MiniStat(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_lifetime_daysOnRoad),
                        value = prefs.number(stats.daysOnRoad, 1),
                    )
                    MiniStat(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_lifetime_avgEfficiency),
                        value =
                            if (stats.avgEfficiencyWhKm > 0.0) {
                                prefs.number(stats.avgEfficiencyWhKm, 0) + " " + EFFICIENCY_UNIT
                            } else {
                                EM_DASH
                            },
                    )
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noData))
        }
    }
}

// ── Panel 11 — Achievement gallery ──────────────────────────────────────────────────────────────────────────

/** GlassPanel11 — the achievement badge gallery, or the empty state when none are tracked yet. */
@Composable
private fun AchievementsPanel(stats: LifetimeStats) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(
                    LifetimeStatsGlyphs.Trophy,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = MaterialTheme.colorScheme.tertiary,
                )
                SectionTitle(stringResource(R.string.translation_lifetime_achievements))
            }
            Caption(
                "${stats.unlockedCount}/${stats.achievements.size} " +
                    stringResource(R.string.translation_lifetime_unlocked),
            )
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        if (stats.achievements.isNotEmpty()) {
            AchievementGrid(stats.achievements)
        } else {
            EmptyState(message = stringResource(R.string.translation_lifetime_noAchievements))
        }
    }
}

/** A simple responsive badge grid (web `StaggerContainer` grid) — rows of [ACHIEVEMENTS_PER_ROW] equal cells. */
@Composable
private fun AchievementGrid(achievements: List<AchievementData>) {
    Column(verticalArrangement = Arrangement.spacedBy(ACHIEVEMENT_ROW_GAP)) {
        achievements.chunked(ACHIEVEMENTS_PER_ROW).forEach { rowItems ->
            Row(horizontalArrangement = Arrangement.spacedBy(ACHIEVEMENT_ROW_GAP), modifier = Modifier.fillMaxWidth()) {
                rowItems.forEach { achievement ->
                    Box(modifier = Modifier.weight(1f)) {
                        AchievementBadge(achievement = achievement, size = AchievementBadgeSize.Md, modifier = Modifier.fillMaxWidth())
                    }
                }
                repeat(ACHIEVEMENTS_PER_ROW - rowItems.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

// ── Shared panel + sub-component composables ────────────────────────────────────────────────────────────────

/** A titled `GlassPanel` section — the web `<GlassPanel><h2><Icon/>{title}</h2>…</GlassPanel>` pattern. */
@Composable
private fun SectionPanel(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = iconTint)
            SectionTitle(title)
        }
        content()
    }
}

/** A subtle inset tile — the web `bg-white/[0.03] rounded-lg p-3` surface used by the fun-fact / record / mini tiles. */
@Composable
private fun InsetTile(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = INSET_TILE_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Box(modifier = Modifier.padding(Spacing.md)) { content() }
    }
}

/** One fun-fact tile — leading [icon], a bold [value] + small [unit], and a muted [label] (web `FunFactCard`). */
@Composable
private fun FunFactCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    value: String,
    unit: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    InsetTile(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = iconTint)
            Column {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    MetricValue(value)
                    if (unit.isNotEmpty()) Caption(unit)
                }
                HelperText(label)
            }
        }
    }
}

/** One environmental tile — a leading [emoji], a bold [value], and a muted [label] (web emoji rows). */
@Composable
private fun EnvironmentalStat(
    emoji: String,
    value: String,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Text(emoji, style = MaterialTheme.typography.headlineMedium)
        Column {
            MetricValue(value)
            HelperText(label)
        }
    }
}

/** One personal-record tile — leading [icon], a muted [title], a bold [value], and an optional [date] (web `RecordCard`). */
@Composable
private fun RecordCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    title: String,
    value: String,
    date: String?,
) {
    InsetTile(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = iconTint)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(title)
                PanelTitle(value)
                if (date != null) HelperText(date)
            }
        }
    }
}

/** One activity mini-stat — a centered muted [label] above a bold [value] (web `MiniStat`). */
@Composable
private fun MiniStat(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    InsetTile(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(label)
            PanelTitle(value)
        }
    }
}

/** The EV-vs-gasoline cost bars + the savings total (web `SavingsBar`). */
@Composable
private fun SavingsBar(
    evCost: Double,
    gasCost: Double,
    savings: Double,
    co2Kg: Double,
    prefs: LifetimeStatsDisplayPrefs,
) {
    val maxCost = maxOf(evCost, gasCost, 1.0)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        CostBar(
            label = stringResource(R.string.translation_lifetime_electricCost),
            labelTint = TeslaTokens.status.success,
            amount = prefs.currency(evCost),
            fraction = (evCost / maxCost).toFloat(),
            fillColor = TeslaTokens.status.success,
        )
        CostBar(
            label = stringResource(R.string.translation_lifetime_gasCost),
            labelTint = TeslaTokens.status.danger,
            amount = prefs.currency(gasCost),
            fraction = (gasCost / maxCost).toFloat(),
            fillColor = TeslaTokens.status.danger,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(
                stringResource(R.string.translation_lifetime_youSaved) + " " + prefs.currency(savings),
            )
            HelperText(
                prefs.number(co2Kg, 0) + " " + CO2_UNIT + " CO\u2082 " + stringResource(R.string.translation_lifetime_avoided),
            )
        }
    }
}

/** One labelled cost bar — a label/amount row above a proportional track. */
@Composable
private fun CostBar(
    label: String,
    labelTint: Color,
    amount: String,
    fraction: Float,
    fillColor: Color,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(label, modifier = Modifier.semantics { contentDescription = label })
            BodyText(amount, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(SAVINGS_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.md))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = INSET_TILE_ALPHA)),
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(fraction.coerceIn(0f, 1f))
                        .height(SAVINGS_BAR_HEIGHT)
                        .clip(RoundedCornerShape(Radius.md))
                        .background(fillColor),
            )
        }
    }
}

private const val INSET_TILE_ALPHA = 0.45f
