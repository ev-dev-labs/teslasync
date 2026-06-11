// The native Jetpack Compose + Material 3 Command Quick Actions dashboard surface — a parity port of
// web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a title + lightning icon + freshness
// header) wrapping either the command grid (a Lock / Unlock / Climate On / Climate Off / Frunk / Horn /
// Flash / Trunk button grid whose visible subset + column count follow the footprint, each button showing
// its accent glyph or an in-flight spinner and disabled while any command runs) or the "No vehicle
// selected" empty surface when no vehicle resolved. All data flows through the shared
// [CommandQuickActionsWidgetViewModel]; the view never performs HTTP. Every string resolves through the
// i18n catalog (P1/S10) and every command button carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CommandQuickActionsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandquickactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3
private val SPINNER_STROKE = 2.dp
private const val CIRCLE_KAPPA = 0.5523f

/**
 * Stateful entry point. Binds the resolved-scope feed via [source] and the command-dispatch [commander]
 * into a [CommandQuickActionsWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders
 * the surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8
 * Vehicles data layer) + [commander] (an adapter over the shared `VehicleCommandStore`) and a unique
 * [instanceKey] per placement.
 *
 * @param source the cache-then-network resolved-scope seam (a [StoreCommandQuickActionsSource] adapter).
 * @param commander the command-dispatch seam (a [StoreCommandQuickActionsCommander] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandQuickActionsWidget(
    source: CommandQuickActionsSource,
    commander: CommandQuickActionsCommander,
    modifier: Modifier = Modifier,
    size: CommandQuickActionsSize = CommandQuickActionsRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CommandQuickActionsRegistration.ID,
) {
    val viewModel: CommandQuickActionsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { CommandQuickActionsWidgetViewModel(source, commander, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activeCommand by viewModel.activeCommand.collectAsStateWithLifecycle()

    CommandQuickActionsWidgetContent(
        state = state,
        size = size,
        activeCommand = activeCommand,
        onCommand = viewModel::sendCommand,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading -> skeleton, hard error -> retry) and otherwise the title +
 * freshness header over the command grid, or the "No vehicle selected" empty surface when no vehicle
 * resolved.
 */
@Composable
fun CommandQuickActionsWidgetContent(
    state: UiState<CommandQuickActionsSnapshot>,
    size: CommandQuickActionsSize,
    activeCommand: String?,
    onCommand: (String) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberCommandQuickActionsStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val hasVehicle = state.data?.hasVehicle == true
            val display =
                remember(size, activeCommand, strings) {
                    CommandQuickActionsProjection.project(size, activeCommand, strings)
                }
            LoadedChrome(state, size, hasVehicle, display, onCommand, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<CommandQuickActionsSnapshot>,
    size: CommandQuickActionsSize,
    hasVehicle: Boolean,
    display: CommandQuickActionsDisplay,
    onCommand: (String) -> Unit,
    onRefresh: () -> Unit,
    strings: CommandQuickActionsStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, onRefresh = onRefresh, strings = strings)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            if (hasVehicle) {
                CommandGrid(display = display, onCommand = onCommand)
            } else {
                CommandQuickActionsEmpty(strings)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<CommandQuickActionsSnapshot>,
    size: CommandQuickActionsSize,
    onRefresh: () -> Unit,
    strings: CommandQuickActionsStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!size.isCompact) {
            Icon(
                DataDisplayGlyphs.Bolt,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun CommandGrid(
    display: CommandQuickActionsDisplay,
    onCommand: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        display.buttons.chunked(display.columns).forEach { rowButtons ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowButtons.forEach { button ->
                    CommandButton(
                        button = button,
                        enabled = !display.anyRunning,
                        showLabel = display.showLabels,
                        onCommand = onCommand,
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(display.columns - rowButtons.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun CommandButton(
    button: CommandQuickActionsButton,
    enabled: Boolean,
    showLabel: Boolean,
    onCommand: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = { onCommand(button.command) },
        modifier = modifier.semantics { contentDescription = button.contentDescription },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = enabled,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (button.isRunning) {
                CircularProgressIndicator(
                    modifier = Modifier.size(IconSize.Md.dimension),
                    strokeWidth = SPINNER_STROKE,
                    color = TeslaTokens.status.info,
                )
            } else {
                Icon(
                    glyphVector(button.glyph),
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = accentColor(button.accent),
                )
            }
            if (showLabel) {
                Caption(button.label)
            }
        }
    }
}

@Composable
private fun CommandQuickActionsEmpty(strings: CommandQuickActionsStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = DataDisplayGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/** Map a [CommandQuickActionsGlyph] to a concrete icon at the render boundary. */
private fun glyphVector(glyph: CommandQuickActionsGlyph): ImageVector =
    when (glyph) {
        CommandQuickActionsGlyph.Lock -> DataDisplayGlyphs.Lock
        CommandQuickActionsGlyph.Unlock -> CommandQuickActionsGlyphs.Unlock
        CommandQuickActionsGlyph.ClimateOn -> CommandQuickActionsGlyphs.Thermometer
        CommandQuickActionsGlyph.ClimateOff -> DataDisplayGlyphs.Snowflake
        // The web uses the Lucide `Container` glyph for BOTH frunk and trunk; the same authored box is reused here.
        CommandQuickActionsGlyph.Frunk -> CommandQuickActionsGlyphs.Container
        CommandQuickActionsGlyph.Horn -> CommandQuickActionsGlyphs.Volume
        CommandQuickActionsGlyph.Flash -> CommandQuickActionsGlyphs.Flashlight
        CommandQuickActionsGlyph.Trunk -> CommandQuickActionsGlyphs.Container
        CommandQuickActionsGlyph.Zap -> DataDisplayGlyphs.Bolt
    }

/**
 * Map a [CommandQuickActionsAccent] to a concrete color. The semantic accents (green/red/cyan/amber)
 * resolve from the per-theme [TeslaTokens.status] palette so light/dark/high-contrast all track; the
 * remaining four use the web source's exact Tailwind mid-tone hues (`text-blue-400` / `text-purple-400` /
 * `text-yellow-400` / `text-indigo-400`) so the grid keeps its at-a-glance per-command color coding.
 */
@Composable
private fun accentColor(accent: CommandQuickActionsAccent): Color =
    when (accent) {
        CommandQuickActionsAccent.Green -> TeslaTokens.status.success
        CommandQuickActionsAccent.Red -> TeslaTokens.status.danger
        CommandQuickActionsAccent.Cyan -> TeslaTokens.status.info
        CommandQuickActionsAccent.Amber -> TeslaTokens.status.warning
        CommandQuickActionsAccent.Blue -> CommandAccentPalette.Blue
        CommandQuickActionsAccent.Purple -> CommandAccentPalette.Purple
        CommandQuickActionsAccent.Yellow -> CommandAccentPalette.Yellow
        CommandQuickActionsAccent.Indigo -> CommandAccentPalette.Indigo
    }

/** The four non-semantic command accents, matching the web source's Tailwind `*-400` classes verbatim. */
private object CommandAccentPalette {
    val Blue = Color(0xFF60A5FA)
    val Purple = Color(0xFFC084FC)
    val Yellow = Color(0xFFFACC15)
    val Indigo = Color(0xFF818CF8)
}

/**
 * Line-style command glyphs the shared icon set does not provide, authored here as 24x24 stroked vectors
 * — the same approach the data-display + UI layers use (`DataDisplayGlyphs` / `TeslaGlyphs`), since
 * Android has no bundled `lucide-react` equivalent without the frozen `material-icons-extended` artifact.
 * Lock / Snowflake (climate-off) / Bolt (zap) come from the shared `DataDisplayGlyphs`; these five fill
 * the gap for the web `Unlock` / `Thermometer` / `Container` / `Volume2` / `Flashlight` icons.
 */
private object CommandQuickActionsGlyphs {
    /** Open padlock (web `Unlock`): body, an open shackle hinged on the left, and a keyhole. */
    val Unlock: ImageVector =
        stroked("Unlock") {
            rect(4f, 11f, 20f, 21f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            curveTo(8f, 4f, 11f, 3f, 13.5f, 4f)
            circle(12f, 16f, 1.4f)
        }

    /** Thermometer (web `Thermometer`, climate-on): a stem, a bulb, and two scale ticks. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 15f)
            circle(12f, 18f, 3f)
            moveTo(14.5f, 7f)
            lineTo(16f, 7f)
            moveTo(14.5f, 10f)
            lineTo(16f, 10f)
        }

    /** Storage box (web `Container`, frunk + trunk): a box body with a lid seam and a handle. */
    val Container: ImageVector =
        stroked("Container") {
            rect(4f, 7f, 20f, 20f)
            moveTo(4f, 11f)
            lineTo(20f, 11f)
            moveTo(10f, 9f)
            lineTo(14f, 9f)
        }

    /** Speaker with sound waves (web `Volume2`, horn). */
    val Volume: ImageVector =
        stroked("Volume") {
            moveTo(4f, 9f)
            lineTo(8f, 9f)
            lineTo(12f, 5f)
            lineTo(12f, 19f)
            lineTo(8f, 15f)
            lineTo(4f, 15f)
            close()
            moveTo(15f, 9f)
            curveTo(17f, 11f, 17f, 13f, 15f, 15f)
            moveTo(17f, 7f)
            curveTo(20f, 10f, 20f, 14f, 17f, 17f)
        }

    /** Flashlight (web `Flashlight`, flash): a head, a body, and a switch line. */
    val Flashlight: ImageVector =
        stroked("Flashlight") {
            moveTo(8f, 3f)
            lineTo(16f, 3f)
            lineTo(14f, 9f)
            lineTo(10f, 9f)
            close()
            moveTo(10f, 9f)
            lineTo(10f, 20f)
            lineTo(14f, 20f)
            lineTo(14f, 9f)
            moveTo(10f, 13f)
            lineTo(14f, 13f)
        }
}

private fun stroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned closed rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Closed circle of radius [r] centred at ([cx], [cy]), approximated with four cubic Béziers. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = r * CIRCLE_KAPPA
    moveTo(cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    close()
}

/**
 * Builds the localized [CommandQuickActionsStrings] from the i18n catalog (P1/S10): the title + empty
 * message, the eight command labels, the header refresh/refreshing/offline microcopy, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 *
 * The command labels reuse the closest existing catalog entries (P1/S10 added only the catalog-backed
 * `widget.quickActions.{title,noVehicle}`; the web command labels are inline fallbacks). `flash` maps to
 * `translation_activity_action_vehicleCommandFlash` ("Flash lights") — the only "Flash" command label in
 * the catalog.
 */
@Composable
private fun rememberCommandQuickActionsStrings(): CommandQuickActionsStrings {
    val title = stringResource(R.string.translation_widget_quickActions_title)
    val empty = stringResource(R.string.translation_widget_quickActions_noVehicle)
    val lock = stringResource(R.string.translation_glance_action_lock)
    val unlock = stringResource(R.string.translation_glance_action_unlock)
    val climateOn = stringResource(R.string.translation_glance_action_climateOn)
    val climateOff = stringResource(R.string.translation_glance_action_climateOff)
    val frunk = stringResource(R.string.translation_digitalTwin_frunk)
    val horn = stringResource(R.string.translation_glance_action_horn)
    val flash = stringResource(R.string.translation_activity_action_vehicleCommandFlash)
    val trunk = stringResource(R.string.translation_digitalTwin_trunk)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        empty,
        lock,
        unlock,
        climateOn,
        climateOff,
        frunk,
        horn,
        flash,
        trunk,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        CommandQuickActionsStrings(
            title = title,
            emptyMessage = empty,
            lock = lock,
            unlock = unlock,
            climateOn = climateOn,
            climateOff = climateOff,
            frunk = frunk,
            horn = horn,
            flash = flash,
            trunk = trunk,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}
