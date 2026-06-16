// The native Jetpack Compose + Material 3 WeeklyDigestPage analytics surface — a parity port of
// web/src/features/analytics/pages/WeeklyDigestPage.tsx, the per-vehicle weekly driving + charging summary. It
// reproduces the page chrome (title / subtitle / data-freshness chip / vehicle `<Select>`), every data state (loading
// skeleton / empty / error-retry, plus the cache-then-network stale/offline tier), and every visible string (resolved
// from the generated res/values catalog `analytics.weeklyDigest.*`, ADR-014).
//
// Composition: [WeeklyDigestPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the digest feed + the vehicle options + the live display
// preferences); [WeeklyDigestPageContent] is the stateless render layer (the page chrome, then the loading / error /
// empty / loaded body). The loaded body draws the week-summary + week-over-week panels from the single decoded
// [WeeklyDigest]; all decode + formatting lives in the framework-free model (WeeklyDigestPageModel.kt), so this file
// only resolves i18n + draws. The SI distance figure is converted to the user's unit only here at the display boundary
// via `prefs.fromKm` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.weeklydigest

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.VehicleOption
import io.teslasync.android.components.forms.VehicleSelect
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Hard-coded unit symbols the web reads as literals (never i18n): `unit="kWh"` / `Wh/km`. */
private const val ENERGY_UNIT = "kWh"
private const val EFFICIENCY_UNIT = "Wh/km"

private val SKELETON_BAR_HEIGHT = 52.dp
private val SKELETON_TITLE_HEIGHT = 20.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [WeeklyDigestPageViewModel] over the supplied [source] (the host wires the shared
 * Analytics + Vehicles + Settings holders + the active-vehicle selection via [weeklyDigestPageSourceOf]). [logger]
 * defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the
 * content.
 */
@Composable
fun WeeklyDigestPage(
    source: WeeklyDigestPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: WeeklyDigestPageViewModel =
        viewModel(
            key = WeeklyDigestPageRegistration.SLUG,
            factory = viewModelFactory { initializer { WeeklyDigestPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val vehicleOptions by viewModel.vehicleOptions.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()

    WeeklyDigestPageContent(
        state = state,
        prefs = prefs,
        vehicleOptions = vehicleOptions,
        selectedVehicleId = selectedVehicleId,
        onSelectVehicle = viewModel::selectVehicle,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page chrome (title + subtitle + the data-freshness chip + the vehicle picker), then the
 * state-dependent body — a shimmer skeleton on a first load, a retryable error panel on a hard failure, the friendly
 * empty-state for an all-zero week, or the loaded summary + week-over-week panels otherwise.
 */
@Composable
fun WeeklyDigestPageContent(
    state: UiState<WeeklyDigest>,
    prefs: WeeklyDigestDisplayPrefs,
    vehicleOptions: List<VehicleOption>,
    selectedVehicleId: Long?,
    onSelectVehicle: (Long) -> Unit,
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
        WeeklyDigestChrome(
            state = state,
            vehicleOptions = vehicleOptions,
            selectedVehicleId = selectedVehicleId,
            onSelectVehicle = onSelectVehicle,
        )

        when {
            state.isLoading -> WeeklyDigestLoading()
            state.isError -> WeeklyDigestError(onRetry = onRetry)
            state.isEmpty -> WeeklyDigestEmpty()
            else -> WeeklyDigestBody(digest = state.data ?: WeeklyDigest.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — the title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the picker. */
@Composable
private fun WeeklyDigestChrome(
    state: UiState<WeeklyDigest>,
    vehicleOptions: List<VehicleOption>,
    selectedVehicleId: Long?,
    onSelectVehicle: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_analytics_weeklyDigest_title))
                BodyText(
                    stringResource(R.string.translation_analytics_weeklyDigest_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshness` — the cache-then-network freshness chip (ADR-013 staleness surfaced here).
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web actions `<Select>` with empty-label "Select vehicle" — the page's per-vehicle scope picker.
        VehicleSelect(
            vehicles = vehicleOptions,
            selectedId = selectedVehicleId,
            onSelect = onSelectVehicle,
            modifier = Modifier.fillMaxWidth(),
            label = null,
            emptyLabel = stringResource(R.string.translation_analytics_weeklyDigest_selectVehicle),
        )
    }
}

/** The first-load surface — a shimmer skeleton in the digest's shape (web `DigestSkeleton`). */
@Composable
private fun WeeklyDigestLoading() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Skeleton(widthFraction = 0.4f, height = SKELETON_TITLE_HEIGHT, rounded = true)
            repeat(SKELETON_BARS) {
                Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
            }
        }
    }
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun WeeklyDigestError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The empty surface — the web `<EmptyState icon={Calendar} title={noData} message={noDataMessage} />`. */
@Composable
private fun WeeklyDigestEmpty() {
    EmptyState(
        icon = WeeklyDigestGlyphs.Calendar,
        title = stringResource(R.string.translation_analytics_weeklyDigest_noData),
        message = stringResource(R.string.translation_analytics_weeklyDigest_noDataMessage),
    )
}

// ── Loaded body ────────────────────────────────────────────────────────────────────────────────────────────

/** The loaded body — the week-summary cards then the week-over-week comparison, each entering with a staggered fade. */
@Composable
private fun WeeklyDigestBody(
    digest: WeeklyDigest,
    prefs: WeeklyDigestDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { WeekSummaryPanel(digest, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { WeekOverWeekPanel(digest, prefs) }
    }
}

/** Web `SummaryHeroCards` + `DrivingSection`/`ChargingSection` — this week's drives / distance / energy / cost / efficiency. */
@Composable
private fun WeekSummaryPanel(
    digest: WeeklyDigest,
    prefs: WeeklyDigestDisplayPrefs,
) {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_weekSummary)
    GlassPanel(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = title },
        padding = PanelPadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SectionTitle(title)
            StatCardRow(
                left = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_drives),
                        value = prefs.integer(digest.drives),
                        icon = WeeklyDigestGlyphs.Car,
                    )
                },
                right = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_distance),
                        value = prefs.number(prefs.fromKm(digest.distanceKm), 0),
                        unit = prefs.distanceLabel,
                        icon = WeeklyDigestGlyphs.Gauge,
                    )
                },
            )
            StatCardRow(
                left = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_energyUsed),
                        value = prefs.number(digest.energyKwh, 1),
                        unit = ENERGY_UNIT,
                        icon = WeeklyDigestGlyphs.Bolt,
                    )
                },
                right = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_cost),
                        value = prefs.currency(digest.cost),
                        icon = WeeklyDigestGlyphs.DollarSign,
                    )
                },
            )
            StatCard(
                modifier = Modifier.fillMaxWidth(),
                label = stringResource(R.string.translation_analytics_weeklyDigest_efficiency),
                value = prefs.number(digest.efficiencyWhKm, 0),
                unit = EFFICIENCY_UNIT,
                icon = WeeklyDigestGlyphs.Gauge,
            )
        }
    }
}

/** Web `WeekOverWeekSummary` — the same metrics with a current-vs-previous trend chip (efficiency inverts tone). */
@Composable
private fun WeekOverWeekPanel(
    digest: WeeklyDigest,
    prefs: WeeklyDigestDisplayPrefs,
) {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_weekOverWeek)
    GlassPanel(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = title },
        padding = PanelPadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SectionTitle(title)
            StatCardRow(
                left = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_drives),
                        value = prefs.integer(digest.drives),
                        icon = WeeklyDigestGlyphs.Car,
                        trend = weekTrend(digest.drives, digest.prevDrives, prefs),
                    )
                },
                right = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_distance),
                        value = prefs.number(prefs.fromKm(digest.distanceKm), 0),
                        unit = prefs.distanceLabel,
                        icon = WeeklyDigestGlyphs.Gauge,
                        trend = weekTrend(digest.distanceKm, digest.prevDistanceKm, prefs),
                    )
                },
            )
            StatCardRow(
                left = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_energyUsed),
                        value = prefs.number(digest.energyKwh, 1),
                        unit = ENERGY_UNIT,
                        icon = WeeklyDigestGlyphs.Bolt,
                        trend = weekTrend(digest.energyKwh, digest.prevEnergyKwh, prefs),
                    )
                },
                right = {
                    StatCard(
                        modifier = it,
                        label = stringResource(R.string.translation_analytics_weeklyDigest_cost),
                        value = prefs.currency(digest.cost),
                        icon = WeeklyDigestGlyphs.DollarSign,
                        trend = weekTrend(digest.cost, digest.prevCost, prefs),
                    )
                },
            )
            StatCard(
                modifier = Modifier.fillMaxWidth(),
                label = stringResource(R.string.translation_analytics_weeklyDigest_efficiency),
                value = prefs.number(digest.efficiencyWhKm, 0),
                unit = EFFICIENCY_UNIT,
                icon = WeeklyDigestGlyphs.Gauge,
                trend = weekTrend(digest.efficiencyWhKm, digest.prevEfficiencyWhKm, prefs, invertPositive = true),
            )
        }
    }
}

/** Two equal-weight [StatCard]s side by side (the web 2-up responsive grid). */
@Composable
private fun StatCardRow(
    left: @Composable (Modifier) -> Unit,
    right: @Composable (Modifier) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
        left(Modifier.weight(1f))
        right(Modifier.weight(1f))
    }
}

/** Number of shimmer skeleton bars shown while the first digest load is in flight (web `DigestSkeleton`). */
private const val SKELETON_BARS = 3
