package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Modal form for adding a chart annotation — the Android counterpart of the web
 * `AddAnnotationPopover`. Captures a label, a category (a [TabNav] pill row), and an
 * optional description, then reports them via [onAdd]. The x position (which point
 * the annotation pins to) is owned by the caller that opened the popover, so this
 * form stays focused on the note's content. Renders only when [open].
 */
@Composable
fun AddAnnotationPopover(
    open: Boolean,
    onAdd: (label: String, category: AnnotationCategory, description: String?) -> Unit,
    onDismiss: () -> Unit,
    title: String = "Add annotation",
    labelFieldLabel: String = "Label",
    categoryFieldLabel: String = "Category",
    descriptionFieldLabel: String = "Description",
    addLabel: String = "Add annotation",
    cancelLabel: String = "Cancel",
    categoryName: (AnnotationCategory) -> String = { it.name },
) {
    if (!open) return
    var label by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(AnnotationCategory.Milestone) }
    var description by remember { mutableStateOf("") }
    val categoryItems = remember { AnnotationCategory.entries.map { TabNavItem(it.name, categoryName(it)) } }

    Modal(onDismissRequest = onDismiss, title = title) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Input(
                value = label,
                onValueChange = { label = it },
                label = labelFieldLabel,
                required = true,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                FieldLabelText(categoryFieldLabel)
                TabNav(
                    items = categoryItems,
                    selectedKey = category.name,
                    onSelect = { category = AnnotationCategory.valueOf(it) },
                )
            }
            Input(
                value = description,
                onValueChange = { description = it },
                label = descriptionFieldLabel,
                singleLine = false,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(cancelLabel, onClick = onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                Button(
                    label = addLabel,
                    onClick = {
                        onAdd(label.trim(), category, description.trim().ifBlank { null })
                        label = ""
                        description = ""
                        category = AnnotationCategory.Milestone
                    },
                    size = ButtonSize.Sm,
                    enabled = label.isNotBlank(),
                )
            }
        }
    }
}
