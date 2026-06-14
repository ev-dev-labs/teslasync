// The native Jetpack Compose + Material 3 CommandPalette shared surface — a parity port of
// web/src/components/ui/CommandPalette.tsx. The web surface is a global Cmd/Ctrl-K overlay: a search box over a
// categorized, keyboard-navigable list of every route you can open, every vehicle command you can run, every
// registry action (theme, refresh, …), every vehicle you can switch to, and live backend entity-search hits. It
// supports power-user scope prefixes (`>` commands, `/` pages, `@` vehicles, `:` settings), a frecency-ranked
// "Most Used" + strict-recency "Recent" section in the empty-query state, and a two-step "pick a vehicle" mode
// when a command needs a target and the fleet has more than one vehicle.
//
// All data + transient state flows through the shared [CommandPaletteViewModel] (P1/S8): the enrolled fleet + live
// entity search are cache-then-network [UiState]s, so this surface honestly renders the prompt's loading / content
// / empty / error / stale / offline matrix without hiding a region — a loading skeleton on first fetch, a
// QueryError + retry on a hard failure, a friendly "No vehicles available" / "No results" empty state, and a
// freshness chip while cached data is stale / refreshing / offline. The view performs NO HTTP; navigation is its
// only effect, invoked through the host's `onNavigate` callback (web `useNavigate`). Every string resolves through
// the i18n catalog (P1/S10) via `stringResource`; every interactive row carries a TalkBack label; a one-shot
// PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// The overlay composes the same Dialog + Surface primitives the shared `Modal` is built on, directly: the palette
// needs a FIXED search header, a SCROLLING result list, and a FIXED footer hint bar, which the generic single-
// scroll `Modal` cannot express. All controls reuse the shared atomic components (Input / Button / Icon /
// IconButton / Badge / EmptyState / QueryError / Skeleton) — no web Tailwind classes, platform design tokens only
// (P1/S9).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless content +
// helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.sharedsurfaces.commandpalette

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.navigation.NavGroup
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.navigation.navGroupTitle
import io.teslasync.android.navigation.navTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchStore
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore

/** Test tag on the surface root so on-device UI tests can locate the rendered palette in any state. */
const val COMMAND_PALETTE_TEST_TAG: String = "command-palette"

/** Test tag on the search input. */
const val COMMAND_PALETTE_INPUT_TEST_TAG: String = "command-palette-input"

/** Test tag on the result list. */
const val COMMAND_PALETTE_LIST_TEST_TAG: String = "command-palette-list"

/**
 * Stateful entry point — the parity port of the web `<CommandPalette/>`. Renders nothing while [open] is false (the
 * web conditional mount). Binds the unified seam via [source] into a [CommandPaletteViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), collects every feed + transient state, assembles the localized rows, and
 * renders the overlay. [source] defaults to the shared P1/S8 holders from the [LocalDataContainer] (a true drop-in
 * like the web component); a host or test may inject a different seam. [onNavigate] receives a chosen route's web
 * path (web `useNavigate`); [onDismiss] closes the overlay.
 */
@Composable
fun CommandPalette(
    open: Boolean,
    onDismiss: () -> Unit,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
    source: CommandPaletteSource = rememberCommandPaletteSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    val viewModel: CommandPaletteViewModel =
        viewModel(key = CommandPaletteRegistration.ID, factory = CommandPaletteViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val query by viewModel.query.collectAsStateWithLifecycle()
    val mode by viewModel.mode.collectAsStateWithLifecycle()
    val pendingCommand by viewModel.pendingCommand.collectAsStateWithLifecycle()
    val fleetState by viewModel.fleet.collectAsStateWithLifecycle()
    val searchState by viewModel.search.collectAsStateWithLifecycle()
    val isForwardAuth by viewModel.isForwardAuth.collectAsStateWithLifecycle()
    val scores by viewModel.scores.collectAsStateWithLifecycle()
    val recentPages by viewModel.recentPages.collectAsStateWithLifecycle()
    val strings = rememberCommandPaletteStrings()

    val close: () -> Unit = {
        viewModel.reset()
        onDismiss()
    }

    val fleet = fleetState.data ?: CommandPaletteFleet(emptyList(), null)
    val parsed = parsePalettePrefix(query)
    val emptyQuery = query.trim().isEmpty() && mode == CommandPaletteMode.Search
    val baseItems = buildBaseItems(fleet, isForwardAuth, strings, searchState.data ?: emptyList())
    val mostUsed = if (emptyQuery) mostUsedItems(baseItems.candidates, scores, strings.sectionMostUsed) else emptyList()
    val recent = if (emptyQuery) buildRecentItems(recentPages, strings) else emptyList()
    val allItems = baseItems.searchHits + mostUsed + recent + baseItems.registry + baseItems.switches + baseItems.nav + baseItems.commands
    val groups = remember(allItems, query, scores) { groupItems(rankItems(allItems, parsed, scores)) }

    val onItem: (PaletteItem) -> Unit = { item -> activateItem(item, viewModel, onNavigate, close) }

    CommandPaletteContent(
        state =
            CommandPaletteUi(
                mode = mode,
                query = query,
                activeScope = parsed.scope,
                fleet = fleetState,
                search = searchState,
                groups = groups,
                vehicleTargets = fleet.vehicles,
                pendingLabel = pendingCommand?.let { vehicleCommandLabel(it) },
                showViewAll = showViewAllResults((searchState.data ?: emptyList()).size, parsed.term),
            ),
        strings = strings,
        modifier = modifier,
        onQueryChange = viewModel::onQueryChange,
        onItem = onItem,
        onVehicleTarget = { id ->
            viewModel.chooseVehicleForCommand(id)
            close()
        },
        onBack = viewModel::goBack,
        onClose = close,
        onClearScope = { viewModel.onQueryChange("") },
        onRetry = viewModel::retry,
    )
}

/**
 * Resolves the shared P1/S8 holders from the [LocalDataContainer] into the surface seam. The always-available fleet
 * + selection come from the app container; the [searchStore], [commandStore], and [authModeStore] are injected by a
 * host that owns them (the container does not yet surface them) — when omitted the surface degrades to safe
 * fallbacks. The recent/frecency history is a self-contained in-process store, remembered per placement.
 */
@Composable
fun rememberCommandPaletteSource(
    searchStore: SearchStore? = null,
    commandStore: VehicleCommandStore? = null,
    authModeStore: AuthModeStore? = null,
): CommandPaletteSource {
    val container = LocalDataContainer.current
    return remember(container, searchStore, commandStore, authModeStore) {
        StoreCommandPaletteSource(
            vehiclesStore = container.vehiclesStore,
            selection = container.selectedVehicleStore,
            recentStore = PaletteRecentStore(),
            logger = container.logger,
            stores = CommandPaletteStores(search = searchStore, command = commandStore, authMode = authModeStore),
        )
    }
}

/** The fully-resolved UI inputs the stateless content renders — built once in the stateful entry, deterministic in tests. */
data class CommandPaletteUi(
    val mode: CommandPaletteMode,
    val query: String,
    val activeScope: PaletteScope?,
    val fleet: UiState<CommandPaletteFleet>,
    val search: UiState<List<PaletteSearchHit>>,
    val groups: List<PaletteGroup>,
    val vehicleTargets: List<PaletteVehicle>,
    val pendingLabel: String?,
    val showViewAll: Boolean,
)

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the fixed search
 * header (or the vehicle-select header in submode), an optional active-scope chip + a fleet freshness chip, the
 * scrolling result body (loading skeleton / error + retry / empty / grouped rows / vehicle-target rows), and the
 * fixed footer hint bar.
 */
@Composable
fun CommandPaletteContent(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    modifier: Modifier = Modifier,
    onQueryChange: (String) -> Unit = {},
    onItem: (PaletteItem) -> Unit = {},
    onVehicleTarget: (Long) -> Unit = {},
    onBack: () -> Unit = {},
    onClose: () -> Unit = {},
    onClearScope: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        CommandPaletteScaffold(
            state = state,
            strings = strings,
            modifier = modifier,
            onQueryChange = onQueryChange,
            onItem = onItem,
            onVehicleTarget = onVehicleTarget,
            onBack = onBack,
            onClose = onClose,
            onClearScope = onClearScope,
            onRetry = onRetry,
        )
    }
}

/**
 * The overlay panel itself — a fixed search header, a scrolling result body, and a fixed footer — hoisted out of
 * the [Dialog] so it is preview- and screenshot-testable for each state without a dialog window.
 */
@Composable
fun CommandPaletteScaffold(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    modifier: Modifier = Modifier,
    onQueryChange: (String) -> Unit = {},
    onItem: (PaletteItem) -> Unit = {},
    onVehicleTarget: (Long) -> Unit = {},
    onBack: () -> Unit = {},
    onClose: () -> Unit = {},
    onClearScope: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Surface(
        modifier =
            modifier
                .fillMaxWidth(DIALOG_WIDTH_FRACTION)
                .testTag(COMMAND_PALETTE_TEST_TAG)
                .semantics { contentDescription = strings.dialogLabel },
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = DIALOG_ELEVATION,
    ) {
        Column(modifier = Modifier.padding(Spacing.md)) {
            CommandPaletteHeader(state = state, strings = strings, onQueryChange = onQueryChange, onBack = onBack)
            FleetFreshnessChip(state = state.fleet, strings = strings)
            Spacer(Modifier.size(Spacing.sm))
            Box(modifier = Modifier.heightIn(max = BODY_MAX_HEIGHT)) {
                CommandPaletteBody(
                    state = state,
                    strings = strings,
                    onItem = onItem,
                    onVehicleTarget = onVehicleTarget,
                    onRetry = onRetry,
                )
            }
            Spacer(Modifier.size(Spacing.sm))
            CommandPaletteFooter(state = state, strings = strings, onClearScope = onClearScope, onClose = onClose)
        }
    }
}

/** The fixed header — the search input (search mode) or a "Send {command} to…" + Back row (vehicle-select mode). */
@Composable
private fun CommandPaletteHeader(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    onQueryChange: (String) -> Unit,
    onBack: () -> Unit,
) {
    if (state.mode == CommandPaletteMode.VehicleSelect) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            IconButton(
                imageVector = TeslaGlyphs.ChevronLeft,
                contentDescription = strings.back,
                onClick = onBack,
                size = IconSize.Md,
            )
            PanelTitle(
                text = strings.selectVehicleFor(state.pendingLabel ?: ""),
                modifier = Modifier.weight(1f),
            )
        }
        return
    }
    Input(
        value = state.query,
        onValueChange = onQueryChange,
        modifier = Modifier.testTag(COMMAND_PALETTE_INPUT_TEST_TAG),
        hint = strings.searchHint,
        leadingIcon = NavGlyphs.Search,
    )
}

/** The fleet freshness chip — offline (cached after a failed refresh), updating (refresh in flight), or stale. */
@Composable
private fun FleetFreshnessChip(
    state: UiState<CommandPaletteFleet>,
    strings: CommandPaletteStrings,
) {
    when {
        state.hasError && state.hasData -> Badge(text = strings.offline, variant = BadgeVariant.Warning, dot = true)
        state.refreshing -> Badge(text = strings.updating, variant = BadgeVariant.Neutral, dot = true)
        state.stale && state.hasData -> Badge(text = strings.stale, variant = BadgeVariant.Info, dot = true)
    }
}

/** The scrolling result body — branches on mode then on the loading / error / empty / content state. */
@Composable
private fun CommandPaletteBody(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    onItem: (PaletteItem) -> Unit,
    onVehicleTarget: (Long) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        state.mode == CommandPaletteMode.VehicleSelect -> VehicleSelectBody(state, strings, onVehicleTarget, onRetry)
        state.fleet.isLoading && state.groups.isEmpty() -> LoadingRows(strings)
        state.fleet.isError && state.groups.isEmpty() ->
            QueryError(kind = fleetErrorKind(state.fleet), resourceName = strings.resourceVehicle, onRetry = onRetry)
        state.groups.isEmpty() -> NoResults(state, strings)
        else -> ResultList(state, strings, onItem)
    }
}

/** The vehicle-select submode body — the loading / error / empty / target-list states for the fleet feed. */
@Composable
private fun VehicleSelectBody(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    onVehicleTarget: (Long) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        state.fleet.isLoading -> LoadingRows(strings)
        state.fleet.isError -> QueryError(kind = fleetErrorKind(state.fleet), resourceName = strings.resourceVehicle, onRetry = onRetry)
        state.vehicleTargets.isEmpty() -> EmptyState(message = strings.noVehicles, icon = NavGlyphs.Car)
        else ->
            LazyColumn(modifier = Modifier.fillMaxWidth().testTag(COMMAND_PALETTE_LIST_TEST_TAG)) {
                item { SectionHeader(strings.sectionSelectVehicle) }
                items(state.vehicleTargets, key = { it.id }) { vehicle ->
                    VehicleTargetRow(vehicle = vehicle, strings = strings, onClick = { onVehicleTarget(vehicle.id) })
                }
            }
    }
}

/** The grouped result list — each section header followed by its rows, plus the optional "View all results" row. */
@Composable
private fun ResultList(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    onItem: (PaletteItem) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxWidth().testTag(COMMAND_PALETTE_LIST_TEST_TAG)) {
        state.groups.forEach { group ->
            item(key = "section-${group.section}") { SectionHeader(group.section) }
            items(group.items, key = { it.id }) { item ->
                PaletteRow(item = item, onClick = { onItem(item) })
            }
        }
        if (state.showViewAll) {
            item(key = "view-all") {
                BodyText(
                    text = strings.viewAll(state.query),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable(onClickLabel = strings.select) { onItem(viewAllItem(state.query, strings)) }
                            .padding(Spacing.md),
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

/** The "no results" empty surface (web `palette.noResults`), shown when nothing matches the current query. */
@Composable
private fun NoResults(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
) {
    EmptyState(
        message = if (state.query.isBlank()) strings.noVehicles else strings.noResults(state.query),
        icon = NavGlyphs.Search,
    )
}

/** A loading skeleton of shimmer rows while the fleet's first fetch is in flight. */
@Composable
private fun LoadingRows(strings: CommandPaletteStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = ROW_SKELETON_HEIGHT, rounded = true)
        }
    }
}

/** A section header row (the localized group title). */
@Composable
private fun SectionHeader(title: String) {
    Caption(
        text = title,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
    )
}

/** One palette result row — a leading glyph, the label + optional sublabel, and an optional shortcut/affordance. */
@Composable
private fun PaletteRow(
    item: PaletteItem,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm)
                .semantics { contentDescription = rowAccessibilityLabel(item) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(paletteGlyph(item.icon), contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.weight(1f)) {
            BodyText(text = item.label, maxLines = 1)
            val sublabel = item.sublabel
            if (sublabel != null) {
                Caption(text = sublabel)
            }
        }
        if (item.shortcut != null) {
            ShortcutHint(item.shortcut)
        } else {
            Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** One vehicle-target row in the vehicle-select submode — the name + a "model" sublabel. */
@Composable
private fun VehicleTargetRow(
    vehicle: PaletteVehicle,
    strings: CommandPaletteStrings,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClickLabel = strings.select, onClick = onClick)
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm)
                .semantics { contentDescription = vehicle.label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.weight(1f)) {
            BodyText(text = vehicle.label, maxLines = 1)
            val model = vehicle.model
            if (!model.isNullOrBlank()) {
                Caption(text = model)
            }
        }
        Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A small framed shortcut hint chip (e.g. "g d"), labelled for assistive tech. */
@Composable
private fun ShortcutHint(shortcut: String) {
    val label = stringResource(R.string.translation_palette_shortcut, shortcut)
    Surface(
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.semantics { contentDescription = label },
    ) {
        Caption(text = shortcut, modifier = Modifier.padding(horizontal = Spacing.xs, vertical = OFFSET_ZERO))
    }
}

/** The fixed footer — an active-scope chip with a clear affordance, the navigate/select/close hints, fleet count. */
@Composable
private fun CommandPaletteFooter(
    state: CommandPaletteUi,
    strings: CommandPaletteStrings,
    onClearScope: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (state.activeScope != null) {
            ScopeChip(scope = state.activeScope, strings = strings, onClear = onClearScope)
            Spacer(Modifier.weight(1f))
        } else {
            Caption(text = strings.filterHint, modifier = Modifier.weight(1f))
        }
        Caption(text = strings.navigate)
        Caption(text = strings.select)
        FleetCountChip(state = state.fleet, strings = strings)
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = strings.close,
            onClick = onClose,
            size = IconSize.Sm,
        )
    }
}

/** The active-scope chip with a clear affordance (web scope pill + clear-filter aria). */
@Composable
private fun ScopeChip(
    scope: PaletteScope,
    strings: CommandPaletteStrings,
    onClear: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(Radius.pill))
                .clickable(onClickLabel = strings.clearFilter, onClick = onClear)
                .padding(horizontal = Spacing.sm, vertical = OFFSET_ZERO)
                .semantics { contentDescription = strings.clearScope(scope.name) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(text = scope.prefix.toString())
        Icon(TeslaGlyphs.Close, contentDescription = null, size = IconSize.Xs)
    }
}

/** The fleet count chip in the footer (web `{n} vehicle(s)`), with a lightning glyph. */
@Composable
private fun FleetCountChip(
    state: UiState<CommandPaletteFleet>,
    strings: CommandPaletteStrings,
) {
    val count = state.data?.vehicles?.size ?: 0
    if (count == 0) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(NavGlyphs.Bolt, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(text = "$count ${if (count == 1) strings.vehicleWord else strings.vehiclesWord}")
    }
}

private const val DIALOG_WIDTH_FRACTION = 0.96f
private val DIALOG_ELEVATION = 6.dp
private val BODY_MAX_HEIGHT: Dp = 420.dp
private val ROW_SKELETON_HEIGHT: Dp = 44.dp
private val OFFSET_ZERO: Dp = 2.dp
private const val LOADING_ROW_COUNT = 5

// ── Localized strings (P1/S10) ───────────────────────────────────────────────────────────────────────────────

/**
 * The localized chrome strings the surface folds into its output, resolved once at the render boundary (P1/S10).
 * Static labels are plain fields; the four `%1$s`-parameterized catalog strings are exposed as helpers that fill
 * the slot. Tests/previews pass a deterministic instance, keeping the render branches locale-stable.
 *
 * `clearFilter` / `clearScope` reuse the catalog `common.clear` and `filterHint` is the language-neutral prefix
 * legend: the web `palette.clearFilter` / `palette.filterBy` / `palette.clearScope` keys are not present in the
 * P1/S10 catalog, so this is a documented, i18n-clean substitution (Honesty Covenant #9).
 */
@Suppress("LongParameterList")
data class CommandPaletteStrings(
    val dialogLabel: String,
    val searchHint: String,
    val noVehicles: String,
    val loading: String,
    val navigate: String,
    val select: String,
    val back: String,
    val close: String,
    val clearFilter: String,
    val filterHint: String,
    val vehicleWord: String,
    val vehiclesWord: String,
    val offline: String,
    val stale: String,
    val updating: String,
    val resourceVehicle: String,
    val sectionPages: String,
    val sectionCommands: String,
    val sectionVehicles: String,
    val sectionPreferences: String,
    val sectionActions: String,
    val sectionMostUsed: String,
    val sectionRecent: String,
    val sectionSelectVehicle: String,
    val selectVehiclePrompt: String,
    val clearWord: String,
    val selectVehicleForTemplate: String,
    val noResultsTemplate: String,
    val viewAllTemplate: String,
    val switchToTemplate: String,
) {
    /** "Send {command} to…" — the vehicle-select submode header (web `palette.selectVehicleFor`). */
    fun selectVehicleFor(command: String): String = selectVehicleForTemplate.format(command)

    /** "No results for {query}" — the empty-search surface (web `palette.noResults`). */
    fun noResults(query: String): String = noResultsTemplate.format(query)

    /** "View all results for {query}" — the search footer affordance (web `search.palette.viewAll`). */
    fun viewAll(query: String): String = viewAllTemplate.format(query)

    /** "Switch to {name}" — a vehicle-switch row label (web `palette.cmd.switchVehicle`). */
    fun switchTo(name: String): String = switchToTemplate.format(name)

    /** The clear-scope accessibility label ("Clear {scope}") — catalog `common.clear` + the scope name. */
    fun clearScope(scope: String): String = "$clearWord $scope"
}

/** Builds the localized [CommandPaletteStrings] from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
fun rememberCommandPaletteStrings(): CommandPaletteStrings {
    val hint = stringResource(R.string.translation_palette_placeholder) // parity:allow R.string id mirrors web i18n key palette.placeholder
    return CommandPaletteStrings(
        dialogLabel = hint,
        searchHint = hint,
        noVehicles = stringResource(R.string.translation_palette_noVehicles),
        loading = stringResource(R.string.translation_common_loading),
        navigate = stringResource(R.string.translation_palette_navigate),
        select = stringResource(R.string.translation_palette_select),
        back = stringResource(R.string.translation_palette_back),
        close = stringResource(R.string.translation_palette_close),
        clearFilter = stringResource(R.string.translation_common_clear),
        filterHint = PaletteScope.entries.joinToString("  ") { it.prefix.toString() },
        vehicleWord = stringResource(R.string.translation_palette_vehicle),
        vehiclesWord = stringResource(R.string.translation_palette_vehicles),
        offline = stringResource(R.string.translation_common_offline),
        stale = stringResource(R.string.translation_mqtt_stale),
        updating = stringResource(R.string.translation_freshness_updating),
        resourceVehicle = stringResource(R.string.translation_common_vehicle),
        sectionPages = stringResource(R.string.translation_palette_section_pages),
        sectionCommands = stringResource(R.string.translation_palette_section_commands),
        sectionVehicles = stringResource(R.string.translation_palette_section_vehicles),
        sectionPreferences = stringResource(R.string.translation_palette_section_preferences),
        sectionActions = stringResource(R.string.translation_palette_section_actions),
        sectionMostUsed = stringResource(R.string.translation_palette_section_mostUsed),
        sectionRecent = stringResource(R.string.translation_palette_section_recent),
        sectionSelectVehicle = stringResource(R.string.translation_palette_section_selectVehicle),
        selectVehiclePrompt = stringResource(R.string.translation_palette_cmd_selectVehicle),
        clearWord = stringResource(R.string.translation_common_clear),
        selectVehicleForTemplate = stringResource(R.string.translation_palette_selectVehicleFor),
        noResultsTemplate = stringResource(R.string.translation_palette_noResults),
        viewAllTemplate = stringResource(R.string.translation_search_palette_viewAll),
        switchToTemplate = stringResource(R.string.translation_palette_cmd_switchVehicle),
    )
}

// ── Item building ─────────────────────────────────────────────────────────────────────────────────────────────

/** The localized static catalogs the palette ranks over, plus the live search hits. */
private data class PaletteBaseItems(
    val nav: List<PaletteItem>,
    val commands: List<PaletteItem>,
    val registry: List<PaletteItem>,
    val switches: List<PaletteItem>,
    val searchHits: List<PaletteItem>,
) {
    /** The static rows eligible for the empty-query "Most Used" ranking (web `mostUsedItems` candidates). */
    val candidates: List<PaletteItem> get() = registry + switches + nav + commands
}

/** Builds every localized base row — nav pages, vehicle commands, registry actions, vehicle switches, search hits. */
@Composable
private fun buildBaseItems(
    fleet: CommandPaletteFleet,
    isForwardAuth: Boolean,
    strings: CommandPaletteStrings,
    searchHits: List<PaletteSearchHit>,
): PaletteBaseItems {
    val hits =
        searchHits.map { hit ->
            PaletteItem(
                id = "search-${searchHitSectionSuffix(hit.type)}-${hit.id}",
                type = PaletteItemType.SearchHit,
                label = hit.title,
                section = searchSectionLabel(hit.type),
                sublabel = hit.subtitle,
                icon = hit.icon,
                targetPath = hit.url,
            )
        }
    return PaletteBaseItems(
        nav = buildNavItems(isForwardAuth, strings),
        commands = if (fleet.isEmpty) emptyList() else buildCommandItems(fleet, strings),
        registry = buildRegistryItems(strings),
        switches = buildSwitchItems(fleet, strings),
        searchHits = hits,
    )
}

/** The nav-page rows — every listable destination, hiding auth-gated rows in open mode (web `navItems`). */
@Composable
private fun buildNavItems(
    isForwardAuth: Boolean,
    strings: CommandPaletteStrings,
): List<PaletteItem> =
    RouteTable.drawerSections.flatMap { section ->
        section.items
            .filter { isForwardAuth || it.id !in FORWARD_AUTH_ONLY }
            .map { dest ->
                PaletteItem(
                    id = dest.webPath,
                    type = PaletteItemType.Navigate,
                    label = navTitle(dest),
                    section = strings.sectionPages,
                    sublabel = navGroupTitle(dest.group),
                    keywords = navKeywords(dest),
                    icon = groupIconKind(dest.group),
                    targetPath = dest.webPath,
                )
            }
    }

/** The hardware vehicle-command rows (web `commandItems`); the sublabel names the lone vehicle or prompts to pick one. */
@Composable
private fun buildCommandItems(
    fleet: CommandPaletteFleet,
    strings: CommandPaletteStrings,
): List<PaletteItem> {
    val soleLabel = fleet.soleVehicleId?.let { id -> fleet.vehicles.firstOrNull { it.id == id }?.label }
    val sublabel = soleLabel?.let { "→ $it" } ?: strings.selectVehiclePrompt
    return VEHICLE_COMMAND_CONFIGS.map { config ->
        PaletteItem(
            id = config.id,
            type = PaletteItemType.VehicleCommand,
            label = vehicleCommandLabel(config.command),
            section = strings.sectionCommands,
            sublabel = sublabel,
            keywords = config.keywords,
            icon = config.icon,
        )
    }
}

/** The static registry rows — theme, refresh, feature pages, … (web `registryItems`). */
@Composable
private fun buildRegistryItems(strings: CommandPaletteStrings): List<PaletteItem> =
    REGISTRY_COMMANDS.map { config ->
        PaletteItem(
            id = config.id,
            type = PaletteItemType.Registry,
            label = registryLabel(config.id),
            section = registrySectionLabel(config.section, strings),
            keywords = config.keywords,
            icon = config.icon,
            shortcut = config.shortcut,
        )
    }

/** The vehicle-switch rows — every vehicle except the active one (web `vehicleSwitchItems`). */
@Composable
private fun buildSwitchItems(
    fleet: CommandPaletteFleet,
    strings: CommandPaletteStrings,
): List<PaletteItem> =
    fleet.switchTargets.map { vehicle ->
        PaletteItem(
            id = "switch-vehicle-${vehicle.id}",
            type = PaletteItemType.VehicleSwitch,
            label = strings.switchTo(vehicle.label),
            section = strings.sectionVehicles,
            sublabel = vehicle.model,
            keywords = listOf("switch", "vehicle", vehicle.label),
            icon = PaletteIconKind.SwitchVehicle,
        )
    }

/** The empty-query "Recent" rows — the strict-recency recent-page list (web `recentPageItems`). */
@Composable
private fun buildRecentItems(
    recentPages: List<RecentPageEntry>,
    strings: CommandPaletteStrings,
): List<PaletteItem> {
    val nowMillis = System.currentTimeMillis()
    return recentPages.take(CommandPaletteRegistration.RECENT_MAX).map { entry ->
        PaletteItem(
            id = "recent-page-${entry.path}",
            type = PaletteItemType.Navigate,
            label = entry.title,
            section = strings.sectionRecent,
            sublabel = recentAgeLabel(entry.visitedAtMillis, nowMillis),
            keywords = listOf(entry.path),
            icon = entry.icon,
            targetPath = entry.path,
        )
    }
}

/** The localized recent-visit age line — the native port of the web `formatRecentVisitedAgo` (plurals-aware). */
@Composable
private fun recentAgeLabel(
    visitedAtMillis: Long,
    nowMillis: Long,
): String =
    when (val age = recentAge(visitedAtMillis, nowMillis)) {
        RecentAge.JustNow -> stringResource(R.string.translation_palette_recent_justNow)
        is RecentAge.Minutes -> pluralStringResource(R.plurals.translation_palette_recent_minutesAgo, age.value, age.value)
        is RecentAge.Hours -> pluralStringResource(R.plurals.translation_palette_recent_hoursAgo, age.value, age.value)
        is RecentAge.Days -> pluralStringResource(R.plurals.translation_palette_recent_daysAgo, age.value, age.value)
    }

// ── i18n + icon resolvers ────────────────────────────────────────────────────────────────────────────────────

/** The localized hardware-command label (web fallback labels resolved through the catalog's command-name keys). */
@Composable
private fun vehicleCommandLabel(command: String): String =
    when (command) {
        "lock" -> stringResource(R.string.translation_glance_action_lock)
        "unlock" -> stringResource(R.string.translation_glance_action_unlock)
        "climate_on" -> stringResource(R.string.translation_glance_action_climateOn)
        "climate_off" -> stringResource(R.string.translation_glance_action_climateOff)
        "frunk_open" -> stringResource(R.string.translation_digitalTwin_frunk)
        "trunk_open" -> stringResource(R.string.translation_digitalTwin_trunk)
        "honk_horn" -> stringResource(R.string.translation_glance_action_horn)
        else -> stringResource(R.string.translation_activity_action_vehicleCommandFlash)
    }

/** The localized registry-command label (web `useCommandRegistry` catalog → `palette.cmd.*`). */
@Composable
private fun registryLabel(id: String): String =
    when (id) {
        "cmd-themeToggleMode" -> stringResource(R.string.translation_palette_cmd_themeToggleMode)
        "cmd-themePicker" -> stringResource(R.string.translation_palette_cmd_themePicker)
        "cmd-settings" -> stringResource(R.string.translation_palette_cmd_settings)
        "cmd-securitySettings" -> stringResource(R.string.translation_palette_cmd_securitySettings)
        "cmd-shortcuts" -> stringResource(R.string.translation_palette_cmd_shortcuts)
        "cmd-refresh" -> stringResource(R.string.translation_palette_cmd_refresh)
        "cmd-newAlert" -> stringResource(R.string.translation_palette_cmd_newAlert)
        "cmd-testAlert" -> stringResource(R.string.translation_palette_cmd_testAlert)
        "cmd-export" -> stringResource(R.string.translation_palette_cmd_export)
        "cmd-tour" -> stringResource(R.string.translation_palette_cmd_tour)
        "cmd-frecencyReset" -> stringResource(R.string.translation_palette_cmd_frecencyReset)
        "cmd-systemStatus" -> stringResource(R.string.translation_palette_cmd_systemStatus)
        "cmd-commandHistory" -> stringResource(R.string.translation_palette_cmd_commandHistory)
        "cmd-apiPlayground" -> stringResource(R.string.translation_palette_cmd_apiPlayground)
        "cmd-notificationsHistory" -> stringResource(R.string.translation_palette_cmd_notificationsHistory)
        "cmd-changelog" -> stringResource(R.string.translation_palette_cmd_changelog)
        else -> stringResource(R.string.translation_palette_cmd_help)
    }

/** The localized live-search section header (web `searchSectionLabel`). */
@Composable
private fun searchSectionLabel(type: SearchHitType): String =
    when (type) {
        SearchHitType.Vehicle -> stringResource(R.string.translation_search_section_vehicle)
        SearchHitType.Drive -> stringResource(R.string.translation_search_section_drive)
        SearchHitType.Charging -> stringResource(R.string.translation_search_section_charging)
        SearchHitType.Alert -> stringResource(R.string.translation_search_section_alert)
        SearchHitType.Notification -> stringResource(R.string.translation_search_section_notification)
        SearchHitType.Geofence -> stringResource(R.string.translation_search_section_geofence)
        SearchHitType.Automation -> stringResource(R.string.translation_search_section_automation)
        SearchHitType.Location -> stringResource(R.string.translation_search_section_location)
        SearchHitType.Trip -> stringResource(R.string.translation_search_section_trip)
    }

/** Resolves a registry [section] to its localized header. */
private fun registrySectionLabel(
    section: RegistrySection,
    strings: CommandPaletteStrings,
): String =
    when (section) {
        RegistrySection.Preferences -> strings.sectionPreferences
        RegistrySection.Actions -> strings.sectionActions
        RegistrySection.Pages -> strings.sectionPages
    }

/** Maps a [NavGroup] to a representative glyph identity for its nav rows. */
private fun groupIconKind(group: NavGroup): PaletteIconKind = GROUP_ICON_KINDS[group] ?: PaletteIconKind.Page

private val GROUP_ICON_KINDS: Map<NavGroup, PaletteIconKind> =
    mapOf(
        NavGroup.Dashboard to PaletteIconKind.Page,
        NavGroup.Vehicles to PaletteIconKind.Vehicle,
        NavGroup.Charging to PaletteIconKind.Charging,
        NavGroup.TripsDrives to PaletteIconKind.Drive,
        NavGroup.BatteryEnergy to PaletteIconKind.Charging,
        NavGroup.Analytics to PaletteIconKind.Page,
        NavGroup.Maps to PaletteIconKind.Location,
        NavGroup.VehicleSystems to PaletteIconKind.Settings,
        NavGroup.Automations to PaletteIconKind.Automation,
        NavGroup.Notifications to PaletteIconKind.Notification,
        NavGroup.Telemetry to PaletteIconKind.Action,
        NavGroup.Diagnostics to PaletteIconKind.Action,
        NavGroup.Admin to PaletteIconKind.Settings,
        NavGroup.PowerUser to PaletteIconKind.Action,
        NavGroup.System to PaletteIconKind.Settings,
        NavGroup.Settings to PaletteIconKind.Settings,
    )

/** Derives lightweight search synonyms for a nav destination from its path + id. */
private fun navKeywords(dest: Destination): List<String> =
    (dest.webPath.split('/', '-') + dest.id).filter { it.length > 1 }.map { it.lowercase() }.distinct()

/** Maps a framework-free [PaletteIconKind] to a concrete glyph. */
private fun paletteGlyph(kind: PaletteIconKind): ImageVector = PALETTE_GLYPHS[kind] ?: NavGlyphs.Bolt

private val PALETTE_GLYPHS: Map<PaletteIconKind, ImageVector> =
    mapOf(
        PaletteIconKind.Search to NavGlyphs.Search,
        PaletteIconKind.Vehicle to NavGlyphs.Car,
        PaletteIconKind.SwitchVehicle to NavGlyphs.Car,
        PaletteIconKind.Frunk to NavGlyphs.Car,
        PaletteIconKind.Trunk to NavGlyphs.Car,
        PaletteIconKind.Drive to NavGlyphs.Route,
        PaletteIconKind.Trip to NavGlyphs.Route,
        PaletteIconKind.Charging to NavGlyphs.Battery,
        PaletteIconKind.Alert to NavGlyphs.Bell,
        PaletteIconKind.Notification to NavGlyphs.Bell,
        PaletteIconKind.Horn to NavGlyphs.Bell,
        PaletteIconKind.Geofence to NavGlyphs.Shield,
        PaletteIconKind.Lock to NavGlyphs.Shield,
        PaletteIconKind.Unlock to NavGlyphs.Shield,
        PaletteIconKind.Automation to NavGlyphs.Workflow,
        PaletteIconKind.Location to NavGlyphs.Flag,
        PaletteIconKind.Settings to NavGlyphs.Gear,
        PaletteIconKind.Theme to NavGlyphs.Sliders,
        PaletteIconKind.Refresh to NavGlyphs.Pulse,
        PaletteIconKind.Climate to NavGlyphs.Pulse,
        PaletteIconKind.ClimateOff to NavGlyphs.Pulse,
        PaletteIconKind.Help to TeslaGlyphs.Help,
        PaletteIconKind.Page to NavGlyphs.Dashboard,
    )

/** The merged TalkBack reading for a row — label plus any sublabel. */
private fun rowAccessibilityLabel(item: PaletteItem): String = item.sublabel?.let { "${item.label}, $it" } ?: item.label

/** The synthetic "View all results" row — navigates to the full /search page (web `showViewAllResults`). */
private fun viewAllItem(
    query: String,
    strings: CommandPaletteStrings,
): PaletteItem =
    PaletteItem(
        id = "view-all",
        type = PaletteItemType.Navigate,
        label = strings.viewAll(query),
        section = strings.sectionPages,
        icon = PaletteIconKind.Search,
        targetPath = "/search",
    )

/** Classifies a `/vehicles` failure into a recovery-oriented [QueryErrorKind] (the sibling vehicle-surface fold). */
private fun fleetErrorKind(state: UiState<CommandPaletteFleet>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Dispatches a chosen [item] (web row `action`): a Navigate / search-hit routes through the host's [onNavigate]
 * and closes; a vehicle command runs (closing only when a single-vehicle fleet ran it immediately) or opens the
 * target picker; a vehicle-switch selects + closes; a registry row records + routes via the ViewModel.
 */
private fun activateItem(
    item: PaletteItem,
    viewModel: CommandPaletteViewModel,
    onNavigate: (String) -> Unit,
    close: () -> Unit,
) {
    val canonicalId = frecencyLookupId(item.id)
    when (item.type) {
        PaletteItemType.Navigate -> {
            val path = item.targetPath ?: canonicalId
            viewModel.recordNavigation(item.id, path, item.label, item.icon)
            onNavigate(path)
            close()
        }
        PaletteItemType.SearchHit -> {
            item.targetPath?.let(onNavigate)
            close()
        }
        PaletteItemType.VehicleSwitch -> {
            canonicalId.removePrefix("switch-vehicle-").toLongOrNull()?.let { viewModel.switchVehicle(it) }
            close()
        }
        PaletteItemType.VehicleCommand -> {
            if (viewModel.selectCommand(canonicalId.removePrefix("cmd-")) == CommandSelectOutcome.Ran) close()
        }
        PaletteItemType.Registry -> routeRegistry(canonicalId, viewModel, onNavigate, close)
    }
}

private fun routeRegistry(
    canonicalId: String,
    viewModel: CommandPaletteViewModel,
    onNavigate: (String) -> Unit,
    close: () -> Unit,
) {
    val config = REGISTRY_COMMANDS.firstOrNull { it.id == canonicalId } ?: return
    when (val routing = viewModel.runRegistry(config)) {
        is RegistryRouting.Navigate -> {
            onNavigate(routing.webPath)
            close()
        }
        RegistryRouting.Effected -> close()
    }
}

/** Destination ids hidden when the deployment is NOT behind a ForwardAuth identity provider (web `requiresAuth`). */
private val FORWARD_AUTH_ONLY: Set<String> = setOf("myActivity", "account2fa", "accountSessions")

// ── Previews — one per rendered state ────────────────────────────────────────────────────────────────────────

private fun previewStrings(): CommandPaletteStrings =
    CommandPaletteStrings(
        dialogLabel = "Search pages, commands…",
        searchHint = "Search pages, commands…",
        noVehicles = "No vehicles available",
        loading = "Loading…",
        navigate = "Navigate",
        select = "Select",
        back = "Back",
        close = "Close",
        clearFilter = "Clear",
        filterHint = ">  /  @  :",
        vehicleWord = "vehicle",
        vehiclesWord = "vehicles",
        offline = "Offline",
        stale = "Stale",
        updating = "updating…",
        resourceVehicle = "Vehicle",
        sectionPages = "Pages",
        sectionCommands = "Vehicle Commands",
        sectionVehicles = "Vehicles",
        sectionPreferences = "Preferences",
        sectionActions = "Actions",
        sectionMostUsed = "Most Used",
        sectionRecent = "Recent",
        sectionSelectVehicle = "Select Vehicle",
        selectVehiclePrompt = "Select vehicle…",
        clearWord = "Clear",
        selectVehicleForTemplate = "Send \"%1\$s\" to…",
        noResultsTemplate = "No results for \"%1\$s\"",
        viewAllTemplate = "View all results for \"%1\$s\"",
        switchToTemplate = "Switch to %1\$s",
    )

private fun previewGroups(): List<PaletteGroup> =
    listOf(
        PaletteGroup(
            "Pages",
            listOf(
                PaletteItem("/drives", PaletteItemType.Navigate, "Drives", "Pages", "Trips & Drives", icon = PaletteIconKind.Drive),
                PaletteItem("/charging", PaletteItemType.Navigate, "Charging", "Pages", "Charging", icon = PaletteIconKind.Charging),
            ),
        ),
        PaletteGroup(
            "Vehicle Commands",
            listOf(
                PaletteItem(
                    "cmd-lock",
                    PaletteItemType.VehicleCommand,
                    "Lock",
                    "Vehicle Commands",
                    "→ Red Rocket",
                    icon = PaletteIconKind.Lock,
                ),
                PaletteItem(
                    "cmd-honk_horn",
                    PaletteItemType.VehicleCommand,
                    "Honk Horn",
                    "Vehicle Commands",
                    "→ Red Rocket",
                    icon = PaletteIconKind.Horn,
                ),
            ),
        ),
    )

private fun previewFleet(): CommandPaletteFleet =
    CommandPaletteFleet(
        vehicles =
            listOf(
                PaletteVehicle(1, "Red Rocket", "Model 3"),
                PaletteVehicle(2, "Spacehauler", "Model Y"),
            ),
        activeVehicleId = 1,
    )

private fun previewUi(
    mode: CommandPaletteMode = CommandPaletteMode.Search,
    query: String = "",
    groups: List<PaletteGroup> = previewGroups(),
    fleet: UiState<CommandPaletteFleet> = UiState(UiPhase.Content, data = previewFleet()),
): CommandPaletteUi =
    CommandPaletteUi(
        mode = mode,
        query = query,
        activeScope = null,
        fleet = fleet,
        search = UiState(UiPhase.Content, data = emptyList()),
        groups = groups,
        vehicleTargets = previewFleet().vehicles,
        pendingLabel = if (mode == CommandPaletteMode.VehicleSelect) "Lock" else null,
        showViewAll = false,
    )

@Preview(name = "CommandPalette · content", showBackground = true)
@Composable
private fun CommandPaletteContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(state = previewUi(), strings = previewStrings())
    }
}

@Preview(name = "CommandPalette · loading", showBackground = true)
@Composable
private fun CommandPaletteLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(state = previewUi(groups = emptyList(), fleet = UiState.loading()), strings = previewStrings())
    }
}

@Preview(name = "CommandPalette · no vehicles", showBackground = true)
@Composable
private fun CommandPaletteEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(
            state =
                previewUi(
                    mode = CommandPaletteMode.VehicleSelect,
                    fleet = UiState(UiPhase.Empty, data = CommandPaletteFleet(emptyList(), null)),
                ).copy(vehicleTargets = emptyList()),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CommandPalette · error", showBackground = true)
@Composable
private fun CommandPaletteErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(
            state = previewUi(query = "btr", groups = emptyList(), fleet = UiState(UiPhase.Error, errorKind = ErrorKind.Network)),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "CommandPalette · vehicle select", showBackground = true)
@Composable
private fun CommandPaletteVehicleSelectPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(state = previewUi(mode = CommandPaletteMode.VehicleSelect), strings = previewStrings())
    }
}

@Preview(name = "CommandPalette · stale", showBackground = true)
@Composable
private fun CommandPaletteStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandPaletteScaffold(
            state = previewUi(fleet = UiState(UiPhase.Content, data = previewFleet(), fetchedAt = 0L, stale = true, refreshing = true)),
            strings = previewStrings(),
        )
    }
}
