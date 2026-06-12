// The native Jetpack Compose + Material 3 SavingsSlide feature view — a parity port of
// web/src/features/analytics/components/review/SavingsSlide.tsx. The web component is one slide of the
// Year-in-Review slideshow: a centered column with a 💰 emoji that springs in, a "You saved" eyebrow, the
// gas-savings headline as a count-up dollar figure, a "vs. driving a gas car" caption, and two comparison
// bars (what gas would have cost vs. the electricity actually spent) closing with a playful
// "That's N cups of coffee!" line. Each element enters on a staggered fade/slide, exactly as the web
// `motion.*` wrappers do.
//
// Every derivation flows through the pure [SavingsSlideProjection]; this composable is a thin render layer
// that resolves the i18n strings (P1/S10) + design-token accents (P1/S9) and lays them out. The surface
// binds no data hook (the savings arrive as a [SavingsData] prop, web parity); its five strings all resolve
// through the generated catalog (`yearReview.youSaved` / `vsGas` / `gasCost` / `electricCost` /
// `savingsNote`), so there is no English literal in this file. The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web savings/electricity emerald maps to the success
// status token, and the web gas red to the danger token — the semantic "saving = good, gas = bad" the slide
// trades on. The "secondary"/"muted" copy maps to `onSurfaceVariant` (at a reduced alpha for the muted line).
//
// Count-up note: the web headline uses the shared `<AnimatedNumber>` tinted `text-emerald-400`. The native
// shared `AnimatedNumber` hard-codes `MetricValue`'s `onSurface` color and cannot be tinted, and this
// surface's allowed-files scope forbids extending it — so the headline is an inline count-up
// ([SavingsAmount]) that reproduces the shared component's mechanics verbatim (an `Animatable` from 0,
// a `tween` with `FastOutSlowInEasing`, formatting via the shared `ChartFormat`) while rendering in the
// success accent and honoring reduced motion (which the shared component does not). All other motion uses
// the shared `FadeIn` from the motion module.
//
// Accessibility: the decorative emoji and bar fills are removed from the tree (`clearAndSetSemantics`); the
// count-up exposes its settled value as a stable description so TalkBack never reads a half-counted figure;
// and each comparison bar / the coffee line collapse to a single "label value" announcement. Reduced motion
// (P1/S9, `rememberReducedMotion`) snaps every entrance + the count-up to their final state.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SavingsSlide) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.savingsslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch
import java.util.Locale

// ── Headline (web `<AnimatedNumber value={gas_savings} duration={1.5} prefix="$" />`) ───────────────
private const val AMOUNT_DECIMALS = 0
private const val COUNT_UP_MS = 1_500

// ── Emoji pop (web `transition={{ type: 'spring', stiffness: 200, damping: 15 }}`, rotate -15 → 0) ──
private const val MONEY_EMOJI = "\uD83D\uDCB0"
private val EMOJI_SIZE: TextUnit = 56.sp
private const val EMOJI_START_ROTATION = -15f
private const val EMOJI_DAMPING = Spring.DampingRatioMediumBouncy
private const val EMOJI_STIFFNESS = Spring.StiffnessMediumLow

// ── Staggered entrance delays (web `motion.*` `transition.delay` in seconds → ms) ───────────────────
private const val EYEBROW_DELAY_MS = 200
private const val AMOUNT_DELAY_MS = 400
private const val VS_GAS_DELAY_MS = 800
private const val BARS_DELAY_MS = 1_000

// ── Layout (web `max-w-xs`, `h-2` bar; eyebrow `tracking-wider`) ─────────────────────────────────────
private val BARS_MAX_WIDTH: Dp = 320.dp
private val BAR_HEIGHT: Dp = 8.dp
private val EYEBROW_TRACKING: TextUnit = 1.sp

// ── Web alpha washes (icon/40-70, bar fill/60, muted/note copy) reproduced as token-color alphas ────
private const val ICON_ALPHA = 0.70f
private const val BAR_FILL_ALPHA = 0.60f
private const val NOTE_ALPHA = 0.80f
private const val MUTED_ALPHA = 0.70f

private const val PERCENT_PER_UNIT = 100f

/**
 * Stateful entry point — the faithful 1:1 port of the web `SavingsSlide({ data })` prop (narrowed to the two
 * fields the slide reads). Records the one-shot `view.opened` diagnostic on first composition (P1/S11),
 * projects [data] onto a [SavingsSlideDisplay] via the pure [SavingsSlideProjection], and renders.
 *
 * @param data the savings figures threaded in by the owning Year-in-Review slideshow (web `data`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SavingsSlide(
    data: SavingsData,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SavingsSlideDiagnostics.recordViewOpened(logger) }
    val display = remember(data) { SavingsSlideProjection.project(data) }
    SavingsSlideContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a centered,
 * full-height column (web `flex flex-col items-center justify-center h-full px-8 text-center`) holding the
 * emoji, the eyebrow, the count-up headline, the caption, and the comparison-bar block, each entering on the
 * web's staggered fade/slide.
 */
@Composable
fun SavingsSlideContent(
    display: SavingsSlideDisplay,
    modifier: Modifier = Modifier,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val reduceMotion = rememberReducedMotion()
    val success = TeslaTokens.status.success
    val danger = TeslaTokens.status.danger

    val eyebrow = stringResource(R.string.translation_yearReview_youSaved).uppercase(locale)
    val vsGas = stringResource(R.string.translation_yearReview_vsGas)
    val gasLabel = stringResource(R.string.translation_yearReview_gasCost)
    val electricLabel = stringResource(R.string.translation_yearReview_electricCost)
    val note = stringResource(R.string.translation_yearReview_savingsNote, display.cupsOfCoffee)

    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = Spacing.xl3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MoneyEmoji(reduceMotion = reduceMotion)
        Spacer(Modifier.height(Spacing.xl2))

        FadeIn(delayMs = effectiveDelay(EYEBROW_DELAY_MS, reduceMotion)) {
            Text(
                text = eyebrow,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = EYEBROW_TRACKING,
                textAlign = TextAlign.Center,
            )
        }
        Spacer(Modifier.height(Spacing.lg))

        FadeIn(delayMs = effectiveDelay(AMOUNT_DELAY_MS, reduceMotion)) {
            SavingsAmount(value = display.gasSavings, reduceMotion = reduceMotion, accent = success, locale = locale)
        }
        Spacer(Modifier.height(Spacing.sm))

        FadeIn(delayMs = effectiveDelay(VS_GAS_DELAY_MS, reduceMotion)) {
            Text(
                text = vsGas,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA),
                textAlign = TextAlign.Center,
            )
        }
        Spacer(Modifier.height(Spacing.xl3))

        FadeIn(delayMs = effectiveDelay(BARS_DELAY_MS, reduceMotion)) {
            Column(
                modifier = Modifier.widthIn(max = BARS_MAX_WIDTH),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                ComparisonBar(
                    icon = SavingsSlideGlyphs.Fuel,
                    label = gasLabel,
                    value = display.gasCostText,
                    fillFraction = 1f,
                    accent = danger,
                )
                ComparisonBar(
                    icon = SavingsSlideGlyphs.Zap,
                    label = electricLabel,
                    value = display.electricCostText,
                    fillFraction = barFraction(display.electricBarPercent),
                    accent = success,
                )
                SavingsNote(text = note, accent = success)
            }
        }
    }
}

/** Entrance delay collapsed to 0 under reduced motion (the shared `FadeIn` also snaps, this drops the wait). */
private fun effectiveDelay(
    delayMs: Int,
    reduceMotion: Boolean,
): Int = if (reduceMotion) 0 else delayMs

/** The electric bar's fill fraction: the projected whole-number percent / 100, clamped to a valid 0..1. */
private fun barFraction(percent: Int): Float = (percent / PERCENT_PER_UNIT).coerceIn(0f, 1f)

/**
 * The 💰 badge — web `motion.span` springing from scale 0 / rotation -15° to its resting state. The glyph is
 * decorative (the "You saved" eyebrow below carries the meaning), so it is cleared from the accessibility
 * tree. Reduced motion renders it settled with no animation.
 */
@Composable
private fun MoneyEmoji(reduceMotion: Boolean) {
    val scale = remember { Animatable(if (reduceMotion) 1f else 0f) }
    val rotation = remember { Animatable(if (reduceMotion) 0f else EMOJI_START_ROTATION) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            scale.snapTo(1f)
            rotation.snapTo(0f)
        } else {
            launch { scale.animateTo(1f, spring(dampingRatio = EMOJI_DAMPING, stiffness = EMOJI_STIFFNESS)) }
            rotation.animateTo(0f, spring(dampingRatio = EMOJI_DAMPING, stiffness = EMOJI_STIFFNESS))
        }
    }
    Text(
        text = MONEY_EMOJI,
        fontSize = EMOJI_SIZE,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    rotationZ = rotation.value
                }.clearAndSetSemantics {},
    )
}

/**
 * The savings headline — the inline count-up that replaces the shared `AnimatedNumber` so the figure can take
 * the success accent (web `text-emerald-400`). It mirrors the shared component's mechanics: an [Animatable]
 * from 0 tweened to [value] with [FastOutSlowInEasing], formatted through the shared [ChartFormat] (so
 * grouping/decimals match charts, tables, and the web `fmtNumber`). The settled, `$`-prefixed value is
 * exposed as the node's accessibility description so TalkBack reads the final amount, never a mid-count
 * frame. Reduced motion snaps straight to [value].
 */
@Composable
private fun SavingsAmount(
    value: Double,
    reduceMotion: Boolean,
    accent: Color,
    locale: Locale,
) {
    val animated = remember { Animatable(0f) }
    LaunchedEffect(value, reduceMotion) {
        if (reduceMotion) {
            animated.snapTo(value.toFloat())
        } else {
            animated.snapTo(0f)
            animated.animateTo(value.toFloat(), animationSpec = tween(COUNT_UP_MS, easing = FastOutSlowInEasing))
        }
    }
    val settled = CURRENCY_PREFIX + ChartFormat.number(value, AMOUNT_DECIMALS, locale)
    val shown = CURRENCY_PREFIX + ChartFormat.number(animated.value * 1.0, AMOUNT_DECIMALS, locale)
    Text(
        text = shown,
        style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Bold),
        color = accent,
        textAlign = TextAlign.Center,
        modifier = Modifier.clearAndSetSemantics { contentDescription = settled },
    )
}

/**
 * One comparison row — web `[icon] [label] [ml-auto value]` over a rounded track filled to [fillFraction]
 * (the gas row is always full; the electric row reflects its share of the gas-cost total). The row collapses
 * to a single "label value" TalkBack announcement; the leading icon and the fill are decorative.
 */
@Composable
private fun ComparisonBar(
    icon: ImageVector,
    label: String,
    value: String,
    fillFraction: Float,
    accent: Color,
) {
    Column(
        modifier =
            Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$label $value" },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = IconSize.Md,
                tint = accent.copy(alpha = ICON_ALPHA),
            )
            Spacer(Modifier.width(Spacing.sm))
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(Spacing.sm))
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = accent,
                maxLines = 1,
            )
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            if (fillFraction > 0f) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth(fillFraction)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(Radius.pill))
                            .background(accent.copy(alpha = BAR_FILL_ALPHA)),
                )
            }
        }
    }
}

/**
 * The closing "That's N cups of coffee!" line — web `[DollarSign] [text]`, centered. The icon is decorative;
 * the row announces just the localized note to TalkBack.
 */
@Composable
private fun SavingsNote(
    text: String,
    accent: Color,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = Spacing.sm)
                .clearAndSetSemantics { contentDescription = text },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = SavingsSlideGlyphs.DollarSign,
            contentDescription = null,
            size = IconSize.Md,
            tint = accent,
        )
        Spacer(Modifier.width(Spacing.sm))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = accent.copy(alpha = NOTE_ALPHA),
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The three glyphs this surface needs that the shared `DataDisplayGlyphs` set does not carry. The web uses
 * lucide `Fuel`, `Zap`, and `DollarSign`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the sibling SummaryStatsRow surface does — they are
 * authored here as 24×24 stroked vectors faithful to the lucide paths. They render through the shared
 * [Icon], which tints the whole vector, so the black author-time stroke is recolored to the row's accent.
 */
private object SavingsSlideGlyphs {
    /** lucide `fuel`: the base + tank-divider lines, the tank body, and the pump/nozzle column. */
    val Fuel: ImageVector =
        stroked("Fuel") {
            moveTo(3f, 22f)
            lineTo(15f, 22f)
            moveTo(4f, 9f)
            lineTo(14f, 9f)
            moveTo(14f, 22f)
            lineTo(14f, 4f)
            curveTo(14f, 2.9f, 13.1f, 2f, 12f, 2f)
            lineTo(6f, 2f)
            curveTo(4.9f, 2f, 4f, 2.9f, 4f, 4f)
            lineTo(4f, 22f)
            moveTo(14f, 13f)
            lineTo(16f, 13f)
            curveTo(17.1f, 13f, 18f, 13.9f, 18f, 15f)
            lineTo(18f, 17f)
            curveTo(18f, 18.1f, 18.9f, 19f, 20f, 19f)
            curveTo(21.1f, 19f, 22f, 18.1f, 22f, 17f)
            lineTo(22f, 9.83f)
            curveTo(22f, 9.3f, 21.79f, 8.79f, 21.41f, 8.41f)
            lineTo(18f, 5f)
        }

    /** lucide `zap`: the lightning-bolt polygon. */
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

    /** lucide `dollar-sign`: the vertical stroke through an `S` of two half-turns. */
    val DollarSign: ImageVector =
        stroked("DollarSign") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(17f, 5f)
            lineTo(9.5f, 5f)
            curveTo(7.57f, 5f, 6f, 6.57f, 6f, 8.5f)
            curveTo(6f, 10.43f, 7.57f, 12f, 9.5f, 12f)
            lineTo(14.5f, 12f)
            curveTo(16.43f, 12f, 18f, 13.57f, 18f, 15.5f)
            curveTo(18f, 17.43f, 16.43f, 19f, 14.5f, 19f)
            lineTo(6f, 19f)
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

@Preview(name = "Typical savings", showBackground = true)
@Composable
private fun SavingsSlideTypicalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsSlideContent(
            SavingsSlideProjection.project(SavingsData(gasSavings = 1200.0, totalChargingCost = 300.0)),
        )
    }
}

@Preview(name = "Large savings", showBackground = true)
@Composable
private fun SavingsSlideLargePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsSlideContent(
            SavingsSlideProjection.project(SavingsData(gasSavings = 10_000.0, totalChargingCost = 2_000.0)),
        )
    }
}

@Preview(name = "Empty (no savings yet)", showBackground = true)
@Composable
private fun SavingsSlideEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavingsSlideContent(SavingsSlideProjection.project(SavingsData(gasSavings = 0.0, totalChargingCost = 0.0)))
    }
}
