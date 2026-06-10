// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.ui.theme.generated.Spacing

/** A pill nav entry: a stable [key], a [label], and an optional leading [icon]. */
data class TabNavItem(
    val key: String,
    val label: String,
    val icon: ImageVector? = null,
)

/**
 * Pill-style scrollable navigation mirroring web `components/ui/TabNav`. Renders each entry as a
 * Material 3 [FilterChip] in a horizontally scrollable row, with the selected entry highlighted;
 * selecting fires [onSelect]. Use for in-page section switchers (the web's icon-pill bar).
 */
@Composable
fun TabNav(
    items: List<TabNavItem>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.forEach { item ->
            FilterChip(
                selected = item.key == selectedKey,
                onClick = { onSelect(item.key) },
                label = { Text(item.label) },
                leadingIcon =
                    item.icon?.let { glyph ->
                        { Icon(glyph, contentDescription = null, size = IconSize.Sm) }
                    },
            )
        }
    }
}
