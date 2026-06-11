package io.teslasync.android.components.maps

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Floating base-map selector — the Android counterpart of the web `MapLayerSwitcher`. A compact
 * segmented control of tabs (one per [MapStyleId]); the selected tab is tonally filled. Each tab
 * carries an accessible label + selected/unselected state for TalkBack. Overlay it on a corner of
 * the map (e.g. `Modifier.align(Alignment.BottomStart).padding(...)`).
 */
@Composable
fun MapLayerSwitcher(
    current: MapStyleId,
    onChange: (MapStyleId) -> Unit,
    modifier: Modifier = Modifier,
    labels: Map<MapStyleId, String> = defaultStyleLabels(),
    selectedStateLabel: String = "selected",
    unselectedStateLabel: String = "not selected",
    showLabels: Boolean = true,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = Elevation.overlay,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.selectableGroup().padding(Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MapStyleId.entries.forEach { id ->
                LayerTab(
                    selected = id == current,
                    label = labels[id] ?: id.name,
                    glyph = styleGlyph(id),
                    showLabel = showLabels,
                    selectedStateLabel = selectedStateLabel,
                    unselectedStateLabel = unselectedStateLabel,
                    onClick = { onChange(id) },
                )
            }
        }
    }
}

@Composable
private fun LayerTab(
    selected: Boolean,
    label: String,
    glyph: ImageVector,
    showLabel: Boolean,
    selectedStateLabel: String,
    unselectedStateLabel: String,
    onClick: () -> Unit,
) {
    val container = if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent
    val content = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(Radius.sm),
        color = container,
        contentColor = content,
        modifier =
            Modifier.semantics {
                role = Role.Tab
                stateDescription = if (selected) selectedStateLabel else unselectedStateLabel
            },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(glyph, contentDescription = if (showLabel) null else label, size = IconSize.Sm, tint = content)
            if (showLabel) Caption(label)
        }
    }
}

/** The glyph shown for each base-map style. */
fun styleGlyph(style: MapStyleId): ImageVector =
    when (style) {
        MapStyleId.Dark -> MapsGlyphs.Layers
        MapStyleId.Streets -> MapsGlyphs.Map
        MapStyleId.Satellite -> MapsGlyphs.Satellite
        MapStyleId.Terrain -> MapsGlyphs.Terrain
    }

/** English fallback labels; pages pass translated strings. */
fun defaultStyleLabels(): Map<MapStyleId, String> =
    mapOf(
        MapStyleId.Dark to "Dark",
        MapStyleId.Streets to "Streets",
        MapStyleId.Satellite to "Satellite",
        MapStyleId.Terrain to "Terrain",
    )
