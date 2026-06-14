// The native Jetpack Compose + Material 3 Typography shared surface — a parity port of
// web/src/components/ui/Typography.tsx. The web module is the app's text primitive: a `Heading` (four levels:
// page / section / panel / sub, each bound to a composed role and a default semantic tag, with an `as` escape hatch),
// a generic `Text` (either a pre-composed `variant` role — which makes size/weight/color irrelevant — or a granular
// size + weight + color + monospace family), and the 1:1 convenience wrappers PageTitle / SectionTitle / PanelTitle /
// Subhead (headings) and Caption / HelperText / ErrorText / TypographyLabel / MetricValue / MetricLabel / Code (roled
// text). It owns no data and renders the caller's children.
//
// This native surface keeps that contract end to end. Every type decision flows through the pure model in
// TypographyModel.kt ([specForRole] / [headingRole] / [fontSizeSp]); this composable is a thin render layer that
// resolves those decisions onto the generated Material 3 token ramp (P1/S9): the role slot → a `MaterialTheme.typography`
// slot, the semantic color → a `MaterialTheme.colorScheme` slot (onSurface / onSurfaceVariant / outlineVariant / error,
// each generated from apps/design/tokens.json so light / dark / high-contrast stay correct), plus the per-role weight /
// monospace / tabular-figures overrides. Text is sized in `sp`, so OS font-scaling always applies; there is no motion to
// honor a reduce-motion setting against. Headings carry the platform `heading()` semantics (the native analogue of the
// web h1–h4 tags) so TalkBack announces them as headings — with an opt-out for the web `as` escape hatch — and the error
// role carries an assertive live region (the web `role="alert"`). A one-shot PII-safe `view.opened` diagnostic (P1/S11)
// fires on first composition of each public entry, carrying only the surface slug — never the rendered text.
//
// It performs NO HTTP and binds NO state holder, and it owns NO i18n key (the web module has no `useTranslation`; every
// string is the caller's `children`). See TypographyModel.kt for why the generic loading / empty / error / stale /
// offline states do not apply to a presentational text primitive, and why the package diverges from the hyphenated
// surface directory. The stateless [HeadingContent] / [TypographyTextContent] renderers are the test + preview entry
// points (no diagnostics), so a screen composing many text nodes never emits per-node events from the render path.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Typography) cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed
// for the co-located stateless renderers, wrappers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.typography

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.sp
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag stamped on every typography node — used by the instrumented per-state + a11y UI tests. */
const val TYPOGRAPHY_TEST_TAG: String = "typography"

// Subtle body color (web `text-white/60`) — onSurfaceVariant softened, theme-aware.
private const val SUBTLE_ALPHA: Float = 0.6f

// Disabled text color (web `text-white/40`) — onSurface softened, theme-aware.
private const val DISABLED_ALPHA: Float = 0.4f

// ── Heading — the four-level title (web `Heading`) ───────────────────────────────────────────────────────────

/**
 * Heading — the faithful port of the web `Heading`. Renders [text] at the composed role for [level] (page /
 * section / panel / sub) and, unless [headingSemantics] is cleared (the web `as` escape hatch for a heading-styled
 * element that is not a semantic heading), announces it to assistive tech as a heading. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition. Performs no HTTP and binds no state holder.
 *
 * @param text the heading text — the web `children` when they are a plain string.
 * @param level the heading level (web `level`, default section).
 * @param headingSemantics whether the platform heading announcement is applied (web defaults to a real heading tag).
 * @param maxLines optional truncation cap (web does not truncate by default).
 */
@Composable
fun Heading(
    text: String,
    modifier: Modifier = Modifier,
    level: HeadingLevel = HeadingLevel.Section,
    headingSemantics: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    logger: Logger = LocalDataContainer.current.logger,
) {
    Heading(modifier = modifier, level = level, headingSemantics = headingSemantics, logger = logger) {
        Text(text = text, maxLines = maxLines, overflow = overflow)
    }
}

/**
 * Heading content-slot overload — the faithful port of `<Heading>{children}</Heading>` for arbitrary content. Fires
 * the one-shot `view.opened` diagnostic, then renders the [content] at the composed role for [level].
 */
@Composable
fun Heading(
    modifier: Modifier = Modifier,
    level: HeadingLevel = HeadingLevel.Section,
    headingSemantics: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { TypographyDiagnostics.recordViewOpened(logger) }
    HeadingContent(modifier = modifier, level = level, headingSemantics = headingSemantics, content = content)
}

/**
 * Stateless heading renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Resolves
 * the role style for [level] and provides it to [content], merging the subtree into one node that carries the
 * platform heading announcement (web h1–h4) when [headingSemantics] is set.
 */
@Composable
fun HeadingContent(
    modifier: Modifier = Modifier,
    level: HeadingLevel = HeadingLevel.Section,
    headingSemantics: Boolean = true,
    content: @Composable () -> Unit,
) {
    val style = roleTextStyle(headingRole(level))
    val semanticsModifier =
        if (headingSemantics) {
            Modifier.semantics(mergeDescendants = true) { heading() }
        } else {
            Modifier
        }
    Box(modifier = modifier.then(semanticsModifier).testTag(TYPOGRAPHY_TEST_TAG)) {
        ProvideTextStyle(style) { content() }
    }
}

// ── Text — the generic roled / granular text (web `Text`) ────────────────────────────────────────────────────

/**
 * Text — the faithful port of the web `Text`. When [variant] is set, [text] renders at that composed role and the
 * granular [size] / [weight] / [color] / [mono] are ignored (mirroring the web precedence exactly); otherwise the
 * granular axes are layered over the inherited text style. Records the one-shot PII-safe `view.opened` diagnostic on
 * first composition.
 *
 * @param variant a pre-composed role (web `variant`); when set, the granular axes are ignored.
 * @param size granular size, applied only when [variant] is unset (web `size`).
 * @param weight granular weight, applied only when [variant] is unset (web `weight`).
 * @param color granular color, applied only when [variant] is unset (web `color`).
 * @param mono switch to the monospace family (web `mono`).
 */
@Composable
fun TypographyText(
    text: String,
    modifier: Modifier = Modifier,
    variant: TypographyRole? = null,
    size: TypographySize? = null,
    weight: TypographyWeight? = null,
    color: TypographyColor? = null,
    mono: Boolean = false,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
    logger: Logger = LocalDataContainer.current.logger,
) {
    TypographyText(
        modifier = modifier,
        variant = variant,
        size = size,
        weight = weight,
        color = color,
        mono = mono,
        logger = logger,
    ) {
        Text(text = text, maxLines = maxLines, overflow = overflow)
    }
}

/**
 * Text content-slot overload — the faithful port of `<Text>{children}</Text>` for arbitrary content. Fires the
 * one-shot `view.opened` diagnostic, then renders the [content] with the resolved role / granular style.
 */
@Composable
fun TypographyText(
    modifier: Modifier = Modifier,
    variant: TypographyRole? = null,
    size: TypographySize? = null,
    weight: TypographyWeight? = null,
    color: TypographyColor? = null,
    mono: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { TypographyDiagnostics.recordViewOpened(logger) }
    TypographyTextContent(
        modifier = modifier,
        variant = variant,
        size = size,
        weight = weight,
        color = color,
        mono = mono,
        content = content,
    )
}

/**
 * Stateless text renderer — the unit/UI-test + preview entry point (no diagnostics). Resolves the [variant] role
 * style, or the granular [size] / [weight] / [color] / [mono] over the inherited style, and provides it to [content].
 */
@Composable
fun TypographyTextContent(
    modifier: Modifier = Modifier,
    variant: TypographyRole? = null,
    size: TypographySize? = null,
    weight: TypographyWeight? = null,
    color: TypographyColor? = null,
    mono: Boolean = false,
    content: @Composable () -> Unit,
) {
    val style =
        if (variant != null) {
            roleTextStyle(variant)
        } else {
            granularTextStyle(size = size, weight = weight, color = color, mono = mono)
        }
    Box(modifier = modifier.testTag(TYPOGRAPHY_TEST_TAG)) {
        ProvideTextStyle(style) { content() }
    }
}

// ── Convenience wrappers — match the web role exports 1:1 ────────────────────────────────────────────────────

/** Page-level title (web `PageTitle`). */
@Composable
fun PageTitle(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = Heading(text = text, modifier = modifier, level = HeadingLevel.Page, logger = logger)

/** Section title (web `SectionTitle`). */
@Composable
fun SectionTitle(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = Heading(text = text, modifier = modifier, level = HeadingLevel.Section, logger = logger)

/** Panel title (web `PanelTitle`). */
@Composable
fun PanelTitle(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = Heading(text = text, modifier = modifier, level = HeadingLevel.Panel, logger = logger)

/** Sub-heading (web `Subhead`). */
@Composable
fun Subhead(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = Heading(text = text, modifier = modifier, level = HeadingLevel.Sub, logger = logger)

/** Caption (web `Caption`). */
@Composable
fun Caption(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.Caption, logger = logger)

/** Helper text (web `HelperText`). */
@Composable
fun HelperText(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.Helper, logger = logger)

/**
 * Error text (web `ErrorText`, `role="alert"`). Carries an assertive live region so TalkBack announces the message
 * when it appears — the native analogue of the web alert role.
 */
@Composable
fun ErrorText(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(
    text = text,
    modifier = modifier.semantics { liveRegion = LiveRegionMode.Assertive },
    variant = TypographyRole.Error,
    logger = logger,
)

/** Field/section label (web `Label` export of the Typography module). */
@Composable
fun TypographyLabel(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.Label, logger = logger)

/** Large metric value with tabular figures (web `MetricValue`). */
@Composable
fun MetricValue(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.MetricValue, logger = logger)

/** Small metric label (web `MetricLabel`). */
@Composable
fun MetricLabel(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.MetricLabel, logger = logger)

/** Inline monospace code (web `Code`). */
@Composable
fun Code(
    text: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) = TypographyText(text = text, modifier = modifier, variant = TypographyRole.Code, logger = logger)

// ── Token resolution (render boundary) ───────────────────────────────────────────────────────────────────────

/**
 * Resolve a composed [role] to its ready-to-render [TextStyle] over the generated Material 3 token ramp: the role's
 * type-scale slot, layered with its weight / monospace / tabular-figures overrides and its semantic color.
 */
@Composable
private fun roleTextStyle(role: TypographyRole): TextStyle {
    val spec = specForRole(role)
    val base = slotStyle(spec.slot)
    return base.copy(
        fontWeight = spec.weight?.let { fontWeight(it) } ?: base.fontWeight,
        fontFamily = if (spec.mono) FontFamily.Monospace else base.fontFamily,
        fontFeatureSettings = if (spec.tabularFigures) TYPOGRAPHY_TABULAR_FIGURES else base.fontFeatureSettings,
        color = roleColor(spec.color),
    )
}

/**
 * Resolve the granular axes over the inherited text style (web `cn(size, weight, color, mono)` when no variant is
 * set). Any axis left null inherits from the ambient style, mirroring CSS inheritance.
 */
@Composable
private fun granularTextStyle(
    size: TypographySize?,
    weight: TypographyWeight?,
    color: TypographyColor?,
    mono: Boolean,
): TextStyle {
    val base = LocalTextStyle.current
    return base.copy(
        fontSize = size?.let { it.fontSizeSp().sp } ?: base.fontSize,
        fontWeight = weight?.let { fontWeight(it) } ?: base.fontWeight,
        fontFamily = if (mono) FontFamily.Monospace else base.fontFamily,
        color = color?.let { granularColor(it) } ?: base.color,
    )
}

/** Map a [TypeScaleSlot] onto the generated `MaterialTheme.typography` slot carrying the role's metrics. */
@Composable
private fun slotStyle(slot: TypeScaleSlot): TextStyle =
    when (slot) {
        TypeScaleSlot.TitleLarge -> MaterialTheme.typography.titleLarge
        TypeScaleSlot.TitleMedium -> MaterialTheme.typography.titleMedium
        TypeScaleSlot.TitleSmall -> MaterialTheme.typography.titleSmall
        TypeScaleSlot.HeadlineMedium -> MaterialTheme.typography.headlineMedium
        TypeScaleSlot.BodyMedium -> MaterialTheme.typography.bodyMedium
        TypeScaleSlot.BodySmall -> MaterialTheme.typography.bodySmall
        TypeScaleSlot.LabelLarge -> MaterialTheme.typography.labelLarge
        TypeScaleSlot.LabelMedium -> MaterialTheme.typography.labelMedium
        TypeScaleSlot.LabelSmall -> MaterialTheme.typography.labelSmall
    }

/** Map a role's semantic [color] onto a theme-aware `MaterialTheme.colorScheme` slot (generated from tokens.json). */
@Composable
private fun roleColor(color: RoleColor): Color =
    when (color) {
        RoleColor.Primary -> MaterialTheme.colorScheme.onSurface
        RoleColor.Secondary -> MaterialTheme.colorScheme.onSurfaceVariant
        RoleColor.Muted -> MaterialTheme.colorScheme.outlineVariant
        RoleColor.Error -> MaterialTheme.colorScheme.error
    }

/** Map a granular [color] onto a theme-aware `MaterialTheme.colorScheme` slot (web `typography.color`). */
@Composable
private fun granularColor(color: TypographyColor): Color =
    when (color) {
        TypographyColor.Primary -> MaterialTheme.colorScheme.onSurface
        TypographyColor.Secondary -> MaterialTheme.colorScheme.onSurfaceVariant
        TypographyColor.Muted -> MaterialTheme.colorScheme.outlineVariant
        TypographyColor.Subtle -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = SUBTLE_ALPHA)
        TypographyColor.Disabled -> MaterialTheme.colorScheme.onSurface.copy(alpha = DISABLED_ALPHA)
        TypographyColor.Inverse -> MaterialTheme.colorScheme.inverseOnSurface
    }

/** Map a [TypographyWeight] onto a Compose [FontWeight] (web `typography.weight`). */
private fun fontWeight(weight: TypographyWeight): FontWeight =
    when (weight) {
        TypographyWeight.Regular -> FontWeight.Normal
        TypographyWeight.Medium -> FontWeight.Medium
        TypographyWeight.Semibold -> FontWeight.SemiBold
        TypographyWeight.Bold -> FontWeight.Bold
    }

// ── Previews (tooling-only; the sample strings are never shipped UI) ──────────────────────────────────────────

@Preview(name = "Typography · roles", showBackground = true)
@Composable
private fun TypographyRolesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            HeadingContent(level = HeadingLevel.Page) { Text("Fleet overview") }
            HeadingContent(level = HeadingLevel.Section) { Text("Battery health") }
            HeadingContent(level = HeadingLevel.Panel) { Text("Charging sessions") }
            HeadingContent(level = HeadingLevel.Sub) { Text("Last 30 days") }
            TypographyTextContent(variant = TypographyRole.Body) { Text("Range estimate updated") }
            TypographyTextContent(variant = TypographyRole.Caption) { Text("Synced 2 minutes ago") }
            TypographyTextContent(variant = TypographyRole.Label) { Text("State of charge") }
            TypographyTextContent(variant = TypographyRole.MetricValue) { Text("342 km") }
            TypographyTextContent(variant = TypographyRole.MetricLabel) { Text("Estimated range") }
            TypographyTextContent(variant = TypographyRole.Code) { Text("vehicle_id=42") }
            TypographyTextContent(variant = TypographyRole.Helper) { Text("Values reflect the last sync") }
            TypographyTextContent(variant = TypographyRole.Error) { Text("Could not reach the vehicle") }
        }
    }
}

@Preview(name = "Typography · granular sizes", showBackground = true)
@Composable
private fun TypographyGranularPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            TypographyTextContent(size = TypographySize.Xl3, weight = TypographyWeight.Bold) { Text("30 sp bold") }
            TypographyTextContent(size = TypographySize.Lg, color = TypographyColor.Secondary) { Text("18 sp secondary") }
            TypographyTextContent(size = TypographySize.Sm, mono = true) { Text("14 sp mono") }
        }
    }
}

@Preview(name = "Typography · roles (dark)", showBackground = true)
@Composable
private fun TypographyDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            HeadingContent(level = HeadingLevel.Page) { Text("Fleet overview") }
            TypographyTextContent(variant = TypographyRole.MetricValue) { Text("76%") }
            TypographyTextContent(variant = TypographyRole.Error) { Text("Charging interrupted") }
        }
    }
}
