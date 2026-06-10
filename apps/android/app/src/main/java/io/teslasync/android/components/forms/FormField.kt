package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Labelled form-field wrapper mirroring web `components/forms/FormField`. Lays out a [label] (with
 * an optional required marker), the field [content] slot, and a single supporting line below —
 * [errorText] takes precedence over [helperText] so validation messages are never hidden.
 */
@Composable
fun FormField(
    label: String,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    helperText: String? = null,
    errorText: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            FieldLabelText(label)
            if (required) {
                Text("*", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
            }
        }
        content()
        when {
            errorText != null -> ErrorText(errorText)
            helperText != null -> HelperText(helperText)
        }
    }
}

/**
 * Titled group of related fields mirroring web `components/forms/FormSection`. Renders a section
 * heading, an optional [description], and the [content] laid out with consistent vertical spacing.
 */
@Composable
fun FormSection(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionTitle(title)
        if (description != null) {
            Caption(description)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md), content = content)
    }
}
