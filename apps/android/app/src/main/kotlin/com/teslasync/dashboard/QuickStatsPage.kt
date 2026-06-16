// The native Jetpack Compose + Material 3 QuickStatsPage dashboard surface — a parity port of
// web/src/features/dashboard/pages/QuickStatsPage.tsx, the compact at-a-glance card (a standalone, chrome-less
// surface). It reproduces the page's five regions (the centered page title, the vehicle GlassPanel, and the four
// metric cards — {unit} Driven / Drives / kWh Used / Total Cost — plus the footer), every data state (loading /
// empty / error / success), and every visible string (resolved from the generated res/values catalog `quickStats.*`,
// ADR-014).
//
// Composition: [QuickStatsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the merged feed + the live state label + display preferences);
// [QuickStatsPageContent] is the stateless render layer (the centered, width-limited card — title then the
// loading / error / loaded body). The loaded body draws the vehicle panel (the card or the noVehicle empty-state) and
// the always-present metric grid from the single merged [QuickStats]; all decode/merge + formatting lives in the
// framework-free model (QuickStatsPageModel.kt), so this file only resolves i18n + draws. SI values are converted to
// the user's units only here at the display boundary via the model's `prefs.fromKm`/`integer`/`currency` (Phase-48
// SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.dashboard.quickstats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `max-w-md` content column cap, so the card stays a compact centered panel on wide screens. */
private val CONTENT_MAX_WIDTH = 448.dp

/** The circular vehicle-icon accent box diameter (web `h-10 w-10`). */
private val VEHICLE_ICON_BOX = 40.dp

/** Tint alpha for the vehicle-icon accent box fill (web `bg-cyan-500/10`). */
private const val ICON_ACCENT_ALPHA = 0.12f

/** Stagger between the body regions' entrance fades (web `FadeIn delay` cascade 0 / 0.05 / 0.1s), in ms per ordinal. */
private const val FADE_STEP_MS = 50

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [QuickStatsPageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Analytics + Settings holders via [quickStatsPageSourceOf]). [logger] defaults to the app's redacting
 * logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun QuickStatsPage(
    source: QuickStatsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: QuickStatsPageViewModel =
        viewModel(
            key = QuickStatsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { QuickStatsPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val vehicleStateLabel by viewModel.vehicleStateLabel.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    QuickStatsPageContent(
        state = state,
        vehicleStateLabel = vehicleStateLabel,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: a centered, width-limited card (web `min-h-screen flex items-center justify-center` +
 * `max-w-md`). The page title always renders (web `PageContainer` h1); beneath it a centered loader on a first load,
 * a retryable error panel on a hard failure, or the loaded body (vehicle panel + metric grid + footer) otherwise.
 */
@Composable
fun QuickStatsPageContent(
    state: UiState<QuickStats>,
    vehicleStateLabel: String,
    prefs: QuickStatsDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.widthIn(max = CONTENT_MAX_WIDTH).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            PageTitle(stringResource(R.string.translation_quickStats_title))

            when {
                state.isLoading -> QuickStatsLoading()
                state.isError -> QuickStatsError(onRetry = onRetry)
                else -> QuickStatsBody(stats = state.data ?: QuickStats.EMPTY, vehicleStateLabel = vehicleStateLabel, prefs = prefs)
            }
        }
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` spinner). */
@Composable
private fun QuickStatsLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun QuickStatsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the vehicle panel, the four-metric grid, and the footer, each entering with a staggered fade. */
@Composable
private fun QuickStatsBody(
    stats: QuickStats,
    vehicleStateLabel: String,
    prefs: QuickStatsDisplayPrefs,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        FadeIn { VehiclePanel(vehicle = stats.vehicle, vehicleStateLabel = vehicleStateLabel) }
        FadeIn(delayMs = FADE_STEP_MS) { MetricsGrid(summary = stats.summary, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { QuickStatsFooter() }
    }
}

/**
 * The vehicle GlassPanel (web first `<GlassPanel>`). Shows the first vehicle's name + `model · state` subtitle with a
 * circular car-icon accent when a vehicle exists, or the friendly noVehicle empty-state otherwise — so the panel is
 * never a blank box.
 */
@Composable
private fun VehiclePanel(
    vehicle: QuickVehicle?,
    vehicleStateLabel: String,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        if (vehicle == null) {
            EmptyState(message = stringResource(R.string.translation_quickStats_noVehicle))
            return@GlassPanel
        }

        val name = vehicle.displayName.ifBlank { stringResource(R.string.translation_quickStats_defaultName) }
        val subtitle =
            listOfNotNull(vehicle.model?.takeIf { it.isNotBlank() }, vehicleStateLabel)
                .joinToString(separator = " \u00B7 ")
        Row(
            modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = "$name $subtitle" },
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(VEHICLE_ICON_BOX)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = ICON_ACCENT_ALPHA), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    NavGlyphs.Car,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(name)
                Caption(subtitle)
            }
        }
    }
}

/**
 * The four-metric grid (web second `<FadeIn>` grid) — {unit} Driven, Drives, kWh Used, Total Cost — laid out 2×2.
 * Always renders its (possibly zero) totals from the fleet [summary], independent of whether a vehicle exists, with
 * SI distance converted to the user's unit at this display boundary (web `convertDistanceFromSI(km * 1000, unit)`).
 */
@Composable
private fun MetricsGrid(
    summary: QuickStatsSummary,
    prefs: QuickStatsDisplayPrefs,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            QuickMetric(
                label = stringResource(R.string.translation_quickStats_distance, prefs.distanceLabel),
                value = prefs.integer(prefs.fromKm(summary.totalDistanceKm)),
                modifier = Modifier.weight(1f),
            )
            QuickMetric(
                label = stringResource(R.string.translation_quickStats_drives),
                value = prefs.integer(summary.totalDrives),
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            QuickMetric(
                label = stringResource(R.string.translation_quickStats_energy),
                value = prefs.integer(summary.totalEnergyKwh),
                modifier = Modifier.weight(1f),
            )
            QuickMetric(
                label = stringResource(R.string.translation_quickStats_cost),
                value = prefs.currency(summary.totalCost, decimals = 0),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** One metric card with a merged-descendant semantics node so TalkBack reads "label value" as one announcement. */
@Composable
private fun QuickMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = label,
        value = value,
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label $value" },
    )
}

/**
 * The footer (web third `<FadeIn>`) — the "Powered by TeslaSync" caption above the "Open Dashboard" link. The link
 * opens the dashboard via the app deep link (web `<Link to="/">`), routed through the Compose `LocalUriHandler` — the
 * established in-app navigation seam for page content.
 */
@Composable
private fun QuickStatsFooter() {
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(stringResource(R.string.translation_quickStats_footer))
        Button(
            stringResource(R.string.translation_quickStats_openDashboard),
            onClick = { uriHandler.openUri(DASHBOARD_DEEP_LINK) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}
