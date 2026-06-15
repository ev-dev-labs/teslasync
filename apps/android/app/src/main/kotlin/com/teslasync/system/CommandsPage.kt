// The native Jetpack Compose + Material 3 CommandsPage system surface — a parity port of
// web/src/features/system/pages/CommandsPage.tsx, the remote-control center mounted at /commands. It reproduces the
// web page's header (title + subtitle + the "View History" link and the online-count chip), the four fleet metric
// cards (Vehicles / Online / Asleep / Refresh), the states-error banner (GlassPanel5), and the per-vehicle
// VehicleCommandCenter list — every visible string resolved from the generated res/values catalog (ADR-014), every
// SI value converted inside each command center at the display boundary by the shared UnitFormatter (web `useUnits`).
//
// Composition: [CommandsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the resolved snapshot, wires the View-History deep link, and
// builds the per-vehicle command-center binder); [CommandsPageContent] is the stateless render layer that switches
// the loading / empty / success surfaces off the bound [UiState] and threads each row into a VehicleCommandCenter.
//
// State matrix (web parity): loading → metric-card + command-center skeletons; success → the four cards + the
// per-vehicle command centers; empty (no enrolled vehicle, web `!vehicles?.length`) → the no-data stats empty-state
// + the "No vehicles found" command-center empty. A hard vehicle-list failure with no cache folds into the empty
// rendering, exactly as the web page does (a failed `useVehicles` leaves `vehicles` undefined ⇒ the same
// `!vehicles?.length` branch); the page declares no separate error chrome.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the command-center binder.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.commands

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandCenterCommander
import io.teslasync.android.featureviews.vehiclecommandcenter.CommandLatestSource
import io.teslasync.android.featureviews.vehiclecommandcenter.VehicleCommandCenter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Height of each command-center loading skeleton — the web `<Skeleton className="h-72" />` (72 × 4px). */
private val CommandCenterSkeletonHeight = 288.dp

/** Height of each metric-card loading skeleton. */
private val StatSkeletonHeight = 64.dp

/** Minimum touch target for the compact View-History header link (ADR-015 ≥ 48dp). */
private val ViewHistoryMinHeight = 48.dp

/**
 * The per-vehicle command-center seams the page threads into each embedded VehicleCommandCenter (web
 * `<VehicleCommandCenter vehicle={v} state={…} />` — each center binds its own `command-latest` feed + the shared
 * command mutation). [latestSourceFor] yields the latest-status feed for a vehicle id; [commander] is the one shared
 * dispatcher. Sourced from [CommandsPageSource] so the view depends on abstractions, never the network.
 */
data class CommandsCommandCenterBinder(
    val latestSourceFor: (Long) -> CommandLatestSource,
    val commander: CommandCenterCommander,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [CommandsPageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Commands + Vehicle-command holders via [commandsPageSourceOf]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun CommandsPage(
    source: CommandsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: CommandsPageViewModel =
        viewModel(
            key = CommandsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { CommandsPageViewModel(source, logger) } },
        )
    CommandsPage(viewModel = viewModel, source = source, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot, wires the
 * "View History" deep-link affordance + the per-vehicle command-center binder, and hands the stateless content the
 * accessibility pane title (web `usePageTitle(t('commands.title'))`).
 */
@Composable
fun CommandsPage(
    viewModel: CommandsPageViewModel,
    source: CommandsPageSource,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // "View History" navigates to /command-history. No NavController is exposed to page hosts, so the app's own
    // teslasync://app deep-link scheme (AndroidManifest + TeslaSyncNavHost) is the sanctioned forward-nav seam.
    val uriHandler = LocalUriHandler.current
    val onViewHistory: () -> Unit =
        remember(uriHandler) { { uriHandler.openUri(CommandsPageRegistration.COMMAND_HISTORY_DEEP_LINK) } }

    val binder =
        remember(source) { CommandsCommandCenterBinder(source::commandLatestFor, source.commander) }

    val title = stringResource(R.string.translation_commands_title)

    CommandsPageContent(
        uiState = uiState,
        binder = binder,
        onViewHistory = onViewHistory,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the header, then the FadeIn stats section (the
 * four metric cards, the loading skeletons, or the no-data empty-state), the conditional states-error banner
 * (GlassPanel5), and finally the per-vehicle command-center list (or its loading skeletons / no-vehicles empty).
 */
@Composable
fun CommandsPageContent(
    uiState: UiState<CommandsSnapshot>,
    binder: CommandsCommandCenterBinder,
    onViewHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = uiState.data
    val hasVehicles = snapshot?.hasVehicles == true

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        CommandsHeader(
            stats = if (hasVehicles) snapshot.stats else null,
            onViewHistory = onViewHistory,
        )

        FadeIn {
            when {
                hasVehicles -> CommandsStatsGrid(stats = snapshot.stats)
                uiState.isLoading -> CommandsStatsSkeleton()
                else -> CommandsNoDataStats()
            }
        }

        if (snapshot?.statesError == true) {
            CommandsStatesErrorPanel()
        }

        when {
            uiState.isLoading -> CommandsLoadingList()
            hasVehicles -> CommandsCenterList(rows = snapshot.rows, binder = binder)
            else -> CommandsNoVehiclesState()
        }
    }
}

/**
 * The page header — the title + subtitle and the actions row (the View-History deep-link affordance + the
 * online-count chip, shown only once a fleet is loaded; web `vehicles && length > 0`).
 */
@Composable
private fun CommandsHeader(
    stats: CommandsStats?,
    onViewHistory: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_commands_pageTitle))
        BodyText(
            stringResource(R.string.translation_commands_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ViewHistoryLink(onClick = onViewHistory)
            if (stats != null) {
                OnlineCountChip(stats = stats)
            }
        }
    }
}

/** The "View History" link — icon + label, navigating to the command-history deep link (web `<Link>`). */
@Composable
private fun ViewHistoryLink(onClick: () -> Unit) {
    val label = stringResource(R.string.translation_commands_viewHistory)
    Row(
        modifier =
            Modifier
                .clip(MaterialTheme.shapes.small)
                .clickable(onClick = onClick)
                .heightIn(min = ViewHistoryMinHeight)
                .padding(horizontal = Spacing.sm)
                .semantics {
                    role = Role.Button
                    contentDescription = label
                },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            CommandsGlyphs.History,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(label)
    }
}

/** The online-count chip — `{onlineCount}` in the success tone, then `/{total} {online}` muted (web header span). */
@Composable
private fun OnlineCountChip(stats: CommandsStats) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(stats.onlineCount.toString(), color = TeslaTokens.status.success)
        BodyText(
            "/${stats.vehicleCount} ${stringResource(R.string.translation_online)}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The four fleet metric cards — Vehicles / Online / Asleep / Refresh — in a 2 × 2 native grid (web responsive grid). */
@Composable
private fun CommandsStatsGrid(stats: CommandsStats) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_Vehicles),
                value = stats.vehicleCount.toString(),
                icon = CommandsGlyphs.Car,
                accent = TeslaTokens.status.info,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = stringResource(R.string.translation_Online),
                value = stats.onlineCount.toString(),
                icon = CommandsGlyphs.Wifi,
                accent = TeslaTokens.status.success,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_Asleep),
                value = stats.asleepCount.toString(),
                icon = CommandsGlyphs.Power,
                accent = TeslaTokens.status.warning,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = stringResource(R.string.translation_Refresh),
                value = REFRESH_INTERVAL_LABEL,
                icon = CommandsGlyphs.Loader,
                accent = TeslaTokens.chart.power,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** The no-data stats empty-state — web `<EmptyState icon={Activity} message={t('common.noData')} />`. */
@Composable
private fun CommandsNoDataStats() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = CommandsGlyphs.Activity,
    )
}

/** GlassPanel5 — the states-error banner (web `{statesError && <GlassPanel>…}`); shown only on a hard states read failure. */
@Composable
private fun CommandsStatesErrorPanel() {
    val message = stringResource(R.string.translation_commands_statesError)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = message },
        padding = PanelPadding.Sm,
        accent = PanelAccent.Danger,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                CommandsGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.danger,
            )
            BodyText(message, color = TeslaTokens.status.danger)
        }
    }
}

/** The command-center loading skeletons — web `[1, 2].map(i => <Skeleton className="h-72" />)`. */
@Composable
private fun CommandsLoadingList() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        repeat(SKELETON_COUNT) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = CommandCenterSkeletonHeight, rounded = true)
        }
    }
}

/** The metric-card loading skeletons (the FadeIn stats section while the vehicle list loads). */
@Composable
private fun CommandsStatsSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(modifier = Modifier.weight(1f), height = StatSkeletonHeight, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = StatSkeletonHeight, rounded = true)
            }
        }
    }
}

/** The no-vehicles empty state — web `<EmptyState icon={Car} title={commands.noVehicles} message={commands.connectFleet} />`. */
@Composable
private fun CommandsNoVehiclesState() {
    EmptyState(
        message = stringResource(R.string.translation_commands_connectFleet),
        icon = CommandsGlyphs.Car,
        title = stringResource(R.string.translation_commands_noVehicles),
    )
}

/** The per-vehicle command centers — web `vehicles.map(v => <StaggerItem><VehicleCommandCenter …/></StaggerItem>)`. */
@Composable
private fun CommandsCenterList(
    rows: List<CommandsVehicleRow>,
    binder: CommandsCommandCenterBinder,
) {
    StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        rows.forEachIndexed { index, row ->
            StaggerItem(index = index) {
                val latestSource = remember(row.vehicle.id) { binder.latestSourceFor(row.vehicle.id) }
                VehicleCommandCenter(
                    vehicle = toCommandCenterVehicle(row.vehicle, row.state),
                    vehicleState = toCommandCenterVehicleState(row.state),
                    latestSource = latestSource,
                    commander = binder.commander,
                )
            }
        }
    }
}

/** Number of command-center skeletons rendered while the vehicle list loads (web `[1, 2]`). */
private const val SKELETON_COUNT = 2
