// The native Jetpack Compose + Material 3 InputCommandTile feature view — a parity port of
// web/src/features/system/components/InputCommandTile.tsx. The web component renders one clickable command
// tile: a tinted icon box (a spinner while the command is in flight), the command label, an optional sublabel,
// and an optional last-status line that reads green when the result starts with `✓` and red otherwise. A small
// favorite-toggle star sits in the top-left corner. Tapping the tile (when not loading) opens the command's
// input dialog; tapping the star toggles the favorite without opening the dialog.
//
// Every derivation flows through the pure [InputCommandTileProjection]; the composable is a thin render layer.
// The surface binds no data feed (the command definition + flags arrive as props, web parity). Its one static
// catalog string — the favorite-toggle accessibility label — resolves through the generated i18n catalog
// (P1/S10) `commands.toggleFavorite` key (R.string.translation_commands_toggleFavorite); the label/sublabel
// resolve through the same catalog by folded resource name, falling back to the definition's English text
// exactly as the web `t(key, fallback)` does. There are no English literals baked into this file. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Platform adaptations (documented, not silent): the web hover-only border tint becomes a persistent panel
// accent (a touch surface has no hover), and the web hover-reveal of the unselected star becomes a permanently
// visible, dimmed outline so the affordance is discoverable by touch. The 48 dp Material touch target around
// the star is a deliberate accessibility improvement over the web's 12 px hit area.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InputCommandTile) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inputcommandtile

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web `InputCommandTile` props. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11) and renders the tile. The surface binds no data of
 * its own; the caller supplies the command [data], its [icon], and the runtime flags/callbacks (web parity).
 *
 * @param data the command definition subset the tile renders (web `def`).
 * @param icon the command's leading glyph (web `def.icon`); replaced by a spinner while [loading].
 * @param loading whether the command is in flight — shows the spinner and disables the tile tap (web `loading`).
 * @param isFavorite whether the command is favorited — fills + tints the star (web `isFavorite`).
 * @param onRequestDialog invoked when the tile is tapped and not loading (web `onRequestDialog(def)`).
 * @param onToggleFavorite invoked when the star is tapped (web `onToggleFavorite`).
 * @param lastStatus the most recent command result text, or `null` for no status line (web `lastStatus`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun InputCommandTile(
    data: CommandTileData,
    icon: ImageVector,
    loading: Boolean,
    isFavorite: Boolean,
    onRequestDialog: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    lastStatus: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { InputCommandTileDiagnostics.recordViewOpened(logger) }
    InputCommandTileContent(
        data = data,
        icon = icon,
        loading = loading,
        isFavorite = isFavorite,
        onRequestDialog = onRequestDialog,
        onToggleFavorite = onToggleFavorite,
        modifier = modifier,
        lastStatus = lastStatus,
    )
}

/**
 * Stateless renderer — the preview/UI entry point. Reproduces the web layout: a clickable [GlassPanel] holding
 * a centered icon-box + label column, with the favorite star overlaid at the top-start corner. The panel tap
 * is disabled and the content dimmed while [loading] (web `opacity-50` + the `if (loading) return` guard).
 */
@Composable
fun InputCommandTileContent(
    data: CommandTileData,
    icon: ImageVector,
    loading: Boolean,
    isFavorite: Boolean,
    onRequestDialog: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    lastStatus: String? = null,
) {
    val context = LocalContext.current
    val display =
        remember(data, lastStatus, context) {
            InputCommandTileProjection.project(data, lastStatus) { resourceName -> context.optionalString(resourceName) }
        }

    Box(modifier = modifier) {
        GlassPanel(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(
                        enabled = !loading,
                        onClickLabel = display.label,
                        role = Role.Button,
                        onClick = onRequestDialog,
                    ),
            accent = panelAccentFor(display.variant),
        ) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = MIN_TILE_HEIGHT)
                        .alpha(if (loading) DISABLED_ALPHA else FULL_ALPHA),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
            ) {
                CommandIconSlot(icon = icon, loading = loading)
                CommandLabelBlock(display = display)
            }
        }
        FavoriteToggle(
            isFavorite = isFavorite,
            onToggle = onToggleFavorite,
            modifier = Modifier.align(Alignment.TopStart).padding(Spacing.xs),
        )
    }
}

/**
 * The tinted icon container — the command glyph while idle, a [CircularProgressIndicator] while [loading] (the
 * web `Loader2 animate-spin`). The neutral tone reproduces the web `bg-[var(--surface-2)]` wash + muted icon.
 */
@Composable
private fun CommandIconSlot(
    icon: ImageVector,
    loading: Boolean,
) {
    IconBox(tone = IconBoxTone.Neutral, size = IconBoxSize.Md) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(ICON_DIMENSION),
                strokeWidth = SPINNER_STROKE,
                color = LocalContentColor.current,
            )
        } else {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg)
        }
    }
}

/** The centered label column: the primary label, the optional sublabel, and the optional last-status line. */
@Composable
private fun CommandLabelBlock(display: InputCommandTileDisplay) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(LABEL_GAP),
    ) {
        Text(
            text = display.label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = LABEL_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        display.sublabel?.let { sublabel ->
            Text(
                text = sublabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = SUBLABEL_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
        display.statusLine?.let { status -> CommandStatusText(status = status) }
    }
}

/** The last-status line — green for a `✓` success, red otherwise (web `text-neon-green/60` vs `text-neon-red/60`). */
@Composable
private fun CommandStatusText(status: CommandStatusLine) {
    val color =
        when (status.outcome) {
            CommandOutcome.Success -> TeslaTokens.status.success
            CommandOutcome.Failure -> TeslaTokens.status.danger
        }
    Text(
        text = status.text,
        style = MaterialTheme.typography.labelSmall,
        color = color.copy(alpha = STATUS_ALPHA),
        textAlign = TextAlign.Center,
        maxLines = SUBLABEL_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The favorite-toggle star overlaid at the panel's top-start corner. Filled + amber (the warning token, the
 * closest semantic match to the web `text-amber-300`) when favorited; a dimmed outline otherwise. The label is
 * resolved from the catalog so TalkBack always announces a localized action (web `aria-label`).
 */
@Composable
private fun FavoriteToggle(
    isFavorite: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tint =
        if (isFavorite) {
            TeslaTokens.status.warning
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = INACTIVE_FAVORITE_ALPHA)
        }
    IconButton(
        imageVector = if (isFavorite) InputCommandTileGlyphs.StarFilled else InputCommandTileGlyphs.Star,
        contentDescription = stringResource(R.string.translation_commands_toggleFavorite),
        onClick = onToggle,
        modifier = modifier,
        size = IconSize.Sm,
        tint = tint,
    )
}

/** Maps the command [variant] to the persistent panel accent that stands in for the web hover border tint. */
private fun panelAccentFor(variant: CommandTileVariant): PanelAccent =
    when (variant) {
        CommandTileVariant.Default -> PanelAccent.None
        CommandTileVariant.Danger -> PanelAccent.Danger
        CommandTileVariant.Success -> PanelAccent.Success
    }

/**
 * Optional by-name read from the Android string catalog — the seam that reproduces web `t(key, fallback)`.
 * `getIdentifier` is the only way to attempt a key that may be absent (a compile-time `R.string` reference
 * cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed. Release builds keep
 * resource names (resource shrinking is off — see app/build.gradle.kts), so the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

private val MIN_TILE_HEIGHT = 100.dp
private val ICON_DIMENSION = 20.dp
private val SPINNER_STROKE = 2.dp
private val LABEL_GAP = 2.dp
private const val DISABLED_ALPHA = 0.5f
private const val FULL_ALPHA = 1f
private const val INACTIVE_FAVORITE_ALPHA = 0.5f
private const val STATUS_ALPHA = 0.75f
private const val LABEL_MAX_LINES = 2
private const val SUBLABEL_MAX_LINES = 1

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_INPUT =
    CommandTileData(
        labelKey = "commands.setChargeLimit.label",
        labelFallback = "Set Charge Limit",
        sublabelKey = "commands.setChargeLimit.sublabel",
        sublabelFallback = "Enter 50–100%",
        variant = CommandTileVariant.Default,
    )

private val PREVIEW_DANGER =
    CommandTileData(
        labelKey = "commands.remoteStart.label",
        labelFallback = "Remote Start",
        variant = CommandTileVariant.Danger,
    )

private val PREVIEW_SUCCESS =
    CommandTileData(
        labelKey = "commands.setTemperature.label",
        labelFallback = "Set Temperature",
        sublabelKey = "commands.setTemperature.sublabel",
        sublabelFallback = "15–28 °C",
        variant = CommandTileVariant.Success,
    )

@Preview(name = "Favorited + sublabel", showBackground = true)
@Composable
private fun InputCommandTileFavoritePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputCommandTileContent(
            data = PREVIEW_INPUT,
            icon = TeslaGlyphs.Edit,
            loading = false,
            isFavorite = true,
            onRequestDialog = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "Danger + failure status", showBackground = true)
@Composable
private fun InputCommandTileDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputCommandTileContent(
            data = PREVIEW_DANGER,
            icon = TeslaGlyphs.Warning,
            loading = false,
            isFavorite = false,
            onRequestDialog = {},
            onToggleFavorite = {},
            lastStatus = "\u2717 Failed",
        )
    }
}

@Preview(name = "Success status", showBackground = true)
@Composable
private fun InputCommandTileSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputCommandTileContent(
            data = PREVIEW_SUCCESS,
            icon = TeslaGlyphs.Edit,
            loading = false,
            isFavorite = false,
            onRequestDialog = {},
            onToggleFavorite = {},
            lastStatus = "\u2713 Sent",
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun InputCommandTileLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputCommandTileContent(
            data = PREVIEW_INPUT,
            icon = TeslaGlyphs.Edit,
            loading = true,
            isFavorite = false,
            onRequestDialog = {},
            onToggleFavorite = {},
        )
    }
}
