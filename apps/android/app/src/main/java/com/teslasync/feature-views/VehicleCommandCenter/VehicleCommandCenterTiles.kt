// The inline command tiles + grids for the VehicleCommandCenter feature view — the native analogue of the
// web tile family the orchestrator composes (CommandTile / ToggleCommandTile / InputCommandTile rendered
// through `renderTile`, plus FavoritesBar and CollapsibleCommandGroup). Those polished standalone tile
// surfaces are out of scope (each has its own prompt); this file renders functional inline tiles so the
// self-contained orchestrator reproduces the web composition without importing the sibling surfaces — the
// decoupled convention every feature-view port follows. Every tile is presentational: the host
// (VehicleCommandCenter.kt) resolves the tap via the pure projection and threads the per-tile state in.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

// ── Grid geometry (web Tailwind breakpoints, reproduced) ─────────────────────────────────────────────

private val GRID_LG_MIN_WIDTH: Dp = 1024.dp
private val GRID_SM_MIN_WIDTH: Dp = 640.dp
private const val GRID_COLUMNS_LG = 4
private const val GRID_COLUMNS_SM = 3
private const val GRID_COLUMNS_BASE = 2

private val TILE_MIN_HEIGHT: Dp = 100.dp
private val ICON_BOX_SIZE: Dp = 40.dp
private val CORNER_INSET: Dp = Spacing.xs
private val LABEL_GAP: Dp = 2.dp
private const val LOADING_ALPHA = 0.5f
private const val DANGER_INDICATOR_ALPHA = 0.5f
private val LOADING_STROKE: Dp = 2.dp
private const val LABEL_MAX_LINES = 2
private const val SECONDARY_MAX_LINES = 1
private const val CHEVRON_FLIPPED = 180f

/**
 * One render-ready command tile — the native analogue of the web `renderTile` output (CommandTile /
 * ToggleCommandTile / InputCommandTile). Presentational: the host resolves the tap (execute vs. open a
 * dialog vs. toggle) and threads in the per-tile state. The favourite star is always shown (web reveals it
 * on hover, unreachable on touch) so it stays tappable + TalkBack-reachable; a dangerous command shows the
 * warning triangle; a toggle shows its on/off chip; the last status line is tinted by its `✓`/`✗` tone.
 */
@Composable
fun CommandTile(
    command: CommandCenterCommand,
    label: String,
    sublabel: String?,
    statusLabel: String?,
    statusTone: CommandStatusTone,
    loading: Boolean,
    running: Boolean,
    isFavorite: Boolean,
    toggleOn: Boolean?,
    onTap: () -> Unit,
    onToggleFavorite: () -> Unit,
    toggleFavoriteLabel: String,
    onLabel: String,
    offLabel: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.large)
                .clickable(enabled = !loading, role = Role.Button, onClick = onTap)
                .then(if (loading) Modifier.alpha(LOADING_ALPHA) else Modifier),
        padding = PanelPadding.None,
        accent = panelAccentFor(command.variant),
    ) {
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = TILE_MIN_HEIGHT)) {
            Column(
                modifier = Modifier.align(Alignment.Center).fillMaxWidth().padding(Spacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                CommandTileIconBox(glyph = glyphVector(command.glyph), running = running)
                CommandTileLabels(
                    label = label,
                    sublabel = sublabel,
                    statusLabel = statusLabel,
                    statusTone = statusTone,
                )
                if (toggleOn != null) {
                    Badge(
                        text = if (toggleOn) onLabel else offLabel,
                        variant = if (toggleOn) BadgeVariant.Success else BadgeVariant.Neutral,
                    )
                }
            }
            CommandTileFavoriteToggle(
                isFavorite = isFavorite,
                onToggle = onToggleFavorite,
                label = toggleFavoriteLabel,
                modifier = Modifier.align(Alignment.TopStart).padding(CORNER_INSET),
            )
            if (command.dangerous) {
                Icon(
                    imageVector = TeslaGlyphs.Warning,
                    contentDescription = null,
                    modifier = Modifier.align(Alignment.TopEnd).padding(CORNER_INSET),
                    size = IconSize.Xs,
                    tint = TeslaTokens.status.danger.copy(alpha = DANGER_INDICATOR_ALPHA),
                )
            }
        }
    }
}

@Composable
private fun CommandTileIconBox(
    glyph: ImageVector,
    running: Boolean,
) {
    Surface(
        modifier = Modifier.size(ICON_BOX_SIZE),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (running) {
                CircularProgressIndicator(
                    modifier = Modifier.size(IconSize.Lg.dimension),
                    strokeWidth = LOADING_STROKE,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Icon(imageVector = glyph, contentDescription = null, size = IconSize.Lg)
            }
        }
    }
}

@Composable
private fun CommandTileLabels(
    label: String,
    sublabel: String?,
    statusLabel: String?,
    statusTone: CommandStatusTone,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(LABEL_GAP),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = LABEL_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        if (sublabel != null) {
            Text(
                text = sublabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = SECONDARY_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (statusTone != CommandStatusTone.None && statusLabel != null) {
            Text(
                text = statusLabel,
                style = MaterialTheme.typography.labelSmall,
                color = statusColorFor(statusTone),
                textAlign = TextAlign.Center,
                maxLines = SECONDARY_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun CommandTileFavoriteToggle(
    isFavorite: Boolean,
    onToggle: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    IconButton(
        imageVector = if (isFavorite) VehicleCommandCenterGlyphs.starFilled else VehicleCommandCenterGlyphs.starOutline,
        contentDescription = label,
        onClick = onToggle,
        modifier = modifier,
        variant = IconButtonVariant.Standard,
        size = IconSize.Xs,
        tint = if (isFavorite) TeslaTokens.status.warning else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun statusColorFor(tone: CommandStatusTone): Color =
    when (tone) {
        CommandStatusTone.Success -> TeslaTokens.status.success
        CommandStatusTone.Error -> TeslaTokens.status.danger
        CommandStatusTone.None -> Color.Unspecified
    }

private fun panelAccentFor(variant: CommandVariant): PanelAccent =
    when (variant) {
        CommandVariant.Default -> PanelAccent.None
        CommandVariant.Danger -> PanelAccent.Danger
        CommandVariant.Success -> PanelAccent.Success
    }

/**
 * The responsive command grid — the web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`. Column
 * count reflows at the Tailwind `sm`/`lg` breakpoints; cells share the row width via [Modifier.weight] and
 * a partial trailing row is padded with weighted spacers so tiles keep an even width. Each cell is drawn by
 * the caller's [renderTile] (web `renderTile(cmd)`).
 */
@Composable
fun CommandTileGrid(
    commands: List<CommandCenterCommand>,
    renderTile: @Composable (CommandCenterCommand) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            commands.chunked(columns).forEach { rowCommands ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCommands.forEach { command ->
                        Box(modifier = Modifier.weight(1f)) { renderTile(command) }
                    }
                    repeat(columns - rowCommands.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The favourites bar — the web `FavoritesBar`: a header row (amber filled star, the uppercase "Quick
 * Actions" label, a muted count) above the responsive grid of favourited tiles. Renders nothing when the
 * favourited subset is empty (web `favCmds.length === 0 → return null`).
 */
@Composable
fun CommandFavoritesSection(
    commands: List<CommandCenterCommand>,
    quickActionsLabel: String,
    renderTile: @Composable (CommandCenterCommand) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (commands.isEmpty()) return
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = VehicleCommandCenterGlyphs.starFilled,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.warning,
            )
            MetricLabel(quickActionsLabel)
            MetricLabel("(${commands.size})")
        }
        Spacer(modifier = Modifier.size(Spacing.sm))
        CommandTileGrid(commands = commands, renderTile = renderTile)
    }
}

/**
 * One collapsible command-category group — the native analogue of the web `CollapsibleCommandGroup` as the
 * orchestrator composes it: a full-width header (category glyph, uppercase label, count, rotating chevron)
 * over a grid of the category's tiles, defaulting to open. The header is one labelled, clickable node with
 * an expand/collapse `stateDescription` (the native `aria-expanded`).
 */
@Composable
fun CommandCategorySection(
    group: CommandCenterCategoryGroup,
    categoryLabel: String,
    expandLabel: String,
    collapseLabel: String,
    renderTile: @Composable (CommandCenterCommand) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by rememberSaveable(group.category) { mutableStateOf(true) }
    Column(modifier = modifier.fillMaxWidth()) {
        Button(
            onClick = { expanded = !expanded },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { stateDescription = if (expanded) collapseLabel else expandLabel },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        ) {
            Icon(
                imageVector = glyphVector(categoryGlyphFor(group.category)),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.size(Spacing.sm))
            MetricLabel(categoryLabel, modifier = Modifier.weight(1f))
            MetricLabel("(${group.commands.size})")
            Spacer(modifier = Modifier.size(Spacing.sm))
            Icon(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(if (expanded) CHEVRON_FLIPPED else 0f),
            )
        }
        Spacer(modifier = Modifier.size(Spacing.sm))
        AnimatedVisibility(visible = expanded) {
            CommandTileGrid(commands = group.commands, renderTile = renderTile)
        }
    }
}

/** The category tile glyph — reuses the catalogue glyph that best represents each category. */
private val CATEGORY_GLYPHS: Map<CommandCenterCategory, CommandGlyph> =
    mapOf(
        CommandCenterCategory.Security to CommandGlyph.Shield,
        CommandCenterCategory.Climate to CommandGlyph.Wind,
        CommandCenterCategory.ClimateProtection to CommandGlyph.ShieldAlert,
        CommandCenterCategory.Charging to CommandGlyph.Bolt,
        CommandCenterCategory.Doors to CommandGlyph.Door,
        CommandCenterCategory.Drive to CommandGlyph.Car,
        CommandCenterCategory.Windows to CommandGlyph.Window,
        CommandCenterCategory.Sunroof to CommandGlyph.Sun,
        CommandCenterCategory.Schedules to CommandGlyph.Calendar,
        CommandCenterCategory.Alerts to CommandGlyph.Speaker,
        CommandCenterCategory.Navigation to CommandGlyph.Navigation,
        CommandCenterCategory.Software to CommandGlyph.Download,
        CommandCenterCategory.Vehicle to CommandGlyph.Car,
        CommandCenterCategory.Media to CommandGlyph.PlayMedia,
    )

private fun categoryGlyphFor(category: CommandCenterCategory): CommandGlyph = CATEGORY_GLYPHS[category] ?: CommandGlyph.Gauge
