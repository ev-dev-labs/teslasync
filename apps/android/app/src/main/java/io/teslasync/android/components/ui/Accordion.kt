package io.teslasync.android.components.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.Spacing

private const val CHEVRON_EXPANDED_ROTATION = 180f

/**
 * Collapsible section mirroring web `components/ui/Accordion`. Uncontrolled by default (seeded by
 * [initiallyExpanded]); pass both [expanded] and [onExpandedChange] for controlled mode. The
 * header toggles open/closed with an animated chevron and `Role.Button` semantics; the body
 * reveal is animated.
 */
@Composable
fun Accordion(
    title: String,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
    expanded: Boolean? = null,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    var internalOpen by remember { mutableStateOf(initiallyExpanded) }
    val open = expanded ?: internalOpen
    val setOpen: (Boolean) -> Unit = { next ->
        if (onExpandedChange != null) onExpandedChange(next) else internalOpen = next
    }
    val rotation by animateFloatAsState(
        targetValue = if (open) CHEVRON_EXPANDED_ROTATION else 0f,
        label = "accordion-chevron",
    )

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Button) { setOpen(!open) }
                        .padding(Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (leading != null) {
                    leading()
                    Spacer(Modifier.width(Spacing.sm))
                }
                PanelTitle(title, modifier = Modifier.weight(1f))
                Icon(TeslaGlyphs.ChevronDown, contentDescription = null, modifier = Modifier.rotate(rotation))
            }
            AnimatedVisibility(visible = open) {
                Column {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Column(modifier = Modifier.padding(Spacing.md), content = content)
                }
            }
        }
    }
}
