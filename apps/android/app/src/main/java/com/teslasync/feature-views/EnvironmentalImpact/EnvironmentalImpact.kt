// The native Jetpack Compose + Material 3 EnvironmentalImpact feature view — a parity port of
// web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx. The web component is the
// "Environmental Impact" tile of the charging Cost-Analysis page: a green-accent GlassPanel headed by a leaf
// glyph + "Environmental Impact" title, then — when `coreStats` is present — a two-up hero (kg CO₂ saved +
// tree-years equivalent), a leaf-prose paragraph that restates the saving with two bold-green inline figures,
// and a three-up mini-stat row (gallons avoided / metric tons CO₂ / $ saved total); when `coreStats` is null
// it renders the friendly "No data" surface instead of a blank box.
//
// Every derivation flows through the pure [EnvironmentalImpactProjection]; this composable is a thin render
// layer. The surface binds no data hook (the `coreStats` arrives as a prop, web parity — the owning page's
// `useCostAnalysisData` computes it), and all eleven of its labels resolve through the generated i18n catalog
// (P1/S10) keys `costAnalysis.environment.*`, so there is no English literal in this file (the lone " kg"
// is the SI unit symbol the web hard-codes inline, never i18n — the same treatment the sibling EnvironmentSlide
// gives its " kg" suffix). The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Color + type mapping (P1/S9 tokens, no ported Tailwind classes): the web eco-green (`text-green-400`) maps to
// the semantic positive token `TeslaTokens.status.success` — the same token the green-glow GlassPanel border
// uses — so the green stays theme-correct in light / dark / high-contrast; the muted captions/labels
// (`--text-muted`) map to `onSurfaceVariant`; the prose (`--text-secondary`) maps to `onSurfaceVariant`; and the
// white mini-stat values (`text-white`) map to `onSurface`. The two hero figures are NOT rendered with the
// shared `MetricValue` role: that role hard-binds `onSurface`, which would erase the eco-green this tile is
// built around, so — exactly as EnvironmentSlide does for its green count-up — they use the generated display
// type ramp (`headlineSmall`, web `text-2xl`) tinted with the success token. Every other string uses a shared
// typography role (PanelTitle / Caption / MetricLabel) so no ad-hoc `fontSize`/`Color` is hand-picked.
//
// Accessibility: this tile has no interactive elements (web parity — it is pure read-out), so there is nothing
// to label with an action; the lead leaf and the prose tree glyphs are decorative (their meaning is already
// carried by the adjacent title text and the prose), so they pass `contentDescription = null` to be skipped by
// TalkBack rather than announced as noise — matching the web icons, which carry no `aria-label`. Every figure
// and label is a first-class text node, so TalkBack reads the whole tile; the sp-based type ramp honors the
// system font scale. There is no motion in the web source, so none is added (nothing to gate on reduced
// motion).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EnvironmentalImpact) cannot form a valid Kotlin package, so the package diverges
// from the path — as the sibling EnvironmentSlide surface does. `MatchingDeclarationName` covers the co-located
// previews + private glyphs/helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.environmentalimpact

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Display constants (web Tailwind values mapped to platform tokens / fixed decimals; no ported classes) ──
private const val HERO_DECIMALS = 1 // web fmtNumber(co2SavedKg, 1) / fmtNumber(treeEquiv, 1)
private const val WHOLE_DECIMALS = 0 // web fmtNumber(co2SavedKg, 0) / fmtNumber(savings, 0)
private const val TON_DECIMALS = 2 // web fmtNumber(co2SavedKg / 1000, 2)
private const val TINT_ALPHA = 0.10f // web bg-green-500/10
private const val EMPTY_MIN_HEIGHT_DP = 128 // web h-32
private const val KG_UNIT_SUFFIX = " kg" // web literal " kg" — an SI unit symbol, never i18n

/**
 * Stateful entry point — the faithful 1:1 port of the web `EnvironmentalImpact({ coreStats })` prop. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11) and renders the tile. The surface binds no
 * data of its own; the caller (the Cost-Analysis page) supplies the [data] (web parity).
 *
 * @param data the computed `CoreStats` slice this tile reads, or `null` while the page has no sessions yet.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnvironmentalImpact(
    data: EnvironmentalImpactData?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { EnvironmentalImpactDiagnostics.recordViewOpened(logger) }
    EnvironmentalImpactContent(data = data, modifier = modifier)
}

/**
 * Stateless renderer — the UI-test + preview entry point. Reproduces the web layout: a green-accent GlassPanel
 * whose header (leaf glyph + title) is always shown, followed by either the full breakdown (when [data] is
 * present) or the friendly "No data" surface (when it is `null`) — the web `coreStats ? … : …` branch.
 */
@Composable
fun EnvironmentalImpactContent(
    data: EnvironmentalImpactData?,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier = modifier,
        padding = PanelPadding.Lg,
        accent = PanelAccent.Success,
    ) {
        ImpactHeader()
        Spacer(Modifier.height(Spacing.lg)) // web h3 mb-4
        if (data != null) {
            ImpactBreakdown(display = remember(data) { EnvironmentalImpactProjection.project(data) })
        } else {
            ImpactEmptyState()
        }
    }
}

/** The always-present header: the decorative leaf glyph (web lucide `Leaf`, green) + the panel title. */
@Composable
private fun ImpactHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm), // web gap-2
        verticalAlignment = Alignment.CenterVertically, // web items-center
    ) {
        Icon(
            imageVector = EnvironmentalImpactGlyphs.Leaf,
            contentDescription = null, // decorative — the title text carries the meaning (web has no aria-label)
            size = IconSize.Md, // web h-4 w-4
            tint = TeslaTokens.status.success, // web text-green-400
        )
        PanelTitle(text = stringResource(R.string.translation_costAnalysis_environment_title))
    }
}

/** The full data branch: the two-up hero, the prose paragraph, and the three-up mini-stat row (web space-y-4). */
@Composable
private fun ImpactBreakdown(display: EnvironmentalImpactDisplay) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md), // web grid-cols-2 gap-3
        ) {
            ImpactHeroTile(
                modifier = Modifier.weight(1f),
                value = ChartFormat.number(display.co2SavedKg, HERO_DECIMALS, locale),
                label = stringResource(R.string.translation_costAnalysis_environment_kgCo2),
            )
            ImpactHeroTile(
                modifier = Modifier.weight(1f),
                value = ChartFormat.number(display.treeEquiv, HERO_DECIMALS, locale),
                label = stringResource(R.string.translation_costAnalysis_environment_treeEquiv),
            )
        }

        ImpactNarrative(display = display, locale = locale)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm), // web grid-cols-3 gap-2
        ) {
            ImpactMiniStat(
                modifier = Modifier.weight(1f),
                value = ChartFormat.number(display.gallonsEquiv, HERO_DECIMALS, locale),
                label = stringResource(R.string.translation_costAnalysis_environment_gallons),
            )
            ImpactMiniStat(
                modifier = Modifier.weight(1f),
                value = ChartFormat.number(display.metricTonsCo2, TON_DECIMALS, locale),
                label = stringResource(R.string.translation_costAnalysis_environment_metricTons),
            )
            ImpactMiniStat(
                modifier = Modifier.weight(1f),
                value = ChartFormat.number(display.savings, WHOLE_DECIMALS, locale),
                label = stringResource(R.string.translation_costAnalysis_environment_dollarsSaved),
            )
        }
    }
}

/**
 * One hero tile — a success-tinted rounded card with a large eco-green figure over a muted caption (web
 * `rounded-lg bg-green-500/10 p-4 text-center`). The figure uses the generated display ramp + success token,
 * not the `MetricValue` role, so the eco-green is preserved.
 */
@Composable
private fun ImpactHeroTile(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .background(
                    color = TeslaTokens.status.success.copy(alpha = TINT_ALPHA),
                    shape = MaterialTheme.shapes.medium,
                ).padding(Spacing.lg),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = TeslaTokens.status.success,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(Spacing.xs)) // web mt-1
            Caption(text = label)
        }
    }
}

/**
 * The prose paragraph: a surface-variant rounded card with the decorative tree glyph (web lucide `Trees`) and a
 * sentence that restates the saving, embedding the kilograms and the tree-years as bold eco-green spans (web's
 * two `font-semibold text-green-400` `<span>`s). Built as an [androidx.compose.ui.text.AnnotatedString] so the
 * inline emphasis is one accessible text node, exactly as the web `<p>` is.
 */
@Composable
private fun ImpactNarrative(
    display: EnvironmentalImpactDisplay,
    locale: Locale,
) {
    val emphasis = SpanStyle(fontWeight = FontWeight.SemiBold, color = TeslaTokens.status.success)
    val co2Whole = ChartFormat.number(display.co2SavedKg, WHOLE_DECIMALS, locale)
    val treeEquiv = ChartFormat.number(display.treeEquiv, HERO_DECIMALS, locale)
    // Resolve the four catalog strings up front: stringResource is @Composable and cannot be called inside the
    // (non-composable) buildAnnotatedString builder lambda below.
    val descText = stringResource(R.string.translation_costAnalysis_environment_desc)
    val ofCo2Text = stringResource(R.string.translation_costAnalysis_environment_ofCo2)
    val treeNoteText = stringResource(R.string.translation_costAnalysis_environment_treeNote)
    val treesAbsorbingText = stringResource(R.string.translation_costAnalysis_environment_treesAbsorbing)

    val sentence =
        buildAnnotatedString {
            append(descText)
            append(" ")
            withStyle(emphasis) { append("$co2Whole$KG_UNIT_SUFFIX") }
            append(" ")
            append(ofCo2Text)
            append(" ")
            append(treeNoteText)
            append(" ")
            withStyle(emphasis) { append(treeEquiv) }
            append(" ")
            append(treesAbsorbingText)
        }

    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(
                    color = MaterialTheme.colorScheme.surfaceVariant, // web bg-[var(--surface-2)]
                    shape = MaterialTheme.shapes.medium,
                ).padding(Spacing.md), // web p-3
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.md), // web gap-3
            verticalAlignment = Alignment.Top, // web items-start
        ) {
            Icon(
                imageVector = EnvironmentalImpactGlyphs.Trees,
                contentDescription = null, // decorative — the sentence carries the meaning
                size = IconSize.Lg, // web h-5 w-5
                tint = TeslaTokens.status.success, // web text-green-400
            )
            Text(
                text = sentence,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, // web text-[var(--text-secondary)]
            )
        }
    }
}

/** One mini-stat — a centered white figure over a tiny muted label (web `text-center`, `text-lg` + `text-[10px]`). */
@Composable
private fun ImpactMiniStat(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface, // web text-white
            textAlign = TextAlign.Center,
        )
        MetricLabel(text = label)
    }
}

/** The friendly empty surface — a centered "No data" read-out, never a blank box (web `h-32` centered text). */
@Composable
private fun ImpactEmptyState() {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = EMPTY_MIN_HEIGHT_DP.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(R.string.translation_costAnalysis_environment_noData),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The two stroked vectors this tile needs that the shared icon sets do not provide: the [Leaf] (the header
 * glyph, web lucide `Leaf`) and the [Trees] (the prose glyph, web lucide `Trees`). Authored as 24×24 monochrome
 * vectors recolored at render time by [Icon]'s tint — Android ships no lucide equivalents without the frozen
 * `material-icons-extended` artifact, so each surface authors the glyphs it needs (as the sibling
 * SummaryHeroCards / HeroGauges ports do). [Trees] is reproduced as a faithful evergreen pair.
 */
private object EnvironmentalImpactGlyphs {
    /** lucide `leaf` — a leaf blade with a midrib (header glyph). */
    val Leaf: ImageVector =
        stroked("Leaf") {
            moveTo(11f, 20f)
            curveTo(7f, 20f, 4f, 17f, 4f, 13f)
            curveTo(4f, 7f, 10f, 4f, 20f, 4f)
            curveTo(20f, 12f, 16f, 18f, 9f, 18f)
            moveTo(5f, 19f)
            curveTo(9f, 13f, 13f, 11f, 17f, 9f)
        }

    /** lucide `trees` — a two-tree grove, here a tiered evergreen pair with trunks (prose glyph). */
    val Trees: ImageVector =
        stroked("Trees") {
            // Left (larger) evergreen: two canopy tiers + trunk.
            moveTo(8f, 3f)
            lineTo(5f, 8f)
            lineTo(11f, 8f)
            close()
            moveTo(8f, 6.5f)
            lineTo(4f, 13f)
            lineTo(12f, 13f)
            close()
            moveTo(8f, 13f)
            lineTo(8f, 17f)
            // Right (smaller) evergreen: two canopy tiers + trunk.
            moveTo(16f, 6f)
            lineTo(13.5f, 10f)
            lineTo(18.5f, 10f)
            close()
            moveTo(16f, 9f)
            lineTo(12.5f, 15f)
            lineTo(19.5f, 15f)
            close()
            moveTo(16f, 15f)
            lineTo(16f, 18f)
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────────

private val PREVIEW_TYPICAL =
    EnvironmentalImpactData(
        co2SavedKg = 540.0,
        treeEquiv = 25.7,
        gallonsEquiv = 61.0,
        savings = 318.0,
    )

@Composable
private fun PreviewHost(data: EnvironmentalImpactData?) {
    TeslaSyncTheme(dynamicColor = false) {
        EnvironmentalImpactContent(data = data, modifier = Modifier.fillMaxWidth())
    }
}

@Preview(name = "Populated", showBackground = true)
@Composable
private fun EnvironmentalImpactPopulatedPreview() = PreviewHost(PREVIEW_TYPICAL)

@Preview(name = "Empty — no data", showBackground = true)
@Composable
private fun EnvironmentalImpactEmptyPreview() = PreviewHost(null)
