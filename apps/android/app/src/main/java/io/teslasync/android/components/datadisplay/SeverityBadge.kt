// File named after its primary @Composable; the co-located enum/function are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Chip size for [SeverityBadge]. */
enum class ChipSize { Sm, Md }

/** Canonical Lucide-equivalent glyph for a [Severity] (matches the web icon mapping). */
fun severityGlyph(severity: Severity): ImageVector =
    when (severity) {
        Severity.Info -> DataDisplayGlyphs.Info
        Severity.Warn -> DataDisplayGlyphs.AlertTriangle
        Severity.Critical -> DataDisplayGlyphs.AlertOctagon
        Severity.Success -> DataDisplayGlyphs.CheckCircle
    }

/**
 * Severity chip with an optional icon and label — the Android counterpart of the web
 * `SeverityBadge`. Any wire severity is normalized via [normalizeSeverity]; the label defaults to
 * the canonical severity name and can be overridden (e.g. localized) via [label].
 */
@Composable
fun SeverityBadge(
    severity: String?,
    modifier: Modifier = Modifier,
    showIcon: Boolean = true,
    size: ChipSize = ChipSize.Md,
    label: String? = null,
) {
    val canonical = normalizeSeverity(severity)
    val colors = severityChipColors(canonical)
    val text = label ?: canonical.name.lowercase()
    val iconSize = if (size == ChipSize.Sm) IconSize.Xs else IconSize.Sm
    val textStyle = if (size == ChipSize.Sm) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium
    val vertical = if (size == ChipSize.Sm) 2.dp else Spacing.xs
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = colors.background,
        contentColor = colors.foreground,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = vertical),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (showIcon) Icon(severityGlyph(canonical), contentDescription = null, size = iconSize, tint = colors.foreground)
            Text(text, style = textStyle, color = colors.foreground)
        }
    }
}
