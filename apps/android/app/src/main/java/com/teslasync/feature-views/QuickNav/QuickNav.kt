// The native Jetpack Compose + Material 3 QuickNav feature view — a parity port of
// web/src/features/dashboard/components/QuickNav.tsx. The web component renders a responsive grid of four
// navigation shortcuts (Drives, Charging, Analytics, Battery): each is a GlassPanel wrapped in a router <Link>
// with an accent-tinted icon box, a `text-sm font-semibold` title, a `text-[10px]` muted description, and a
// trailing chevron; the grid is `grid-cols-2 sm:grid-cols-4` (two columns on a phone, four when wide).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling ToolCard port — the other
// zero-data-source presentational surface — it has no loading / error / stale / offline lifecycle to render;
// modelling those would invent behaviour the web spec does not have (honesty covenant: no silent drift). What it
// genuinely varies is its content: the populated four-item grid (web `NAV_ITEMS.map(...)`) and a defensive empty
// state (shown only if the catalogue is ever empty) so the panel is never a blank box. Every item + ordering +
// accent flows through the pure [QuickNavProjection]; the composable is a thin render layer.
//
// Decoupling: the web `<Link to={nav.to}>` becomes a clickable card that emits the tapped [QuickNavDestination]
// through [onNavigate]; the host wires that to the NavController (the view never touches navigation directly).
//
// Accent colors mirror the web per-item hexes via design tokens (the same mapping the sibling ToolCard port
// uses, dark-theme tokens equal to the web hexes): Cyan `#00F0FF` → status.info, Green `#10B981` →
// status.success, Purple `#A855F7` → chart.power, Amber `#F59E0B` → status.warning. The icon box is a rounded
// Surface washed with the accent at 10% (web `bg-{c}/10`), with the glyph tinted full-strength.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuickNav — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quicknav

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web icon box: `rounded-lg p-2` around an `h-5 w-5` (20dp) glyph ⇒ 36dp box. */
private val ICON_CHIP_SIZE: Dp = 36.dp

/** Web `bg-{color}/10` icon-box wash. */
private const val ICON_CHIP_BG_ALPHA: Float = 0.10f

/** Web `grid-cols-2` (phone) — two columns below the `sm` breakpoint. */
private const val GRID_COLUMNS_COMPACT: Int = 2

/** Web `sm:grid-cols-4` — four columns at/above the `sm` breakpoint. */
private const val GRID_COLUMNS_WIDE: Int = 4

/** The `sm` breakpoint (~640px) mapped to the Material medium-window threshold. */
private val WIDE_GRID_MIN_WIDTH: Dp = 600.dp

/** One-line title, two-line description — keeps the grid cells uniform on a phone. */
private const val DESCRIPTION_MAX_LINES: Int = 2

/**
 * Stateful entry point for the QuickNav shortcut grid. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders the navigation grid. The surface binds no data of its own; tapping a card emits the
 * chosen [QuickNavDestination] through [onNavigate] (web `<Link to={nav.to}>`), which the host routes.
 *
 * @param onNavigate invoked with the tapped destination; the host navigates (the view never touches the NavController).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun QuickNav(
    onNavigate: (QuickNavDestination) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { QuickNavDiagnostics.recordViewOpened(logger) }
    QuickNavContent(onNavigate = onNavigate, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web grid: a responsive
 * two-/four-column layout of accent-tinted nav cards (web `NAV_ITEMS.map(...)`), or a friendly empty state when
 * [items] is empty so the surface is never a blank box. [items] defaults to the static [QuickNavProjection].
 */
@Composable
fun QuickNavContent(
    onNavigate: (QuickNavDestination) -> Unit,
    modifier: Modifier = Modifier,
    items: List<QuickNavItem> = QuickNavProjection.items,
) {
    if (items.isEmpty()) {
        GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                icon = TeslaGlyphs.Info,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        return
    }
    BoxWithConstraints(modifier = modifier) {
        val columns = if (maxWidth >= WIDE_GRID_MIN_WIDTH) GRID_COLUMNS_WIDE else GRID_COLUMNS_COMPACT
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            items.chunked(columns).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowItems.forEach { item ->
                        QuickNavCard(item = item, onNavigate = onNavigate, modifier = Modifier.weight(1f))
                    }
                    // Pad the final row so cards keep an even width when the item count is not a full row.
                    repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One navigation card — the web `<Link><GlassPanel>` row: an accent icon box, the title + description column,
 * and a trailing chevron. The whole card is a single button (web `<Link>`): tapping emits the card's
 * [QuickNavItem.destination] through [onNavigate]. The title + description carry the accessible name; the
 * chevron and icon are decorative, and the click exposes the localized "Open" action label for TalkBack.
 */
@Composable
private fun QuickNavCard(
    item: QuickNavItem,
    onNavigate: (QuickNavDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = accentColor(item.accent)
    val openLabel = stringResource(R.string.translation_common_open)
    GlassPanel(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.large)
                .clickable(role = Role.Button, onClickLabel = openLabel) { onNavigate(item.destination) },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            QuickNavIconChip(icon = glyphFor(item.destination), accent = accent)
            Column(modifier = Modifier.weight(1f)) {
                PanelTitle(stringResource(labelResFor(item.destination)))
                QuickNavCardDescription(stringResource(descriptionResFor(item.destination)))
            }
            Icon(
                imageVector = TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The accent icon box — the native analogue of the web `rounded-lg p-2 bg-{c}/10` chip: a rounded [Surface]
 * washed with the accent at [ICON_CHIP_BG_ALPHA] with the glyph tinted full-strength. Decorative (the title +
 * description carry the meaning), so it exposes no content description to accessibility services.
 */
@Composable
private fun QuickNavIconChip(
    icon: ImageVector,
    accent: Color,
) {
    Surface(
        modifier = Modifier.size(ICON_CHIP_SIZE),
        shape = RoundedCornerShape(Radius.sm),
        color = accent.copy(alpha = ICON_CHIP_BG_ALPHA),
        contentColor = accent,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg, tint = accent)
        }
    }
}

/**
 * The card's muted one-line-ish description — the web `text-[10px] text-[var(--text-muted)]`. Rendered with the
 * theme's `labelMedium` slot + `onSurfaceVariant` (the same role/color the [io.teslasync.android.components.ui.Caption]
 * wrapper binds), capped at [DESCRIPTION_MAX_LINES] with an ellipsis so the destination subtitles keep the grid
 * cells uniform; never a hand-picked hex, so light/dark/high-contrast all stay correct.
 */
@Composable
private fun QuickNavCardDescription(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = DESCRIPTION_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Destination → localized title key (P1/S10). The web `t('nav.x', 'Drives'|…)` keys are inline-fallback keys
 * absent from the shared catalog, so each title resolves through the canonical nav title key for the same
 * destination (web fallbacks `Drives`/`Charging`/`Analytics`/`Battery`).
 */
private fun labelResFor(destination: QuickNavDestination): Int =
    when (destination) {
        QuickNavDestination.Drives -> R.string.translation_nav_drives
        QuickNavDestination.Charging -> R.string.translation_nav_charging
        QuickNavDestination.Analytics -> R.string.translation_nav_analytics
        QuickNavDestination.Battery -> R.string.translation_nav_battery
    }

/**
 * Destination → localized description key (P1/S10). Resolves to each destination's canonical page subtitle (web
 * card fallbacks `Trip history`/`Sessions & costs`/`Fleet insights`/`Health & degradation`), so the card
 * describes exactly where it leads with a real, localized catalog string rather than an English literal.
 */
private fun descriptionResFor(destination: QuickNavDestination): Int =
    when (destination) {
        QuickNavDestination.Drives -> R.string.translation_drives_subtitle
        QuickNavDestination.Charging -> R.string.translation_charging_list_subtitle
        QuickNavDestination.Analytics -> R.string.translation_analytics_subtitle
        QuickNavDestination.Battery -> R.string.translation_battery_subtitle
    }

/**
 * Destination → leading glyph. Web lucide `Route`/`BatteryCharging`/`Gauge` map 1:1 to the vendored component
 * glyphs; the components layer ships no `Activity`/pulse glyph, so the Battery item uses the components `Battery`
 * glyph (the family the app's own BatteryEnergy nav group uses) — the one documented icon substitution.
 */
private fun glyphFor(destination: QuickNavDestination): ImageVector =
    when (destination) {
        QuickNavDestination.Drives -> MapsGlyphs.Route
        QuickNavDestination.Charging -> DataDisplayGlyphs.BatteryCharging
        QuickNavDestination.Analytics -> DataDisplayGlyphs.Gauge
        QuickNavDestination.Battery -> DataDisplayGlyphs.Battery
    }

/** Accent → design-token [Color]. Dark-theme tokens equal the web hexes (see the file header). */
@Composable
private fun accentColor(accent: QuickNavAccent): Color =
    when (accent) {
        QuickNavAccent.Cyan -> TeslaTokens.status.info
        QuickNavAccent.Green -> TeslaTokens.status.success
        QuickNavAccent.Purple -> TeslaTokens.chart.power
        QuickNavAccent.Amber -> TeslaTokens.status.warning
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Content", showBackground = true)
@Composable
private fun QuickNavContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickNavContent(onNavigate = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun QuickNavEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickNavContent(onNavigate = {}, items = emptyList())
    }
}
