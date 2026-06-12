// The native Jetpack Compose + Material 3 VehicleCommandCenter feature view — a parity port of
// web/src/features/system/components/VehicleCommandCenter.tsx, the Vehicle Commands orchestrator. It binds
// the data hooks through the shared S8 layer (the [VehicleCommandCenterViewModel] over a [CommandLatestSource]
// + [CommandCenterCommander]; the unit formatter from `LocalDataContainer`), then composes the web layout
// from native primitives + design tokens (P1/S9): the vehicle header (name, state badge, freshness, model ·
// VIN, and battery / range / temperature metrics formatted at the display boundary), the post-command
// feedback panel, the asleep + stale banners, the command search field, the favourites bar, and either the
// flat search-results grid (with its "No commands match your search" empty surface) or the per-category
// collapsible groups — plus the centralized input / select / confirm dialogs. Every string resolves through
// the i18n facade (P1/S10), every tile + control carries a TalkBack label, and the surface emits the one-shot
// `view.opened` diagnostic (P1/S11). The view performs NO HTTP.
//
// Every state the web source defines is reproduced: the latest-status feed's loading / stale / offline /
// error chrome (over the always-present static grid), the post-command success/error feedback, the asleep
// and stale banners, the search-empty surface, the favourites bar (hidden only when empty, exactly as web
// `return null`), and the three dialogs. The bound feed never hides the command grid — the web grid is
// static config, decorated (not gated) by the latest-status query.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.FreshnessIndicator
import io.teslasync.android.components.datadisplay.isStale
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val MILLIS_PER_SECOND = 1_000L
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point — the faithful 1:1 port of the web `VehicleCommandCenter({ vehicle, state })` props.
 * Binds the latest-status feed via [latestSource] and the command-dispatch [commander] into a
 * [VehicleCommandCenterViewModel], records the one-shot `view.opened` diagnostic, owns the component-local UI
 * state the web component keeps in `useState` (search query, favourites, the active dialog), surfaces the
 * one-shot command outcome as a toast (web `useToast`), and renders the stateless [VehicleCommandCenterContent].
 *
 * @param vehicle the target vehicle (web `vehicle`).
 * @param vehicleState the live vehicle state, or `null` (web `state`).
 * @param latestSource the cache-then-network latest-command feed seam (a host adapter ↔ a test fake).
 * @param commander the command-dispatch seam (a [StoreCommandCenterCommander] adapter in production).
 * @param commands the command catalogue (web imported `COMMANDS`); defaults to [DEFAULT_COMMAND_CATALOG].
 * @param favoritesStore the favourites persistence seam (web `localStorage`); defaults to the process store.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleCommandCenter(
    vehicle: CommandCenterVehicle,
    vehicleState: CommandCenterVehicleState?,
    latestSource: CommandLatestSource,
    commander: CommandCenterCommander,
    modifier: Modifier = Modifier,
    commands: List<CommandCenterCommand> = DEFAULT_COMMAND_CATALOG,
    favoritesStore: CommandFavoritesStore = SessionCommandFavoritesStore,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = VehicleCommandCenterRegistration.ID,
) {
    val viewModel: VehicleCommandCenterViewModel =
        viewModel(
            key = "$instanceKey-${vehicle.id}",
            factory =
                viewModelFactory {
                    initializer { VehicleCommandCenterViewModel(vehicle.id, latestSource, commander, logger) }
                },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val latest by viewModel.state.collectAsStateWithLifecycle()
    val inFlight by viewModel.inFlightCommand.collectAsStateWithLifecycle()
    val lastResult by viewModel.lastResult.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val lookup = remember(context) { { name: String -> context.optionalString(name) } }

    var favorites by remember(vehicle.id) {
        mutableStateOf(favoritesStore.read(vehicle.id) ?: VehicleCommandCenterProjection.defaultFavorites(commands))
    }
    var search by rememberSaveable(vehicle.id) { mutableStateOf("") }
    var dialog by remember(vehicle.id) { mutableStateOf<DialogRequest?>(null) }
    var toasts by remember { mutableStateOf<List<ToastItem>>(emptyList()) }

    val sentLabel = resolveOptional(lookup, foldCatalogKey("commands.toast.sent"), "Command sent")
    val failedLabel = resolveOptional(lookup, foldCatalogKey("commands.toast.failed"), "Command failed")

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event is UiEvent.CommandOutcome) {
                val message = if (event.success) "${vehicle.name}: $sentLabel" else "${vehicle.name}: $failedLabel"
                val tone = if (event.success) Tone.Success else Tone.Danger
                toasts = enqueueToast(toasts, ToastItem(id = System.nanoTime(), message = message, tone = tone), MAX_TOASTS)
            }
        }
    }
    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        VehicleCommandCenterContent(
            vehicle = vehicle,
            vehicleState = vehicleState,
            commands = commands,
            latest = latest,
            favorites = favorites,
            inFlightCommand = inFlight,
            lastResult = lastResult,
            dialog = dialog,
            search = search,
            formatter = formatter,
            lookup = lookup,
            onSearchChange = { search = it },
            onExecute = { command, params -> viewModel.executeCommand(command, params.toCommandBody()) },
            onToggleFavorite = { id ->
                favorites = VehicleCommandCenterProjection.toggleFavorite(favorites, id)
                favoritesStore.write(vehicle.id, favorites)
            },
            onRequestDialog = { command ->
                VehicleCommandCenterProjection.dialogKindFor(command)?.let { kind -> dialog = DialogRequest(kind, command) }
            },
            onDialogSubmit = { command, params ->
                dialog = null
                viewModel.executeCommand(command.command, params.toCommandBody())
            },
            onDialogDismiss = { dialog = null },
            onRetry = viewModel::refresh,
        )
        ToastHost(toasts = toasts, onDismiss = { toasts = dismissToast(toasts, it) })
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * layout end to end: the [GlassPanel] header, the latest-feed freshness chrome, the post-command feedback
 * panel, the asleep + stale banners, the search field, the favourites bar, and either the flat
 * search-results grid (with the empty surface) or the per-category groups, plus the routed dialog. [lookup]
 * resolves localized command + category labels; tests pass a fixed lookup (English fallbacks).
 */
@Composable
fun VehicleCommandCenterContent(
    vehicle: CommandCenterVehicle,
    vehicleState: CommandCenterVehicleState?,
    commands: List<CommandCenterCommand>,
    latest: UiState<List<CommandLogEntry>>,
    favorites: List<String>,
    inFlightCommand: String?,
    lastResult: CommandResultFeedback?,
    dialog: DialogRequest?,
    search: String,
    formatter: UnitFormatter,
    lookup: (String) -> String?,
    onSearchChange: (String) -> Unit,
    onExecute: (command: String, params: Map<String, String>) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onRequestDialog: (CommandCenterCommand) -> Unit,
    onDialogSubmit: (CommandCenterCommand, Map<String, String>) -> Unit,
    onDialogDismiss: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val nowMs = remember(latest.fetchedAt, vehicle.updatedAt) { System.currentTimeMillis() }
    val byCommand = remember(latest.data) { VehicleCommandCenterProjection.latestByCommand(latest.data.orEmpty()) }
    val freshnessFormatter = rememberFreshnessFormatter()
    val ageFormatter = rememberCommandAgeFormatter()

    val filtered =
        remember(search, commands, lookup) {
            VehicleCommandCenterProjection.filterCommands(commands, search) { commandLabel(it, lookup) }
        }
    val grouped = remember(commands) { VehicleCommandCenterProjection.groupedInOrder(commands) }
    val favoriteCommands = remember(favorites, commands) { VehicleCommandCenterProjection.favoriteCommands(favorites, commands) }

    val isAsleep = VehicleCommandCenterProjection.isAsleep(vehicle.state)
    val vehicleAgeSeconds =
        remember(vehicle.updatedAt, nowMs) {
            parseTimestampMillis(vehicle.updatedAt)?.let { (nowMs - it) / MILLIS_PER_SECOND }
        }
    val vehicleStale = isStale(vehicleAgeSeconds)

    val tileState =
        CommandTileRenderState(
            favorites = favorites,
            inFlightCommand = inFlightCommand,
            vehicleState = vehicleState,
            byCommand = byCommand,
            nowMs = nowMs,
            toggleFavoriteLabel = stringResource(R.string.translation_commands_toggleFavorite),
            onLabel = resolveOptional(lookup, foldCatalogKey("commands.toggle.on"), "ON"),
            offLabel = resolveOptional(lookup, foldCatalogKey("commands.toggle.off"), "OFF"),
        )
    val renderTile: @Composable (CommandCenterCommand) -> Unit = { command ->
        RenderCommandTile(command, tileState, lookup, ageFormatter, onExecute, onRequestDialog, onToggleFavorite)
    }

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        VehicleCommandHeader(
            vehicle = vehicle,
            vehicleState = vehicleState,
            isAsleep = isAsleep,
            formatter = formatter,
            latest = latest,
            freshnessFormatter = freshnessFormatter,
            onRetry = onRetry,
        )
        lastResult?.let { result ->
            VerticalGap(Spacing.md)
            CommandResultPanel(result)
        }
        if (isAsleep) {
            VerticalGap(Spacing.md)
            AlertBanner(
                message =
                    "${resolveOptional(lookup, foldCatalogKey("Vehicle is"), "Vehicle is")} ${vehicle.state}. " +
                        resolveOptional(
                            lookup,
                            foldCatalogKey("Wake it up first to send commands."),
                            "Wake it up first to send commands.",
                        ),
                tone = Tone.Warning,
                icon = VehicleCommandCenterGlyphs.power,
            )
        }
        if (vehicleStale && !isAsleep) {
            VerticalGap(Spacing.md)
            AlertBanner(
                message =
                    stringResource(
                        R.string.translation_commands_staleData,
                        freshnessFormatter(relativeAge(vehicleAgeSeconds)),
                    ),
                tone = Tone.Warning,
                icon = VehicleCommandCenterGlyphs.clock,
            )
        }
        VerticalGap(Spacing.lg)
        Input(
            value = search,
            onValueChange = onSearchChange,
            label = stringResource(R.string.translation_commands_search_placeholder), // parity:allow i18n key
            leadingIcon = FormsGlyphs.Search,
        )
        VerticalGap(Spacing.lg)
        VehicleCommandBody(
            filtered = filtered,
            grouped = grouped,
            favoriteCommands = favoriteCommands,
            lookup = lookup,
            renderTile = renderTile,
        )
    }

    dialog?.let { request ->
        CommandDialogHost(
            request = request,
            lookup = lookup,
            loading = inFlightCommand != null,
            onSubmit = onDialogSubmit,
            onDismiss = onDialogDismiss,
        )
    }
}

@Composable
private fun VehicleCommandHeader(
    vehicle: CommandCenterVehicle,
    vehicleState: CommandCenterVehicleState?,
    isAsleep: Boolean,
    formatter: UnitFormatter,
    latest: UiState<List<CommandLogEntry>>,
    freshnessFormatter: (FreshnessAge) -> String,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                PanelTitle(vehicle.name, modifier = Modifier.semantics { heading() })
                Badge(text = vehicle.state, variant = if (isAsleep) BadgeVariant.Neutral else BadgeVariant.Success)
                FreshnessIndicator(
                    timestampMillis = parseTimestampMillis(vehicle.updatedAt),
                    showLabel = false,
                    formatAge = freshnessFormatter,
                )
            }
            Caption("${vehicle.model} · ${vehicle.vin}")
        }
        Column(horizontalAlignment = Alignment.End) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                DataFreshness(
                    updatedAtMillis = latest.fetchedAt?.takeIf { it > 0 },
                    isFetching = latest.isLoading || latest.refreshing,
                    isStale = latest.stale,
                    isError = latest.hasError,
                    compact = true,
                    fetchingLabel = stringResource(R.string.translation_common_loading),
                    errorLabel = stringResource(R.string.translation_common_offline),
                    formatAge = freshnessFormatter,
                )
                if (latest.canRetry) {
                    IconButton(
                        imageVector = FeedbackGlyphs.Refresh,
                        contentDescription = stringResource(R.string.translation_common_retry),
                        onClick = onRetry,
                        size = IconSize.Sm,
                    )
                }
            }
            if (vehicleState != null) {
                VerticalGap(Spacing.sm)
                VehicleCommandMetrics(vehicleState = vehicleState, formatter = formatter)
            }
        }
    }
}

@Composable
private fun VehicleCommandMetrics(
    vehicleState: CommandCenterVehicleState,
    formatter: UnitFormatter,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        HeaderMetric(icon = VehicleCommandCenterGlyphs.battery, value = "${vehicleState.batteryLevel}%")
        HeaderMetric(icon = VehicleCommandCenterGlyphs.wifi, value = formatter.distance(vehicleState.ratedRange))
        if (vehicleState.insideTemp != null) {
            HeaderMetric(icon = VehicleCommandCenterGlyphs.thermometer, value = formatter.temperature(vehicleState.insideTemp))
        }
    }
}

@Composable
private fun HeaderMetric(
    icon: ImageVector,
    value: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(value)
    }
}

@Composable
private fun CommandResultPanel(result: CommandResultFeedback) {
    GlassPanel(
        modifier = Modifier.fillMaxWidth(),
        padding = PanelPadding.Sm,
        accent = if (result.success) PanelAccent.Success else PanelAccent.Danger,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                imageVector = if (result.success) TeslaGlyphs.Check else TeslaGlyphs.Warning,
                contentDescription = null,
                size = IconSize.Md,
                tint = if (result.success) TeslaTokens.status.success else TeslaTokens.status.danger,
            )
            Caption(result.message)
        }
    }
}

@Composable
private fun VehicleCommandBody(
    filtered: List<CommandCenterCommand>?,
    grouped: List<CommandCenterCategoryGroup>,
    favoriteCommands: List<CommandCenterCommand>,
    lookup: (String) -> String?,
    renderTile: @Composable (CommandCenterCommand) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (filtered == null) {
            CommandFavoritesSection(
                commands = favoriteCommands,
                quickActionsLabel = stringResource(R.string.translation_commands_cat_quickActions),
                renderTile = renderTile,
            )
        }
        if (filtered != null) {
            if (filtered.isEmpty()) {
                EmptyState(message = stringResource(R.string.translation_commands_search_noResults))
            } else {
                CommandTileGrid(commands = filtered, renderTile = renderTile)
            }
        } else {
            val locale = currentLocale()
            val expandLabel = resolveOptional(lookup, foldCatalogKey("commands.group.expand"), "Click to expand")
            val collapseLabel = resolveOptional(lookup, foldCatalogKey("commands.group.collapse"), "Click to collapse")
            grouped.forEach { group ->
                CommandCategorySection(
                    group = group,
                    categoryLabel = categoryLabel(group.category, lookup).uppercase(locale),
                    expandLabel = expandLabel,
                    collapseLabel = collapseLabel,
                    renderTile = renderTile,
                )
            }
        }
    }
}

@Composable
private fun VerticalGap(height: androidx.compose.ui.unit.Dp) {
    Spacer(modifier = Modifier.height(height))
}

// ── Tile wiring (glue between the projection + the inline tiles) ─────────────────────────────────────

/** The per-render tile state threaded into every tile by [VehicleCommandCenterContent]. */
@Suppress("LongParameterList")
private data class CommandTileRenderState(
    val favorites: List<String>,
    val inFlightCommand: String?,
    val vehicleState: CommandCenterVehicleState?,
    val byCommand: Map<String, CommandLogEntry>,
    val nowMs: Long,
    val toggleFavoriteLabel: String,
    val onLabel: String,
    val offLabel: String,
)

@Composable
private fun RenderCommandTile(
    command: CommandCenterCommand,
    state: CommandTileRenderState,
    lookup: (String) -> String?,
    ageFormatter: (CommandAge) -> String,
    onExecute: (String, Map<String, String>) -> Unit,
    onRequestDialog: (CommandCenterCommand) -> Unit,
    onToggleFavorite: (String) -> Unit,
) {
    CommandTile(
        command = command,
        label = commandLabel(command, lookup),
        sublabel = commandSublabel(command, lookup),
        statusLabel = statusLabelFor(command, state.byCommand, state.nowMs, ageFormatter),
        statusTone = statusToneFor(command, state.byCommand),
        loading = state.inFlightCommand != null,
        running = isRunning(command, state.inFlightCommand),
        isFavorite = VehicleCommandCenterProjection.isFavorite(state.favorites, command.id),
        toggleOn =
            if (command.type == CommandType.Toggle) {
                VehicleCommandCenterProjection.toggleIsOn(command, state.vehicleState)
            } else {
                null
            },
        onTap = { dispatchTile(command, state.vehicleState, onExecute, onRequestDialog) },
        onToggleFavorite = { onToggleFavorite(command.id) },
        toggleFavoriteLabel = state.toggleFavoriteLabel,
        onLabel = state.onLabel,
        offLabel = state.offLabel,
    )
}

private fun dispatchTile(
    command: CommandCenterCommand,
    vehicleState: CommandCenterVehicleState?,
    onExecute: (String, Map<String, String>) -> Unit,
    onRequestDialog: (CommandCenterCommand) -> Unit,
) {
    val dialogKind = VehicleCommandCenterProjection.dialogKindFor(command)
    when {
        command.type == CommandType.Toggle && dialogKind == null ->
            onExecute(VehicleCommandCenterProjection.toggleCommandFor(command, vehicleState), command.params)
        dialogKind != null -> onRequestDialog(command)
        else -> onExecute(command.command, command.params)
    }
}

private fun isRunning(
    command: CommandCenterCommand,
    inFlightCommand: String?,
): Boolean = inFlightCommand != null && (inFlightCommand == command.command || inFlightCommand == command.commandOff)

private fun statusToneFor(
    command: CommandCenterCommand,
    byCommand: Map<String, CommandLogEntry>,
): CommandStatusTone = CommandStatusTone.fromStatus(VehicleCommandCenterProjection.statusEntryFor(command, byCommand)?.status)

private fun statusLabelFor(
    command: CommandCenterCommand,
    byCommand: Map<String, CommandLogEntry>,
    nowMs: Long,
    ageFormatter: (CommandAge) -> String,
): String? {
    val entry = VehicleCommandCenterProjection.statusEntryFor(command, byCommand)
    val createdMs = entry?.createdAt?.let { parseTimestampMillis(it) }
    if (entry == null || createdMs == null) return null
    val age = ageFormatter(VehicleCommandCenterProjection.commandAge(nowMs - createdMs))
    val prefix =
        if (CommandStatusTone.fromStatus(entry.status) == CommandStatusTone.Success) {
            CommandStatusTone.SUCCESS_PREFIX
        } else {
            CommandStatusTone.FAILURE_PREFIX
        }
    return "$prefix $age"
}

/** Converts a string param map to the JSON command body — `null` when empty (web omits an empty body). */
private fun Map<String, String>.toCommandBody(): JsonObject? = if (isEmpty()) null else JsonObject(mapValues { JsonPrimitive(it.value) })

// ── i18n + freshness formatters (the display-boundary localizers) ────────────────────────────────────

/** Resolves a by-name string from the Android catalog, or `null` when absent — the native `t(key, default)` seam. */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

@Composable
private fun rememberCommandAgeFormatter(): (CommandAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(locale, justNow, minutes, hours, days) {
        { age ->
            when (age) {
                CommandAge.JustNow -> justNow
                is CommandAge.Minutes -> minutes.format(locale, age.value)
                is CommandAge.Hours -> hours.format(locale, age.value)
                is CommandAge.Days -> days.format(locale, age.value)
            }
        }
    }
}

@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}
