// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** One bulk action rendered in a [BulkActionToolbar]. */
data class BulkAction(
    val id: String,
    val label: String,
    val onClick: () -> Unit,
    val danger: Boolean = false,
    val enabled: Boolean = true,
    val loading: Boolean = false,
)

/**
 * Selection toolbar shown above a list when one or more rows are selected — the Android
 * counterpart of the web `BulkActionToolbar`. Renders a live "{n} selected" count, the per-page
 * [actions], and a clear button. Renders nothing when [selectedCount] is 0, so callers can mount
 * it unconditionally.
 */
@Composable
fun BulkActionToolbar(
    selectedCount: Int,
    onClear: () -> Unit,
    actions: List<BulkAction>,
    modifier: Modifier = Modifier,
    total: Int? = null,
    countText: (Int) -> String = { "$it selected" },
    ofTotalText: (Int) -> String = { "of $it" },
    clearLabel: String = "Clear selection",
) {
    if (selectedCount <= 0) return
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Surface(
                shape = RoundedCornerShape(Radius.pill),
                color = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            ) {
                Text(
                    countText(selectedCount),
                    modifier =
                        Modifier
                            .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            if (total != null) {
                Text(ofTotalText(total), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.weight(1f))
            actions.forEach { action ->
                Button(
                    label = action.label,
                    onClick = action.onClick,
                    variant = if (action.danger) ButtonVariant.Danger else ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    enabled = action.enabled,
                    loading = action.loading,
                )
            }
            IconButton(TeslaGlyphs.Close, contentDescription = clearLabel, onClick = onClear, size = IconSize.Sm)
        }
    }
}
