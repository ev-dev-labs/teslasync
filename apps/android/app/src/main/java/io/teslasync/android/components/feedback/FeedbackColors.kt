// File named after its primary @Composable resolvers; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaTokens

/*
 * Token-based color + glyph resolution for the feedback layer. Every semantic color comes from the
 * per-theme TeslaTokens.status palette or the Material 3 scheme — never a raw hex literal — so
 * light / dark / high-contrast all stay correct. Mirrors datadisplay/DataDisplayColors.
 */

/** Foreground + soft background / border tints for a banner/callout surface of a given [Tone]. */
data class ToneColors(
    val foreground: Color,
    val background: Color,
    val border: Color,
)

private const val BANNER_BG_ALPHA = 0.10f
private const val BANNER_BORDER_ALPHA = 0.28f

/** Per-theme foreground color for a [Tone]. */
@Composable
@ReadOnlyComposable
fun toneColor(tone: Tone): Color =
    when (tone) {
        Tone.Info -> TeslaTokens.status.info
        Tone.Success -> TeslaTokens.status.success
        Tone.Warning -> TeslaTokens.status.warning
        Tone.Danger -> TeslaTokens.status.danger
    }

/** Per-theme fg/bg/border tints for a banner or callout of the given [Tone]. */
@Composable
@ReadOnlyComposable
fun toneColors(tone: Tone): ToneColors {
    val fg = toneColor(tone)
    return ToneColors(
        foreground = fg,
        background = fg.copy(alpha = BANNER_BG_ALPHA),
        border = fg.copy(alpha = BANNER_BORDER_ALPHA),
    )
}

/** Default leading glyph for a [Tone] (callers may override). */
fun toneGlyph(tone: Tone): ImageVector =
    when (tone) {
        Tone.Info -> TeslaGlyphs.Info
        Tone.Success -> TeslaGlyphs.Check
        Tone.Warning -> TeslaGlyphs.Warning
        Tone.Danger -> TeslaGlyphs.Octagon
    }

/** Material scheme color for a [QueryErrorKind] icon/title (danger for hard failures). */
@Composable
@ReadOnlyComposable
fun queryErrorColor(kind: QueryErrorKind): Color =
    when (kind) {
        QueryErrorKind.Waiting -> TeslaTokens.status.warning
        QueryErrorKind.NotFound -> MaterialTheme.colorScheme.onSurfaceVariant
        QueryErrorKind.Unauthorized -> TeslaTokens.status.warning
        QueryErrorKind.ServerError -> TeslaTokens.status.danger
        QueryErrorKind.Offline -> MaterialTheme.colorScheme.onSurfaceVariant
        QueryErrorKind.Network -> TeslaTokens.status.danger
    }

/** Per-theme color for a job lifecycle [JobStatus] dot/icon. */
@Composable
@ReadOnlyComposable
fun jobStatusColor(status: JobStatus): Color =
    when (status) {
        JobStatus.Queued -> MaterialTheme.colorScheme.onSurfaceVariant
        JobStatus.Processing -> TeslaTokens.status.info
        JobStatus.Ready -> TeslaTokens.status.success
        JobStatus.Failed -> TeslaTokens.status.danger
        JobStatus.Expired -> TeslaTokens.status.warning
    }
