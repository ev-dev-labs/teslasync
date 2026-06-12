// The native Jetpack Compose + Material 3 QuickLinks feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx. The web component renders a
// GlassPanel headed by a cyan chevron + a "Quick Links" title, holding a responsive grid
// (grid-cols-2 sm:grid-cols-3 lg:grid-cols-6) of six navigation shortcuts (Drives, Charging, Battery, Climate,
// Efficiency, Settings). Each shortcut is a per-tile GlassPanel (web `hover glow="cyan"`) wrapped in a router
// <Link>, laid out as a centered column: a muted `h-5 w-5` icon above an `text-xs font-medium` primary label.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling QuickNav port — the other
// zero-data-source presentational surface — it has no loading / error / stale / offline lifecycle to render;
// modelling those would invent behaviour the web spec does not have (honesty covenant: no silent drift). What it
// genuinely varies is its content: the populated six-tile grid (web `quickLinks.map(...)`) and a defensive empty
// state (shown only if the catalogue is ever empty) so the panel is never a blank box. Every item + ordering +
// route flows through the pure [QuickLinksProjection]; the composable is a thin render layer.
//
// Decoupling: the web `<Link to={link.to}>` becomes a clickable card that emits the tapped [QuickLinkDestination]
// through [onNavigate]; the host wires that to the NavController (the view never touches navigation directly).
//
// Styling parity: the web header chevron `text-[var(--neon-cyan)]` maps to the cyan `status.info` design token;
// the per-tile `glow="cyan"` affordance maps to the shared GlassPanel `PanelAccent.Info` border tint (its
// documented native analogue of the web glow). The tile icon is muted (`onSurfaceVariant`, web `--text-muted`)
// and the label is primary (`onSurface`, web `--text-primary`), so light / dark / high-contrast all stay correct.
//
// Glyphs: the web lucide icons are Route / BatteryCharging / Battery / Thermometer / BarChart3 / Settings, plus a
// header ChevronRight. Route, BatteryCharging, Battery and ChevronRight already exist in the shared component glyph
// catalogs and are reused. Thermometer, BarChart3 and Settings are absent from every shared catalog and the
// surface's allowed-files scope forbids editing those shared files, so they are authored locally below as 24×24
// stroked vectors (the same approach the sibling ReferenceLinksSection port and the shared glyph sets take).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuickLinksSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quicklinks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Glyph geometry (lucide 24×24 stroked viewport) ──────────────────────────────────────────────────
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f

/** One-line tile label, mirroring the web `text-xs` cell whose width is kept uniform across the grid. */
private const val LABEL_MAX_LINES = 1

/**
 * Stateful entry point for the QuickLinks shortcut grid. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders the navigation grid. The surface binds no data of its own; tapping a tile emits the chosen
 * [QuickLinkDestination] through [onNavigate] (web `<Link to={link.to}>`), which the host routes.
 *
 * @param onNavigate invoked with the tapped destination; the host navigates (the view never touches the NavController).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun QuickLinksSection(
    onNavigate: (QuickLinkDestination) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { QuickLinksDiagnostics.recordViewOpened(logger) }
    QuickLinksSectionContent(onNavigate = onNavigate, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web panel: a cyan-chevron header,
 * then a responsive grid of shortcut tiles (web `quickLinks.map(...)`), or a friendly empty state when [items] is
 * empty so the surface is never a blank box. [items] defaults to the static [QuickLinksProjection].
 */
@Composable
fun QuickLinksSectionContent(
    onNavigate: (QuickLinkDestination) -> Unit,
    modifier: Modifier = Modifier,
    items: List<QuickLinkDestination> = QuickLinksProjection.items,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        QuickLinksHeader()
        Spacer(modifier = Modifier.height(Spacing.md))
        if (items.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                icon = TeslaGlyphs.Info,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            QuickLinksGrid(items = items, onNavigate = onNavigate)
        }
    }
}

/**
 * The panel header — the web `<ChevronRight class="text-[var(--neon-cyan)]"/>` + bold "Quick Links" title. The
 * chevron is decorative (the title carries the accessible name), tinted with the cyan `status.info` token; the
 * title resolves through the i18n catalog (P1/S10).
 */
@Composable
private fun QuickLinksHeader(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(stringResource(R.string.translation_vehicles_detail_quickLinks))
    }
}

/**
 * The responsive shortcut grid — the web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3`. The column count
 * is derived from the available width by the pure [QuickLinksProjection.columnsFor]; a trailing partial row is
 * padded with weighted spacers so every tile keeps a uniform width.
 */
@Composable
private fun QuickLinksGrid(
    items: List<QuickLinkDestination>,
    onNavigate: (QuickLinkDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = QuickLinksProjection.columnsFor(maxWidth.value.toInt())
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            items.chunked(columns).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowItems.forEach { destination ->
                        QuickLinkTile(
                            destination = destination,
                            onNavigate = onNavigate,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    // Pad the final row so tiles keep an even width when the item count is not a full row.
                    repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One shortcut tile — the web per-link `<Link><GlassPanel hover glow="cyan">`: a centered column of a muted glyph
 * above a primary label. The whole tile is a single button (web `<Link>`): it is one merged TalkBack node whose
 * accessible name is the localized [label], with the Button role and the localized "Open" action label; activating
 * it emits the tile's [destination] through [onNavigate]. The cyan glow maps to the `PanelAccent.Info` border tint.
 */
@Composable
private fun QuickLinkTile(
    destination: QuickLinkDestination,
    onNavigate: (QuickLinkDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(labelResFor(destination))
    val openLabel = stringResource(R.string.translation_common_open)
    GlassPanel(
        modifier =
            modifier
                .semantics(mergeDescendants = true) { contentDescription = label }
                .clickable(role = Role.Button, onClickLabel = openLabel) { onNavigate(destination) },
        padding = PanelPadding.Md,
        accent = PanelAccent.Info,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = glyphFor(destination),
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            QuickLinkTileLabel(text = label)
        }
    }
}

/**
 * The centered tile label — the web `text-xs font-medium text-[var(--text-primary)]`. Rendered with the theme's
 * `labelMedium` slot + `onSurface` (primary), capped at [LABEL_MAX_LINES] with an ellipsis so the labels keep the
 * grid cells uniform; never a hand-picked hex, so light / dark / high-contrast all stay correct.
 */
@Composable
private fun QuickLinkTileLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        maxLines = LABEL_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Destination → localized title key (P1/S10). The web `t('nav.x', 'Drives'|…)` keys resolve through the canonical
 * nav title key for the same destination (web fallbacks Drives / Charging / Battery / Climate / Efficiency / Settings).
 */
private fun labelResFor(destination: QuickLinkDestination): Int =
    when (destination) {
        QuickLinkDestination.Drives -> R.string.translation_nav_drives
        QuickLinkDestination.Charging -> R.string.translation_nav_charging
        QuickLinkDestination.Battery -> R.string.translation_nav_battery
        QuickLinkDestination.Climate -> R.string.translation_nav_climate
        QuickLinkDestination.Efficiency -> R.string.translation_nav_efficiency
        QuickLinkDestination.Settings -> R.string.translation_nav_settings
    }

/**
 * Destination → leading glyph. Web lucide `Route` / `BatteryCharging` / `Battery` map 1:1 to the vendored component
 * glyphs; `Thermometer` / `BarChart3` / `Settings` are absent from the shared catalogs and are authored locally in
 * [QuickLinkGlyphs] (the shared catalogs are outside this surface's allowed-files scope).
 */
private fun glyphFor(destination: QuickLinkDestination): ImageVector =
    when (destination) {
        QuickLinkDestination.Drives -> MapsGlyphs.Route
        QuickLinkDestination.Charging -> DataDisplayGlyphs.BatteryCharging
        QuickLinkDestination.Battery -> DataDisplayGlyphs.Battery
        QuickLinkDestination.Climate -> QuickLinkGlyphs.Thermometer
        QuickLinkDestination.Efficiency -> QuickLinkGlyphs.BarChart3
        QuickLinkDestination.Settings -> QuickLinkGlyphs.Settings
    }

/**
 * Locally authored line-style glyphs for the three web lucide icons absent from the shared catalogs (Thermometer,
 * BarChart3, Settings), drawn as 24×24 stroked [ImageVector]s and recolored at render time by the [Icon] tint. The
 * other three web glyphs (Route, BatteryCharging, Battery) are reused from the shared catalogs rather than redrawn.
 */
private object QuickLinkGlyphs {
    /** Thermometer glyph (lucide `thermometer`) — the Climate tile. */
    val Thermometer: ImageVector =
        quickLinkStroked("QuickLinksThermometer") {
            moveTo(14f, 14.76f)
            verticalLineTo(3.5f)
            arcToRelative(2.5f, 2.5f, 0f, false, false, -5f, 0f)
            verticalLineToRelative(11.26f)
            arcToRelative(4.5f, 4.5f, 0f, true, false, 5f, 0f)
            close()
        }

    /** Bar-chart glyph (lucide `bar-chart-3`) — the Efficiency tile. */
    val BarChart3: ImageVector =
        quickLinkStroked("QuickLinksBarChart3") {
            moveTo(3f, 3f)
            verticalLineToRelative(18f)
            horizontalLineToRelative(18f)
            moveTo(18f, 17f)
            verticalLineTo(9f)
            moveTo(13f, 17f)
            verticalLineTo(5f)
            moveTo(8f, 17f)
            verticalLineToRelative(-3f)
        }

    /** Gear glyph (lucide `settings`) — the Settings tile: a toothed ring around a center circle. */
    val Settings: ImageVector =
        quickLinkStroked("QuickLinksSettings") {
            moveTo(12.22f, 2f)
            horizontalLineToRelative(-0.44f)
            arcToRelative(2f, 2f, 0f, false, false, -2f, 2f)
            verticalLineToRelative(0.18f)
            arcToRelative(2f, 2f, 0f, false, true, -1f, 1.73f)
            lineToRelative(-0.43f, 0.25f)
            arcToRelative(2f, 2f, 0f, false, true, -2f, 0f)
            lineToRelative(-0.15f, -0.08f)
            arcToRelative(2f, 2f, 0f, false, false, -2.73f, 0.73f)
            lineToRelative(-0.22f, 0.38f)
            arcToRelative(2f, 2f, 0f, false, false, 0.73f, 2.73f)
            lineToRelative(0.15f, 0.1f)
            arcToRelative(2f, 2f, 0f, false, true, 1f, 1.72f)
            verticalLineToRelative(0.51f)
            arcToRelative(2f, 2f, 0f, false, true, -1f, 1.74f)
            lineToRelative(-0.15f, 0.09f)
            arcToRelative(2f, 2f, 0f, false, false, -0.73f, 2.73f)
            lineToRelative(0.22f, 0.38f)
            arcToRelative(2f, 2f, 0f, false, false, 2.73f, 0.73f)
            lineToRelative(0.15f, -0.08f)
            arcToRelative(2f, 2f, 0f, false, true, 2f, 0f)
            lineToRelative(0.43f, 0.25f)
            arcToRelative(2f, 2f, 0f, false, true, 1f, 1.73f)
            verticalLineTo(20f)
            arcToRelative(2f, 2f, 0f, false, false, 2f, 2f)
            horizontalLineToRelative(0.44f)
            arcToRelative(2f, 2f, 0f, false, false, 2f, -2f)
            verticalLineToRelative(-0.18f)
            arcToRelative(2f, 2f, 0f, false, true, 1f, -1.73f)
            lineToRelative(0.43f, -0.25f)
            arcToRelative(2f, 2f, 0f, false, true, 2f, 0f)
            lineToRelative(0.15f, 0.08f)
            arcToRelative(2f, 2f, 0f, false, false, 2.73f, -0.73f)
            lineToRelative(0.22f, -0.39f)
            arcToRelative(2f, 2f, 0f, false, false, -0.73f, -2.73f)
            lineToRelative(-0.15f, -0.08f)
            arcToRelative(2f, 2f, 0f, false, true, -1f, -1.74f)
            verticalLineToRelative(-0.5f)
            arcToRelative(2f, 2f, 0f, false, true, 1f, -1.74f)
            lineToRelative(0.15f, -0.09f)
            arcToRelative(2f, 2f, 0f, false, false, 0.73f, -2.73f)
            lineToRelative(-0.22f, -0.38f)
            arcToRelative(2f, 2f, 0f, false, false, -2.73f, -0.73f)
            lineToRelative(-0.15f, 0.08f)
            arcToRelative(2f, 2f, 0f, false, true, -2f, 0f)
            lineToRelative(-0.43f, -0.25f)
            arcToRelative(2f, 2f, 0f, false, true, -1f, -1.73f)
            verticalLineTo(4f)
            arcToRelative(2f, 2f, 0f, false, false, -2f, -2f)
            close()
            moveTo(9f, 12f)
            arcTo(3f, 3f, 0f, false, true, 15f, 12f)
            arcTo(3f, 3f, 0f, false, true, 9f, 12f)
            close()
        }
}

/** Builds a stroked, round-capped 24×24 [ImageVector] from a path [build] block — the shared local glyph recipe. */
private fun quickLinkStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Content", showBackground = true)
@Composable
private fun QuickLinksSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickLinksSectionContent(onNavigate = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun QuickLinksSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickLinksSectionContent(onNavigate = {}, items = emptyList())
    }
}
