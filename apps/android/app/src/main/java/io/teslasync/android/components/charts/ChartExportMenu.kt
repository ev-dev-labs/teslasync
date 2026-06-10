package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs

/**
 * Overflow export menu — the Android counterpart of the web `ChartExportMenu`. A
 * single download trigger opens a menu of the actions whose callbacks are supplied:
 * save image, copy image, export CSV. It is a controlled primitive (the host owns
 * the actual capture / file IO, which is out of this prompt's scope), so it renders
 * nothing when no action is wired — mirroring how the web menu hides with nothing to
 * share. SVG export is web-only: Android has no SVG canvas, so image export is PNG.
 */
@Composable
fun ChartExportMenu(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onExportImage: (() -> Unit)? = null,
    onCopyImage: (() -> Unit)? = null,
    onExportCsv: (() -> Unit)? = null,
    triggerLabel: String = "Export chart",
    imageLabel: String = "Save image",
    copyLabel: String = "Copy image",
    csvLabel: String = "Export data as CSV",
) {
    if (onExportImage == null && onCopyImage == null && onExportCsv == null) return
    var open by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        IconButton(
            imageVector = ChartGlyphs.Download,
            contentDescription = triggerLabel,
            onClick = { open = true },
            enabled = enabled,
            size = IconSize.Md,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            onExportCsv?.let { callback ->
                DropdownMenuItem(
                    text = { BodyText(csvLabel) },
                    onClick = {
                        open = false
                        callback()
                    },
                )
            }
            onExportImage?.let { callback ->
                DropdownMenuItem(
                    text = { BodyText(imageLabel) },
                    onClick = {
                        open = false
                        callback()
                    },
                )
            }
            onCopyImage?.let { callback ->
                DropdownMenuItem(
                    text = { BodyText(copyLabel) },
                    leadingIcon = { Icon(TeslaGlyphs.Copy, contentDescription = null, size = IconSize.Sm) },
                    onClick = {
                        open = false
                        callback()
                    },
                )
            }
        }
    }
}
