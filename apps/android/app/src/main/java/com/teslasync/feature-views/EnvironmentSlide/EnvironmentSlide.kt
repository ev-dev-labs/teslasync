// The native Jetpack Compose + Material 3 EnvironmentSlide feature view — a parity port of
// web/src/features/analytics/components/review/EnvironmentSlide.tsx. The web component is one slide of the
// Year-in-Review deck: a centered column with a spring-popped 🌍, an uppercase "CO₂ offset" label, the year's
// CO₂ offset rendered as a large green count-up number suffixed " kg", a "Like planting N trees" caption, and
// a wrapped grid of 🌳 glyphs (one per equivalent tree, capped at 30) that ends in a "+N more" chip when the
// equivalent-tree count exceeds the cap.
//
// Every derivation flows through the pure [EnvironmentSlideProjection]; the composable is a thin render layer.
// The surface binds no data hook (the `data` arrives as a prop, web parity), and its three catalog strings
// resolve through the generated i18n catalog (P1/S10) keys yearReview.co2Offset / .treesEquiv / .more, so
// there is no English literal in this file. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first
// composition.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web eco-green number (`text-green-400`) maps to the
// semantic positive token `TeslaTokens.status.success` — the same token the sibling data-display surfaces use
// for "good"/"fresh", so the green stays theme-correct in light / dark / high-contrast. The secondary label
// and the muted caption/overflow map to `onSurfaceVariant` (web `--text-secondary` / `--text-muted`). The
// shared `AnimatedNumber` is intentionally NOT reused verbatim: it hard-binds the `MetricValue` role
// (onSurface, headlineSmall) with no color/size override, which would erase the two traits this slide's spec
// is built around — the eco-green and the hero scale — so the count-up is rendered here with the success token
// and the generated display type ramp, while keeping AnimatedNumber's count-up math (0 → value, decelerate
// easing) and additionally honoring reduced motion (which the shared AnimatedNumber does not).
//
// All entrances honor the reduced-motion preference (P1/S9, `rememberReducedMotion`): the 🌍 scale-pop, the
// number count-up, and the staggered header + per-tree reveals all fall back to their final static frame.
// Accessibility: the 🌍 is a labelled image announcing the "CO₂ offset" concept (web has no aria-label, but
// TalkBack benefits from a label on the lead glyph); the repeated 🌳 glyphs are decorative (their meaning is
// already carried by the "Like planting N trees" caption) so their semantics are cleared to avoid 30 redundant
// announcements; every textual string (label, number, caption, overflow) is a first-class semantics node.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EnvironmentSlide) cannot form a valid Kotlin package, so the package diverges
// from the path — as the sibling AchievementBadge surface does. `MatchingDeclarationName` covers the
// co-located previews + private helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.environmentslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.motion.staggerDelayMs
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

// ── Glyphs (the web emoji literals) ──────────────────────────────────────────────────────────────────
private const val GLOBE_EMOJI = "🌍"
private const val TREE_EMOJI = "🌳"

// ── Geometry (web Tailwind sizes mapped to platform sp/dp; no ported classes) ────────────────────────
private val GLOBE_FONT_SIZE: TextUnit = 48.sp // web text-5xl
private val TREE_FONT_SIZE: TextUnit = 24.sp // web text-2xl
private val LABEL_LETTER_SPACING: TextUnit = 1.5.sp // web tracking-wider
private val TREE_GRID_MAX_WIDTH: Dp = 320.dp // web max-w-xs (20rem)

// ── Units + formatting (web `suffix=" kg"`, an SI unit literal — never i18n; co2_offset_kg is already SI) ─
private const val CO2_UNIT_SUFFIX = " kg"
private const val CO2_DECIMALS = 0

// ── Motion (web framer-motion timings, collapsed to a tighter native cadence; all reduced-motion aware) ─
private const val COUNT_UP_DURATION_MS = 1500 // web `duration={1.5}`
private const val LABEL_DELAY_MS = 80
private const val NUMBER_DELAY_MS = 160
private const val CAPTION_DELAY_MS = 240
private const val TREE_STAGGER_STEP_MS = 50 // web `delay: 1.1 + i * 0.05`
private const val GLOBE_SPRING_DAMPING = 0.5f // web `damping: 15` pop (unitless Compose ratio)

/**
 * Stateful entry point — the faithful 1:1 port of the web `EnvironmentSlide({ data })` prop. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11) and renders the slide. The surface binds no
 * data of its own; the caller (the Year-in-Review deck) supplies the [data] (web parity).
 *
 * @param data the decoded year-review slice this slide reads (web `data`, a `YearReview`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EnvironmentSlide(
    data: EnvironmentSlideData,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { EnvironmentSlideDiagnostics.recordViewOpened(logger) }
    EnvironmentSlideContent(data = data, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a centered,
 * vertically-centered column (web `flex flex-col items-center justify-center h-full px-8 text-center`) holding
 * the spring-popped globe, the uppercase label, the green CO₂ count-up, the trees-equivalent caption, and the
 * capped 🌳 grid with its "+N more" overflow chip.
 */
@Composable
fun EnvironmentSlideContent(
    data: EnvironmentSlideData,
    modifier: Modifier = Modifier,
) {
    val display = remember(data) { EnvironmentSlideProjection.project(data) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    val reduceMotion = rememberReducedMotion()

    val co2OffsetLabel = stringResource(R.string.translation_yearReview_co2Offset)
    val treesFormatted = NumberFormat.getIntegerInstance(locale).format(display.treesPlanted.toLong())
    val treesEquivCaption = stringResource(R.string.translation_yearReview_treesEquiv, treesFormatted)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(horizontal = Spacing.xl3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        GlobeGlyph(reduceMotion = reduceMotion, contentDescription = co2OffsetLabel)

        Spacer(Modifier.height(Spacing.lg)) // web mb-4
        FadeIn(delayMs = if (reduceMotion) 0 else LABEL_DELAY_MS) {
            Text(
                text = co2OffsetLabel.uppercase(locale),
                style =
                    MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Medium,
                        letterSpacing = LABEL_LETTER_SPACING,
                    ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(Spacing.lg)) // web mb-4
        FadeIn(delayMs = if (reduceMotion) 0 else NUMBER_DELAY_MS) {
            Co2CountUp(value = display.co2OffsetKg, locale = locale, reduceMotion = reduceMotion)
        }

        Spacer(Modifier.height(Spacing.sm)) // web mt-2
        FadeIn(delayMs = if (reduceMotion) 0 else CAPTION_DELAY_MS) {
            Text(
                text = treesEquivCaption,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(Spacing.xl3)) // web mb-8
        TreeGrid(display = display, reduceMotion = reduceMotion, locale = locale)
    }
}

/**
 * The lead 🌍 glyph, scale-popped on first composition (web `initial={{ scale: 0 }} animate={{ scale: 1 }}`
 * spring). Under reduced motion it snaps to full scale. It is exposed to TalkBack as a labelled image whose
 * label is the [contentDescription] (the localized "CO₂ offset" concept), so screen-reader users get the
 * slide's subject from its lead glyph.
 */
@Composable
private fun GlobeGlyph(
    reduceMotion: Boolean,
    contentDescription: String,
) {
    val scale = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            scale.snapTo(1f)
        } else {
            scale.animateTo(1f, spring(dampingRatio = GLOBE_SPRING_DAMPING, stiffness = Spring.StiffnessMediumLow))
        }
    }
    Text(
        text = GLOBE_EMOJI,
        fontSize = GLOBE_FONT_SIZE,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                }.clearAndSetSemantics {
                    this.contentDescription = contentDescription
                    role = Role.Image
                },
    )
}

/**
 * The hero CO₂ figure, counting up from 0 to [value] on first composition (web `<AnimatedNumber duration=1.5
 * suffix=" kg" />`), rendered in the eco-green success token at the generated display scale. The count-up
 * mirrors the shared `AnimatedNumber` (0 → value, FastOutSlowIn easing) by scaling [value] through an eased
 * 0 → 1 progress fraction, and additionally honors reduced motion by landing on the final value at once.
 * Reading the progress `Animatable.value` here recomposes each frame (snapshot-state backed).
 */
@Composable
private fun Co2CountUp(
    value: Double,
    locale: Locale,
    reduceMotion: Boolean,
) {
    val progress = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(value, reduceMotion) {
        if (reduceMotion) {
            progress.snapTo(1f)
        } else {
            progress.snapTo(0f)
            progress.animateTo(1f, animationSpec = tween(COUNT_UP_DURATION_MS, easing = FastOutSlowInEasing))
        }
    }
    Text(
        text = "${ChartFormat.number(value * progress.value, CO2_DECIMALS, locale)}$CO2_UNIT_SUFFIX",
        style = MaterialTheme.typography.displaySmall,
        color = TeslaTokens.status.success,
        textAlign = TextAlign.Center,
    )
}

/**
 * The wrapped 🌳 grid (web `flex flex-wrap justify-center gap-2 max-w-xs`): one decorative tree glyph per
 * equivalent tree, [EnvironmentSlideDisplay.treeIconCount] of them (capped at 30), each entering on a staggered
 * delay via the shared [FadeIn] + tested [staggerDelayMs]. When [EnvironmentSlideDisplay.hasOverflow] the grid
 * ends in the muted "+N more" chip (web `+{treesPlanted - 30} {t('yearReview.more')}`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TreeGrid(
    display: EnvironmentSlideDisplay,
    reduceMotion: Boolean,
    locale: Locale,
) {
    FlowRow(
        modifier = Modifier.widthIn(max = TREE_GRID_MAX_WIDTH),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(display.treeIconCount) { index ->
            FadeIn(delayMs = staggerDelayMs(index, TREE_STAGGER_STEP_MS, reduceMotion)) {
                Text(
                    text = TREE_EMOJI,
                    fontSize = TREE_FONT_SIZE,
                    modifier = Modifier.clearAndSetSemantics {},
                )
            }
        }
        if (display.hasOverflow) {
            val overflowFormatted = NumberFormat.getIntegerInstance(locale).format(display.overflowCount.toLong())
            val moreLabel = stringResource(R.string.translation_yearReview_more)
            Caption(
                text = "+$overflowFormatted $moreLabel",
                modifier = Modifier.align(Alignment.CenterVertically),
            )
        }
    }
}

// ── Previews (tooling-only; reduced-motion forced so each branch renders its final static frame) ─────

private val PREVIEW_TYPICAL = EnvironmentSlideData(co2OffsetKg = 504.0) // → 24 trees, no overflow
private val PREVIEW_OVERFLOW = EnvironmentSlideData(co2OffsetKg = 1050.0) // → 50 trees, "+20 more"
private val PREVIEW_EMPTY = EnvironmentSlideData(co2OffsetKg = 0.0) // → "0 kg", empty grid

@Composable
private fun PreviewHost(data: EnvironmentSlideData) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            EnvironmentSlideContent(data = data)
        }
    }
}

@Preview(name = "Typical — 24 trees", showBackground = true)
@Composable
private fun EnvironmentSlideTypicalPreview() = PreviewHost(PREVIEW_TYPICAL)

@Preview(name = "Overflow — +N more", showBackground = true)
@Composable
private fun EnvironmentSlideOverflowPreview() = PreviewHost(PREVIEW_OVERFLOW)

@Preview(name = "Empty — zero offset", showBackground = true)
@Composable
private fun EnvironmentSlideEmptyPreview() = PreviewHost(PREVIEW_EMPTY)
