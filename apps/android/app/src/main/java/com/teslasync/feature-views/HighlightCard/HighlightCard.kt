// The native Jetpack Compose + Material 3 HighlightCard feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/HighlightCard.tsx. The web component is purely
// presentational: its weekly-digest slide parents pass an `icon`, `label`, `value`, an optional `change`
// ({ value, positive }), an optional `subtitle`, and a `color` accent, and it renders a GlassPanel holding
// an icon+label line, a bold headline value, an optional colored trend line, and an optional muted subtitle.
// It binds NO data hook and reads NO i18n catalog of its own — every string arrives pre-localized as a prop.
//
// Because the surface has zero data sources, there is no loading / error / stale / offline lifecycle to
// render here — that lives on the owning slide/page (modelling it here would invent behaviour the spec does
// not have). What the web source genuinely varies, and what this port reproduces, is the optional change row
// (present/absent × positive/negative) and the optional subtitle. The card always shows at least the label
// and value, so it is never a blank box. Every derivation flows through the pure [HighlightCardProjection];
// the composable is a thin render layer.
//
// `color` parity: the web threads it through `glowMap` into GlassPanel's `glow`, but GlassPanel only emits
// the glow utilities under its `hover` prop (`hover && glowClasses[glow]`) and HighlightCard never sets
// `hover` — so the accent has no resting visual effect in the source and all five variants render as the
// same glass surface. We faithfully render the neutral panel for every accent (no resting glow) while still
// modelling + unit-testing `glowMap` in [HighlightCardProjection], matching the sibling ports' reproduce-the-
// source-quirk discipline. The five-key accent → design-token mapping is shared with ToolCard.
//
// Trend glyphs: the web uses lucide `TrendingUp` / `TrendingDown`. The shared `DataDisplayGlyphs` set ships
// only `TrendingDown` and lives outside this surface's allowed files, so the matched up/down pair is authored
// locally here as 24×24 stroked vectors — the same self-contained approach the sibling DrivingPerformanceCards
// surface takes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HighlightCard) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling ToolCard / AchievementBadge surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.highlightcard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LABEL_MAX_LINES = 1
private const val VALUE_MAX_LINES = 1
private const val SUBTITLE_MAX_LINES = 2
private const val CHANGE_MAX_LINES = 1

// Trend glyph footprint — web `h-3.5 w-3.5` (14px) maps to [IconSize.Sm].
private val TREND_ICON_SIZE = IconSize.Sm

/**
 * Stateful entry point — the faithful 1:1 port of the web `HighlightCard({ icon, label, value, change,
 * subtitle, color })` props. Records the one-shot PII-safe `view.opened` diagnostic on first composition
 * (P1/S11) and renders the card. The surface binds no data of its own; the caller supplies the already-
 * localized [label]/[value]/[change]/[subtitle] and the [icon] slot (web parity — the strings are localized
 * at the call site and the icon is a caller-provided node).
 *
 * @param label the secondary label shown beside the icon (web `label`).
 * @param value the bold headline value (web `value`).
 * @param icon the leading glyph (web `icon`, a ReactNode); decorative — tinted as the secondary text. `null`
 *   simply omits it, mirroring an absent React node.
 * @param change the optional trend indicator (web `change`); when `null` the trend row is skipped.
 * @param subtitle the optional caption (web `subtitle`); when `null`/empty the caption row is skipped.
 * @param color the accent key (web `color`, default `cyan`); see [HighlightColor].
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun HighlightCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    change: HighlightChange? = null,
    subtitle: String? = null,
    color: HighlightColor = HighlightColor.Cyan,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HighlightCardDiagnostics.recordViewOpened(logger) }
    HighlightCardContent(
        label = label,
        value = value,
        modifier = modifier,
        icon = icon,
        change = change,
        subtitle = subtitle,
        color = color,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout exactly: a
 * [GlassPanel] (web `p-5`, `flex flex-col gap-2`) holding the icon+label line, the bold value, the optional
 * trend line, and the optional subtitle. The accent never tints the resting panel (web parity — the glow is
 * gated behind GlassPanel's unused `hover` prop), so the panel is always the neutral glass surface. The whole
 * card merges into a single accessibility node so TalkBack announces it as one phrase.
 */
@Composable
fun HighlightCardContent(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    change: HighlightChange? = null,
    subtitle: String? = null,
    color: HighlightColor = HighlightColor.Cyan,
) {
    val display =
        remember(label, value, color, change, subtitle) {
            HighlightCardProjection.project(label, value, color, change, subtitle)
        }
    val description = rememberHighlightDescription(display)

    GlassPanel(modifier = modifier, padding = PanelPadding.None, accent = PanelAccent.None) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.xl)
                    .semantics(mergeDescendants = true) { contentDescription = description },
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            HighlightLabelRow(label = display.label, icon = icon)
            Text(
                text = display.value,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = VALUE_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
            display.change?.let { HighlightChangeRow(change = it) }
            display.subtitle?.let { subtitleText ->
                Text(
                    text = subtitleText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outlineVariant,
                    maxLines = SUBTITLE_MAX_LINES,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * The icon+label line — web `flex items-center gap-2 text-sm text-[var(--text-secondary)]`. The icon inherits
 * the secondary text color (the web icon inherits the span's color) and is decorative; the [label] carries
 * the meaning.
 */
@Composable
private fun HighlightLabelRow(
    label: String,
    icon: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
                icon()
            }
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = LABEL_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The trend line — web `flex items-center gap-1 text-xs font-medium` colored `text-emerald-400` (up) or
 * `text-red-400` (down), with a leading TrendingUp/TrendingDown glyph. The glyph is decorative (the colored
 * value text and the merged card description carry the meaning), so it exposes no content description.
 */
@Composable
private fun HighlightChangeRow(change: HighlightChange) {
    val tint = if (change.positive) TeslaTokens.status.success else TeslaTokens.status.danger
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (change.positive) TrendingUpGlyph else TrendingDownGlyph,
            contentDescription = null,
            size = TREND_ICON_SIZE,
            tint = tint,
        )
        Text(
            text = change.value,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = tint,
            maxLines = CHANGE_MAX_LINES,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Builds the merged accessibility phrase from the already-localized, visible fields (label, value, optional
 * change, optional subtitle). No new catalog key is introduced — the web trend glyph is itself decorative, so
 * the direction is conveyed by the caller's change text, exactly as on the web.
 */
@Composable
private fun rememberHighlightDescription(display: HighlightCardDisplay): String =
    remember(display) {
        listOfNotNull(display.label, display.value, display.change?.value, display.subtitle)
            .joinToString(separator = ", ")
    }

// ── Local trend glyphs (lucide TrendingUp / TrendingDown), authored as 24×24 stroked vectors ────────────

/** Web lucide `trending-up`: an upward zig-zag with an arrowhead at the top-right. */
private val TrendingUpGlyph: ImageVector =
    trendGlyph("TrendingUp") {
        moveTo(4f, 17f)
        lineTo(11f, 10f)
        lineTo(14f, 13f)
        lineTo(20f, 7f)
        moveTo(15f, 7f)
        lineTo(20f, 7f)
        lineTo(20f, 12f)
    }

/** Web lucide `trending-down`: a downward zig-zag with an arrowhead at the bottom-right. */
private val TrendingDownGlyph: ImageVector =
    trendGlyph("TrendingDown") {
        moveTo(4f, 7f)
        lineTo(11f, 14f)
        lineTo(14f, 11f)
        lineTo(20f, 17f)
        moveTo(15f, 17f)
        lineTo(20f, 17f)
        lineTo(20f, 12f)
    }

private fun trendGlyph(
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

// ── Previews (tooling-only; each @Preview exercises a render branch) ─────────────────────────────────────

@Composable
private fun previewIcon(): @Composable () -> Unit =
    { Icon(imageVector = DataDisplayGlyphs.Bolt, contentDescription = null, size = IconSize.Md) }

@Preview(name = "Cyan — positive change + subtitle", showBackground = true)
@Composable
private fun HighlightCardCyanPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HighlightCardContent(
            label = "Avg Efficiency",
            value = "248 Wh/mi",
            icon = previewIcon(),
            change = HighlightChange(value = "+6% vs last week", positive = true),
            subtitle = "Across 12 drives",
            color = HighlightColor.Cyan,
        )
    }
}

@Preview(name = "Green — negative change", showBackground = true)
@Composable
private fun HighlightCardGreenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HighlightCardContent(
            label = "Energy Used",
            value = "63.4 kWh",
            icon = previewIcon(),
            change = HighlightChange(value = "-4% vs last week", positive = false),
            color = HighlightColor.Green,
        )
    }
}

@Preview(name = "Purple — subtitle only", showBackground = true)
@Composable
private fun HighlightCardPurplePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HighlightCardContent(
            label = "Longest Drive",
            value = "412 km",
            icon = previewIcon(),
            subtitle = "Reno → San Jose",
            color = HighlightColor.Purple,
        )
    }
}

@Preview(name = "Amber — label + value only", showBackground = true)
@Composable
private fun HighlightCardAmberPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HighlightCardContent(
            label = "Peak Power",
            value = "311 kW",
            icon = previewIcon(),
            color = HighlightColor.Amber,
        )
    }
}

@Preview(name = "Red — no icon, positive change", showBackground = true)
@Composable
private fun HighlightCardRedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HighlightCardContent(
            label = "Phantom Drain",
            value = "1.8%/day",
            change = HighlightChange(value = "+0.3% vs last week", positive = true),
            color = HighlightColor.Red,
        )
    }
}
