// The native Jetpack Compose + Material 3 HeroGauges feature view — a parity port of
// web/src/features/analytics/components/analytics/HeroGauges.tsx. The web component renders six summary
// MetricCards (distance, drive count, energy, efficiency, gas savings, and CO2 saved) in a responsive
// 2 / 3 / 6-column grid, switching the whole grid to six MetricSkeleton tiles while the owning page's
// `useFleetAnalytics` query is still loading (its `!data` branch). This port keeps that contract: the six
// cards always render (showing formatted zeros, never a blank box, when a value is absent), the grid reflows
// at the web Tailwind `md` (768dp) and `lg` (1024dp) breakpoints with the web `gap-3` (12dp) gutter, and the
// resolved grid fades in exactly as the web `<FadeIn>`-less plain grid mounts (the shared FadeIn matches the
// app's standard surface entrance).
//
// Every derivation flows through the pure [HeroGaugesProjection]; the composable is a thin render layer that
// resolves the i18n labels (P1/S10), the live display preferences (units + currency via the S8
// `SettingsStore` — the native binding of the web `useUnits` + `useFormatting` hooks), and the design-token
// accents (P1/S9), then hands them to the shared MetricCard. The owning page threads the `FleetAnalytics`
// payload in as a prop exactly as the web component receives it. The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HeroGauges) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Card
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the six cards lay out in a single row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `md` breakpoint (768px): at or above this width the cards lay out three-per-row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

private const val GRID_COLUMNS_LG = 6
private const val GRID_COLUMNS_MD = 3
private const val GRID_COLUMNS_BASE = 2

/** Web MetricSkeleton: a panel with a 60%-wide 12dp label bar over a 40%-wide 24dp value bar (`mt-2`). */
private const val SKELETON_LABEL_FRACTION = 0.6f
private const val SKELETON_VALUE_FRACTION = 0.4f
private val SKELETON_LABEL_HEIGHT: Dp = 12.dp
private val SKELETON_VALUE_HEIGHT: Dp = 24.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `HeroGauges({ data })`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), resolves the localized labels (P1/S10) and the live
 * display preferences from the shared S8 [SettingsStore] (the native binding of the web `useUnits` +
 * `useFormatting` hooks; metric/"$" defaults apply until settings load, exactly as the web hooks default),
 * projects the prop onto a [HeroGaugesDisplay] via the pure [HeroGaugesProjection], and renders.
 *
 * @param data the owning Analytics page's `FleetAnalytics` payload, or `null` while its query is in flight
 *   (the web `data: FleetAnalytics | undefined` prop); `null` drives the six-tile skeleton branch.
 * @param settings the shared live `/settings` feed backing units + currency; defaults to the app's S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun HeroGauges(
    data: FleetAnalyticsSummary?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HeroGaugesDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { HeroGaugesDisplayPrefs.from(settingsResource.cached) }
    val strings = heroGaugesStrings()
    val display = remember(data, prefs, strings) { HeroGaugesProjection.project(data, prefs, strings) }
    HeroGaugesContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit-test and preview entry point. While [HeroGaugesDisplay.loading] is true it
 * shows the six-tile skeleton grid (web `!data` branch); otherwise it fades in the six MetricCards. Every card
 * is always present and always carries an accessible label + value (absent figures resolve to formatted
 * zeros), so no surface is ever hidden or blank.
 */
@Composable
fun HeroGaugesContent(
    display: HeroGaugesDisplay,
    modifier: Modifier = Modifier,
) {
    if (display.loading) {
        HeroGaugesLoading(modifier = modifier)
        return
    }
    FadeIn(modifier = modifier) {
        HeroGaugesGrid(itemCount = display.cards.size) { index, cellModifier ->
            val card = display.cards[index]
            MetricCard(
                label = card.label,
                value = card.value,
                modifier = cellModifier,
                icon = heroGaugeIcon(card.icon),
                accent = heroGaugeAccent(card.accent),
                subtitle = card.subtitle,
            )
        }
    }
}

/**
 * The loading branch — six skeleton tiles in the same responsive grid as the resolved cards (web
 * `Array.from({ length: 6 }).map(() => <MetricSkeleton />)`). The grid carries a single TalkBack "Loading"
 * content description so the loading state is announced rather than read as six empty boxes.
 */
@Composable
private fun HeroGaugesLoading(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    HeroGaugesGrid(
        itemCount = HeroGaugesProjection.CARD_COUNT,
        modifier = modifier.semantics { contentDescription = loadingLabel },
    ) { _, cellModifier ->
        HeroSkeletonTile(modifier = cellModifier)
    }
}

/** A single loading tile — the web MetricSkeleton (a panel with a label bar over a larger value bar). */
@Composable
private fun HeroSkeletonTile(modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_LABEL_HEIGHT)
        Skeleton(
            modifier = Modifier.padding(top = Spacing.sm),
            widthFraction = SKELETON_VALUE_FRACTION,
            height = SKELETON_VALUE_HEIGHT,
        )
    }
}

/**
 * Lays out [itemCount] cells as the web responsive grid: six-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-6`), three-per-row at or above [GRID_MD_MIN_WIDTH] (`md:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cells keep a uniform width. Cells are spaced by `Spacing.md` (12dp), the native
 * expression of the web `gap-3`.
 */
@Composable
private fun HeroGaugesGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    item: @Composable (Int, Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
                else -> GRID_COLUMNS_BASE
            }
        val rows = (0 until itemCount).chunked(columns)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            rows.forEach { rowIndices ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowIndices.forEach { index -> item(index, Modifier.weight(1f)) }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the six localized card labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun heroGaugesStrings(): HeroGaugesStrings =
    HeroGaugesStrings(
        distance = stringResource(R.string.translation_analytics_hero_distance),
        drives = stringResource(R.string.translation_analytics_hero_drives),
        energy = stringResource(R.string.translation_analytics_hero_energy),
        efficiency = stringResource(R.string.translation_analytics_hero_efficiency),
        gasSavings = stringResource(R.string.translation_analytics_hero_gasSavings),
        co2Saved = stringResource(R.string.translation_analytics_hero_co2Saved),
    )

/**
 * Maps a [HeroGaugeIcon] to its glyph. The web lucide `MapPin`/`Zap`/`Gauge` reuse the shared
 * [DataDisplayGlyphs] (`MapPin`/`Bolt`/`Gauge`); lucide `Car`/`DollarSign`/`Leaf` have no shared equivalent
 * and are authored below as 24×24 stroked vectors faithful to the lucide paths.
 */
private fun heroGaugeIcon(icon: HeroGaugeIcon): ImageVector =
    when (icon) {
        HeroGaugeIcon.Distance -> DataDisplayGlyphs.MapPin
        HeroGaugeIcon.Drives -> HeroGaugesGlyphs.Car
        HeroGaugeIcon.Energy -> DataDisplayGlyphs.Bolt
        HeroGaugeIcon.Efficiency -> DataDisplayGlyphs.Gauge
        HeroGaugeIcon.GasSavings -> HeroGaugesGlyphs.DollarSign
        HeroGaugeIcon.Co2 -> HeroGaugesGlyphs.Leaf
    }

/**
 * Maps a [HeroGaugeAccent] to a design-token color (P1/S9). The web MetricCard colors map to the brand
 * palette: 'cyan' -> the info token (#00F0FF), 'purple' -> the chart power hue (#A855F7, an exact match for
 * web neon-purple), 'green' -> the success token, and 'amber' -> the warning token.
 */
@Composable
private fun heroGaugeAccent(accent: HeroGaugeAccent): Color =
    when (accent) {
        HeroGaugeAccent.Info -> TeslaTokens.status.info
        HeroGaugeAccent.Power -> TeslaTokens.chart.power
        HeroGaugeAccent.Success -> TeslaTokens.status.success
        HeroGaugeAccent.Warning -> TeslaTokens.status.warning
    }

/**
 * The three glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `Car`, `DollarSign`, and `Leaf`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling surfaces do for their lucide ports — they
 * are authored here as 24×24 stroked vectors faithful to the lucide paths.
 */
private object HeroGaugesGlyphs {
    val Car: ImageVector =
        stroked("Car") {
            moveTo(5f, 11f)
            lineTo(6.5f, 6.5f)
            curveTo(6.8f, 5.6f, 7.6f, 5f, 8.5f, 5f)
            lineTo(15.5f, 5f)
            curveTo(16.4f, 5f, 17.2f, 5.6f, 17.5f, 6.5f)
            lineTo(19f, 11f)
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            curveTo(20.1f, 11f, 21f, 11.9f, 21f, 13f)
            lineTo(21f, 17f)
            lineTo(3f, 17f)
            lineTo(3f, 13f)
            curveTo(3f, 11.9f, 3.9f, 11f, 5f, 11f)
            close()
            moveTo(7f, 17f)
            lineTo(7f, 19f)
            moveTo(17f, 17f)
            lineTo(17f, 19f)
        }

    val DollarSign: ImageVector =
        stroked("DollarSign") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(16f, 7.5f)
            curveTo(16f, 5.8f, 14.2f, 5f, 12f, 5f)
            curveTo(9.2f, 5f, 8f, 6.4f, 8f, 8.3f)
            curveTo(8f, 12.5f, 16f, 11f, 16f, 15.7f)
            curveTo(16f, 17.6f, 14.8f, 19f, 12f, 19f)
            curveTo(9.8f, 19f, 8f, 18.2f, 8f, 16.5f)
        }

    val Leaf: ImageVector =
        stroked("Leaf") {
            moveTo(11f, 20f)
            curveTo(7f, 20f, 4f, 17f, 4f, 13f)
            curveTo(4f, 7f, 10f, 4f, 20f, 4f)
            curveTo(20f, 12f, 16f, 18f, 9f, 18f)
            moveTo(5f, 19f)
            curveTo(9f, 13f, 13f, 11f, 17f, 9f)
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

private val previewSummary =
    FleetAnalyticsSummary(
        totalDistanceKm = 12345.6,
        totalCost = 420.0,
        avgEfficiencyWhKm = 158.0,
        totalDrives = 487.0,
        totalEnergyKwh = 1950.0,
    )

private val previewMilesPrefs =
    HeroGaugesDisplayPrefs(
        distanceUnit = DistanceUnitPref.MI,
        currencySymbol = "$",
        precision = 2,
        locale = Locale.US,
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun HeroGaugesLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HeroGaugesContent(
            HeroGaugesProjection.project(
                data = null,
                prefs = HeroGaugesDisplayPrefs.DEFAULT,
                strings = heroGaugesStrings(),
            ),
        )
    }
}

@Preview(name = "Resolved — metric (km)", showBackground = true)
@Composable
private fun HeroGaugesMetricPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HeroGaugesContent(
            HeroGaugesProjection.project(
                data = previewSummary,
                prefs = HeroGaugesDisplayPrefs.DEFAULT,
                strings = heroGaugesStrings(),
            ),
        )
    }
}

@Preview(name = "Resolved — imperial (mi)", showBackground = true)
@Composable
private fun HeroGaugesImperialPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HeroGaugesContent(
            HeroGaugesProjection.project(
                data = previewSummary,
                prefs = previewMilesPrefs,
                strings = heroGaugesStrings(),
            ),
        )
    }
}

@Preview(name = "Resolved — empty (all zeros)", showBackground = true)
@Composable
private fun HeroGaugesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HeroGaugesContent(
            HeroGaugesProjection.project(
                data = FleetAnalyticsSummary(0.0, 0.0, 0.0, 0.0, 0.0),
                prefs = HeroGaugesDisplayPrefs.DEFAULT,
                strings = heroGaugesStrings(),
            ),
        )
    }
}
