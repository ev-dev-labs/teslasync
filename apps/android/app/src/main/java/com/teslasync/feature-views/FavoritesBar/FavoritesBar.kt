// The native Jetpack Compose + Material 3 FavoritesBar feature view — a parity port of
// web/src/features/system/components/FavoritesBar.tsx. The web component is purely presentational: its only
// hook is `useTranslation`, and the owning VehicleCommandCenter page threads in the persisted `favorites`
// id list, the full `commands` catalogue, and a `renderTile` callback. It derives the favourited subset
// (`commands.filter(c => favorites.includes(c.id))`), and — when that subset is non-empty — wraps a `<FadeIn>`
// around a header row (an amber filled Star, the uppercase "Quick Actions" label, and a muted `(count)`) above
// a responsive tile grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`) of `renderTile(cmd)`. When the
// subset is empty the web component `return`s null — it renders NOTHING.
//
// This port keeps that contract exactly. The favourite filter flows through the pure [FavoritesBarProjection];
// this file is a thin render layer that resolves the i18n label (P1/S10 `translation_commands_cat_quickActions`,
// the catalog entry for the web `commands.cat.quickActions` key), the amber accent (P1/S9 design token), and
// the reduced-motion preference (via [FadeIn]), then draws them. The empty branch composes nothing, faithfully
// reproducing the web `return null` (the owning page fills the space) — there is no blank box because there is
// no box at all. The cache-then-network states (loading / hard fetch-error / stale / offline) are owned by the
// VehicleCommandCenter page in the web source, exactly as in the committed FleetStatsBar / SummaryStatsRow /
// QuickMetrics siblings, so they are not re-implemented in this presentational bar. The one-shot `view.opened`
// diagnostic (P1/S11) fires on first composition. There is no English literal and no HTTP here.
//
// The surface is generic over the minimal [FavoriteCommand] id contract and renders each command through its
// `renderTile` slot — the native analogue of the web `renderTile` render-prop. The owning page supplies the
// concrete command type and the tile composable (the CommandTile, covered by its own surface), so this bar
// stays decoupled from a tile's internals exactly as the web component is.
//
// The star is authored locally as a filled [ImageVector] rather than pulled from [TeslaGlyphs]: the shared
// glyph set ships only stroked outlines and has no star, and extending it is outside this surface's allowed
// files, so the one glyph this bar needs lives here (tinted at the render boundary so it tracks the theme).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FavoritesBar) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.favoritesbar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Grid geometry (web Tailwind breakpoints, reproduced) ────────────────────────────────────────────

/** Web `lg:grid-cols-4` — the Tailwind `lg` breakpoint (1024px): four tiles per row at/above this width. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web `sm:grid-cols-3` — the Tailwind `sm` breakpoint (640px): three tiles per row at/above this width. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Web `lg:grid-cols-4`. */
private const val GRID_COLUMNS_LG: Int = 4

/** Web `sm:grid-cols-3`. */
private const val GRID_COLUMNS_SM: Int = 3

/** Web base `grid-cols-2` (below the `sm` breakpoint). */
private const val GRID_COLUMNS_BASE: Int = 2

/** Web Star `h-4 w-4` (16px) — mapped to the 16dp [IconSize.Md] glyph. */
private val STAR_SIZE: IconSize = IconSize.Md

/**
 * Stateful entry point — the faithful 1:1 port of the web `FavoritesBar({ favorites, commands, renderTile })`
 * props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), derives the favourited
 * subset via the pure [FavoritesBarProjection] (web `commands.filter(c => favorites.includes(c.id))`), and
 * renders. The diagnostic fires on first composition regardless of whether the subset is empty — the web
 * component's hooks likewise run before its `favCmds.length === 0` early return — and carries only the surface
 * slug, never the favourite ids or count.
 *
 * @param favorites the persisted favourite command ids (web `favorites`).
 * @param commands the full command catalogue, in display order (web `commands`).
 * @param renderTile draws one favourited command — the native analogue of the web `renderTile` render-prop.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun <C : FavoriteCommand> FavoritesBar(
    favorites: List<String>,
    commands: List<C>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    renderTile: @Composable (C) -> Unit,
) {
    LaunchedEffect(Unit) { FavoritesBarDiagnostics.recordViewOpened(logger) }
    val favouriteCommands = remember(favorites, commands) { FavoritesBarProjection.select(favorites, commands) }
    FavoritesBarContent(commands = favouriteCommands, modifier = modifier, renderTile = renderTile)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. [commands] is the already-projected favourited
 * subset (web `favCmds`). When it is empty the surface composes nothing, faithfully reproducing the web
 * `if (favCmds.length === 0) return null`; otherwise it draws the [FadeIn]-wrapped header + responsive tile grid.
 *
 * @param commands the favourited commands to render, in catalogue order (web `favCmds`).
 * @param renderTile draws one favourited command (web `renderTile`).
 */
@Composable
fun <C : FavoriteCommand> FavoritesBarContent(
    commands: List<C>,
    modifier: Modifier = Modifier,
    renderTile: @Composable (C) -> Unit,
) {
    if (commands.isEmpty()) return
    FadeIn(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth()) {
            FavoritesBarHeader(count = commands.size)
            Spacer(modifier = Modifier.height(Spacing.sm))
            FavoritesGrid(commands = commands, renderTile = renderTile)
        }
    }
}

/**
 * The header row — the web `flex items-center gap-2`: an amber filled [FavoritesStar] (decorative; the label
 * carries the meaning, so it exposes no content description), the uppercase "Quick Actions" label (web
 * `text-xs uppercase tracking-wider text-[var(--text-secondary)]`), and the `(count)` (web
 * `text-[10px] text-[var(--text-muted)]`). Both texts use the [MetricLabel] role so the secondary/muted colours
 * collapse onto the theme's `onSurfaceVariant` and the surface stays correct in light/dark/high-contrast,
 * exactly as the sibling ports normalise the web text tiers.
 */
@Composable
private fun FavoritesBarHeader(count: Int) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val label = stringResource(R.string.translation_commands_cat_quickActions)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = FavoritesStar,
            contentDescription = null,
            size = STAR_SIZE,
            tint = TeslaTokens.status.warning,
        )
        MetricLabel(label.uppercase(locale))
        MetricLabel("($count)")
    }
}

/**
 * The responsive tile grid — the web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`. Column count
 * reflows with the available width at the Tailwind `sm` / `lg` breakpoints; cells share the row width via
 * [Modifier.weight] and a partial trailing row is padded with weighted spacers so the tiles keep an even
 * width. The `gap-3` (12dp) becomes both the inter-row and inter-column spacing ([Spacing.md]). Each tile is
 * drawn by the caller's [renderTile] (web `renderTile(cmd)`).
 */
@Composable
private fun <C : FavoriteCommand> FavoritesGrid(
    commands: List<C>,
    renderTile: @Composable (C) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
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
 * The favourites star — a filled five-point [ImageVector] (24×24 viewport) drawn in opaque black and recoloured
 * at render time by the [Icon] composable's `tint`, so it tracks every theme/state colour. The web glyph is
 * lucide `Star` with `fill-neon-amber`; the shared [TeslaGlyphs] set ships only stroked outlines and no star,
 * so this one filled glyph is authored locally (the surface's allowed files do not include the glyph set).
 */
private val FavoritesStar: ImageVector =
    ImageVector
        .Builder(
            name = "FavoritesStar",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 2f)
                lineTo(14.351f, 8.764f)
                lineTo(21.511f, 8.91f)
                lineTo(15.804f, 13.236f)
                lineTo(17.878f, 20.09f)
                lineTo(12f, 16f)
                lineTo(6.122f, 20.09f)
                lineTo(8.196f, 13.236f)
                lineTo(2.489f, 8.91f)
                lineTo(9.649f, 8.764f)
                close()
            }
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise the populated render branch) ─────────────

/** A throwaway [FavoriteCommand] for the preview/illustrative tile. */
private data class PreviewFavoriteCommand(
    override val id: String,
    val label: String,
) : FavoriteCommand

private val PREVIEW_COMMANDS: List<PreviewFavoriteCommand> =
    listOf(
        PreviewFavoriteCommand("lock", "Lock"),
        PreviewFavoriteCommand("climate_on", "Climate On"),
        PreviewFavoriteCommand("flash", "Flash Lights"),
        PreviewFavoriteCommand("frunk", "Open Frunk"),
    )

/** Illustrative stand-in for the owning page's CommandTile — a small labelled [GlassPanel]. */
@Composable
private fun PreviewTile(command: PreviewFavoriteCommand) {
    GlassPanel(padding = PanelPadding.Md) {
        Caption(command.label)
    }
}

@Preview(name = "Populated", showBackground = true, widthDp = 360)
@Composable
private fun FavoritesBarPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FavoritesBarContent(commands = PREVIEW_COMMANDS) { PreviewTile(it) }
    }
}

@Preview(name = "Populated (wide)", showBackground = true, widthDp = 720)
@Composable
private fun FavoritesBarWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FavoritesBarContent(commands = PREVIEW_COMMANDS) { PreviewTile(it) }
    }
}
