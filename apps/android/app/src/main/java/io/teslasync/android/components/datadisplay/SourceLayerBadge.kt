// File named after its primary @Composable; the co-located enum/functions are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/** Layer a live signal value was satisfied from (FSM debugger / signal diff). */
enum class SignalSourceLayer { L1, L2, Log, Stale, Unknown }

/** Parses the backend source-layer string onto [SignalSourceLayer]; unknown values are tolerated. */
fun parseSourceLayer(raw: String?): SignalSourceLayer =
    when (raw?.trim()?.lowercase()) {
        "l1" -> SignalSourceLayer.L1
        "l2" -> SignalSourceLayer.L2
        "log" -> SignalSourceLayer.Log
        "stale" -> SignalSourceLayer.Stale
        else -> SignalSourceLayer.Unknown
    }

/** Short chip label for a [layer] (matches the web glyphs). */
fun sourceLayerLabel(layer: SignalSourceLayer): String =
    when (layer) {
        SignalSourceLayer.L1 -> "L1"
        SignalSourceLayer.L2 -> "L2"
        SignalSourceLayer.Log -> "LOG"
        SignalSourceLayer.Stale -> "STALE"
        SignalSourceLayer.Unknown -> "\u2014"
    }

/** Human-readable age for a value in milliseconds; `null` when missing / non-finite. */
fun formatSourceAgeMs(
    ageMs: Long?,
    locale: Locale = Locale.getDefault(),
): String? {
    if (ageMs == null || ageMs < 0L) return null
    return when {
        ageMs < 1_000L -> "$ageMs ms"
        ageMs < 60_000L -> "${String.format(locale, "%.1f", ageMs / 1_000.0)} s"
        ageMs < 3_600_000L -> "${ageMs / 60_000L} min"
        ageMs < 86_400_000L -> "${String.format(locale, "%.1f", ageMs / 3_600_000.0)} h"
        else -> "${String.format(locale, "%.1f", ageMs / 86_400_000.0)} d"
    }
}

/**
 * Debugger-only badge showing where a signal value came from — the Android counterpart of the web
 * `SourceLayerBadge`. The layered live-state contract distinguishes the L1 in-process store, the
 * L2 Redis cache, durable signal_log replay, and stale Redis values. Pass [description] (localized)
 * to surface the layer meaning to TalkBack; [ageMs] is appended when present.
 */
@Composable
fun SourceLayerBadge(
    source: String?,
    modifier: Modifier = Modifier,
    ageMs: Long? = null,
    description: String? = null,
) {
    val layer = parseSourceLayer(source)
    val colors = sourceLayerChipColors(layer)
    val ageText = formatSourceAgeMs(ageMs)
    val semantic =
        listOfNotNull(description ?: sourceLayerLabel(layer), ageText?.let { "($it)" }).joinToString(" ")
    Surface(
        modifier = modifier.clearAndSetSemantics { contentDescription = semantic },
        shape = RoundedCornerShape(Radius.sm),
        color = colors.background,
        contentColor = colors.foreground,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Text(
            sourceLayerLabel(layer),
            modifier = Modifier.padding(horizontal = Spacing.xs, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
            color = colors.foreground,
        )
    }
}
