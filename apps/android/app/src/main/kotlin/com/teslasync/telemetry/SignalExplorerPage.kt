// The native Jetpack Compose + Material 3 SignalExplorerPage telemetry surface — a parity port of
// web/src/features/telemetry/pages/SignalExplorerPage.tsx, the multi-signal explorer's controls workspace. It
// reproduces the page header (title + subtitle + the live connected/disconnected badge), the controls panel
// (GlassPanel1 — the signal multi-select, the time-range picker, the page-size select, and the Explore / Live
// toggle + live-mode help affordance), the no-vehicle empty state, and the "pick signals and click Explore" prompt,
// plus every data state the one `useSignals` catalog read resolves to (loading / empty / error / success), and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SignalExplorerPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the catalog feed + the selection + the interaction
// snapshot); [SignalExplorerPageContent] is the stateless render layer. The reused A3 [SignalSelector] feature view
// owns the multi-select's own content/empty rendering; this page wires the selection, the controls, and the page
// chrome, and maps the catalog feed's four [UiState] phases onto the spinner / selector / error-banner surfaces. All
// derivation lives in the framework-free model (SignalExplorerPageModel.kt); this file only resolves i18n + draws.
//
// The web page's chart / stats / history panels and its live SSE stream are NOT part of this parity unit (the
// manifest declares only GlassPanel1 + the `useSignals` source), so the Explore / Live controls drive local
// interaction state here; the connected/disconnected badge reads the interaction's `liveConnected` flag, which stays
// false until the live pipeline (P1/S4/S6) is wired into the surface — an honest "Disconnected", never a faked link.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalexplorer

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.signalselector.SignalSelector
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** The page's interaction callbacks, wired to the [SignalExplorerPageViewModel] (web event handlers). */
data class SignalExplorerActions(
    val onSelectSignals: (List<String>) -> Unit,
    val onRange: (Long?, Long?) -> Unit,
    val onPerPage: (Int) -> Unit,
    val onExplore: () -> Unit,
    val onToggleLive: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SignalExplorerPageViewModel] over the supplied [source] (the host wires the shared
 * signals port + the app-scoped vehicle selection via [signalExplorerPageSourceOf]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun SignalExplorerPage(
    source: SignalExplorerPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SignalExplorerPageViewModel =
        viewModel(
            key = SignalExplorerPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SignalExplorerPageViewModel(source, logger) } },
        )
    SignalExplorerPage(viewModel = viewModel, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] catalog feed + selection + interaction snapshot to the stateless content. */
@Composable
fun SignalExplorerPage(
    viewModel: SignalExplorerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()
    val signalsState by viewModel.signalsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            SignalExplorerActions(
                onSelectSignals = viewModel::setSelectedSignals,
                onRange = viewModel::setRange,
                onPerPage = viewModel::setPerPage,
                onExplore = viewModel::explore,
                onToggleLive = viewModel::toggleLive,
                onRetry = viewModel::retry,
            )
        }

    SignalExplorerPageContent(
        selectedVehicleId = selectedVehicleId,
        signalsState = signalsState,
        interaction = interaction,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + live badge), then either the no-vehicle empty panel (web
 * `vehicleId === 0`) or the controls panel (GlassPanel1) followed by the "pick signals and click Explore" prompt
 * (web `!hasHistorical && !isLive`). The catalog feed's four [UiState] phases drive the controls' selector region.
 */
@Composable
fun SignalExplorerPageContent(
    selectedVehicleId: Long?,
    signalsState: UiState<List<String>>,
    interaction: SignalExplorerInteraction,
    actions: SignalExplorerActions,
    modifier: Modifier = Modifier,
) {
    val hasVehicle = (selectedVehicleId ?: 0L) > 0L
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SignalExplorerHeader(interaction)

        if (!hasVehicle) {
            // No-vehicle empty state — web `vehicleId === 0` branch.
            FadeIn {
                GlassPanel(padding = PanelPadding.Md) {
                    EmptyState(
                        message = stringResource(R.string.translation_signalExplorer_noVehicleDesc),
                        title = stringResource(R.string.translation_signalExplorer_noVehicle),
                        icon = SignalExplorerGlyphs.Activity,
                    )
                }
            }
        } else {
            // Panel 1 — the controls bar (signal select + time range + page size + Explore / Live).
            FadeIn {
                GlassPanel(padding = PanelPadding.Md) {
                    SignalExplorerControls(
                        selectedVehicleId = selectedVehicleId,
                        signalsState = signalsState,
                        interaction = interaction,
                        actions = actions,
                    )
                }
            }

            if (interaction.showPickPrompt) {
                // "Pick signals and click Explore" prompt — web `!hasHistorical && !isLive` empty state.
                FadeIn(delayMs = FADE_STEP_MS) {
                    GlassPanel(padding = PanelPadding.Md) {
                        EmptyState(
                            message =
                                stringResource(
                                    R.string.translation_Choose_up_to_5_signals__set_a_date_range__then_hit_Explore___or_toggle_Live_to_stream_in_real_time_,
                                ),
                            title = stringResource(R.string.translation_Pick_signals_and_click_Explore),
                            icon = SignalExplorerGlyphs.Database,
                        )
                    }
                }
            }
        }
    }
}

/** The page header — the title, the muted subtitle, and the live connected/disconnected badge (web `actions`). */
@Composable
private fun SignalExplorerHeader(interaction: SignalExplorerInteraction) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(stringResource(R.string.translation_Signal_Explorer))
            BodyText(
                stringResource(
                    R.string.translation_Visualise_signal_history_with_chart_and_stats___or_stream_live,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (interaction.isLive) {
            Badge(
                text =
                    if (interaction.liveConnected) {
                        stringResource(R.string.translation_liveMonitor_connected)
                    } else {
                        stringResource(R.string.translation_liveMonitor_disconnected)
                    },
                variant = if (interaction.liveConnected) BadgeVariant.Success else BadgeVariant.Danger,
                dot = true,
            )
        }
    }
}

/**
 * The GlassPanel1 controls — the signal multi-select (with its four catalog data states), the time-range picker, the
 * page-size select, and the Explore / Live toggle + live-mode help affordance. The catalog feed drives the selector
 * region: `Loading` ⇒ a spinner, `Error` ⇒ the load-failed banner + retry (shown above the selector), and
 * `Success` / empty ⇒ the [SignalSelector], which renders its own populated list or friendly empty note.
 */
@Composable
private fun SignalExplorerControls(
    selectedVehicleId: Long?,
    signalsState: UiState<List<String>>,
    interaction: SignalExplorerInteraction,
    actions: SignalExplorerActions,
) {
    val signalNames = signalsState.data ?: emptyList()
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (signalsState.hasError) {
            // Error state — web top-of-page AlertBanner (also covers the stale/offline cached tier).
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                action = BannerAction(stringResource(R.string.translation_common_retry), actions.onRetry),
            )
        }

        when {
            // Loading state — first catalog load with nothing cached yet.
            signalsState.isLoading ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Spinner(size = SpinnerSize.Sm)
                }
            // Success (populated list) and empty (friendly "no signals" note) are both rendered by the selector.
            else ->
                SignalSelector(
                    options = signalNames,
                    value = interaction.selectedSignals,
                    onChange = actions.onSelectSignals,
                    max = MAX_SIGNALS,
                )
        }

        // Time Range picker.
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(stringResource(R.string.translation_Time_Range))
            DateRangeFilter(
                startEpochDay = interaction.startEpochDay,
                endEpochDay = interaction.endEpochDay,
                onRangeChange = actions.onRange,
            )
        }

        // Page size (hidden in live mode, web `!isLive`).
        if (!interaction.isLive) {
            val perPageOptions =
                remember { PER_PAGE_OPTIONS.map { SelectOption(it.toString(), it.toString()) } }
            Select(
                options = perPageOptions,
                selectedValue = interaction.perPage.toString(),
                onSelect = { value -> value.toIntOrNull()?.let(actions.onPerPage) },
                label = stringResource(R.string.translation_Per_Page),
            )
        }

        // Explore (hidden in live mode) + Live toggle + live-mode help.
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!interaction.isLive) {
                Button(
                    label = stringResource(R.string.translation_Explore),
                    onClick = actions.onExplore,
                    variant = ButtonVariant.Primary,
                    enabled = interaction.canExplore(selectedVehicleId),
                    leadingIcon = SignalExplorerGlyphs.Database,
                )
            }
            Button(
                label =
                    if (interaction.isLive) {
                        stringResource(R.string.translation_signalExplorer_stopLive)
                    } else {
                        stringResource(R.string.translation_signalExplorer_live)
                    },
                onClick = actions.onToggleLive,
                variant = if (interaction.isLive) ButtonVariant.Danger else ButtonVariant.Outline,
                enabled = interaction.canToggleLive,
                leadingIcon = SignalExplorerGlyphs.Radio,
            )
            HelpIcon(
                text = stringResource(R.string.translation_help_signal_live),
                contentDescription = stringResource(R.string.translation_help_signal_live_aria),
                size = IconSize.Sm,
            )
        }
    }
}
