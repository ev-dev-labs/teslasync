// The native Jetpack Compose + Material 3 EfficiencyPanel feature view — a parity port of
// web/src/features/charging/components/charging-list/EfficiencyPanel.tsx. The web component renders an outer
// GlassPanel with an Activity-icon header ("Charging Efficiency" + a "Wall-to-battery energy conversion
// (N sessions with data)" hint) over a responsive 1 / 2 / 4-column grid of four centered stat tiles: the
// average wall-to-battery efficiency (a colored percent + a progress bar clamped to 100%), the best and worst
// sessions (a colored percent + the session's formatted date), and the wall-to-battery loss (a colored
// "kWh" value + a "used kWh -> added kWh" detail line). This port keeps that contract: the four tiles always
// render with real values, the grid reflows at the web Tailwind `sm` (640dp) and `lg` (1024dp) breakpoints,
// and the resolved grid fades in exactly as the web `<FadeIn>` wrapper does.
//
// Every derivation flows through the pure [EfficiencyPanelProjection]; the composable is a thin render layer
// that resolves the i18n labels (P1/S10) and the design-token accents (P1/S9) and lays out the tiles. The
// tile colors map the web Tailwind hues onto the semantic status palette (cyan -> info, emerald -> success,
// rose -> danger, amber -> warning), so light/dark/high-contrast all stay consistent. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EfficiencyPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.efficiencypanel

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the four tiles lay out in a single row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the tiles lay out two-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 4
private const val GRID_COLUMNS_SM: Int = 2
private const val GRID_COLUMNS_BASE: Int = 1

/** The four efficiency tiles, matching the web component's fixed tile set. */
private const val TILE_COUNT: Int = 4

/** Web `h-1.5` (6px) progress-bar track/fill height on the average tile. */
private val BAR_HEIGHT: Dp = 6.dp

/** Skeleton tile height while the owning query loads — covers a value + label + bar/subline tile. */
private val SKELETON_TILE_HEIGHT: Dp = 104.dp

/** Web `bg-white/[0.05]` progress-bar track alpha, expressed against the theme's on-surface color. */
private const val BAR_TRACK_ALPHA: Float = 0.08f

/**
 * Stateful entry point — the faithful port of the web `EfficiencyPanel({ stats })` plus the owning page's
 * implicit query state. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), projects
 * the inputs onto an [EfficiencyPanelDisplay] via the pure [EfficiencyPanelProjection] (using the device
 * locale + zone so the percent/date formatting tracks the platform exactly as the web tracks the browser),
 * and renders.
 *
 * @param stats the lifetime efficiency stats the ChargingList page computed, or `null` while absent.
 * @param isLoading whether the owning query is still in flight; drives the skeleton branch.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EfficiencyPanel(
    stats: EfficiencyStats?,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { EfficiencyPanelDiagnostics.recordViewOpened(logger) }
    val locale = LocalConfiguration.current.locales[0]
    val zoneId = remember { ZoneId.systemDefault() }
    val display =
        remember(stats, isLoading, locale, zoneId) {
            EfficiencyPanelProjection.project(stats = stats, loading = isLoading, locale = locale, zoneId = zoneId)
        }
    EfficiencyPanelContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Always renders the outer panel + header, then
 * the per-state body: the skeleton tile grid while [EfficiencyPanelDisplay.Loading], a friendly empty state
 * for [EfficiencyPanelDisplay.Empty] (never a blank box), and the four resolved tiles otherwise. The header's
 * session-count hint is shown only once resolved (it is unknown while loading/empty).
 */
@Composable
fun EfficiencyPanelContent(
    display: EfficiencyPanelDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        EfficiencyHeader(sessionCount = (display as? EfficiencyPanelDisplay.Resolved)?.sessionCount)
        Spacer(modifier = Modifier.height(Spacing.lg))
        when (display) {
            EfficiencyPanelDisplay.Loading -> EfficiencyLoadingGrid()
            EfficiencyPanelDisplay.Empty ->
                EmptyState(message = stringResource(R.string.translation_common_noData))
            is EfficiencyPanelDisplay.Resolved -> FadeIn { EfficiencyResolvedGrid(display) }
        }
    }
}

/**
 * The panel header — the web `<h3>` with its Activity icon, the "Charging Efficiency" title, and the
 * "Wall-to-battery energy conversion (N sessions with data)" hint. The count parenthetical is appended only
 * when [sessionCount] is known (resolved); while loading/empty the bare hint is shown. Title + hint stack
 * vertically (native idiom) rather than sharing a line as the web does on wide viewports.
 */
@Composable
private fun EfficiencyHeader(sessionCount: Int?) {
    val hint = stringResource(R.string.translation_charging_efficiency_hint)
    val sessionsWithData = stringResource(R.string.translation_charging_efficiency_sessionsWithData)
    val hintText =
        if (sessionCount != null) "$hint ($sessionCount $sessionsWithData)" else hint
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            EfficiencyPanelGlyphs.Activity,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        SectionTitle(stringResource(R.string.translation_charging_efficiency_title))
    }
    Caption(hintText, modifier = Modifier.padding(top = Spacing.xs))
}

/**
 * The resolved four-tile grid (web `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`). Tile order, colors,
 * and content mirror the web 1:1: average efficiency (info / cyan, with a bar), best session (success /
 * emerald, with a date), worst session (danger / rose, with a date), and wall-to-battery loss (warning /
 * amber, with the used→added detail).
 */
@Composable
private fun EfficiencyResolvedGrid(resolved: EfficiencyPanelDisplay.Resolved) {
    val averageLabel = stringResource(R.string.translation_charging_efficiency_average)
    val bestLabel = stringResource(R.string.translation_charging_efficiency_best)
    val worstLabel = stringResource(R.string.translation_charging_efficiency_worst)
    val wallLossLabel = stringResource(R.string.translation_charging_efficiency_wallLoss)
    EfficiencyGrid(
        cells =
            listOf(
                { cellModifier ->
                    EfficiencyTile(
                        value = resolved.averageEfficiency,
                        label = averageLabel,
                        accent = TeslaTokens.status.info,
                        modifier = cellModifier,
                        barFraction = resolved.averageBarFraction,
                    )
                },
                { cellModifier ->
                    EfficiencyTile(
                        value = resolved.bestEfficiency,
                        label = bestLabel,
                        accent = TeslaTokens.status.success,
                        modifier = cellModifier,
                        subline = resolved.bestDate,
                    )
                },
                { cellModifier ->
                    EfficiencyTile(
                        value = resolved.worstEfficiency,
                        label = worstLabel,
                        accent = TeslaTokens.status.danger,
                        modifier = cellModifier,
                        subline = resolved.worstDate,
                    )
                },
                { cellModifier ->
                    EfficiencyTile(
                        value = resolved.wallLoss,
                        label = wallLossLabel,
                        accent = TeslaTokens.status.warning,
                        modifier = cellModifier,
                        subline = resolved.wallLossDetail,
                    )
                },
            ),
    )
}

/**
 * The loading branch — four skeleton tiles in the same responsive grid as the resolved tiles. The grid carries
 * a single TalkBack "Loading" content description so the state is announced rather than read as four empty boxes.
 */
@Composable
private fun EfficiencyLoadingGrid() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val skeleton: @Composable (Modifier) -> Unit = { cellModifier ->
        Skeleton(modifier = cellModifier, height = SKELETON_TILE_HEIGHT)
    }
    EfficiencyGrid(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        cells = List(TILE_COUNT) { skeleton },
    )
}

/**
 * A single centered stat tile — an inner GlassPanel with a large accent-colored [value], a muted [label], and
 * either a progress [barFraction] (the average tile) or a [subline] (the best/worst dates and the loss detail).
 * The tile merges its descendants under one accessible label so TalkBack reads "label: value[, detail]" as a
 * unit; the bar is purely decorative.
 */
@Composable
private fun EfficiencyTile(
    value: String,
    label: String,
    accent: Color,
    modifier: Modifier = Modifier,
    barFraction: Float? = null,
    subline: String? = null,
) {
    val description = EfficiencyPanelProjection.accessibilityLabel(label = label, value = value, detail = subline)
    GlassPanel(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description },
        padding = PanelPadding.Lg,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = accent,
                textAlign = TextAlign.Center,
            )
            MetricLabel(label)
            if (barFraction != null) {
                EfficiencyBar(fraction = barFraction, accent = accent, modifier = Modifier.padding(top = Spacing.xs))
            }
            if (subline != null) {
                HelperText(subline)
            }
        }
    }
}

/**
 * The average tile's progress bar — a rounded track ([BAR_TRACK_ALPHA] of the on-surface color, web
 * `bg-white/[0.05]`) with an accent fill spanning [fraction] of the width (web `width: min(avg, 100)%`).
 */
@Composable
private fun EfficiencyBar(
    fraction: Float,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = BAR_TRACK_ALPHA)),
    ) {
        Spacer(
            modifier =
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(accent),
        )
    }
}

/**
 * Lays out the [cells] as the web responsive grid: four-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:4`),
 * two-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:2`), and stacked below it (`default:1`). Each cell fills its
 * column via [Modifier.weight]; a partial trailing row is padded with weighted spacers so cells keep a uniform
 * width. Cells are spaced by `Spacing.md`, the native expression of the web `gap-4`.
 */
@Composable
private fun EfficiencyGrid(
    cells: List<@Composable (Modifier) -> Unit>,
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
            cells.chunked(columns).forEach { rowCells ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCells.forEach { cell -> cell(Modifier.weight(1f)) }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The one glyph this surface needs that the shared sets do not carry. The web uses lucide `Activity`; Android
 * ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly as the shared sets
 * do for their lucide ports — it is authored here as a 24×24 stroked vector faithful to the lucide path.
 */
private object EfficiencyPanelGlyphs {
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
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
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val SAMPLE_RESOLVED =
    EfficiencyPanelDisplay.Resolved(
        sessionCount = 42,
        averageEfficiency = "88.40%",
        averageBarFraction = 0.884f,
        bestEfficiency = "96.10%",
        bestDate = "Apr 4, 2026, 2:30 AM",
        worstEfficiency = "71.20%",
        worstDate = "Mar 28, 2026, 9:05 PM",
        wallLoss = "12.50 kWh",
        wallLossDetail = "1,204.00 kWh \u2192 1,191.50 kWh",
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun EfficiencyPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EfficiencyPanelContent(EfficiencyPanelDisplay.Loading)
    }
}

@Preview(name = "Resolved", showBackground = true)
@Composable
private fun EfficiencyPanelResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EfficiencyPanelContent(SAMPLE_RESOLVED)
    }
}

@Preview(name = "Resolved — bar clamped to full", showBackground = true)
@Composable
private fun EfficiencyPanelClampedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EfficiencyPanelContent(
            SAMPLE_RESOLVED.copy(
                averageEfficiency = "142.00%",
                averageBarFraction = 1f,
                bestDate = EM_DASH,
            ),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun EfficiencyPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EfficiencyPanelContent(EfficiencyPanelDisplay.Empty)
    }
}
