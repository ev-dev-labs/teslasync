// The native Jetpack Compose + Material 3 SecurityAccessPage admin surface — a parity port of
// web/src/features/admin/pages/SecurityAccessPage.tsx, the lock / sentry / doors / windows monitor. It reproduces
// the page's two GlassPanels (the "may not be secure" alert / secure-status panel, and the live vehicle-state
// panel), every data state (loading / empty / error / content), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [SecurityAccessPage] is the stateful entry (constructs the view-model over the host-wired source +
// the app selection holder, records the one-shot `view.opened` diagnostic, collects the feeds);
// [SecurityAccessPageContent] is the stateless render layer driven entirely by the two [UiState]s + [SecurityAccessActions].
// All derivation lives in the framework-free model (SecurityAccessPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.admin.securityaccess

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The page's interaction callbacks, wired to the [SecurityAccessPageViewModel] (web query `refetch`). */
data class SecurityAccessActions(
    val onRetry: () -> Unit,
    val onRetryVehicles: () -> Unit,
)

private const val FADE_STEP_MS = 60

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SecurityAccessPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] + [io.teslasync.shared.core.presentation.admin.AdminStore]
 * via [securityAccessSourceOf]) and the app-wide [selection]. [logger] defaults to the app's redacting logger.
 */
@Composable
fun SecurityAccessPage(
    source: SecurityAccessSource,
    selection: SelectedVehicleStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SecurityAccessPageViewModel =
        viewModel(
            key = SecurityAccessRegistration.SLUG,
            factory = viewModelFactory { initializer { SecurityAccessPageViewModel(source, selection, logger) } },
        )
    SecurityAccessPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] security + vehicles feeds to the stateless content. */
@Composable
fun SecurityAccessPage(
    viewModel: SecurityAccessPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val securityState by viewModel.securityState.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            SecurityAccessActions(
                onRetry = viewModel::retry,
                onRetryVehicles = viewModel::refreshVehicles,
            )
        }

    SecurityAccessPageContent(
        securityState = securityState,
        vehiclesState = vehiclesState,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle), the optional load-failed error banner (web `anyError`),
 * then the two GlassPanels — the secure/alert status panel and the live vehicle-state panel. The security feed
 * drives each panel's loading / empty / content phase; the vehicles feed contributes only to the error banner.
 */
@Composable
fun SecurityAccessPageContent(
    securityState: UiState<SecurityAccessData>,
    vehiclesState: UiState<List<*>>,
    actions: SecurityAccessActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SecurityAccessHeader()

        if (securityState.hasError || vehiclesState.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                icon = SecurityGlyphs.AlertCircle,
                action =
                    BannerAction(
                        label = stringResource(R.string.translation_error_retry),
                        onClick = if (securityState.hasError) actions.onRetry else actions.onRetryVehicles,
                    ),
            )
        }

        // GlassPanel1 — the security status / "may not be secure" alert (web alert banner GlassPanel).
        FadeIn { SecurityStatusPanel(state = securityState) }

        // GlassPanel2 — the live vehicle-state panel (web Digital-Twin / LiveVehicleState GlassPanel).
        FadeIn(delayMs = FADE_STEP_MS) { LiveStatePanel(state = securityState) }
    }
}

/** The page header — the `<h1>` title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun SecurityAccessHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_security_title))
        BodyText(
            stringResource(R.string.translation_admin_security_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel1 — secure status / alert ───────────────────────────────────────────────────────────────────────

/**
 * The security-status panel: a spinner while the first history load is in flight, otherwise the secure/unsecure
 * banner. When the vehicle "may not be secure" it shows the danger-accented alert (web `admin.security.alert`);
 * otherwise it shows the secure header with the current lock + sentry chips. The panel is always rendered (never
 * hidden on null) so the region never collapses to a blank box.
 */
@Composable
private fun SecurityStatusPanel(state: UiState<SecurityAccessData>) {
    val data = state.data ?: SecurityAccessData.EMPTY
    val hasLatest = data.latest != null
    val unsecure = hasLatest && !data.isSecure
    val accent = if (unsecure) PanelAccent.Danger else PanelAccent.Success
    val description = stringResource(R.string.translation_admin_security_statsTitle)

    GlassPanel(
        modifier = Modifier.semantics { contentDescription = description },
        padding = PanelPadding.Md,
        accent = accent,
    ) {
        when {
            state.isLoading ->
                Spinner(size = SpinnerSize.Sm, label = stringResource(R.string.translation_admin_security_stat_status))

            unsecure ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = SecurityGlyphs.ShieldAlert,
                        contentDescription = null,
                        size = IconSize.Md,
                        tint = MaterialTheme.colorScheme.error,
                    )
                    BodyText(
                        stringResource(R.string.translation_admin_security_alert),
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.error,
                    )
                }

            else ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = SecurityGlyphs.Shield,
                            contentDescription = null,
                            size = IconSize.Md,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        PanelTitle(stringResource(R.string.translation_admin_security_secure))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                        Badge(text = lockLabel(data.latest?.locked), variant = if (data.latest?.locked == true) BadgeVariant.Success else BadgeVariant.Neutral)
                        Badge(text = sentryLabel(data.sentryActive), variant = if (data.sentryActive) BadgeVariant.Info else BadgeVariant.Neutral)
                        Caption(stringResource(R.string.translation_admin_security_stat_totalEvents) + ": " + data.totalEvents)
                    }
                }
        }
    }
}

// ── GlassPanel2 — live vehicle state ──────────────────────────────────────────────────────────────────────────

/**
 * The live vehicle-state panel: a spinner during the first load, an empty state when the vehicle has no recorded
 * security signals yet (web `latest == null`), otherwise the latest snapshot rendered as a definition list (lock /
 * sentry / doors / windows + the live security fields). Always rendered (never hidden on null).
 */
@Composable
private fun LiveStatePanel(state: UiState<SecurityAccessData>) {
    val data = state.data ?: SecurityAccessData.EMPTY
    val latest = data.latest
    val description = stringResource(R.string.translation_admin_security_liveState)

    GlassPanel(
        modifier = Modifier.semantics { contentDescription = description },
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = SecurityGlyphs.Eye,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            PanelTitle(stringResource(R.string.translation_admin_security_liveState), modifier = Modifier.weight(1f))
            Badge(text = stringResource(R.string.translation_admin_security_live_indicator), variant = BadgeVariant.Info, dot = true)
        }

        when {
            state.isLoading ->
                Spinner(
                    modifier = Modifier.padding(top = Spacing.md),
                    size = SpinnerSize.Sm,
                    label = stringResource(R.string.translation_admin_security_live_indicator),
                )

            latest == null ->
                EmptyState(
                    message = stringResource(R.string.translation_admin_security_live_noData),
                    icon = SecurityGlyphs.Eye,
                )

            else ->
                KVList(
                    items = liveItems(data, latest),
                    modifier = Modifier.padding(top = Spacing.sm),
                )
        }
    }
}

/** Builds the live definition-list rows from the latest snapshot, each label/value resolved from strings.xml. */
@Composable
private fun liveItems(
    data: SecurityAccessData,
    latest: SecurityRow,
): List<KVItem> {
    val windowsValue =
        if (allWindowsClosed(latest)) {
            stringResource(R.string.translation_admin_security_closed)
        } else {
            openWindowCount(latest).toString() + " " + stringResource(R.string.translation_admin_security_open)
        }
    return listOf(
        KVItem(stringResource(R.string.translation_admin_security_card_lockStatus), lockLabel(latest.locked)),
        KVItem(stringResource(R.string.translation_admin_security_card_sentryMode), sentryLabel(data.sentryActive)),
        KVItem(stringResource(R.string.translation_admin_security_card_doors), if (doorClosed(latest.doorState)) stringResource(R.string.translation_admin_security_closed) else stringResource(R.string.translation_admin_security_open)),
        KVItem(stringResource(R.string.translation_admin_security_card_windows), windowsValue),
        KVItem(stringResource(R.string.translation_admin_security_stat_sentryUptime), data.sentryUptimePct.toString() + "%"),
        KVItem(stringResource(R.string.translation_admin_security_live_centerDisplay), latest.centerDisplay ?: EM_DASH),
        KVItem(stringResource(R.string.translation_admin_security_live_driverSeat), occupancyLabel(latest.driverSeatOccupied)),
        KVItem(stringResource(R.string.translation_admin_security_live_serviceMode), onOffLabel(latest.serviceMode)),
        KVItem(stringResource(R.string.translation_admin_security_live_valetMode), onOffLabel(latest.valetModeEnabled)),
        KVItem(stringResource(R.string.translation_admin_security_live_pairedKeys), latest.pairedPhoneKeyCount?.toString() ?: EM_DASH),
        KVItem(stringResource(R.string.translation_admin_security_stat_totalEvents), data.totalEvents.toString()),
    )
}

// ── Localized value helpers ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun lockLabel(locked: Boolean?): String =
    when (locked) {
        true -> stringResource(R.string.translation_admin_security_locked)
        false -> stringResource(R.string.translation_admin_security_unlocked)
        null -> EM_DASH
    }

@Composable
private fun sentryLabel(active: Boolean): String =
    if (active) stringResource(R.string.translation_admin_security_on) else stringResource(R.string.translation_admin_security_off)

@Composable
private fun onOffLabel(value: Boolean?): String =
    when (value) {
        true -> stringResource(R.string.translation_admin_security_on)
        false -> stringResource(R.string.translation_admin_security_off)
        null -> EM_DASH
    }

@Composable
private fun occupancyLabel(occupied: Boolean?): String =
    when (occupied) {
        true -> stringResource(R.string.translation_admin_security_live_occupied)
        false -> stringResource(R.string.translation_admin_security_live_empty)
        null -> EM_DASH
    }
