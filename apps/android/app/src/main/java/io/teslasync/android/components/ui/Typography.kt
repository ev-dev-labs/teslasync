// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

/**
 * Semantic typography wrappers mirroring web `components/ui/Typography`. Each role binds a
 * [MaterialTheme.typography] slot and a scheme color so callers never hand-pick `fontSize`
 * or `Color`, keeping light/dark/high-contrast consistent. Roles map onto the generated
 * (tokens.json) type ramp from P3/A1.
 */
enum class HeadingLevel { Page, Section, Panel, Sub }

@Composable
fun Heading(
    text: String,
    modifier: Modifier = Modifier,
    level: HeadingLevel = HeadingLevel.Section,
    color: Color = MaterialTheme.colorScheme.onSurface,
    maxLines: Int = Int.MAX_VALUE,
) {
    val style =
        when (level) {
            HeadingLevel.Page -> MaterialTheme.typography.titleLarge
            HeadingLevel.Section -> MaterialTheme.typography.titleMedium
            HeadingLevel.Panel -> MaterialTheme.typography.titleSmall
            HeadingLevel.Sub -> MaterialTheme.typography.labelLarge
        }
    RoleText(text, style.copy(fontWeight = FontWeight.SemiBold), color, modifier, maxLines)
}

@Composable
fun PageTitle(
    text: String,
    modifier: Modifier = Modifier,
) = Heading(text, modifier, HeadingLevel.Page)

@Composable
fun SectionTitle(
    text: String,
    modifier: Modifier = Modifier,
) = Heading(text, modifier, HeadingLevel.Section)

@Composable
fun PanelTitle(
    text: String,
    modifier: Modifier = Modifier,
) = Heading(text, modifier, HeadingLevel.Panel)

@Composable
fun Subhead(
    text: String,
    modifier: Modifier = Modifier,
) = Heading(text, modifier, HeadingLevel.Sub)

@Composable
fun BodyText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    maxLines: Int = Int.MAX_VALUE,
) = RoleText(text, MaterialTheme.typography.bodyMedium, color, modifier, maxLines)

@Composable
fun Caption(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(text, MaterialTheme.typography.labelMedium, MaterialTheme.colorScheme.onSurfaceVariant, modifier)

@Composable
fun HelperText(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(text, MaterialTheme.typography.bodySmall, MaterialTheme.colorScheme.onSurfaceVariant, modifier)

@Composable
fun ErrorText(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(text, MaterialTheme.typography.bodySmall, MaterialTheme.colorScheme.error, modifier)

@Composable
fun FieldLabelText(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(text, MaterialTheme.typography.labelLarge, MaterialTheme.colorScheme.onSurfaceVariant, modifier)

@Composable
fun MetricValue(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(
    text,
    MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
    MaterialTheme.colorScheme.onSurface,
    modifier,
)

@Composable
fun MetricLabel(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(text, MaterialTheme.typography.labelSmall, MaterialTheme.colorScheme.onSurfaceVariant, modifier)

@Composable
fun CodeText(
    text: String,
    modifier: Modifier = Modifier,
) = RoleText(
    text,
    MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
    MaterialTheme.colorScheme.onSurface,
    modifier,
)

@Composable
private fun RoleText(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text = text,
        modifier = modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}
