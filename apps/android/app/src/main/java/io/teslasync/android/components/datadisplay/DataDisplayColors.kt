// File named after its primary @Composable resolvers; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import io.teslasync.android.ui.theme.TeslaTokens

/*
 * Token-based color resolution for the data-display layer. Every semantic color comes from the
 * per-theme TeslaTokens.status palette or the Material 3 scheme — never a raw hex literal in
 * component code — so light / dark / high-contrast all stay correct. Mirrors charts/ChartColors.
 */

/** Foreground + soft background / border / dot tints for a chip-style status surface. */
data class StatusChipColors(
    val foreground: Color,
    val background: Color,
    val border: Color,
    val dot: Color,
)

private const val CHIP_BG_ALPHA = 0.14f
private const val CHIP_BORDER_ALPHA = 0.32f

private fun chip(foreground: Color): StatusChipColors =
    StatusChipColors(
        foreground = foreground,
        background = foreground.copy(alpha = CHIP_BG_ALPHA),
        border = foreground.copy(alpha = CHIP_BORDER_ALPHA),
        dot = foreground,
    )

/** Per-theme foreground color for a canonical [Severity]. */
@Composable
@ReadOnlyComposable
fun severityColor(severity: Severity): Color =
    when (severity) {
        Severity.Info -> TeslaTokens.status.info
        Severity.Warn -> TeslaTokens.status.warning
        Severity.Critical -> TeslaTokens.status.danger
        Severity.Success -> TeslaTokens.status.success
    }

/** Per-theme chip colors (fg/bg/border/dot) for a [Severity]. */
@Composable
@ReadOnlyComposable
fun severityChipColors(severity: Severity): StatusChipColors = chip(severityColor(severity))

/** Per-theme text color for a letter [grade] (shared by ScoreBadge + DriveScore). */
@Composable
@ReadOnlyComposable
fun gradeColor(grade: ScoreGrade): Color =
    when (grade) {
        ScoreGrade.APlus, ScoreGrade.A -> TeslaTokens.status.success
        ScoreGrade.B -> TeslaTokens.status.info
        ScoreGrade.C -> TeslaTokens.status.warning
        ScoreGrade.D, ScoreGrade.F -> TeslaTokens.status.danger
        ScoreGrade.None -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Per-theme dot/text color for a per-datum [FreshnessStatus]. */
@Composable
@ReadOnlyComposable
fun freshnessColor(status: FreshnessStatus): Color =
    when (status) {
        FreshnessStatus.Fresh -> TeslaTokens.status.success
        FreshnessStatus.Stale -> TeslaTokens.status.warning
        FreshnessStatus.Offline -> TeslaTokens.status.danger
        FreshnessStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Per-theme color for a query freshness tier. */
@Composable
@ReadOnlyComposable
fun queryFreshnessColor(status: QueryFreshness): Color =
    when (status) {
        QueryFreshness.Fresh -> TeslaTokens.status.success
        QueryFreshness.Fetching -> TeslaTokens.status.info
        QueryFreshness.Stale -> TeslaTokens.status.warning
        QueryFreshness.Error -> TeslaTokens.status.danger
    }

/** Per-theme color for the live-connection status surfaced by LiveIndicator. */
@Composable
@ReadOnlyComposable
fun liveConnectionColor(status: LiveConnectionStatus): Color =
    when (status) {
        LiveConnectionStatus.Connected -> TeslaTokens.status.success
        LiveConnectionStatus.Reconnecting -> TeslaTokens.status.warning
        LiveConnectionStatus.Disconnected -> TeslaTokens.status.danger
        LiveConnectionStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Per-theme text color for a delta tone. */
@Composable
@ReadOnlyComposable
fun deltaToneColor(tone: DeltaTone): Color =
    when (tone) {
        DeltaTone.Good -> TeslaTokens.status.success
        DeltaTone.Bad -> TeslaTokens.status.danger
        DeltaTone.Neutral -> MaterialTheme.colorScheme.onSurface
        DeltaTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Per-theme color for a battery state-of-charge trend. */
@Composable
@ReadOnlyComposable
fun batteryTrendColor(trend: BatteryTrend): Color =
    when (trend) {
        BatteryTrend.Charge -> TeslaTokens.status.success
        BatteryTrend.Drain -> TeslaTokens.status.warning
        BatteryTrend.Flat -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Per-theme chip colors for a signal source layer (FSM debugger / signal diff). */
@Composable
@ReadOnlyComposable
fun sourceLayerChipColors(layer: SignalSourceLayer): StatusChipColors =
    when (layer) {
        SignalSourceLayer.L1 -> chip(TeslaTokens.status.success)
        SignalSourceLayer.L2 -> chip(TeslaTokens.status.info)
        SignalSourceLayer.Log -> chip(MaterialTheme.colorScheme.onSurfaceVariant)
        SignalSourceLayer.Stale -> chip(TeslaTokens.status.warning)
        SignalSourceLayer.Unknown -> chip(MaterialTheme.colorScheme.onSurfaceVariant)
    }

/** Per-theme color for a 0–100 score tone (Good / Warn / Bad). */
@Composable
@ReadOnlyComposable
fun scoreToneColor(tone: ScoreTone): Color =
    when (tone) {
        ScoreTone.Good -> TeslaTokens.status.success
        ScoreTone.Warn -> TeslaTokens.status.warning
        ScoreTone.Bad -> TeslaTokens.status.danger
    }
