package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation

/**
 * Single-line text field mirroring web `components/ui/Input`, built on Material 3
 * [OutlinedTextField]. The web "label above, ghost prompt inside" pattern maps to Material's
 * floating [label]; [hint] and [errorText] render as supporting text below the field (error
 * styling kicks in automatically when [errorText] is non-null). Optional leading/trailing
 * glyphs and a [required] marker on the label are supported.
 */
@Composable
fun Input(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    hint: String? = null,
    errorText: String? = null,
    leadingIcon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    required: Boolean = false,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val isError = errorText != null
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        readOnly = readOnly,
        isError = isError,
        singleLine = singleLine,
        label = label?.let { text -> { FieldLabelSlot(text, required) } },
        leadingIcon = leadingIcon?.let { glyph -> { Icon(glyph, contentDescription = null) } },
        trailingIcon = trailingIcon?.let { glyph -> { Icon(glyph, contentDescription = null) } },
        supportingText = supportingSlot(errorText ?: hint),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        visualTransformation = visualTransformation,
        shape = MaterialTheme.shapes.medium,
    )
}

@Composable
internal fun FieldLabelSlot(
    label: String,
    required: Boolean,
) {
    Text(if (required) "$label *" else label)
}

internal fun supportingSlot(text: String?): (@Composable () -> Unit)? = text?.let { value -> { Text(value) } }
