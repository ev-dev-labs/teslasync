package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant

/**
 * Export-format menu mirroring web `components/forms/ListExportMenu`. A button opens a dropdown of
 * [formats]; choosing one calls [onExport] with the selected [ExportFormat] (labels/extensions come
 * from [exportFormatLabel]/[exportFileExtension]).
 */
@Composable
fun ListExportMenu(
    onExport: (ExportFormat) -> Unit,
    modifier: Modifier = Modifier,
    formats: List<ExportFormat> = ExportFormat.entries,
    label: String = "Export",
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier = modifier) {
        Button(
            label,
            onClick = { expanded = true },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            leadingIcon = FormsGlyphs.Download,
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            formats.forEach { format ->
                DropdownMenuItem(
                    text = { Text(exportFormatLabel(format)) },
                    onClick = {
                        expanded = false
                        onExport(format)
                    },
                )
            }
        }
    }
}
