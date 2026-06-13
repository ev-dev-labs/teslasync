// The native Jetpack Compose + Material 3 BatteryDelta shared surface — a parity port of
// web/src/components/data-display/BatteryDelta.tsx. The web surface is a compact, inline read-out of a
// battery state-of-charge change used by Drives (deltas are usually negative — the trip drained the pack)
// and Charging (usually positive — the session filled it): an optional battery glyph followed by either the
// signed delta ("−1%", "+12%", "—") or the legacy "79% → 78%" pair, tinted emerald on a rise, amber on a
// drop, and muted on zero / missing. It is pure presentational — the parent owns the two endpoints and the
// component's only hook is useTranslation.
//
// Every derivation flows through the pure [projectBatteryDelta] in BatteryDeltaModel.kt; this composable is
// a thin render layer that resolves the localized accessible label (P1/S10), maps the projected tone onto
// the per-theme TeslaTokens palette, lays out the shared `Icon` + label, and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11). It performs NO HTTP. Like the web `aria-label`, the whole read-out is
// collapsed into a single accessibility node carrying the spoken label, with the glyph marked decorative.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BatteryDelta) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.batterydelta

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** OpenType "tabular figures" — the native analogue of the web `tabular-nums` so the digits never jitter. */
private const val TABULAR_FIGURES: String = "tnum"

/**
 * Stateful entry point — the faithful port of the web `BatteryDelta`. Records the one-shot `view.opened`
 * diagnostic, then renders the read-out for the [startPct] → [endPct] change. Always renders (the web
 * component never returns `null`): missing / non-finite endpoints fall through to the muted "unknown"
 * branch. Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param startPct starting state-of-charge percentage (web `startPct`); `null` / non-finite → unknown.
 * @param endPct ending state-of-charge percentage (web `endPct`); `null` / non-finite → unknown.
 * @param showIcon whether to lead with the battery glyph (web `showIcon`, default `true`).
 * @param variant [BatteryDeltaVariant.Compact] (default) shows the delta; [BatteryDeltaVariant.Pair] the pair.
 */
@Composable
fun BatteryDelta(
    startPct: Double?,
    endPct: Double?,
    modifier: Modifier = Modifier,
    showIcon: Boolean = true,
    variant: BatteryDeltaVariant = BatteryDeltaVariant.Compact,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BatteryDeltaDiagnostics.recordViewOpened(logger) }
    BatteryDeltaContent(
        startPct = startPct,
        endPct = endPct,
        modifier = modifier,
        showIcon = showIcon,
        variant = variant,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reduces the endpoints
 * into a [BatteryDeltaProjection] and draws the glyph + tinted label, collapsing the row into one
 * accessibility node that speaks the localized label (web `aria-label` on the outer span, `aria-hidden` on
 * the icon). Carries no diagnostics, so a parent rendering many deltas in a list never emits per-item events.
 */
@Composable
fun BatteryDeltaContent(
    startPct: Double?,
    endPct: Double?,
    modifier: Modifier = Modifier,
    showIcon: Boolean = true,
    variant: BatteryDeltaVariant = BatteryDeltaVariant.Compact,
) {
    val projection = remember(startPct, endPct, variant) { projectBatteryDelta(startPct, endPct, variant) }
    val description = batteryDeltaContentDescription(projection.a11y)
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showIcon) {
            Icon(
                DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = projection.visibleLabel,
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TABULAR_FIGURES),
            color = batteryDeltaToneColor(projection.tone),
        )
    }
}

/**
 * Resolve the localized accessible label for the [a11y] descriptor — the native mirror of the web
 * `aria-label` (`battery.delta.unknown` for missing data, `battery.delta.aria` with the start/end
 * percentages otherwise). Both keys resolve through the P1/S10 catalog; no English literal lives here.
 */
@Composable
private fun batteryDeltaContentDescription(a11y: BatteryDeltaA11y): String =
    when (a11y) {
        BatteryDeltaA11y.Unknown -> stringResource(R.string.translation_battery_delta_unknown)
        is BatteryDeltaA11y.Known ->
            stringResource(R.string.translation_battery_delta_aria, a11y.fromPct, a11y.toPct)
    }

/**
 * Map the projected [BatteryDeltaTone] onto a per-theme colour — the native mirror of the web colour rules
 * (rise → emerald, drop → amber, zero / unknown → muted), drawn from the TeslaTokens status palette and the
 * Material scheme so light / dark / high-contrast all stay correct.
 */
@Composable
@ReadOnlyComposable
private fun batteryDeltaToneColor(tone: BatteryDeltaTone): Color =
    when (tone) {
        BatteryDeltaTone.Positive -> TeslaTokens.status.success
        BatteryDeltaTone.Negative -> TeslaTokens.status.warning
        BatteryDeltaTone.Neutral, BatteryDeltaTone.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

// ── Previews (tooling-only; sample percentages are never shipped UI) ──────────────────────────────────────

@Preview(name = "Charge (+), Drain (−), Flat (—), Unknown", showBackground = true)
@Composable
private fun BatteryDeltaCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BatteryDeltaContent(startPct = 20.0, endPct = 80.0)
            BatteryDeltaContent(startPct = 79.0, endPct = 78.0)
            BatteryDeltaContent(startPct = 80.0, endPct = 80.0)
            BatteryDeltaContent(startPct = null, endPct = 50.0)
        }
    }
}

@Preview(name = "Pair variant — 79% → 78%", showBackground = true)
@Composable
private fun BatteryDeltaPairPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryDeltaContent(startPct = 79.0, endPct = 78.0, variant = BatteryDeltaVariant.Pair)
    }
}

@Preview(name = "Charge — pair (dark)", showBackground = true)
@Composable
private fun BatteryDeltaPairDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        BatteryDeltaContent(startPct = 18.0, endPct = 90.0, variant = BatteryDeltaVariant.Pair)
    }
}
