// The native Jetpack Compose + Material 3 WidgetBigNumber widget primitive — a parity port of the web shared
// building block web/src/features/dashboard/widgets/shared/WidgetBigNumber.tsx. The web source is a purely
// presentational "big number" used by many dashboard widgets: centered in its cell it renders the value (a
// count-up `AnimatedNumber` when `animated`, otherwise a static `tabular-nums` span, otherwise the muted
// `nullDisplay` when `value === null`) beside an optional unit, then an optional uppercase label, an optional
// subtitle, and an optional `Badge`. The value styling (`text-3xl font-bold` + the caller `valueColor`) is applied
// by the web caller via `className`, so this native primitive renders the number itself at the 30 sp / Bold type
// token (the `text-3xl font-bold` equivalent) honoring the caller [valueColor], rather than delegating to the
// fixed-style `AnimatedNumber` atom — that is the only way to preserve the web `valueColor` knob. It composes the
// shared `Badge` atom for the chip (the web `@/components/ui` Badge counterpart) and the shared `ChartFormat`
// number formatter (the web `fmtNumber` counterpart the `AnimatedNumber` atom also uses).
//
// All rendering decisions (formatting, the null branch, blank-prop normalization, and the single coherent
// accessibility label) live in WidgetBigNumberModel.kt and are unit-tested off-device; this file is the thin
// render layer that drives the count-up clock, applies color / typography, and merges the fragments into one
// TalkBack unit. The primitive performs NO HTTP and renders no copy of its own — every visible string is handed
// in by the caller — so it carries NO i18n keys (the web source has none either). It honors the platform
// reduced-motion preference (the value settles instantly) and records the one-shot PII-safe `view.opened`
// diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated primitive directory
// (com/teslasync/widget-primitives/WidgetBigNumber) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling widget / shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located private helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetbignumber

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Test tag on the primitive root so on-device UI tests can locate it in any state (present or empty value). */
const val WIDGET_BIG_NUMBER_TEST_TAG: String = "widget-big-number"

/** The OpenType tabular-figures feature tag — fixed-width digits while counting (web `tabular-nums`). */
private const val TABULAR_FIGURES: String = "tnum"

/** Extra fade applied to the `--text-muted` roles (the label + the empty-value fallback) over the secondary color. */
private const val MUTED_ALPHA: Float = 0.7f

/**
 * A centered "big number" — the Android port of the web `WidgetBigNumber`. Renders [value] (formatted with locale
 * grouping and [decimals] fraction digits) at the 30 sp / Bold token in [valueColor], beside the optional [unit],
 * then the optional uppercase [label], the optional [subtitle], and the optional [badge]. A `null` (or non-finite)
 * [value] renders [nullDisplay] in the muted color — the web `value === null` branch. When [animated] the value
 * counts up from zero (settling instantly under the platform reduced-motion preference); when `false` it is shown
 * statically. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and exposes one coherent TalkBack
 * description for the whole primitive.
 *
 * @param value the number to display, or `null` for the muted empty branch (web `value: number | null`).
 * @param unit the optional unit rendered beside the value (web `unit`).
 * @param label the optional caption rendered (uppercased) below the value (web `label`).
 * @param subtitle the optional secondary line below the label (web `subtitle`).
 * @param badge the optional status chip below everything (web `badge`).
 * @param valueColor the value color — the caller's `valueColor` className analogue; defaults to the primary text.
 * @param nullDisplay the fallback shown for the empty branch (web `nullDisplay`, default `—`).
 * @param animated whether the value counts up on appearance (web `animated`, default `true`).
 * @param decimals fraction digits for the value (web `AnimatedNumber` `decimals`).
 * @param durationMillis count-up length; defaults to the web `AnimatedNumber` 1-second cadence. Reduced motion or
 *   `0` settles instantly.
 * @param locale the formatting locale; defaults to the app/device locale, like the shared formatters.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer] logger.
 */
@Composable
fun WidgetBigNumber(
    value: Double?,
    modifier: Modifier = Modifier,
    unit: String? = null,
    label: String? = null,
    subtitle: String? = null,
    badge: WidgetBigNumberBadge? = null,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
    nullDisplay: String = WidgetBigNumberDefaults.NULL_DISPLAY,
    animated: Boolean = true,
    decimals: Int = WidgetBigNumberDefaults.DECIMALS,
    durationMillis: Int = WidgetBigNumberDefaults.ANIMATION_MS,
    locale: Locale = Locale.getDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WidgetBigNumberDiagnostics.recordViewOpened(logger) }

    val content =
        remember(value, unit, label, subtitle, badge, nullDisplay, decimals, locale) {
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = value, unit = unit, label = label, subtitle = subtitle, badge = badge),
                nullDisplay = nullDisplay,
                decimals = decimals,
                locale = locale,
            )
        }

    Column(
        modifier =
            modifier
                .fillMaxHeight()
                .testTag(WIDGET_BIG_NUMBER_TEST_TAG)
                .semantics(mergeDescendants = true) { contentDescription = content.accessibilityLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            WidgetBigNumberValue(
                content = content,
                rawValue = value,
                valueColor = valueColor,
                animated = animated,
                decimals = decimals,
                durationMillis = durationMillis,
                locale = locale,
                modifier = Modifier.alignByBaseline(),
            )
            content.unit?.let { unitText ->
                Text(
                    text = unitText,
                    modifier = Modifier.alignByBaseline(),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }

        content.labelDisplay?.let { labelText ->
            Text(
                text = labelText,
                style = MaterialTheme.typography.labelSmall,
                color = mutedColor(),
                maxLines = 1,
            )
        }

        content.subtitle?.let { subtitleText ->
            Text(
                text = subtitleText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }

        content.badge?.let { chip ->
            Badge(text = chip.text, variant = chip.variant.toBadgeVariant())
        }
    }
}

/**
 * The value glyph — the web `text-3xl font-bold` number. Renders the muted [nullDisplay] for the empty branch, a
 * count-up number when [animated] (settling instantly under reduced motion), or a static formatted number
 * otherwise. Always uses tabular figures so the digits never jitter while counting.
 */
@Composable
private fun WidgetBigNumberValue(
    content: WidgetBigNumberContent,
    rawValue: Double?,
    valueColor: Color,
    animated: Boolean,
    decimals: Int,
    durationMillis: Int,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val numberStyle = MaterialTheme.typography.displaySmall
    when {
        content.isNullValue || rawValue == null -> {
            WidgetBigNumberGlyph(content.displayText, numberStyle, mutedColor(), modifier)
        }

        animated -> {
            val reduce = rememberReducedMotion()
            val animatable = remember { Animatable(0f) }
            LaunchedEffect(rawValue, durationMillis, reduce) {
                val target = rawValue.toFloat()
                if (reduce || durationMillis <= 0) {
                    animatable.snapTo(target)
                } else {
                    animatable.snapTo(0f)
                    animatable.animateTo(target, animationSpec = tween(durationMillis, easing = FastOutSlowInEasing))
                }
            }
            val frameValue = animatable.value.toDouble() // parity:allow widening the Float animation frame to Double, not a TODO
            val frameText = ChartFormat.number(frameValue, decimals, locale)
            WidgetBigNumberGlyph(frameText, numberStyle, valueColor, modifier)
        }

        else -> {
            WidgetBigNumberGlyph(content.displayText, numberStyle, valueColor, modifier)
        }
    }
}

/** A single-line number Text with tabular figures applied on top of [style] (web `tabular-nums`). */
@Composable
private fun WidgetBigNumberGlyph(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = style.merge(TextStyle(fontFeatureSettings = TABULAR_FIGURES)),
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

/** The `--text-muted` color — the secondary text color, faded, for the label and the empty-value fallback. */
@Composable
private fun mutedColor(): Color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA)

/** Maps the primitive's semantic badge intent onto the shared `Badge` atom (the web `badgeVariantMap`). */
private fun WidgetBigNumberBadgeVariant.toBadgeVariant(): BadgeVariant =
    when (this) {
        WidgetBigNumberBadgeVariant.Success -> BadgeVariant.Success
        WidgetBigNumberBadgeVariant.Warning -> BadgeVariant.Warning
        WidgetBigNumberBadgeVariant.Error -> BadgeVariant.Danger
        WidgetBigNumberBadgeVariant.Neutral -> BadgeVariant.Neutral
    }

// ── Previews (tooling-only; the sample copy is never shipped UI) ─────────────────────────────────────────────

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

/** Renders a primitive inside the theme and a fixed widget-sized cell, with reduced motion so the value settles. */
@Composable
private fun WidgetBigNumberPreviewCell(
    dark: Boolean = false,
    content: @Composable () -> Unit,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Box(
                modifier = Modifier.width(160.dp).height(120.dp),
                contentAlignment = Alignment.Center,
            ) {
                content()
            }
        }
    }
}

@Preview(name = "WidgetBigNumber · value + unit + label + subtitle (dark)", showBackground = true)
@Composable
private fun WidgetBigNumberFullPreview() {
    WidgetBigNumberPreviewCell(dark = true) {
        WidgetBigNumber(
            value = 287.0,
            unit = "mi",
            label = "Rated range",
            subtitle = "EPA estimate",
            badge = WidgetBigNumberBadge("Healthy", WidgetBigNumberBadgeVariant.Success),
            locale = Locale.US,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "WidgetBigNumber · empty value", showBackground = true)
@Composable
private fun WidgetBigNumberEmptyPreview() {
    WidgetBigNumberPreviewCell {
        WidgetBigNumber(
            value = null,
            unit = "kWh",
            label = "Energy added",
            locale = Locale.US,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "WidgetBigNumber · static (not animated) + warning badge", showBackground = true)
@Composable
private fun WidgetBigNumberStaticPreview() {
    WidgetBigNumberPreviewCell(dark = true) {
        WidgetBigNumber(
            value = 12_345.0,
            label = "Odometer",
            unit = "mi",
            animated = false,
            badge = WidgetBigNumberBadge("Service soon", WidgetBigNumberBadgeVariant.Warning),
            locale = Locale.US,
            logger = PreviewLogger,
        )
    }
}
