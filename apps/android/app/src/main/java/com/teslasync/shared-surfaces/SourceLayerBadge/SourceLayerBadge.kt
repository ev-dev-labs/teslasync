// The native Jetpack Compose + Material 3 SourceLayerBadge shared surface — a parity port of the web
// debugger-only badge web/src/components/data-display/SourceLayerBadge.tsx. The web surface renders a tiny
// monospace chip (a single glyph: "L1" / "L2" / "LOG" / "STALE" / "—") tinted by the layer a live signal
// value was satisfied from, wrapped in a Tooltip that spells out the layer's meaning plus an optional age, so
// power-user diagnostics surfaces (the FSM debugger, the signal-diff table) can distinguish the L1 in-process
// store, the L2 Redis hot cache, durable signal_log replay, and stale Redis values at a glance.
//
// Every derivation flows through the pure model in SourceLayerBadgeModel.kt (parse → glyph → tint → age
// format → projection); this file is the thin render layer that maps the projected tint onto the per-theme
// TeslaTokens status palette, resolves the localized layer description + the "age" label from the shared
// P1/S10 catalog, composes the shared `Tooltip` atom (the web composes `@/components/ui` Tooltip), and fires
// the one-shot PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP. The whole chip collapses into
// a single accessibility node carrying the spoken layer description (with the age when present) — improving on
// the web source, which exposes only a hover/`title` tooltip + a colour-tinted glyph to assistive tech.
//
// On the web `showLabel` prop: the running web code ALWAYS renders the same short glyph (`style.label`) and
// only widens the chip's min-width (`min-w-[2.5rem]` vs `min-w-[1.5rem]`); there is no separate long-form to
// "spell out". This port reproduces that observed behaviour faithfully (the glyph is always shown; [showLabel]
// only reserves the wider minimum width) rather than the prop's doc-comment, which disagrees with its own code
// (honesty covenant: reproduce the spec's actual composition, no silent drift).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SourceLayerBadge) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sourcelayerbadge

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Soft fill alpha behind the glyph — web background tint at 15 percent. */
private const val BADGE_BACKGROUND_ALPHA: Float = 0.15f

/** Hairline border alpha around the chip — web border tint at 30 percent. */
private const val BADGE_BORDER_ALPHA: Float = 0.30f

/** Glyph letter tracking — web `tracking-wider` on the 10px monospace label. */
private val BADGE_LETTER_SPACING = 0.5.sp

/** Vertical chip padding — web `py-px`. */
private val BADGE_PADDING_VERTICAL: Dp = 1.dp

/** Minimum chip width when [showLabel] is set — web `min-w-[2.5rem]`. */
private val MIN_WIDTH_WITH_LABEL: Dp = 40.dp

/** Minimum chip width for the glyph-only badge — web `min-w-[1.5rem]` (the default). */
private val MIN_WIDTH_GLYPH_ONLY: Dp = 24.dp

/**
 * Stateful entry point — the faithful port of the web `SourceLayerBadge`. Records the one-shot `view.opened`
 * diagnostic and renders the tinted glyph + tooltip for [source]. Always renders (the web component never
 * returns `null`): a `null` / unrecognised [source] falls through to the muted "unknown" branch. Performs no
 * HTTP; [logger] defaults to the process logger.
 *
 * @param source the backend source-layer string (web `source`); `null` / unrecognised → the unknown badge.
 * @param ageMs the value's age in milliseconds (web `ageMs`); when present it is surfaced in the tooltip.
 * @param showLabel reserve the wider chip minimum width (web `showLabel`, default false → glyph-only width).
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 */
@Composable
fun SourceLayerBadge(
    source: String?,
    modifier: Modifier = Modifier,
    ageMs: Long? = null,
    showLabel: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SourceLayerBadgeDiagnostics.recordViewOpened(logger) }
    SourceLayerBadgeContent(
        source = source,
        modifier = modifier,
        ageMs = ageMs,
        showLabel = showLabel,
    )
}

/**
 * Stateless renderer for every surface state — the UI-test + preview entry point. Reduces [source] + [ageMs]
 * into a [SourceLayerProjection], maps the tint onto a per-theme colour, resolves the localized description +
 * "age" label, and draws the monospace glyph inside a tinted chip wrapped in the shared [Tooltip]. Collapses
 * the chip into one accessibility node that speaks the description (the glyph alone is decorative). Carries no
 * diagnostics, so a parent rendering many badges in a dense table never emits per-cell events and previews
 * stay deterministic.
 */
@Composable
fun SourceLayerBadgeContent(
    source: String?,
    modifier: Modifier = Modifier,
    ageMs: Long? = null,
    showLabel: Boolean = false,
) {
    val projection = remember(source, ageMs) { projectSourceLayerBadge(source, ageMs) }
    val description = sourceLayerDescription(projection)
    val colors = sourceLayerBadgeColors(projection.tint)
    val minWidth = if (showLabel) MIN_WIDTH_WITH_LABEL else MIN_WIDTH_GLYPH_ONLY

    Tooltip(text = description) {
        Surface(
            modifier = modifier.clearAndSetSemantics { contentDescription = description },
            shape = RoundedCornerShape(Radius.sm),
            color = colors.background,
            contentColor = colors.foreground,
            border = BorderStroke(1.dp, colors.border),
        ) {
            Box(
                modifier =
                    Modifier
                        .defaultMinSize(minWidth = minWidth)
                        .padding(horizontal = Spacing.xs, vertical = BADGE_PADDING_VERTICAL),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = projection.glyph,
                    style =
                        MaterialTheme.typography.labelSmall.copy(
                            fontFamily = FontFamily.Monospace,
                            letterSpacing = BADGE_LETTER_SPACING,
                        ),
                    color = colors.foreground,
                    maxLines = 1,
                )
            }
        }
    }
}

/** Foreground glyph/text + soft background + hairline border for the tinted chip. */
private data class SourceLayerBadgeColors(
    val foreground: Color,
    val background: Color,
    val border: Color,
)

/**
 * Map the projected [SourceLayerTint] onto a per-theme chip palette — the native mirror of the web tint rules
 * (success → green, info → blue, warning → amber, muted → on-surface-variant). The foreground colour comes
 * from the TeslaTokens status palette / the Material scheme; the soft fill + hairline border are alpha
 * derivations of it (web background 15 percent + border 30 percent), so light / dark / high-contrast stay legible.
 */
@Composable
@ReadOnlyComposable
private fun sourceLayerBadgeColors(tint: SourceLayerTint): SourceLayerBadgeColors {
    val foreground =
        when (tint) {
            SourceLayerTint.Success -> TeslaTokens.status.success
            SourceLayerTint.Info -> TeslaTokens.status.info
            SourceLayerTint.Warning -> TeslaTokens.status.warning
            SourceLayerTint.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    return SourceLayerBadgeColors(
        foreground = foreground,
        background = foreground.copy(alpha = BADGE_BACKGROUND_ALPHA),
        border = foreground.copy(alpha = BADGE_BORDER_ALPHA),
    )
}

/**
 * Resolve the tooltip + accessible description for the [projection] — the localized layer description, with
 * " ({age}: {ageText})" appended when an age is present (web `${desc} (${t('sourceLayer.age')}: ${ageText})`).
 * Both the per-layer description and the "age" label resolve through the shared P1/S10 catalog.
 */
@Composable
private fun sourceLayerDescription(projection: SourceLayerProjection): String {
    val desc = stringResource(sourceLayerDescriptionRes(projection.layer))
    val ageText = projection.ageText ?: return desc
    val ageLabel = stringResource(R.string.translation_sourceLayer_age)
    return "$desc ($ageLabel: $ageText)"
}

/** The P1/S10 catalog key for a [layer]'s description (web `style.descKey`). */
@StringRes
private fun sourceLayerDescriptionRes(layer: SignalSourceLayer): Int =
    when (layer) {
        SignalSourceLayer.L1 -> R.string.translation_sourceLayer_l1_desc
        SignalSourceLayer.L2 -> R.string.translation_sourceLayer_l2_desc
        SignalSourceLayer.Log -> R.string.translation_sourceLayer_log_desc
        SignalSourceLayer.Stale -> R.string.translation_sourceLayer_stale_desc
        SignalSourceLayer.Unknown -> R.string.translation_sourceLayer_unknown_desc
    }

// ── Previews (tooling-only; render settled frames, never shipped UI) ────────────────────────────────────────

@Preview(name = "Layers — l1 / l2 / log / stale / unknown", showBackground = true)
@Composable
private fun SourceLayerBadgeLayersPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SourceLayerBadgeContent(source = "l1")
            SourceLayerBadgeContent(source = "l2")
            SourceLayerBadgeContent(source = "log")
            SourceLayerBadgeContent(source = "stale")
            SourceLayerBadgeContent(source = null)
        }
    }
}

@Preview(name = "With age + showLabel width", showBackground = true)
@Composable
private fun SourceLayerBadgeAgePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                SourceLayerBadgeContent(source = "l1", ageMs = 850L)
                SourceLayerBadgeContent(source = "l2", ageMs = 4_200L)
                SourceLayerBadgeContent(source = "stale", ageMs = 200_000L)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                SourceLayerBadgeContent(source = "log", ageMs = 7_200_000L, showLabel = true)
                SourceLayerBadgeContent(source = "stale", showLabel = true)
            }
        }
    }
}

@Preview(name = "Stale (dark)", showBackground = true)
@Composable
private fun SourceLayerBadgeDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        SourceLayerBadgeContent(source = "stale", ageMs = 180_000L, showLabel = true)
    }
}
