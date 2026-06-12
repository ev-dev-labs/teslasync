// The native Jetpack Compose + Material 3 CommandTile feature view — a parity port of
// web/src/features/system/components/CommandTile.tsx. The web component is one tile in the Vehicle Commands
// grid: a clickable GlassPanel with a neutral icon box (a spinner while the command is in flight), a centered
// primary label, an optional sublabel, an optional last-result line (green when it starts with ✓, red
// otherwise), a top-left favourite star (filled + amber when favourited), and a top-right warning triangle for
// dangerous commands. Tapping it ignores the tap while loading, opens the host confirm dialog when dangerous,
// and otherwise executes the command.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`): the hosting Commands page owns the vehicle/command-log queries, the favourites
// state, and the execute / request-dialog / toggle-favourite callbacks. So — exactly as the sibling
// ToolCard / QuickNav / AddWidgetButton presentational ports document — the loading / empty / error / stale /
// offline DATA lifecycle lives on that owning page, not here; modelling those on a hook-less surface would
// invent behaviour the web spec lacks (honesty covenant: no silent drift). The genuine render branches the web
// source DOES define — loading vs. idle, favourite on/off, dangerous on/off, the success/error/no status line,
// the optional sublabel, and the three semantic variants — are all reproduced and exercised by the UI test.
// Every derivation flows through the pure [CommandTileModel]; the composable is a thin render layer that records
// the one-shot `view.opened` diagnostic (P1/S11).
//
// Hover→touch adaptations (documented, consistent with the sibling ports): the web reveals the favourite star
// only on pointer hover (`opacity-0 group-hover:opacity-50`) — unreachable on touch — so the native star is
// always shown (muted when not favourited) so it stays tappable and TalkBack-reachable; and the web variant is a
// pointer-hover border tint with no touch equivalent, so it maps to a static, subtle [GlassPanel] accent border.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CommandTile — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandtile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `min-h-[100px]` — the tile never collapses below this. */
private val TILE_MIN_HEIGHT: Dp = 100.dp

/** Web icon box: `rounded-xl p-2.5` around an `h-5 w-5` (20dp) glyph ⇒ 40dp box. */
private val ICON_BOX_SIZE: Dp = 40.dp

/** Web `left-1.5 top-1.5` / `right-1.5 top-1.5` — the favourite + warning corner inset. */
private val CORNER_INSET: Dp = Spacing.xs

/** Web `mt-0.5` — the tiny gap between the label, sublabel, and status lines. */
private val LABEL_GAP: Dp = 2.dp

/** Web `opacity-50` while a command is in flight. */
private const val LOADING_ALPHA: Float = 0.5f

/** Web `text-neon-red/50` for the dangerous-command warning triangle. */
private const val DANGER_INDICATOR_ALPHA: Float = 0.5f

/** Stroke for the in-flight spinner that replaces the icon (web `Loader2`). */
private val LOADING_STROKE: Dp = 2.dp

/** Label is `text-xs` (two lines max); sublabel/status are single `text-[10px]`/`text-[9px]` lines. */
private const val LABEL_MAX_LINES: Int = 2
private const val SECONDARY_MAX_LINES: Int = 1

/**
 * Stateful entry point — the faithful 1:1 port of the web `CommandTile` props. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition and renders the stateless content.
 *
 * @param def the render-ready command definition (web `def`).
 * @param icon the command glyph shown in the icon box (web `def.icon`).
 * @param onExecute runs the command — invoked with [CommandTileDef.command] + [CommandTileDef.params]
 *   (web `onExecute`).
 * @param onRequestDialog asks the host to open the confirm dialog for a dangerous command (web `onRequestDialog`).
 * @param loading whether the command is in flight — shows the spinner + dims the tile + ignores taps (web `loading`).
 * @param isFavorite whether the command is favourited — fills + tints the star (web `isFavorite`).
 * @param onToggleFavorite toggles the favourite (web `onToggleFavorite`).
 * @param lastStatus the optional last command result, shown tinted by its ✓/✗ prefix (web `lastStatus`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandTile(
    def: CommandTileDef,
    icon: ImageVector,
    onExecute: (command: String, params: Map<String, Any?>) -> Unit,
    onRequestDialog: (CommandTileDef) -> Unit,
    loading: Boolean,
    isFavorite: Boolean,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    lastStatus: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CommandTileDiagnostics.recordViewOpened(logger) }
    CommandTileContent(
        def = def,
        icon = icon,
        loading = loading,
        isFavorite = isFavorite,
        onExecute = onExecute,
        onRequestDialog = onRequestDialog,
        onToggleFavorite = onToggleFavorite,
        modifier = modifier,
        lastStatus = lastStatus,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout: a clickable
 * [GlassPanel] (web `cursor-pointer`, dimmed while loading) carrying a centered icon-box + label column, with the
 * favourite star pinned top-start and the warning triangle pinned top-end. The tap routes through the pure
 * [CommandTileClickResolver] so the loading / dangerous / execute precedence matches the web `handleClick`
 * exactly.
 */
@Composable
fun CommandTileContent(
    def: CommandTileDef,
    icon: ImageVector,
    loading: Boolean,
    isFavorite: Boolean,
    onExecute: (command: String, params: Map<String, Any?>) -> Unit,
    onRequestDialog: (CommandTileDef) -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    lastStatus: String? = null,
) {
    val statusTone = CommandStatusTone.fromStatus(lastStatus)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val handleClick: () -> Unit = {
        when (CommandTileClickResolver.resolve(loading = loading, dangerous = def.dangerous)) {
            CommandTileAction.Ignore -> Unit
            CommandTileAction.RequestDialog -> onRequestDialog(def)
            CommandTileAction.Execute -> onExecute(def.command, def.params)
        }
    }
    GlassPanel(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.large)
                .clickable(role = Role.Button, onClick = handleClick)
                .then(
                    if (loading) {
                        Modifier.alpha(LOADING_ALPHA).semantics { stateDescription = loadingLabel }
                    } else {
                        Modifier
                    },
                ),
        padding = PanelPadding.None,
        accent = panelAccentFor(def.variant),
    ) {
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = TILE_MIN_HEIGHT)) {
            Column(
                modifier = Modifier.align(Alignment.Center).fillMaxWidth().padding(Spacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                CommandTileIconBox(icon = icon, loading = loading)
                CommandTileLabels(def = def, lastStatus = lastStatus, statusTone = statusTone)
            }
            CommandTileFavoriteToggle(
                isFavorite = isFavorite,
                onToggle = onToggleFavorite,
                modifier = Modifier.align(Alignment.TopStart).padding(CORNER_INSET),
            )
            if (def.dangerous) {
                CommandTileDangerIndicator(
                    modifier = Modifier.align(Alignment.TopEnd).padding(CORNER_INSET),
                )
            }
        }
    }
}

/**
 * The neutral icon box — the native analogue of the web `rounded-xl p-2.5 bg-[var(--surface-2)]` chip: a rounded
 * [Surface] in the elevated `surfaceVariant` tone with a muted `onSurfaceVariant` foreground. While [loading] it
 * shows an indeterminate spinner (web `Loader2 animate-spin`); otherwise the command [icon]. The glyph/spinner is
 * decorative — the label carries the meaning — so it exposes no content description.
 */
@Composable
private fun CommandTileIconBox(
    icon: ImageVector,
    loading: Boolean,
) {
    Surface(
        modifier = Modifier.size(ICON_BOX_SIZE),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(IconSize.Lg.dimension),
                    strokeWidth = LOADING_STROKE,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg)
            }
        }
    }
}

/**
 * The centered label column — the web `text-xs` primary label (web `t(def.labelKey, def.labelFallback)`), the
 * optional `text-[10px]` muted sublabel, and the optional `text-[9px]` last-result line tinted by its tone. Each
 * line is an inline [Text] (centered + clamped, which the role typography wrappers don't express) bound to a
 * theme/token color so light/dark/high-contrast all stay correct — the same documented one-off the sibling
 * QuickNav port uses for its clamped card description.
 */
@Composable
private fun CommandTileLabels(
    def: CommandTileDef,
    lastStatus: String?,
    statusTone: CommandStatusTone,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(LABEL_GAP),
    ) {
        Text(
            text = def.label,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = LABEL_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        def.sublabel?.let { sublabel ->
            Text(
                text = sublabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = SECONDARY_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (statusTone != CommandStatusTone.None && lastStatus != null) {
            Text(
                text = lastStatus,
                style = MaterialTheme.typography.labelSmall,
                color = statusColorFor(statusTone),
                textAlign = TextAlign.Center,
                maxLines = SECONDARY_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The favourite toggle — the web top-left ghost `Button` wrapping a `Star`. Always rendered (unlike the web's
 * hover-revealed star) so it stays tappable + TalkBack-reachable on touch: the filled amber star when favourited,
 * the muted hollow star otherwise. Carries the localized "Toggle favorite" label (web
 * `aria-label={t('commands.toggleFavorite', 'Toggle favorite')}`); as a nested clickable it consumes its own taps,
 * so tapping the star never also triggers the tile (web `e.stopPropagation()`).
 */
@Composable
private fun CommandTileFavoriteToggle(
    isFavorite: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    IconButton(
        imageVector = if (isFavorite) CommandTileGlyphs.Filled else CommandTileGlyphs.Outline,
        contentDescription = stringResource(R.string.translation_commands_toggleFavorite),
        onClick = onToggle,
        modifier = modifier,
        variant = IconButtonVariant.Standard,
        size = IconSize.Xs,
        tint = if (isFavorite) TeslaTokens.status.warning else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * The dangerous-command indicator — the web top-right `AlertTriangle` at `text-neon-red/50`. Decorative (web sets
 * no `aria-label`; the danger is conveyed by routing the tap to the confirm dialog), so it exposes no content
 * description. Reuses the shared `Warning` glyph (the components-layer alert triangle).
 */
@Composable
private fun CommandTileDangerIndicator(modifier: Modifier = Modifier) {
    Icon(
        imageVector = TeslaGlyphs.Warning,
        contentDescription = null,
        modifier = modifier,
        size = IconSize.Xs,
        tint = TeslaTokens.status.danger.copy(alpha = DANGER_INDICATOR_ALPHA),
    )
}

/**
 * Status tone → design-token color: success → status.success (web `text-neon-green`), error → status.danger
 * (web `text-neon-red`). [CommandStatusTone.None] never reaches a render path, so it folds to the unspecified
 * color. Full-strength tokens (rather than the web `/60` wash) keep the tiny status line legible at AA contrast.
 */
@Composable
private fun statusColorFor(tone: CommandStatusTone): Color =
    when (tone) {
        CommandStatusTone.Success -> TeslaTokens.status.success
        CommandStatusTone.Error -> TeslaTokens.status.danger
        CommandStatusTone.None -> Color.Unspecified
    }

/**
 * Variant → [GlassPanel] accent. The web variant is a pointer-hover border tint with no touch equivalent, so it
 * maps to a static, subtle accent border: danger → Danger, success → Success, default → None (web's un-hovered
 * standard border). Dark-theme accent tokens equal the web neon hexes.
 */
private fun panelAccentFor(variant: CommandVariant): PanelAccent =
    when (variant) {
        CommandVariant.Default -> PanelAccent.None
        CommandVariant.Danger -> PanelAccent.Danger
        CommandVariant.Success -> PanelAccent.Success
    }

// ── Previews (tooling-only; the @Preview entry points exercise each render branch) ──────────────────

private val PREVIEW_DEF =
    CommandTileDef(
        id = "flash-lights",
        command = "flash_lights",
        label = "Flash Lights",
        sublabel = "Signal",
        variant = CommandVariant.Default,
    )

@Preview(name = "Idle", showBackground = true)
@Composable
private fun CommandTileIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandTileContent(
            def = PREVIEW_DEF,
            icon = TeslaGlyphs.Info,
            loading = false,
            isFavorite = false,
            onExecute = { _, _ -> },
            onRequestDialog = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "Favourite + success status", showBackground = true)
@Composable
private fun CommandTileFavoriteSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandTileContent(
            def = PREVIEW_DEF.copy(variant = CommandVariant.Success),
            icon = TeslaGlyphs.Check,
            loading = false,
            isFavorite = true,
            onExecute = { _, _ -> },
            onRequestDialog = {},
            onToggleFavorite = {},
            lastStatus = "${CommandStatusTone.SUCCESS_PREFIX} Sent",
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun CommandTileLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandTileContent(
            def = PREVIEW_DEF,
            icon = TeslaGlyphs.Info,
            loading = true,
            isFavorite = false,
            onExecute = { _, _ -> },
            onRequestDialog = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "Dangerous + error status", showBackground = true)
@Composable
private fun CommandTileDangerousErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandTileContent(
            def =
                PREVIEW_DEF.copy(
                    id = "remote-start",
                    command = "remote_start",
                    label = "Remote Start",
                    sublabel = null,
                    variant = CommandVariant.Danger,
                    dangerous = true,
                ),
            icon = TeslaGlyphs.Warning,
            loading = false,
            isFavorite = false,
            onExecute = { _, _ -> },
            onRequestDialog = {},
            onToggleFavorite = {},
            lastStatus = "Failed",
        )
    }
}
