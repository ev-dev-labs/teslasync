// The native Jetpack Compose + Material 3 TriggerConfigurator page surface (P3/A7) — the page-prompt's
// `@Composable screen + ViewModel` seam over the shared TriggerConfigurator feature view
// (io.teslasync.android.featureviews.triggerconfigurator.TriggerConfiguratorContent), itself a full parity
// port of web/src/features/automations/pages/TriggerConfigurator.tsx. The web source is an unrouted,
// controlled form sub-component the Automation builder embeds (props: trigger + onChange; one data hook,
// useGeofences), so this layer follows the sanctioned thin-wrapper precedent (AutomationCard / ConditionBuilder):
// it embeds the one shared surface verbatim — every panel, string, and data state is that parity-covered
// surface — and adds only the page state holder + a stateless screen (DRY, ADR-006). It performs NO HTTP and
// re-implements no rendering.
//
// DRY NOTE (honesty): unlike the sibling ConditionBuilder/AutomationCard page surfaces, whose shared feature
// views ship NO state holder (so each page had to add its own), the shared TriggerConfigurator feature view
// already ships a lifecycle-aware [TriggerConfiguratorViewModel] (the geofence cache-then-network feed —
// useGeofences). Re-declaring an identical page-layer holder would duplicate it, so this surface REUSES that
// shared holder (via its public `factory(source, logger)`) as the page state holder the prompt mandates, and
// keeps only the page-scoped registration/diagnostics local. The geofence [kotlinx.coroutines.flow.StateFlow]
// is collected here and handed to the stateless screen as a single [UiState] projection; the trigger value
// stays caller-owned (web `trigger`/`onChange`), so no business logic is added by this layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app
// uses. `MatchingDeclarationName` is suppressed for the co-located screen + page entry points.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.triggerconfigurator.StringResolver
import io.teslasync.android.featureviews.triggerconfigurator.TriggerConfiguratorContent
import io.teslasync.android.featureviews.triggerconfigurator.TriggerConfiguratorSource
import io.teslasync.android.featureviews.triggerconfigurator.TriggerConfiguratorViewModel
import io.teslasync.android.featureviews.triggerconfigurator.TriggerKind
import io.teslasync.android.featureviews.triggerconfigurator.createDefaultTrigger
import io.teslasync.android.featureviews.triggerconfigurator.foldCatalogKey
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.locations.Geofence

/**
 * Stateful entry for the TriggerConfigurator page surface. Builds the shared [TriggerConfiguratorViewModel]
 * from the host-supplied geofence [source] (the web `useGeofences` seam, an adapter over the shared S8
 * Locations data layer), records the one-shot `view.opened` diagnostic (P1/S11), and binds the stateless
 * screen to the holder's geofence [kotlinx.coroutines.flow.StateFlow]. The trigger value stays caller-owned
 * (web `TriggerConfiguratorProps`): [trigger] is rendered as-is and every edit is reported through [onChange].
 *
 * @param trigger the current trigger value (the web `trigger` prop).
 * @param onChange invoked with the next trigger on every edit (the web `onChange` prop).
 * @param source the cache-then-network geofence seam backing the geofence dropdown.
 * @param logger the redacting logger backing the surface; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TriggerConfiguratorPage(
    trigger: AutomationTriggerInput,
    onChange: (AutomationTriggerInput) -> Unit,
    source: TriggerConfiguratorSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TriggerConfiguratorViewModel =
        viewModel(
            key = TriggerConfiguratorPageRegistration.SLUG,
            factory = TriggerConfiguratorViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { recordTriggerConfiguratorPageOpened(logger) }
    val geofenceState by viewModel.geofences.collectAsStateWithLifecycle()
    TriggerConfiguratorScreen(
        state = geofenceState,
        trigger = trigger,
        onChange = onChange,
        modifier = modifier,
        onRetryGeofences = viewModel::retry,
    )
}

/**
 * The stateless TriggerConfigurator page screen. Renders the shared TriggerConfigurator feature view content
 * ([TriggerConfiguratorContent]) for the supplied geofence [state] and caller-owned [trigger], so every panel,
 * string, and data state — the geofence dropdown's loading / content / empty / stale-offline / error chrome,
 * plus the four kind-specific bodies (schedule / event / geofence / signal) — is the single parity-covered
 * surface (DRY, ADR-006). The host owns the [kotlinx.coroutines.flow.StateFlow] behind [state] and the
 * [onChange] callback; this layer adds no rendering of its own.
 *
 * @param state the cache-then-network geofence projection driving the dropdown's freshness/empty/offline chrome.
 * @param trigger the caller-owned trigger value rendered by the embedded surface.
 * @param onChange invoked with the next trigger on every edit (kind switch / field change).
 * @param onRetryGeofences re-runs the host's geofence load — wired to the dropdown's offline/error retry.
 */
@Composable
fun TriggerConfiguratorScreen(
    state: UiState<List<Geofence>>,
    trigger: AutomationTriggerInput,
    onChange: (AutomationTriggerInput) -> Unit,
    modifier: Modifier = Modifier,
    onRetryGeofences: () -> Unit = {},
) {
    TriggerConfiguratorContent(
        trigger = trigger,
        onChange = onChange,
        geofenceState = state,
        onRetryGeofences = onRetryGeofences,
        resolve = rememberStringResolver(),
        modifier = modifier,
    )
}

/**
 * The by-name i18n resolver for the page surface — the production seam reproducing the web `t(key, default)`:
 * it resolves the dotted catalog key through the generated Android string catalog (ADR-014) and falls back to
 * the web's exact English text when a key is absent, so parity holds whether or not a given key has been
 * generated yet. Remembered against the context so a locale change re-resolves the surface. The catalog read
 * lives in the non-`@Composable` [optionalString] extension so the resource lookup is not a direct
 * `LocalContext.current` resource query inside a composable, mirroring the shared feature view's resolver.
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam reproducing web `t(key, default)`.
 * `getIdentifier` is the only way to attempt a key that may be absent (a compile-time `R.string` reference
 * cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed. Kept non-`@Composable`
 * so the catalog read is not flagged as a `LocalContext.current` resource query inside a composable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Previews (tooling-only; @Preview entry points exercise the geofence dropdown's success + empty states) ──

private val PREVIEW_GEOFENCES =
    listOf(
        Geofence(
            id = 1,
            name = "Home",
            polygonWkt = "POLYGON((0 0,0 1,1 1,1 0,0 0))",
            category = "home",
            enabled = true,
            createdAt = "2026-06-11T12:00:00Z",
            updatedAt = "2026-06-11T12:00:00Z",
            latitude = 37.42,
            longitude = -122.08,
            radius = 120.0,
        ),
        Geofence(
            id = 2,
            name = "Office",
            polygonWkt = "POLYGON((2 2,2 3,3 3,3 2,2 2))",
            category = "work",
            enabled = true,
            createdAt = "2026-06-11T12:00:00Z",
            updatedAt = "2026-06-11T12:00:00Z",
            latitude = 37.49,
            longitude = -122.14,
            radius = 90.0,
        ),
    )

@Preview(name = "Geofence trigger — fences loaded", showBackground = true)
@Composable
private fun TriggerConfiguratorScreenContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TriggerConfiguratorScreen(
            state = UiState(UiPhase.Content, data = PREVIEW_GEOFENCES),
            trigger = createDefaultTrigger(TriggerKind.Geofence),
            onChange = {},
        )
    }
}

@Preview(name = "Geofence trigger — no fences", showBackground = true)
@Composable
private fun TriggerConfiguratorScreenEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TriggerConfiguratorScreen(
            state = UiState(UiPhase.Empty, data = emptyList()),
            trigger = createDefaultTrigger(TriggerKind.Geofence),
            onChange = {},
        )
    }
}
