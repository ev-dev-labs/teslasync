// The native Jetpack Compose + Material 3 MetricCard shared surface — a parity port of the web compact
// metric tile web/src/components/data-display/MetricCard.tsx, together with the pieces it composes: the
// neon `color` token (web lib/tokens.ts `neonColorMap`), the inline `HelpTooltip` (web
// components/ui/HelpTooltip.tsx), and the embedded `<Delta>` (web components/data-display/Delta.tsx).
//
// [MetricCard] is the stateful entry: it records the one-shot `view.opened` diagnostic (P1/S11), projects
// its render parameters with the pure [MetricCardProjection.project], and paints the result through the
// stateless [MetricCardContent] (the test / preview entry point). The faithful mapping of the web layout:
//   * the card chrome (web `rounded-xl bg-white/[0.02] border`) → the shared [Card];
//   * the label + optional inline help "?" (web `metric-label … flex items-center gap-1` + `<HelpTooltip>`)
//     → [MetricCardLabelRow] over [MetricLabel] + [HelpIcon];
//   * the value (web `text-xl font-bold`) → [MetricValue]; the subtitle (web `text-[var(--text-muted)]`)
//     → [HelperText];
//   * the footer — exactly one of nothing, the legacy change pill (web `change && !delta`), or the delta
//     (web `<Delta current={deltaCurrent}>`) → [MetricCardFooterContent]. The delta is delegated to the
//     SHIPPED Delta shared surface, which binds the user's unit preferences through the shared settings
//     state holder (P1/S8) exactly as the web `<Delta>` reads `useUnits` / `useFormatting`;
//   * the neon accent icon box (web `ring-1` + `c.bg` / `c.ring` + `c.text`) → [MetricCardIconBox], whose
//     accent comes from [accentColor] — a theme token per variant, never a raw hex, so light / dark /
//     high-contrast stay correct.
// The only i18n key the card owns is the help trigger's accessible label, resolved from the shared P1/S10
// catalog (`translation_help_tooltip_iconLabel`, the web `help.tooltip.iconLabel`); the label, value,
// subtitle, help body, and compare-window labels are all caller-supplied, so no English literal lives in
// this file. The accent icon and the change-pill arrow are decorative (the label / value carry the
// meaning, the arrow's sign is already in the tint), so they are skipped by accessibility services.
//
// There is no data feed behind the card itself (it is handed a finished value), so — like the accepted
// VisuallyHidden / AnimatedNumber / Delta presentational ports — it has no loading / empty / error / stale
// / offline lifecycle of its own; the one "loading" notion belongs to the embedded delta and is forwarded
// verbatim. It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/MetricCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metriccard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.delta.Delta
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered card — used by the instrumented per-state + a11y UI tests. */
const val METRIC_CARD_TEST_TAG: String = "metric-card"

/** Test tag identifying the legacy change pill (web `change && !delta`). */
const val METRIC_CARD_CHANGE_TEST_TAG: String = "metric-card-change"

/** Test tag identifying the delta footer slot (web `<Delta>`). */
const val METRIC_CARD_DELTA_TEST_TAG: String = "metric-card-delta"

/** The up-arrow glyph for a positive legacy change (web `'↑'`). */
private const val ARROW_UP: String = "\u2191"

/** The down-arrow glyph for a negative legacy change (web `'↓'`). */
private const val ARROW_DOWN: String = "\u2193"

/** Background wash alpha for the accent icon box (web `c.bg` ~10% neon). */
private const val ACCENT_BG_ALPHA: Float = 0.16f

/** Ring alpha for the accent icon box (web `c.ring` ~20% neon). */
private const val ACCENT_RING_ALPHA: Float = 0.32f

/**
 * Stateful entry point — the faithful port of the web `MetricCard`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), projects the caller's parameters with the pure [MetricCardProjection.project], and
 * paints the result. The delta footer (when present) is delegated to the shipped Delta shared surface,
 * which resolves the user's unit preferences through the shared settings state holder (P1/S8) — the view
 * performs no work of its own.
 *
 * @param label the metric name (web `label`).
 * @param value the metric value, a number or an already-formatted string (web `value`).
 * @param modifier optional layout modifier for the card.
 * @param icon optional leading accent glyph (web `icon`); decorative unless [iconContentDescription] names it.
 * @param iconContentDescription optional accessible name for the accent [icon]; `null` keeps it decorative.
 * @param accent the neon accent (web `color`), defaulting to cyan.
 * @param subtitle optional muted line under the value (web `subtitle`).
 * @param change optional legacy change pill, shown only when [delta] is absent (web `change && !delta`).
 * @param delta optional direction-aware delta forwarded to the embedded Delta surface (web `delta`).
 * @param help optional contextual help affordance next to the label (web `help`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun MetricCard(
    label: String,
    value: MetricCardValue,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    iconContentDescription: String? = null,
    accent: MetricCardAccent = MetricCardAccent.Cyan,
    subtitle: String? = null,
    change: MetricCardChange? = null,
    delta: MetricCardDeltaSpec? = null,
    help: MetricCardHelp? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MetricCardDiagnostics.recordViewOpened(logger) }
    val projection =
        MetricCardProjection.project(
            MetricCardInput(
                label = label,
                value = value,
                accent = accent,
                subtitle = subtitle,
                change = change,
                delta = delta,
                help = help,
            ),
        )
    MetricCardContent(
        projection = projection,
        modifier = modifier,
        icon = icon,
        iconContentDescription = iconContentDescription,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected card: the label
 * (with optional inline help), the value, the optional subtitle, the optional footer (nothing / change
 * pill / delta), and the optional accent icon box. Every branch renders a non-blank tile (never a hidden
 * surface) so the P3 "every state renders" contract holds. [renderDelta] is the delta footer slot — it
 * defaults to the shipped Delta surface and is overridden by tests / previews that cannot host the Delta
 * view-model.
 */
@Composable
fun MetricCardContent(
    projection: MetricCardProjection,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    iconContentDescription: String? = null,
    renderDelta: @Composable (MetricCardFooter.DeltaFooter) -> Unit = { DefaultMetricCardDelta(it) },
) {
    Card(modifier = modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Column(modifier = Modifier.weight(1f)) {
                MetricCardLabelRow(label = projection.label, help = projection.help)
                MetricValue(projection.displayValue, modifier = Modifier.padding(top = Spacing.xs))
                if (projection.subtitle != null) {
                    HelperText(projection.subtitle, modifier = Modifier.padding(top = Spacing.xs))
                }
                MetricCardFooterContent(footer = projection.footer, renderDelta = renderDelta)
            }
            if (icon != null) {
                MetricCardIconBox(icon = icon, accent = projection.accent, contentDescription = iconContentDescription)
            }
        }
    }
}

/**
 * The label row — the metric name plus the optional inline help "?" (web `metric-label flex items-center
 * gap-1`). The help trigger speaks its localized accessible label (the caller's override, else the shared
 * `translation_help_tooltip_iconLabel`), so a screen-reader user can reach the explanation.
 */
@Composable
private fun MetricCardLabelRow(
    label: String,
    help: MetricCardHelp?,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(label, modifier = Modifier.weight(1f, fill = false))
        if (help != null) {
            val description = help.contentDescription ?: stringResource(R.string.translation_help_tooltip_iconLabel)
            HelpIcon(text = help.helpText, contentDescription = description, size = IconSize.Xs)
        }
    }
}

/**
 * The footer slot — paints exactly one branch (web's mutually-exclusive change/delta region): nothing, the
 * legacy change pill, or the delta (delegated to [renderDelta]). Each non-empty branch is separated from
 * the value by the same top inset the web `mt-1` applies.
 */
@Composable
private fun MetricCardFooterContent(
    footer: MetricCardFooter,
    renderDelta: @Composable (MetricCardFooter.DeltaFooter) -> Unit,
) {
    when (footer) {
        MetricCardFooter.None -> Unit
        is MetricCardFooter.ChangePill ->
            MetricCardChangePill(pill = footer, modifier = Modifier.padding(top = Spacing.xs))
        is MetricCardFooter.DeltaFooter ->
            Box(modifier = Modifier.padding(top = Spacing.xs)) { renderDelta(footer) }
    }
}

/**
 * The legacy change pill (web `<p class="… font-medium {positive?emerald:rose}">{↑|↓} {value}</p>`). The
 * arrow glyph encodes the direction and the tint (success / danger token) reinforces it; the formatted
 * change text is caller-supplied.
 */
@Composable
private fun MetricCardChangePill(
    pill: MetricCardFooter.ChangePill,
    modifier: Modifier = Modifier,
) {
    val glyph = if (pill.positive) ARROW_UP else ARROW_DOWN
    val color = if (pill.positive) TeslaTokens.status.success else TeslaTokens.status.danger
    Text(
        text = "$glyph ${pill.text}",
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
        color = color,
        modifier = modifier,
    )
}

/**
 * The neon accent icon box (web `flex … rounded-lg p-1.5 ring-1 {c.bg} {c.ring}` wrapping `{c.text}`
 * icon). The wash + ring derive from the accent token; the glyph is tinted with the full accent. The icon
 * is decorative unless [contentDescription] names it, since the label / value already convey the metric.
 */
@Composable
private fun MetricCardIconBox(
    icon: ImageVector,
    accent: MetricCardAccent,
    contentDescription: String?,
) {
    val color = accentColor(accent)
    Box(
        modifier =
            Modifier
                .background(color.copy(alpha = ACCENT_BG_ALPHA), RoundedCornerShape(Radius.md))
                .border(1.dp, color.copy(alpha = ACCENT_RING_ALPHA), RoundedCornerShape(Radius.md))
                .padding(Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, size = IconSize.Md, tint = color)
    }
}

/**
 * The shipped delta footer — delegates to the [io.teslasync.android.sharedsurfaces.delta.Delta] shared
 * surface (web `<Delta {...delta} current={deltaCurrent} />`), forwarding the projected `current` and the
 * forwarded spec. The Delta surface owns its own settings binding + diagnostics, so the user's unit
 * preferences flow in without this card knowing how they are stored.
 */
@Composable
private fun DefaultMetricCardDelta(footer: MetricCardFooter.DeltaFooter) {
    val spec = footer.spec
    Delta(
        current = footer.current,
        previous = spec.previous,
        metric = spec.metric,
        display = spec.display,
        comparedTo = spec.comparedTo,
        size = spec.size,
        hideArrow = spec.hideArrow,
        loading = spec.loading,
        precision = spec.precision,
    )
}

/**
 * Resolves the neon [accent] (web `NeonColor`) to a theme token — never a raw hex, so every theme stays
 * correct. Cyan / green / red / amber map onto the semantic status palette (the web neon-cyan / -green /
 * -red / -amber hues); purple and blue map onto the chart power / speed series, the closest brand hues to
 * the web neon-purple / -blue.
 */
@Composable
@ReadOnlyComposable
private fun accentColor(accent: MetricCardAccent): Color =
    when (accent) {
        MetricCardAccent.Cyan -> TeslaTokens.status.info
        MetricCardAccent.Green -> TeslaTokens.status.success
        MetricCardAccent.Red -> TeslaTokens.status.danger
        MetricCardAccent.Amber -> TeslaTokens.status.warning
        MetricCardAccent.Purple -> TeslaTokens.chart.power
        MetricCardAccent.Blue -> TeslaTokens.chart.speed
    }

// ── Previews (tooling-only; sample values are never shipped UI) ──────────────────────────────────────

@Preview(name = "MetricCard — value only", showBackground = true)
@Composable
private fun MetricCardValueOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricCardContent(projection = MetricCardProjection.project(MetricCardInput("Trips", MetricCardValue.Numeric(128.0))))
    }
}

@Preview(name = "MetricCard — icon + subtitle (purple)", showBackground = true)
@Composable
private fun MetricCardIconPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricCardContent(
            projection =
                MetricCardProjection.project(
                    MetricCardInput(
                        label = "Avg Power",
                        value = MetricCardValue.Text("142 kW"),
                        accent = MetricCardAccent.Purple,
                        subtitle = "last 30 days",
                    ),
                ),
            icon = TeslaGlyphs.Info,
        )
    }
}

@Preview(name = "MetricCard — help + positive change", showBackground = true)
@Composable
private fun MetricCardChangePositivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MetricCardContent(
            projection =
                MetricCardProjection.project(
                    MetricCardInput(
                        label = "Efficiency",
                        value = MetricCardValue.Text("248 Wh/mi"),
                        accent = MetricCardAccent.Green,
                        help = MetricCardHelp(helpText = "Energy used per mile over the period."),
                        change = MetricCardChange(value = "4.2%", positive = true),
                    ),
                ),
        )
    }
}

@Preview(name = "MetricCard — negative change (dark)", showBackground = true)
@Composable
private fun MetricCardChangeNegativePreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        MetricCardContent(
            projection =
                MetricCardProjection.project(
                    MetricCardInput(
                        label = "Range",
                        value = MetricCardValue.Text("301 mi"),
                        accent = MetricCardAccent.Red,
                        change = MetricCardChange(value = "12 mi", positive = false),
                    ),
                ),
        )
    }
}
