// The native Jetpack Compose + Material 3 BatteryPill feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/BatteryPill.tsx. The web component renders a compact
// glass pill for one battery reading: a battery glyph tinted by the charge band, a two-line column holding
// the secondary label over the bold `{fmtInt(level)}%` value, and a right-aligned meter whose fill width is
// `min(level, 100)%`. The icon, value, and meter fill all share one color picked from `STATUS_COLORS`:
// green at `level >= 60`, amber at `level >= 30`, red below (web/src/lib/colors.ts).
//
// Every derivation flows through the pure [BatteryPillProjection]; the composable is a thin render layer.
// The surface binds no data hook and makes no `t()` call — the owning weekly-digest BatteryHealthSection
// supplies the already-localized [label] and the rounded [level] (web parity), so there are no English
// literals here. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Color + geometry mapping (P1/S9 tokens, no ported Tailwind): the web glass card maps to the shared native
// `GlassPanel`; the `STATUS_COLORS` hexes map to `TeslaTokens.status` (success/warning/danger carry the same
// #10b981 / #f59e0b / #ef4444 values); the `--surface-2` meter track maps to `colorScheme.surfaceVariant`;
// the web `gap-3` / `px-4` / `py-3` map to `Spacing.md` / `Spacing.lg` / `Spacing.md`; the `h-2 w-16` meter
// maps to 8.dp × 64.dp. The web `transition-all` on the fill maps to an `animateFloatAsState`, suppressed to
// an instant snap when the platform requests reduced motion (P1/S9 `rememberReducedMotion`). The whole pill
// is a single accessibility node that announces the label and value together (the icon and meter are
// decorative), so TalkBack reads one coherent phrase.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryPill) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterypill

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Geometry (web `h-5 w-5` icon, `h-2 w-16` meter, `gap-3` / `px-4` / `py-3` glass padding) ────────────
private val METER_HEIGHT: Dp = 8.dp
private val METER_WIDTH: Dp = 64.dp
private const val INSTANT_SNAP_MS = 0

/**
 * Stateful entry point — the faithful 1:1 port of the web `BatteryPill({ level, label })` props. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11) and renders the pill. The surface binds no
 * data of its own; the caller supplies the rounded [level] and the already-localized [label] (web parity).
 *
 * @param level the 0–100 state of charge (web `level`); rendered as the `{fmtInt(level)}%` value.
 * @param label the secondary caption above the value (web `label`), already localized by the caller.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryPill(
    level: Double,
    label: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BatteryPillDiagnostics.recordViewOpened(logger) }
    BatteryPillContent(level = level, label = label, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a glass
 * pill (web `GlassPanel`) holding a centered row of the tinted battery glyph, the label-over-value column,
 * and a right-aligned meter (web `ml-auto`). The icon/value/meter share one band color; the meter fill
 * animates on level change unless reduced motion is requested.
 */
@Composable
fun BatteryPillContent(
    level: Double,
    label: String,
    modifier: Modifier = Modifier,
) {
    val display = remember(level) { BatteryPillProjection.project(level) }
    val color = batteryStatusColor(display.status)
    val locale: Locale = LocalConfiguration.current.locales[0]
    val valueText = remember(level, locale) { BatteryPillProjection.percentLabel(level, locale) }
    val description = "$label $valueText"

    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.lg, vertical = Spacing.md)
                    .clearAndSetSemantics { contentDescription = description },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Icon(
                imageVector = DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Lg,
                tint = color,
            )
            Column {
                Caption(label)
                Text(
                    text = valueText,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                    color = color,
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            BatteryMeter(fraction = display.barFraction, color = color)
        }
    }
}

/**
 * The right-aligned charge meter — the web `h-2 w-16 rounded-full bg-[var(--surface-2)]` track with an inner
 * fill at `min(level, 100)%` width in the band color. The fill width animates on change (web `transition-all`)
 * and snaps instantly when reduced motion is requested.
 */
@Composable
private fun BatteryMeter(
    fraction: Float,
    color: Color,
) {
    val reduceMotion = rememberReducedMotion()
    val animated by animateFloatAsState(
        targetValue = fraction,
        animationSpec = tween(durationMillis = if (reduceMotion) INSTANT_SNAP_MS else MotionDurations.slow),
        label = "battery-pill-fill",
    )
    Box(
        modifier =
            Modifier
                .height(METER_HEIGHT)
                .width(METER_WIDTH)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(animated)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(color),
        )
    }
}

/** Maps a [BatteryStatus] band onto a P1/S9 design token — the web `STATUS_COLORS` good/warning/critical hexes. */
@Composable
private fun batteryStatusColor(status: BatteryStatus): Color =
    when (status) {
        BatteryStatus.Good -> TeslaTokens.status.success
        BatteryStatus.Warning -> TeslaTokens.status.warning
        BatteryStatus.Critical -> TeslaTokens.status.danger
    }

// ── Previews (tooling-only; @Preview entry points exercise each rendered band + an edge) ────────────────

private const val PREVIEW_LABEL_START = "Avg Battery at Charge Start"
private const val PREVIEW_LABEL_END = "Avg Battery at Charge End"

@Preview(name = "Good (≥60)", showBackground = true)
@Composable
private fun BatteryPillGoodPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryPillContent(level = 82.0, label = PREVIEW_LABEL_START)
    }
}

@Preview(name = "Warning (≥30)", showBackground = true)
@Composable
private fun BatteryPillWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryPillContent(level = 43.0, label = PREVIEW_LABEL_END)
    }
}

@Preview(name = "Critical (<30)", showBackground = true)
@Composable
private fun BatteryPillCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryPillContent(level = 12.0, label = PREVIEW_LABEL_END)
    }
}

@Preview(name = "Full (100)", showBackground = true)
@Composable
private fun BatteryPillFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryPillContent(level = 100.0, label = PREVIEW_LABEL_START)
    }
}
