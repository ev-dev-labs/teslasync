// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/** One row in a [ContextMenu]. [destructive] tints the label with the error color. */
data class ContextMenuItem(
    val label: String,
    val onClick: () -> Unit,
    val enabled: Boolean = true,
    val destructive: Boolean = false,
    val leadingIcon: ImageVector? = null,
)

/**
 * Context menu mirroring web `components/ui/ContextMenu`, built on Material 3 [DropdownMenu]
 * (which provides keyboard roving focus, Esc/back dismissal, and `Role.DropdownList` semantics).
 * Selecting an enabled item fires its `onClick` and dismisses the menu.
 */
@Composable
fun ContextMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    items: List<ContextMenuItem>,
    modifier: Modifier = Modifier,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest, modifier = modifier) {
        items.forEach { item ->
            DropdownMenuItem(
                text = {
                    Text(
                        text = item.label,
                        color = if (item.destructive) MaterialTheme.colorScheme.error else Color.Unspecified,
                    )
                },
                onClick = {
                    item.onClick()
                    onDismissRequest()
                },
                enabled = item.enabled,
                leadingIcon =
                    item.leadingIcon?.let { glyph ->
                        { Icon(glyph, contentDescription = null, size = IconSize.Sm) }
                    },
            )
        }
    }
}

/**
 * Wraps [content] so a long-press opens a [ContextMenu] of [items] anchored to it; a normal tap
 * invokes [onClick]. The Android long-press idiom replacing the web's right-click/x,y menu.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ContextMenuArea(
    items: List<ContextMenuItem>,
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {},
    content: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier.combinedClickable(onClick = onClick, onLongClick = { expanded = true })) {
        content()
        ContextMenu(expanded = expanded, onDismissRequest = { expanded = false }, items = items)
    }
}
