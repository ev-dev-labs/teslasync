package io.teslasync.android.components.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Inline-edit primitive mirroring web `components/ui/EditableText`: tap the value to switch to
 * an editor with confirm/cancel actions. Commit semantics come from [decideCommit] — an empty
 * or [validate]-rejected draft shows an error and stays in edit mode; an unchanged draft exits
 * silently; a valid change calls [onSave] with the trimmed value. Persistence is the caller's
 * responsibility ([onSave] is synchronous here — networking is out of scope).
 */
@Composable
fun EditableText(
    value: String,
    onSave: (String) -> Unit,
    editActionLabel: String,
    saveLabel: String,
    cancelLabel: String,
    modifier: Modifier = Modifier,
    validate: (String) -> String? = { null },
    enabled: Boolean = true,
    emptyText: String? = null,
    emptyErrorText: String = "",
) {
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(value) }
    var error by remember { mutableStateOf<String?>(null) }

    if (!editing) {
        EditableDisplay(
            value = value,
            emptyText = emptyText,
            enabled = enabled,
            editActionLabel = editActionLabel,
            modifier = modifier,
            onStartEdit = {
                draft = value
                error = null
                editing = true
            },
        )
        return
    }

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = draft,
            onValueChange = { next ->
                draft = next
                val trimmed = next.trim()
                error = if (trimmed.isEmpty()) null else validate(trimmed)
            },
            isError = error != null,
            singleLine = true,
            supportingText = supportingSlot(error),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(Spacing.xs))
        IconButton(
            imageVector = TeslaGlyphs.Check,
            contentDescription = saveLabel,
            onClick = {
                when (decideCommit(draft, value, validate)) {
                    CommitOutcome.Commit -> {
                        onSave(draft.trim())
                        error = null
                        editing = false
                    }
                    CommitOutcome.NoOp -> {
                        error = null
                        editing = false
                    }
                    CommitOutcome.Invalid -> {
                        val trimmed = draft.trim()
                        error = if (trimmed.isEmpty()) emptyErrorText else validate(trimmed)
                    }
                }
            },
        )
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = cancelLabel,
            onClick = {
                draft = value
                error = null
                editing = false
            },
        )
    }
}

@Composable
private fun EditableDisplay(
    value: String,
    emptyText: String?,
    enabled: Boolean,
    editActionLabel: String,
    modifier: Modifier,
    onStartEdit: () -> Unit,
) {
    val rowModifier =
        modifier
            .clip(MaterialTheme.shapes.small)
            .let {
                if (enabled) {
                    it.clickable(role = Role.Button, onClickLabel = editActionLabel, onClick = onStartEdit)
                } else {
                    it
                }
            }.padding(horizontal = Spacing.xs, vertical = Spacing.xs)
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        if (value.isEmpty() && emptyText != null) {
            Caption(emptyText)
        } else {
            BodyText(value)
        }
        if (enabled) {
            Spacer(Modifier.width(Spacing.xs))
            Icon(TeslaGlyphs.Edit, contentDescription = null, size = IconSize.Sm)
        }
    }
}
