// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Spacing

/** A saved filter combination for a list page. */
data class SavedView(
    val id: String,
    val name: String,
    val query: String,
    val isDefault: Boolean = false,
    val isPinned: Boolean = false,
)

/** Orders saved views: pinned first, then alphabetically (mirrors the web ordering). */
fun sortedSavedViews(views: List<SavedView>): List<SavedView> =
    views.sortedWith(compareByDescending<SavedView> { it.isPinned }.thenBy { it.name.lowercase() })

/**
 * Inline "saved views" list affordance — the Android counterpart of the web `SavedViewMenu`. Shows
 * the views (pinned first) with apply-on-tap and optional pin / default / delete actions; the
 * active view (matching [currentQuery]) is badged and clearable. Stateless: pages own persistence.
 */
@Composable
fun SavedViewMenu(
    views: List<SavedView>,
    currentQuery: String,
    onApply: (String) -> Unit,
    modifier: Modifier = Modifier,
    onClear: () -> Unit = {},
    onSetDefault: ((SavedView) -> Unit)? = null,
    onTogglePin: ((SavedView) -> Unit)? = null,
    onDelete: ((SavedView) -> Unit)? = null,
    title: String = "Saved views",
    defaultLabel: String = "Default",
    pinLabel: String = "Pin",
    deleteLabel: String = "Delete",
    clearLabel: String = "Clear",
    emptyMessage: String = "No saved views yet.",
) {
    val active = views.firstOrNull { it.query == currentQuery }
    GlassPanel(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(title)
            if (active != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Badge(text = active.name, variant = BadgeVariant.Info)
                    IconButton(TeslaGlyphs.Close, contentDescription = clearLabel, onClick = onClear, size = IconSize.Sm)
                }
            }
        }
        if (views.isEmpty()) {
            DataEmpty(emptyMessage)
            return@GlassPanel
        }
        Column(modifier = Modifier.padding(top = Spacing.sm)) {
            sortedSavedViews(views).forEach { view ->
                SavedViewRow(
                    view = view,
                    isActive = view.id == active?.id,
                    onApply = { onApply(view.query) },
                    onSetDefault = onSetDefault,
                    onTogglePin = onTogglePin,
                    onDelete = onDelete,
                    defaultLabel = defaultLabel,
                    pinLabel = pinLabel,
                    deleteLabel = deleteLabel,
                )
            }
        }
    }
}

@Composable
private fun SavedViewRow(
    view: SavedView,
    isActive: Boolean,
    onApply: () -> Unit,
    onSetDefault: ((SavedView) -> Unit)?,
    onTogglePin: ((SavedView) -> Unit)?,
    onDelete: ((SavedView) -> Unit)?,
    defaultLabel: String,
    pinLabel: String,
    deleteLabel: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onApply).padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (view.isPinned) {
            Icon(TeslaGlyphs.Pin, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.primary)
        }
        Text(
            view.name,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (view.isDefault) Badge(text = defaultLabel, variant = BadgeVariant.Neutral)
        if (onSetDefault != null) {
            IconButton(TeslaGlyphs.Check, contentDescription = defaultLabel, onClick = { onSetDefault(view) }, size = IconSize.Sm)
        }
        if (onTogglePin != null) {
            IconButton(TeslaGlyphs.Pin, contentDescription = pinLabel, onClick = { onTogglePin(view) }, size = IconSize.Sm)
        }
        if (onDelete != null) {
            IconButton(TeslaGlyphs.Close, contentDescription = deleteLabel, onClick = { onDelete(view) }, size = IconSize.Sm)
        }
    }
}
