// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** A tab: a stable [key], a visible [label], and an [enabled] flag. */
data class TabItem(
    val key: String,
    val label: String,
    val enabled: Boolean = true,
)

/**
 * Tab strip mirroring web `components/ui/Tabs`, built on Material 3 [PrimaryTabRow]. The row owns
 * the WAI-ARIA tab semantics (roving focus, arrow-key navigation, selected indicator); selecting
 * an enabled tab fires [onSelect] with its key. The caller renders the matching panel below.
 */
@Composable
fun Tabs(
    tabs: List<TabItem>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selectedIndex = tabs.indexOfFirst { it.key == selectedKey }.coerceAtLeast(0)
    PrimaryTabRow(selectedTabIndex = selectedIndex, modifier = modifier) {
        tabs.forEachIndexed { index, tab ->
            Tab(
                selected = index == selectedIndex,
                onClick = { onSelect(tab.key) },
                enabled = tab.enabled,
                text = { Text(tab.label) },
            )
        }
    }
}
