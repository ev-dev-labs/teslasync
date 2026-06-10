package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Multi-line text field mirroring web `components/ui/Textarea`. A Material 3 [OutlinedTextField]
 * configured for free text: [minLines]/[maxLines] bound the height, [label] floats, and
 * [hint]/[errorText] render as supporting text below (error styling applies automatically).
 */
@Composable
fun Textarea(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    hint: String? = null,
    errorText: String? = null,
    enabled: Boolean = true,
    required: Boolean = false,
    minLines: Int = 3,
    maxLines: Int = 6,
) {
    val isError = errorText != null
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        isError = isError,
        singleLine = false,
        minLines = minLines,
        maxLines = maxLines,
        label = label?.let { text -> { FieldLabelSlot(text, required) } },
        supportingText = supportingSlot(errorText ?: hint),
        shape = MaterialTheme.shapes.medium,
    )
}
