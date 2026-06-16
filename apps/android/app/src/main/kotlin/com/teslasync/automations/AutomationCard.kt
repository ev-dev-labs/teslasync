// The native Jetpack Compose + Material 3 AutomationCard page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared AutomationCard feature view
// (io.teslasync.android.featureviews.automationcard.AutomationCardContent), itself a full parity port of
// web/src/features/automations/pages/AutomationCard.tsx. The web source is an unrouted, purely presentational
// card the Automations list renders per row, so this layer follows the sanctioned thin-wrapper precedent
// (GasPriceAutoPollPage): it embeds the one shared surface verbatim — every panel, string, and data state is
// that parity-covered surface — and adds only the page state holder + a stateless screen (DRY, ADR-006). It
// performs NO HTTP and re-implements no rendering.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app
// uses. `MatchingDeclarationName` is suppressed for the co-located screen + page entry points.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.automationcard.AutomationCardContent
import io.teslasync.android.featureviews.automationcard.AutomationConflictView
import io.teslasync.android.featureviews.automationcard.AutomationView
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.automations.Automation
import java.text.NumberFormat
import java.util.Locale

/**
 * Stateful entry for the AutomationCard page surface. Builds the [AutomationCardPageViewModel] from the
 * host-supplied props (web `automation` / `isFiring` / `vehicleName` + the four action callbacks), records the
 * one-shot `view.opened` diagnostic (P1/S11), and binds the stateless screen to the holder's [kotlinx.coroutines.flow.StateFlow]s.
 *
 * @param automation the automation this card renders, or `null` when none is selected (web `automation` prop).
 * @param onToggle invoked with `(id, enabled)` when the switch is changed for a non-auto-disabled automation.
 * @param onReEnable invoked with `id` when an auto-disabled automation is toggled back on or re-enabled.
 * @param onDelete invoked with `id` after the delete confirmation is accepted.
 * @param onTestRun invoked with `id` from the actions menu.
 * @param isFiring whether the automation is currently firing (web `isFiring` prop).
 * @param vehicleName the assigned vehicle's name, or `null` for a fleet-wide automation (web `vehicleName`).
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AutomationCardPage(
    automation: AutomationView?,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    modifier: Modifier = Modifier,
    isFiring: Boolean = false,
    vehicleName: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val pageViewModel: AutomationCardPageViewModel =
        viewModel(
            key = AutomationCardPageRegistration.SLUG,
            factory = AutomationCardPageViewModel.factory(automation, isFiring, vehicleName, logger),
        )
    LaunchedEffect(pageViewModel) { pageViewModel.recordViewOpened() }
    val state by pageViewModel.state.collectAsStateWithLifecycle()
    val pinned by pageViewModel.pinned.collectAsStateWithLifecycle()
    AutomationCardScreen(
        state = state,
        onToggle = onToggle,
        onReEnable = onReEnable,
        onDelete = onDelete,
        onTestRun = onTestRun,
        modifier = modifier,
        isFiring = pageViewModel.isFiring,
        vehicleName = pageViewModel.vehicleName,
        pinned = pinned,
        onRetry = pageViewModel::retry,
        onTogglePin = pageViewModel::togglePin,
    )
}

/**
 * The stateless AutomationCard page screen. Renders the shared AutomationCard feature view content
 * ([AutomationCardContent]) for the supplied [state], so every panel, string, and data state
 * (loading / empty / error / content) is the single parity-covered surface (DRY, ADR-006). The host owns the
 * [kotlinx.coroutines.flow.StateFlow] behind [state] and the action callbacks; this layer adds no rendering of
 * its own.
 *
 * @param state the cache-then-network projection of the single automation this card renders.
 * @param onToggle invoked with `(id, enabled)` when the switch is changed for a non-auto-disabled automation.
 * @param onReEnable invoked with `id` when an auto-disabled automation is toggled back on or re-enabled.
 * @param onDelete invoked with `id` after the delete confirmation is accepted.
 * @param onTestRun invoked with `id` from the actions menu.
 * @param isFiring whether the automation is currently firing (web `isFiring` prop).
 * @param vehicleName the assigned vehicle's name, or `null` for a fleet-wide automation (web `vehicleName`).
 * @param pinned host-owned pin state; [onTogglePin] flips it.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onTogglePin flips the host-owned pin state (the web `<PinButton>` toggle).
 */
@Composable
fun AutomationCardScreen(
    state: UiState<AutomationView>,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    modifier: Modifier = Modifier,
    isFiring: Boolean = false,
    vehicleName: String? = null,
    pinned: Boolean = false,
    onRetry: () -> Unit = {},
    onTogglePin: () -> Unit = {},
) {
    AutomationCardContent(
        state = state,
        onToggle = onToggle,
        onReEnable = onReEnable,
        onDelete = onDelete,
        onTestRun = onTestRun,
        onRetry = onRetry,
        modifier = modifier,
        isFiring = isFiring,
        vehicleName = vehicleName,
        pinned = pinned,
        onTogglePin = onTogglePin,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise the screen's content + empty branches) ────────────

private val PREVIEW_AUTOMATION =
    AutomationView(
        id = 1,
        name = "Precondition before commute",
        description = "Warm the cabin to 21°C on weekday mornings",
        enabled = true,
        vehicleId = 7,
        lastTriggeredAt = "2026-06-11T12:00:00Z",
        executionCount = 142,
        failureCount = 0,
        autoDisabled = false,
        autoDisabledReason = null,
        nextFireTime = "2026-06-12T14:30:00Z",
        conflicts =
            listOf(
                AutomationConflictView(3, "Charge to 90% on trips", "Overlapping charge limit", "warning"),
            ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun AutomationCardScreenContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardScreen(
            state = UiState(UiPhase.Content, data = PREVIEW_AUTOMATION),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
            isFiring = true,
            vehicleName = "Model 3",
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AutomationCardScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardScreen(
            state = UiState(UiPhase.Empty),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
        )
    }
}
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numbers = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    val accent = if (automation.autoDisabled) PanelAccent.Danger else PanelAccent.None
    val toggleLabel = stringResource(R.string.translation_automations_toggleLabel)
            val interactive = !busy && !automation.autoDisabled
    val runsLabel = stringResource(R.string.translation_automations_runs)
    val failsLabel = stringResource(R.string.translation_automations_fails)
    val lastLabel = stringResource(R.string.translation_automations_lastRun)
    val neverRun = stringResource(R.string.translation_automations_neverRun)
    val lastFired = formatAutomationTimestamp(automation.lastTriggeredAt, locale)