// The native Jetpack Compose + Material 3 ToggleCommandTile feature view — a parity port of
// web/src/features/system/components/ToggleCommandTile.tsx. The web component is one tile in the Vehicle
// Commands grid: a clickable GlassPanel with an on/off state. When on it tints the panel border, the icon box,
// the top-right status dot, and the ON/OFF line with the variant colour (default → neon-cyan, danger →
// neon-red, success → neon-green); when off they fall back to neutral. The icon box shows a spinner while a
// command is in flight, otherwise the on glyph (`def.icon`) or the off glyph (`def.iconOff ?? def.icon`). A
// top-left favourite star (filled + amber when favourited) and an optional last-result line (green when it
// starts with ✓, red otherwise) complete the tile. Tapping it ignores the tap while loading, runs the off
// command when on, opens the host input dialog when off + the command needs input, and otherwise runs the on
// command.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`): the hosting Commands page owns the vehicle-state/command-log queries, the
// favourites state, and the execute / request-dialog / toggle-favourite callbacks. So — exactly as the sibling
// CommandTile / InputCommandTile presentational ports document — the loading / empty / error / stale / offline
// DATA lifecycle lives on that owning page, not here; modelling those on a hook-less surface would invent
// behaviour the web spec lacks (honesty covenant: no silent drift). The genuine render branches the web source
// DOES define — on vs. off, in-flight loading, the three semantic variants, favourite on/off, and the
// success/error/no status line — are all reproduced and exercised by the UI test. Every derivation flows
// through the pure [ToggleCommandTileProjection]; the composable is a thin render layer that owns only the
// uncontrolled local-toggle state (web `useState`) and records the one-shot `view.opened` diagnostic (P1/S11).
//
// Hover→touch adaptations (documented, consistent with the sibling ports): the web reveals the favourite star
// only on pointer hover (`opacity-0 group-hover:opacity-50`) — unreachable on touch — so the native star is
// always shown (muted when not favourited) so it stays tappable and TalkBack-reachable; and the web's off-state
// panel border is a pointer-hover tint with no touch equivalent, so the off panel uses the standard static
// border. The on/off state is also surfaced to TalkBack as a `stateDescription` so the toggle reads correctly
// to screen readers, not only through the visible ON/OFF line.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ToggleCommandTile — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.togglecommandtile

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
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
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `min-h-[100px]` — the tile never collapses below this. */
private val TILE_MIN_HEIGHT: Dp = 100.dp

/** Web icon glyph `h-5 w-5` (20dp), placed inside the [IconBoxSize.Md] (40dp) box (web `rounded-xl p-2.5`). */
private val ICON_DIMENSION: Dp = 20.dp

/** Web `h-2 w-2` (8dp) status dot. */
private val DOT_SIZE: Dp = 8.dp

/** Web `left-1.5 top-1.5` — the favourite star corner inset. */
private val CORNER_INSET: Dp = Spacing.xs

/** Web `top-2 right-2` — the status-dot corner inset. */
private val DOT_INSET: Dp = Spacing.sm

/** Web `mt-0.5` — the tiny gap between the label, ON/OFF, and status lines. */
private val LABEL_GAP: Dp = 2.dp

/** Stroke for the in-flight spinner that replaces the icon (web `Loader2`). */
private val SPINNER_STROKE: Dp = 2.dp

/** Web `opacity-50` while a command is in flight. */
private const val LOADING_ALPHA: Float = 0.5f

/** Web `text-neon-green/60` / `text-neon-red/60` wash for the last-status line. */
private const val STATUS_ALPHA: Float = 0.75f

/** Label is `text-xs` (two lines max); the ON/OFF + status lines are single short lines. */
private const val LABEL_MAX_LINES: Int = 2
private const val SECONDARY_MAX_LINES: Int = 1

/**
 * Stateful entry point — the faithful 1:1 port of the web `ToggleCommandTile` props. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11) on first composition, owns the uncontrolled local-toggle state
 * (web `useState`), projects the render-ready view, and routes taps through the pure [ToggleClickResolver]. The
 * surface binds no data of its own; the caller supplies the command [data], the current [vehicleState], the
 * on/off glyphs, and the runtime flags/callbacks (web parity).
 *
 * @param data the command definition subset the tile renders (web `def`).
 * @param icon the command's on glyph (web `def.icon`); replaced by a spinner while [loading].
 * @param loading whether the command is in flight — shows the spinner, dims the tile, and ignores taps
 *   (web `loading`).
 * @param isFavorite whether the command is favourited — fills + tints the star (web `isFavorite`).
 * @param onExecute runs a command with its params — invoked for the on command (web `onExecute(def.command,
 *   def.params)`) and the off command (web `onExecute(def.commandOff!)`, with no params).
 * @param onRequestDialog asks the host to open the input dialog when turning an input command on
 *   (web `onRequestDialog(def)`).
 * @param onToggleFavorite toggles the favourite (web `onToggleFavorite`).
 * @param vehicleState the current vehicle state as a field → boolean map; when the command names a
 *   [ToggleCommandTileData.stateField] and this is present, it drives the controlled on/off state (web `state`).
 * @param iconOff the command's off glyph (web `def.iconOff`); falls back to [icon] when absent.
 * @param lastStatus the optional last command result, shown tinted by its ✓/✗ prefix (web `lastStatus`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ToggleCommandTile(
    data: ToggleCommandTileData,
    icon: ImageVector,
    loading: Boolean,
    isFavorite: Boolean,
    onExecute: (command: String, params: Map<String, Any?>) -> Unit,
    onRequestDialog: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    vehicleState: Map<String, Boolean?>? = null,
    iconOff: ImageVector? = null,
    lastStatus: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ToggleCommandTileDiagnostics.recordViewOpened(logger) }
    var localToggle by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val display =
        remember(data, vehicleState, localToggle, lastStatus, context) {
            ToggleCommandTileProjection.project(data, vehicleState, localToggle, lastStatus) { resourceName ->
                context.optionalString(resourceName)
            }
        }

    val handleClick: () -> Unit = {
        val action =
            ToggleClickResolver.resolve(
                loading = loading,
                isOn = display.isOn,
                hasInputConfig = data.hasInputConfig,
            )
        when (action) {
            ToggleAction.Ignore -> Unit
            ToggleAction.TurnOff -> {
                if (data.stateField.isNullOrBlank()) localToggle = false
                data.commandOff?.let { command -> onExecute(command, emptyMap()) }
            }
            ToggleAction.RequestDialog -> onRequestDialog()
            ToggleAction.TurnOn -> {
                if (data.stateField.isNullOrBlank()) localToggle = true
                onExecute(data.command, data.params)
            }
        }
    }

    ToggleCommandTileContent(
        display = display,
        icon = icon,
        loading = loading,
        isFavorite = isFavorite,
        onClick = handleClick,
        onToggleFavorite = onToggleFavorite,
        modifier = modifier,
        iconOff = iconOff,
    )
}

/**
 * Stateless renderer — the preview/UI-test entry point. Reproduces the web layout: a clickable [GlassPanel]
 * (dimmed while [loading]) carrying a centered icon-box + label column, with the favourite star pinned
 * top-start and the on/off status dot pinned top-end. The tap routing, on/off derivation, and label resolution
 * are already baked into the supplied [display] + [onClick], so this layer only renders.
 */
@Composable
fun ToggleCommandTileContent(
    display: ToggleCommandTileDisplay,
    icon: ImageVector,
    loading: Boolean,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    iconOff: ImageVector? = null,
) {
    val activeIcon = if (display.isOn) icon else (iconOff ?: icon)
    val onOffLabel =
        if (display.isOn) {
            stringResource(R.string.translation_commands_on)
        } else {
            stringResource(R.string.translation_commands_off)
        }
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val stateLabel = if (loading) loadingLabel else onOffLabel

    GlassPanel(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.large)
                .clickable(role = Role.Button, onClickLabel = display.label, onClick = onClick)
                .semantics { stateDescription = stateLabel }
                .then(if (loading) Modifier.alpha(LOADING_ALPHA) else Modifier),
        padding = PanelPadding.None,
        accent = panelAccentFor(display.isOn, display.variant),
    ) {
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = TILE_MIN_HEIGHT)) {
            Column(
                modifier = Modifier.align(Alignment.Center).fillMaxWidth().padding(Spacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                ToggleIconSlot(icon = activeIcon, isOn = display.isOn, variant = display.variant, loading = loading)
                ToggleLabelColumn(display = display, onOffLabel = onOffLabel)
            }
            FavoriteToggle(
                isFavorite = isFavorite,
                onToggle = onToggleFavorite,
                modifier = Modifier.align(Alignment.TopStart).padding(CORNER_INSET),
            )
            StateIndicatorDot(
                isOn = display.isOn,
                variant = display.variant,
                modifier = Modifier.align(Alignment.TopEnd).padding(DOT_INSET),
            )
        }
    }
}

/**
 * The icon container — the on/off [icon] while idle (web `isOn ? def.icon : def.iconOff`), a
 * [CircularProgressIndicator] while [loading] (web `Loader2 animate-spin`). The tone follows the on/off state +
 * variant: an active tile uses the variant wash (default → cyan/info, danger, success), an off tile the neutral
 * wash (web `bg-[var(--surface-2)] text-[var(--text-muted)]`). The glyph/spinner is decorative — the label and
 * the ON/OFF line carry the meaning — so it exposes no content description.
 */
@Composable
private fun ToggleIconSlot(
    icon: ImageVector,
    isOn: Boolean,
    variant: ToggleVariant,
    loading: Boolean,
) {
    IconBox(tone = iconBoxToneFor(isOn, variant), size = IconBoxSize.Md) {
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

/**
 * The centered label column — the web `text-xs` primary label (web `t(def.labelKey, def.labelFallback)`), the
 * always-present `text-[10px]` ON/OFF line tinted by the on/off state, and the optional `text-[9px]` last-result
 * line tinted by its tone. Each line is an inline [Text] (centered + clamped) bound to a theme/token color so
 * light/dark/high-contrast all stay correct.
 */
@Composable
private fun ToggleLabelColumn(
    display: ToggleCommandTileDisplay,
    onOffLabel: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(LABEL_GAP),
    ) {
        Text(
            text = display.label,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = LABEL_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = onOffLabel,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = onOffColorFor(display.isOn, display.variant),
            textAlign = TextAlign.Center,
            maxLines = SECONDARY_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        display.statusLine?.let { status -> ToggleStatusText(status = status) }
    }
}

/** The last-status line — green for a `✓` success, red otherwise (web `text-neon-green/60` vs `text-neon-red/60`). */
@Composable
private fun ToggleStatusText(status: CommandStatusLine) {
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
        maxLines = SECONDARY_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The favourite toggle — the web top-left ghost `Button` wrapping a `Star`. Always rendered (unlike the web's
 * hover-revealed star) so it stays tappable + TalkBack-reachable on touch: the filled amber star when
 * favourited, the muted hollow star otherwise. Carries the localized "Toggle favorite" label (web
 * `aria-label={t('commands.toggleFavorite', 'Toggle favorite')}`); as a nested clickable it consumes its own
 * taps, so tapping the star never also triggers the tile (web `e.stopPropagation()`).
 */
@Composable
private fun FavoriteToggle(
    isFavorite: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    IconButton(
        imageVector = if (isFavorite) ToggleCommandTileGlyphs.Filled else ToggleCommandTileGlyphs.Outline,
        contentDescription = stringResource(R.string.translation_commands_toggleFavorite),
        onClick = onToggle,
        modifier = modifier,
        size = IconSize.Xs,
        tint = if (isFavorite) TeslaTokens.status.warning else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * The top-right status dot — the web `absolute top-2 right-2 h-2 w-2 rounded-full` indicator: the variant tone
 * when on, a neutral surface tone when off. Decorative (the ON/OFF line + the panel `stateDescription` already
 * announce the state), so it exposes no content description.
 */
@Composable
private fun StateIndicatorDot(
    isOn: Boolean,
    variant: ToggleVariant,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(dotColorFor(isOn, variant)),
    )
}

/**
 * On/off + variant → [IconBox] tone. An off tile is [IconBoxTone.Neutral] (web neutral wash); an on tile uses
 * the variant tone: default → Info (the dark-theme #00f0ff cyan, web neon-cyan), danger → Danger, success →
 * Success.
 */
private fun iconBoxToneFor(
    isOn: Boolean,
    variant: ToggleVariant,
): IconBoxTone =
    if (!isOn) {
        IconBoxTone.Neutral
    } else {
        when (variant) {
            ToggleVariant.Default -> IconBoxTone.Info
            ToggleVariant.Danger -> IconBoxTone.Danger
            ToggleVariant.Success -> IconBoxTone.Success
        }
    }

/**
 * On/off + variant → [GlassPanel] accent. An off tile uses the standard border (web's un-hovered border, the
 * hover tint has no touch equivalent); an on tile tints the border with the variant tone (web `onStyles.panel`).
 */
private fun panelAccentFor(
    isOn: Boolean,
    variant: ToggleVariant,
): PanelAccent =
    if (!isOn) {
        PanelAccent.None
    } else {
        when (variant) {
            ToggleVariant.Default -> PanelAccent.Info
            ToggleVariant.Danger -> PanelAccent.Danger
            ToggleVariant.Success -> PanelAccent.Success
        }
    }

/** The full-strength active tone color for a [variant] — the web `onStyles[variant].text` / `.dot` colour. */
@Composable
private fun activeToneColor(variant: ToggleVariant): Color =
    when (variant) {
        ToggleVariant.Default -> TeslaTokens.status.info
        ToggleVariant.Danger -> TeslaTokens.status.danger
        ToggleVariant.Success -> TeslaTokens.status.success
    }

/** ON/OFF line color: the active tone when on (web `styles.text`), the muted token when off. */
@Composable
private fun onOffColorFor(
    isOn: Boolean,
    variant: ToggleVariant,
): Color = if (isOn) activeToneColor(variant) else MaterialTheme.colorScheme.onSurfaceVariant

/** Status-dot color: the active tone when on (web `styles.dot`), the neutral surface tone when off. */
@Composable
private fun dotColorFor(
    isOn: Boolean,
    variant: ToggleVariant,
): Color = if (isOn) activeToneColor(variant) else MaterialTheme.colorScheme.surfaceVariant

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

// ── Previews (tooling-only; the @Preview entry points exercise each render branch) ──────────────────

private fun previewDisplay(
    label: String = "Sentry Mode",
    isOn: Boolean = false,
    variant: ToggleVariant = ToggleVariant.Default,
    statusLine: CommandStatusLine? = null,
) = ToggleCommandTileDisplay(label = label, isOn = isOn, variant = variant, statusLine = statusLine)

@Preview(name = "Off (default)", showBackground = true)
@Composable
private fun ToggleCommandTileOffPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleCommandTileContent(
            display = previewDisplay(isOn = false),
            icon = TeslaGlyphs.Info,
            loading = false,
            isFavorite = false,
            onClick = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "On (default) + favourite", showBackground = true)
@Composable
private fun ToggleCommandTileOnPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleCommandTileContent(
            display = previewDisplay(isOn = true),
            icon = TeslaGlyphs.Info,
            loading = false,
            isFavorite = true,
            onClick = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "On (danger) + success status", showBackground = true)
@Composable
private fun ToggleCommandTileDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleCommandTileContent(
            display =
                previewDisplay(
                    label = "Valet Mode",
                    isOn = true,
                    variant = ToggleVariant.Danger,
                    statusLine = CommandStatusLine("${ToggleCommandTileProjection.SUCCESS_PREFIX} Sent", CommandOutcome.Success),
                ),
            icon = TeslaGlyphs.Warning,
            loading = false,
            isFavorite = false,
            onClick = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "On (success) + error status", showBackground = true)
@Composable
private fun ToggleCommandTileSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleCommandTileContent(
            display =
                previewDisplay(
                    label = "Climate",
                    isOn = true,
                    variant = ToggleVariant.Success,
                    statusLine = CommandStatusLine("Failed", CommandOutcome.Failure),
                ),
            icon = TeslaGlyphs.Check,
            loading = false,
            isFavorite = false,
            onClick = {},
            onToggleFavorite = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ToggleCommandTileLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleCommandTileContent(
            display = previewDisplay(isOn = false),
            icon = TeslaGlyphs.Info,
            loading = true,
            isFavorite = false,
            onClick = {},
            onToggleFavorite = {},
        )
    }
}
