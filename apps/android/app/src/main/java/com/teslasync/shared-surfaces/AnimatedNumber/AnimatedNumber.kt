// The native Jetpack Compose + Material 3 AnimatedNumber shared surface — a parity port of the web count-up
// number web/src/components/data-display/AnimatedNumber.tsx. The web component animates a display number from 0
// up to `value` on mount and on every `value` / `duration` change, easing with an ease-out-quad curve driven by
// requestAnimationFrame, formatting each frame through `fmtNumber(display, decimals)` and rendering
// `{prefix}{…}{suffix}` in a `tabular-nums` span. Its pure math (the easing curve, the count-from-zero
// projection, and the `fmtNumber`-parity formatter) lives in AnimatedNumberModel.kt and is unit-tested
// off-device; this file is the thin render layer that drives the animation clock and applies the text style.
//
// Parity choices:
//   • Count-from-zero: every `value` / `durationMillis` change snaps the animator back to 0 and re-runs the
//     count-up, exactly as the web effect restarts with `from = 0` on its `[value, duration]` dependency.
//   • Easing: the Compose tween uses [EaseOutQuadEasing], which delegates to the model's [easeOutQuad] so there
//     is ONE reference curve shared by the animation and its tests — no drift between render and verification.
//   • Tabular figures: the text style enables the `tnum` OpenType feature so digits keep a fixed width while
//     counting, the native analogue of the web `tabular-nums` utility.
//   • `className` analogue: web callers style the number through `className`; native callers pass a [style] and
//     [color] (plus [modifier]) so size / weight / color stay caller-controlled, defaulting to the shared metric
//     style so an unstyled call looks like the rest of the app.
//   • Reduced motion: when the platform requests reduced motion ([rememberReducedMotion]) the animator settles
//     straight to `value` with no count-up — the surface is never a moving distraction for users who opted out.
//   • Accessibility: the node exposes the SETTLED formatted value as its content description (not the flickering
//     intermediate frames), so a screen reader reads the meaningful final number once.
//
// There is no data feed behind the surface (it is handed a finished number), so — like the accepted
// VisuallyHidden / AreaChartWrapper presentational ports — it has no loading / empty / error / stale / offline
// lifecycle, and it renders no static copy of its own, so it carries no i18n keys. It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AnimatedNumber — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.animatednumber

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * The Compose ease-out-quad easing — delegates to the model's unit-tested [easeOutQuad] so the animation curve
 * and the off-device verification are the same single reference (web `1 - (1 - progress) * (1 - progress)`).
 */
private val EaseOutQuadEasing: Easing =
    Easing { fraction -> easeOutQuad(fraction.toDouble()).toFloat() } // parity:allow Float to Double for the shared curve, not a TODO

/** The OpenType tabular-figures feature tag — fixed-width digits while counting (web `tabular-nums`). */
private const val TABULAR_FIGURES: String = "tnum"

/** The default metric text style — matches the shared metric look so an unstyled call fits the app. */
@Composable
private fun defaultNumberStyle(): TextStyle = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold)

/**
 * A count-up number that animates from 0 to [value] on first composition and re-counts from 0 to each new value
 * thereafter — the Android port of the web `AnimatedNumber`. Each frame is formatted with locale grouping and
 * [decimals] fraction digits and wrapped with [prefix] / [suffix]; digits use tabular figures so the text does
 * not jitter as it counts. Honors the platform reduced-motion preference (settles instantly) and records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param value the target number to count up to (web `value`).
 * @param decimals fraction digits for every frame (web `decimals`).
 * @param prefix text rendered before the number, verbatim (web `prefix`).
 * @param suffix text rendered after the number, verbatim (web `suffix`).
 * @param durationMillis count-up length; web `duration = 1` second by default. `0` (or reduced motion) settles
 *   instantly.
 * @param style the number's text style — the caller's `className` analogue for size / weight (tabular figures
 *   are always applied on top).
 * @param color the number's color — the caller's `className` color analogue.
 * @param locale the formatting locale; defaults to the app/device locale, like the shared formatters.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AnimatedNumber(
    value: Double,
    modifier: Modifier = Modifier,
    decimals: Int = AnimatedNumberDefaults.DECIMALS,
    prefix: String = "",
    suffix: String = "",
    durationMillis: Int = AnimatedNumberDefaults.DURATION_MS,
    style: TextStyle = defaultNumberStyle(),
    color: Color = MaterialTheme.colorScheme.onSurface,
    locale: Locale = Locale.getDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AnimatedNumberDiagnostics.recordViewOpened(logger) }

    val reduce = rememberReducedMotion()
    val animated = remember { Animatable(AnimatedNumberDefaults.FROM.toFloat()) }
    LaunchedEffect(value, durationMillis, reduce) {
        val target = value.toFloat()
        if (reduce || durationMillis <= 0) {
            animated.snapTo(target)
        } else {
            // web `from = 0`: every value / duration change restarts the count-up from zero.
            animated.snapTo(AnimatedNumberDefaults.FROM.toFloat())
            animated.animateTo(target, animationSpec = tween(durationMillis, easing = EaseOutQuadEasing))
        }
    }

    val spec = AnimatedNumberSpec(value = value, decimals = decimals, prefix = prefix, suffix = suffix)
    // Animatable.value is snapshot-state backed, so reading it here recomposes each frame (the web rAF tick).
    val frameValue = animated.value.toDouble() // parity:allow Float frame to Double for the projection, not a TODO
    val frameText = AnimatedNumberProjection.formatDisplay(spec, frameValue, locale)
    val settledLabel = remember(spec, locale) { AnimatedNumberProjection.settledText(spec, locale) }

    AnimatedNumberText(
        text = frameText,
        accessibleValue = settledLabel,
        style = style,
        color = color,
        modifier = modifier,
    )
}

/**
 * The stateless number renderer — the test/preview entry point. Draws [text] with tabular figures and exposes
 * the stable [accessibleValue] (the settled number) as the node's sole accessibility label via
 * [clearAndSetSemantics], so a screen reader reads the final value once instead of every intermediate frame.
 */
@Composable
private fun AnimatedNumberText(
    text: String,
    accessibleValue: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier.clearAndSetSemantics { contentDescription = accessibleValue },
        style = style.merge(TextStyle(fontFeatureSettings = TABULAR_FIGURES)),
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

// ── Previews (tooling-only; render the settled frame, which is what a static preview can show) ───────────────

/** Renders a settled number frame inside the theme — previews cannot run the animation clock, so they show the
 * final value the count-up lands on. */
@Composable
private fun SettledNumberPreview(
    text: String,
    dark: Boolean = false,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        AnimatedNumberText(
            text = text,
            accessibleValue = text,
            style = defaultNumberStyle(),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Preview(name = "Integer count", showBackground = true)
@Composable
private fun AnimatedNumberIntegerPreview() {
    val spec = AnimatedNumberSpec(value = 12_345.0)
    SettledNumberPreview(AnimatedNumberProjection.settledText(spec, Locale.US))
}

@Preview(name = "Currency (prefix + decimals)", showBackground = true)
@Composable
private fun AnimatedNumberCurrencyPreview() {
    val spec = AnimatedNumberSpec(value = 1_284.5, decimals = 2, prefix = "$")
    SettledNumberPreview(AnimatedNumberProjection.settledText(spec, Locale.US))
}

@Preview(name = "Percent suffix (dark)", showBackground = true)
@Composable
private fun AnimatedNumberPercentDarkPreview() {
    val spec = AnimatedNumberSpec(value = 87.0, suffix = " %")
    SettledNumberPreview(AnimatedNumberProjection.settledText(spec, Locale.US), dark = true)
}
