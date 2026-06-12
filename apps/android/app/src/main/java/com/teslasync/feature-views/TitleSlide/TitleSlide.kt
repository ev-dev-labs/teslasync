// The native Jetpack Compose + Material 3 TitleSlide feature view — a parity port of
// web/src/features/analytics/components/review/TitleSlide.tsx. The web component renders the opening slide
// of the Year-in-Review carousel: a large car emoji, the recap year as a count-up hero, the localized
// "Year in Review" title, and the vehicle's display name — all entering with a short staggered fade/slide.
//
// Every derivation flows through the pure [TitleSlideProjection]; the composable is a thin render layer. The
// surface binds no data hook (the `data` arrives as a prop, web parity — the slide host owns the
// `useYearReview` query and its loading/error/stale/offline lifecycle), and its one catalog string resolves
// through the generated i18n catalog (P1/S10) `yearReview.title` key, so there is no English literal here.
// The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Typography (P1/S9 tokens, no ported Tailwind): the web hero (`text-5xl md:text-7xl font-bold text-white`)
// maps to the top of the generated type ramp — `displayLarge` in `onSurface`; the two secondary lines
// (`text-[var(--text-secondary)]`) map to `titleLarge` / `titleMedium` in `onSurfaceVariant`, the same
// secondary-text mapping the sibling AchievementBadge port uses. The count-up reuses the shared
// [ChartFormat.number] so the grouped figure (e.g. "2,024") matches the web `fmtNumber(year, 0)` exactly; it
// is rendered with tabular figures so the hero does not jitter as it counts.
//
// Motion honors the reduced-motion preference (P1/S9, `rememberReducedMotion`): under reduced motion the
// staggered entrances snap to their final state (via the shared [FadeIn]) and the year count-up snaps
// straight to the final value rather than animating.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TitleSlide) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.titleslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Locale

/** The decorative hero glyph (web `🚗`); cleared from the accessibility tree (the year + title carry meaning). */
private const val CAR_EMOJI = "\uD83D\uDE97"

/** Hero emoji size — the native analogue of the web `text-7xl` glyph. */
private val EMOJI_SIZE: TextUnit = 64.sp

/** Tabular figures keep the count-up hero a fixed width so it does not shift as the digits change. */
private const val TABULAR_NUMS = "tnum"

/** Year count-up duration in ms — the web `<AnimatedNumber … duration={0.8} />` (0.8 s). */
private const val YEAR_COUNT_UP_MS = 800

/** Per-line entrance delays in ms — the web framer-motion `transition.delay` values (0.3 / 0.5 / 0.7 s). */
private const val ENTER_DELAY_YEAR_MS = 300
private const val ENTER_DELAY_TITLE_MS = 500
private const val ENTER_DELAY_VEHICLE_MS = 700

/** Inter-line spacing — the web `mb-6` / `mb-4` / `mb-2` rhythm, snapped onto the P1/S9 spacing scale. */
private val GAP_AFTER_EMOJI: Dp = Spacing.lg
private val GAP_AFTER_YEAR: Dp = Spacing.md
private val GAP_AFTER_TITLE: Dp = Spacing.sm

/**
 * Stateful entry point — the faithful 1:1 port of the web `TitleSlide({ data })` prop. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11) and renders the slide. The surface binds no data of
 * its own; the caller (the Year-in-Review slide host) supplies the [data] (web parity).
 *
 * @param data the decoded year-review payload this slide reads (web `data`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TitleSlide(
    data: TitleSlideData,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TitleSlideDiagnostics.recordViewOpened(logger) }
    TitleSlideContent(data = data, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a column
 * that fills the slide and centers its content both axes (web `flex flex-col items-center justify-center
 * h-full px-8 text-center`), holding the decorative emoji, the year count-up hero, the localized title, and
 * the vehicle name, each entering with a staggered fade/slide that honors reduced motion.
 */
@Composable
fun TitleSlideContent(
    data: TitleSlideData,
    modifier: Modifier = Modifier,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val strings = TitleSlideStrings(title = stringResource(R.string.translation_yearReview_title))
    val display = remember(data, strings, locale) { TitleSlideProjection.project(data, strings, locale) }

    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        FadeIn {
            Text(
                text = CAR_EMOJI,
                fontSize = EMOJI_SIZE,
                textAlign = TextAlign.Center,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
        Spacer(Modifier.height(GAP_AFTER_EMOJI))

        FadeIn(delayMs = ENTER_DELAY_YEAR_MS) {
            AnimatedYear(
                year = display.year,
                label = display.yearLabel,
                locale = locale,
                startDelayMs = ENTER_DELAY_YEAR_MS,
            )
        }
        Spacer(Modifier.height(GAP_AFTER_YEAR))

        FadeIn(delayMs = ENTER_DELAY_TITLE_MS) {
            Text(
                text = display.title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Spacer(Modifier.height(GAP_AFTER_TITLE))

        FadeIn(delayMs = ENTER_DELAY_VEHICLE_MS) {
            Text(
                text = display.vehicleName,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The year hero — a count-up from 0 to [year] (web `AnimatedNumber`), formatted with locale grouping via the
 * shared [ChartFormat.number] so the figure matches the web exactly. The shared `AnimatedNumber` is not used
 * directly because it renders at a fixed metric-value type size; the slide's hero needs the top of the type
 * ramp (`displayLarge`), so the count-up is rendered here with that style.
 *
 * The animating value is cleared from the accessibility tree and replaced by the stable [label] (the final
 * grouped year), so TalkBack announces the year once instead of every intermediate count-up frame. Under
 * reduced motion the value snaps straight to [year]. [startDelayMs] aligns the count-up start with the
 * line's fade-in so the digits do not advance while the hero is still invisible.
 */
@Composable
private fun AnimatedYear(
    year: Int,
    label: String,
    locale: Locale,
    startDelayMs: Int,
) {
    val reduce = rememberReducedMotion()
    val animated = remember { Animatable(if (reduce) year.toFloat() else 0f) }
    LaunchedEffect(year, reduce, startDelayMs) {
        if (reduce) {
            animated.snapTo(year.toFloat())
        } else {
            animated.snapTo(0f)
            delay(startDelayMs.toLong())
            animated.animateTo(year.toFloat(), tween(YEAR_COUNT_UP_MS, easing = FastOutSlowInEasing))
        }
    }
    Text(
        text = ChartFormat.number(animated.value * 1.0, 0, locale),
        style = MaterialTheme.typography.displayLarge.copy(fontFeatureSettings = TABULAR_NUMS),
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier.clearAndSetSemantics { contentDescription = label },
    )
}

// ── Previews (tooling-only; @Preview entry points exercise the render path + the em-dash fallback) ─────────

private val PREVIEW_DATA =
    TitleSlideData(
        year = 2024,
        vehicle = TitleSlideVehicle(id = 1, displayName = "My Model 3", model = "model3"),
    )

private val PREVIEW_BLANK_NAME =
    TitleSlideData(
        year = 2025,
        vehicle = TitleSlideVehicle(id = 2, displayName = "", model = "models"),
    )

@Preview(name = "Title slide", showBackground = true)
@Composable
private fun TitleSlidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TitleSlideContent(PREVIEW_DATA)
    }
}

@Preview(name = "Blank vehicle name (em-dash fallback)", showBackground = true)
@Composable
private fun TitleSlideBlankNamePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TitleSlideContent(PREVIEW_BLANK_NAME)
    }
}
