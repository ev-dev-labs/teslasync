// The native Jetpack Compose + Material 3 TelemetryGrid feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx. The web component is purely
// presentational: the owning vehicle Live/Overview page resolves a `VehicleState` (owning the
// `/vehicles/{vehicleID}/state` query and its loading / error / stale / offline handling) and passes it down
// as the single `state` prop. It renders a responsive grid (`grid-cols-2 sm:3 lg:4 xl:6`, `gap-3`) of six
// `InfoTile`s wrapped in `StaggerContainer` / `StaggerItem`, its only data hooks being `useTranslation` and
// `useUnits`.
//
// This port keeps that contract exactly. The grid reproduces the web composition tile-for-tile, in source
// order: Battery (percent + range sub, emerald/amber/rose by charge), Speed (Driving/Parked sub), Inside
// (Outside-temp sub), Odometer, Charger (kW + "Full in …h" sub when charging, else "Not charging"), and
// Sentry (Active/Off). The cells stagger in exactly as the web `StaggerItem`s do and collapse to their final
// state at once under reduced motion (the shared `StaggerContainer` contract). The grid reflows 2 → 3 → 4 → 6
// columns at the web `sm`/`lg`/`xl` breakpoints. When `state` is absent the surface shows a friendly
// `EmptyState`, never a blank box — the cache-then-network states are owned by the page exactly as in the web
// source and the committed LiveVehicleState / QuickMetrics siblings.
//
// Every derivation flows through the pure [TelemetryGridProjection]; this file is a thin render layer that
// resolves the i18n labels + value words (P1/S10), the SI -> display unit formatter (P1/S8 settings store, the
// `useUnits` port), the design-token accents (P1/S9), and the glyphs, then draws them. There is no English
// literal and no HTTP here. The one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryGrid) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrygrid

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Tailwind `sm` (640px) breakpoint — the web `sm:grid-cols-3` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Tailwind `lg` (1024px) breakpoint — the web `lg:grid-cols-4` reflow. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Tailwind `xl` (1280px) breakpoint — the web `xl:grid-cols-6` reflow. */
private val GRID_XL_MIN_WIDTH: Dp = 1280.dp

private const val GRID_COLUMNS_BASE = 2
private const val GRID_COLUMNS_SM = 3
private const val GRID_COLUMNS_LG = 4
private const val GRID_COLUMNS_XL = 6

/** Web `gap-3` (12px) between tiles, both axes — the Spacing-token equivalent. */
private val GRID_GAP: Dp = Spacing.md

/**
 * Stateful entry point — the faithful 1:1 port of the web `TelemetryGrid({ state })` prop. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), resolves the SI -> display unit formatter
 * from the shared settings store (P1/S8, the `useUnits` port), projects the prop onto a [TelemetryGridDisplay]
 * via the pure [TelemetryGridProjection], and renders.
 *
 * @param state the vehicle state resolved by the owning Live/Overview page (web `state` prop), or `null` when
 *   no state is cached — `null` selects the empty branch. The owning page owns the `/vehicles/{vehicleID}/state`
 *   query's loading / error / stale / offline handling, so this presentational surface renders only the grid
 *   and empty branches.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param formatter the SI -> display unit formatter, resolved from the shared settings store.
 */
@Composable
fun TelemetryGrid(
    state: VehicleStateTelemetry?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    formatter: UnitFormatter = rememberUnitFormatter(),
) {
    LaunchedEffect(Unit) { TelemetryGridDiagnostics.recordViewOpened(logger) }
    val display = remember(state, formatter) { TelemetryGridProjection.project(state, formatter) }
    TelemetryGridContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the web component's two branches:
 * the six-tile responsive grid when [display] is present, or the localized empty state when it is `null`
 * (the native analogue of the web `state ? <grid/> : <empty/>`). Never a hidden surface.
 */
@Composable
fun TelemetryGridContent(
    display: TelemetryGridDisplay?,
    modifier: Modifier = Modifier,
) {
    if (display != null) {
        TelemetryGridLayout(tiles = display.tiles, modifier = modifier)
    } else {
        EmptyState(message = stringResource(R.string.translation_common_noData), modifier = modifier)
    }
}

/**
 * The responsive tile grid — the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6`. Picks the
 * column count from the available width and lays the tiles out as weighted rows so every tile shares a
 * uniform width; the final row is padded with empty weighted slots so a short last row keeps the same tile
 * sizing. Each tile is wrapped in a [StaggerItem] keyed by its global index so the entrance cascades exactly
 * as the web `StaggerContainer` / `StaggerItem` do, honoring reduced motion.
 */
@Composable
private fun TelemetryGridLayout(
    tiles: List<TelemetryTile>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_XL_MIN_WIDTH -> GRID_COLUMNS_XL
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        StaggerContainer(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(GRID_GAP),
        ) {
            tiles.chunked(columns).forEachIndexed { rowIndex, rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(GRID_GAP),
                ) {
                    rowTiles.forEachIndexed { columnIndex, tile ->
                        StaggerItem(index = rowIndex * columns + columnIndex, modifier = Modifier.weight(1f)) {
                            TelemetryTileCard(tile = tile, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    repeat(columns - rowTiles.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * One tile — the native port of the web `InfoTile`: a muted icon + label row on top, the accent-tinted value
 * below, and an optional muted sub-line. The whole tile is a single merged accessibility node so TalkBack
 * reads it as "<label>, <value>, <sub>" rather than separate fragments.
 */
@Composable
private fun TelemetryTileCard(
    tile: TelemetryTile,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(tileLabelRes(tile.key))
    val value = tileValueText(tile.value)
    val sub = tileSubText(tile.sub)
    GlassPanel(
        modifier = modifier.semantics(mergeDescendants = true) {},
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = tileGlyph(tile.key),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(modifier = Modifier.height(Spacing.xs))
        Text(
            text = value,
            modifier = Modifier.fillMaxWidth(),
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
            color = accentColor(tile.accent),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (sub != null) {
            Spacer(modifier = Modifier.height(Spacing.xs))
            Text(
                text = sub,
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Resolves a tile's render-ready value; the state variants resolve through the i18n catalog (P1/S10). */
@Composable
private fun tileValueText(value: TileValue): String =
    when (value) {
        is TileValue.Text -> value.text
        TileValue.NotCharging -> stringResource(R.string.translation_common_notCharging)
        TileValue.SentryActive -> stringResource(R.string.translation_common_active)
        TileValue.SentryOff -> stringResource(R.string.translation_common_off)
    }

/**
 * Resolves a tile's render-ready sub-line, composing the projected numeric fragment with the translated
 * word(s) (web template literals), or `null` for [TileSub.None] so no sub-line renders.
 */
@Composable
private fun tileSubText(sub: TileSub): String? =
    when (sub) {
        TileSub.None -> null
        is TileSub.Range -> "${sub.distance} ${stringResource(R.string.translation_common_range)}"
        TileSub.Driving -> stringResource(R.string.translation_common_driving)
        TileSub.Parked -> stringResource(R.string.translation_common_parked)
        is TileSub.Outside -> "${stringResource(R.string.translation_common_outside)}: ${sub.temperature}"
        is TileSub.FullIn -> "${stringResource(R.string.translation_vehicles_detail_fullIn)} ${sub.hours}"
    }

/** Maps a tile key onto its generated i18n label resource (web `t('common.<key>')`). */
private fun tileLabelRes(key: TelemetryTileKey): Int =
    when (key) {
        TelemetryTileKey.BATTERY -> R.string.translation_common_battery
        TelemetryTileKey.SPEED -> R.string.translation_common_speed
        TelemetryTileKey.INSIDE -> R.string.translation_common_inside
        TelemetryTileKey.ODOMETER -> R.string.translation_common_odometer
        TelemetryTileKey.CHARGER -> R.string.translation_common_charger
        TelemetryTileKey.SENTRY -> R.string.translation_common_sentry
    }

/** Maps a tile key onto its lucide-equivalent glyph; four reuse the shared sets, two are surface-authored. */
private fun tileGlyph(key: TelemetryTileKey): ImageVector =
    when (key) {
        TelemetryTileKey.BATTERY -> DataDisplayGlyphs.Battery
        TelemetryTileKey.SPEED -> DataDisplayGlyphs.Gauge
        TelemetryTileKey.INSIDE -> TelemetryGridGlyphs.Thermometer
        TelemetryTileKey.ODOMETER -> TelemetryGridGlyphs.Navigation
        TelemetryTileKey.CHARGER -> DataDisplayGlyphs.BatteryCharging
        TelemetryTileKey.SENTRY -> TeslaGlyphs.Eye
    }

/** Resolves a [TileAccent] to its design-token color (web `InfoTile` `color`). */
@Composable
private fun accentColor(accent: TileAccent): Color =
    when (accent) {
        TileAccent.PRIMARY -> MaterialTheme.colorScheme.onSurface
        TileAccent.SUCCESS -> TeslaTokens.status.success
        TileAccent.WARNING -> TeslaTokens.status.warning
        TileAccent.DANGER -> TeslaTokens.status.danger
        TileAccent.MUTED -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Resolves the live [UnitFormatter] from the shared settings store (P1/S8) — the native projection of the web
 * `useUnits` hook. The `DataContainer` exposes it as a `StateFlow` derived from the live settings document,
 * so a units / locale / precision change re-projects every tile without this surface knowing how the
 * preference is stored.
 */
@Composable
private fun rememberUnitFormatter(): UnitFormatter {
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    return formatter
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STATE =
    VehicleStateTelemetry(
        batteryLevel = 84.0,
        ratedRangeMeters = 350_000.0,
        speedMps = 0.0,
        insideTempCelsius = 21.0,
        outsideTempCelsius = 14.0,
        odometerMeters = 19_874_000.0,
        isCharging = true,
        chargerPowerKw = 11.0,
        timeToFullChargeHours = 1.5,
        sentryMode = true,
    )

@Preview(name = "Grid — data (2-col)", showBackground = true, widthDp = 420)
@Composable
private fun TelemetryGridDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryGridContent(TelemetryGridProjection.project(PREVIEW_STATE, UnitFormatter.default()))
    }
}

@Preview(name = "Grid — wide (6-col)", showBackground = true, widthDp = 1320)
@Composable
private fun TelemetryGridWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryGridContent(TelemetryGridProjection.project(PREVIEW_STATE, UnitFormatter.default()))
    }
}

@Preview(name = "Empty — no data", showBackground = true, widthDp = 420)
@Composable
private fun TelemetryGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryGridContent(TelemetryGridProjection.project(state = null, formatter = UnitFormatter.default()))
    }
}
