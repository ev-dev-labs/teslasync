// The native Jetpack Compose + Material 3 QuickMetrics feature view — a parity port of
// web/src/features/charging/components/charging-list/QuickMetrics.tsx. The web component is purely
// presentational: the owning Charging List page computes a `ChargingStats` summary (web `computeStats`) and
// passes it down as the single `stats` prop. It renders one `GlassPanel` with two branches — a six-cell
// metrics grid when `stats` is present, and a friendly `EmptyState` when it is absent — its only data hook
// being `useTranslation`.
//
// This port keeps that contract exactly. The grid reproduces the web composition cell-for-cell, in source
// order: the home / Supercharger / DC-fast session counts (each a colored count-up number above an
// icon + label, web `<AnimatedNumber>` inside an emerald / rose / amber `<p>`), then the total charging time,
// the monthly-average cost, and the per-session energy (each a primary-text value above a label). The
// counts count up exactly as the web `AnimatedNumber` does and collapse to a static figure under reduced
// motion (the same contract the sibling StatHeroSlide / SummaryHeroCards ports honor). When `stats` is
// absent the panel shows the localized empty message, never a blank box. The cache-then-network states
// (loading / stale / offline / fetch-error) are owned by the Charging List page, exactly as in the web
// source and the committed SummaryStatsRow sibling, so they are not re-implemented here.
//
// Every derivation flows through the pure [QuickMetricsProjection]; this file is a thin render layer that
// resolves the i18n labels (P1/S10), the currency symbol + locale + precision (P1/S8 settings store), the
// design-token accents (P1/S9), and the reduced-motion preference, then draws them. There is no English
// literal and no HTTP here. The one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuickMetrics) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.quickmetrics

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale
import kotlin.math.roundToInt

/** Web Tailwind `md` breakpoint (768px): at or above this width all six cells lay out in a single row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cells lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_MD: Int = 6
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/**
 * Stateful entry point — the faithful 1:1 port of the web `QuickMetrics({ stats })` prop. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), resolves the display formatting from the
 * shared settings store (P1/S8), projects the prop onto a [QuickMetricsDisplay] via the pure
 * [QuickMetricsProjection], and renders.
 *
 * @param stats the charging summary computed by the owning Charging List page (web `stats` prop), or `null`
 *   when the session history is empty — `null` selects the empty branch.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param formatting the currency symbol + locale + precision, resolved from the shared settings store.
 */
@Composable
fun QuickMetrics(
    stats: ChargingMetrics?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    formatting: QuickMetricsFormatting = rememberQuickMetricsFormatting(),
) {
    LaunchedEffect(Unit) { QuickMetricsDiagnostics.recordViewOpened(logger) }
    val display = remember(stats, formatting) { QuickMetricsProjection.project(stats, formatting) }
    QuickMetricsContent(display = display, locale = formatting.locale, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the web component's two branches:
 * the six-cell metrics grid when [display] is present, or the localized empty state when it is `null` (web
 * `stats ? … : <EmptyState/>`). The whole grid lives inside one [GlassPanel], matching the web wrapper.
 *
 * @param locale formats the count-up figures (the three derived figures are pre-formatted by the projection).
 * @param reduceMotion when true the counts render statically instead of counting up (accessibility contract).
 */
@Composable
fun QuickMetricsContent(
    display: QuickMetricsDisplay?,
    locale: Locale,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        if (display != null) {
            QuickMetricsGrid(display = display, locale = locale, reduceMotion = reduceMotion)
        } else {
            EmptyState(message = stringResource(R.string.translation_charging_noMetrics))
        }
    }
}

/**
 * Lays out the six metric cells as the web responsive grid: six-per-row at or above [GRID_MD_MIN_WIDTH]
 * (`md:grid-cols-6`), three-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cells keep a uniform width. The cells are emitted in web source order.
 */
@Composable
private fun QuickMetricsGrid(
    display: QuickMetricsDisplay,
    locale: Locale,
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val cells: List<@Composable (Modifier) -> Unit> =
        listOf(
            { cellModifier ->
                QuickMetricCountCell(
                    count = display.homeCount,
                    accent = TeslaTokens.status.success,
                    icon = QuickMetricsGlyphs.Home,
                    label = stringResource(R.string.translation_charging_metrics_home),
                    reduceMotion = reduceMotion,
                    locale = locale,
                    modifier = cellModifier,
                )
            },
            { cellModifier ->
                QuickMetricCountCell(
                    count = display.scCount,
                    accent = TeslaTokens.status.danger,
                    icon = DataDisplayGlyphs.Bolt,
                    label = stringResource(R.string.translation_charging_metrics_supercharger),
                    reduceMotion = reduceMotion,
                    locale = locale,
                    modifier = cellModifier,
                )
            },
            { cellModifier ->
                QuickMetricCountCell(
                    count = display.dcCount,
                    accent = TeslaTokens.status.warning,
                    icon = QuickMetricsGlyphs.Zap,
                    label = stringResource(R.string.translation_charging_metrics_dcFast),
                    reduceMotion = reduceMotion,
                    locale = locale,
                    modifier = cellModifier,
                )
            },
            { cellModifier ->
                QuickMetricValueCell(
                    value = display.totalTime,
                    label = stringResource(R.string.translation_charging_metrics_totalTime),
                    modifier = cellModifier,
                )
            },
            { cellModifier ->
                QuickMetricValueCell(
                    value = display.monthlyAvg,
                    label = stringResource(R.string.translation_charging_metrics_monthlyAvg),
                    modifier = cellModifier,
                )
            },
            { cellModifier ->
                QuickMetricValueCell(
                    value = display.perSession,
                    label = stringResource(R.string.translation_charging_metrics_perSession),
                    modifier = cellModifier,
                )
            },
        )

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
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
 * A charger-type count cell: a colored count-up figure above an icon + label, centered — the native mirror
 * of the web `<div><p class="text-{accent}"><AnimatedNumber/></p><p class="text-muted"><Icon/> {label}</p>`.
 * The label + icon use the muted on-surface-variant color (web `--text-muted`); the icon is decorative
 * (`contentDescription = null`) because the adjacent label already names the metric for TalkBack.
 */
@Composable
private fun QuickMetricCountCell(
    count: Int,
    accent: Color,
    icon: ImageVector,
    label: String,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        CountUpValue(value = count, color = accent, reduceMotion = reduceMotion, locale = locale)
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            MetricLabel(label)
        }
    }
}

/**
 * A derived-value cell: a primary-text value above a label, centered — the native mirror of the web
 * `<div><p class="text-primary">{value}</p><p class="text-muted">{label}</p></div>`. The value reuses the
 * shared [MetricValue] role (on-surface, the web `--text-primary`).
 */
@Composable
private fun QuickMetricValueCell(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(value)
        MetricLabel(label)
    }
}

/**
 * The count-up figure for a charger-type cell — the colored analogue of the shared `AnimatedNumber` (which
 * forces the on-surface metric color and so cannot carry the web's emerald / rose / amber accent). It counts
 * up from zero on first composition exactly as the web `AnimatedNumber` does, and collapses to a static
 * figure under [reduceMotion] (the same reduced-motion contract the sibling StatHeroSlide hero honors). The
 * figure uses the shared [MetricValue] type slot ([MaterialTheme.typography] `headlineSmall`, SemiBold) so it
 * stays visually consistent with the derived-value cells while carrying the [color] accent.
 */
@Composable
private fun CountUpValue(
    value: Int,
    color: Color,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val rendered =
        if (reduceMotion) {
            QuickMetricsProjection.formatCount(value, locale)
        } else {
            val animated = remember(value) { Animatable(0f) }
            LaunchedEffect(value) {
                animated.animateTo(
                    targetValue = value.toFloat(),
                    animationSpec = tween(durationMillis = MotionDurations.slow, easing = FastOutSlowInEasing),
                )
            }
            QuickMetricsProjection.formatCount(animated.value.roundToInt(), locale)
        }
    Text(
        text = rendered,
        modifier = modifier,
        color = color,
        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Resolves the [QuickMetricsFormatting] from the shared settings store (P1/S8) — the native projection of the
 * web `useFormatting` result plus the `numberFormat` global locale + precision. Remembered against the
 * settings document so a units / currency / locale change re-projects. The `currency_symbol` falls back to
 * the web default ("$") when blank; the locale + precision come from the shared [UnitPreferences] derivation.
 */
@Composable
private fun rememberQuickMetricsFormatting(): QuickMetricsFormatting {
    val container = LocalDataContainer.current
    val settings by container.settingsStore.settings().collectAsStateWithLifecycle()
    return remember(settings) {
        val cached = settings.cached
        val symbol = ((cached as? JsonObject)?.get("currency_symbol") as? JsonPrimitive)?.contentOrNull
        val currencySymbol = if (!symbol.isNullOrBlank()) symbol else QUICK_METRICS_DEFAULT_CURRENCY
        val prefs = UnitPreferences.fromSettings(cached)
        val localeTag = prefs.locale
        val resolvedLocale = if (localeTag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(localeTag)
        val precision = prefs.precision ?: QUICK_METRICS_DEFAULT_PRECISION
        QuickMetricsFormatting(currencySymbol = currencySymbol, precision = precision, locale = resolvedLocale)
    }
}

/**
 * The two glyphs this surface needs that the shared sets do not carry. The web uses lucide `Home` and `Zap`;
 * Android ships no equivalents without the frozen `material-icons-extended` artifact, so — exactly as the
 * shared sets do for their lucide ports — they are authored here as 24×24 stroked vectors faithful to the
 * lucide paths. The Supercharger cell reuses the shared `DataDisplayGlyphs.Bolt` (the codebase's sanctioned
 * "Bolt" glyph), matching the web `Bolt` import name.
 */
private object QuickMetricsGlyphs {
    val Home: ImageVector =
        stroked("Home") {
            moveTo(3f, 10f)
            lineTo(12f, 3f)
            lineTo(21f, 10f)
            moveTo(5f, 9f)
            lineTo(5f, 20f)
            lineTo(19f, 20f)
            lineTo(19f, 9f)
            moveTo(9.5f, 20f)
            lineTo(9.5f, 14f)
            lineTo(14.5f, 14f)
            lineTo(14.5f, 20f)
        }

    val Zap: ImageVector =
        stroked("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
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

private val PREVIEW_STATS =
    ChargingMetrics(
        homeCount = 5,
        scCount = 3,
        dcCount = 2,
        totalDurationMinutes = 1234.0,
        totalCost = 240.0,
        totalEnergyKwh = 100.0,
        count = 10,
    )

private val PREVIEW_FORMATTING =
    QuickMetricsFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

@Preview(name = "Resolved — metrics grid", showBackground = true, widthDp = 420)
@Composable
private fun QuickMetricsResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickMetricsContent(
            display = QuickMetricsProjection.project(PREVIEW_STATS, PREVIEW_FORMATTING),
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Empty — no metrics", showBackground = true, widthDp = 420)
@Composable
private fun QuickMetricsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuickMetricsContent(display = null, locale = Locale.US, reduceMotion = true)
    }
}
