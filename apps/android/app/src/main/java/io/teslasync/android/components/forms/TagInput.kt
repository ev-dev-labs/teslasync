// File holds the tag-input primitive; tag parsing lives in FormsLogic.
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.input.ImeAction
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Tag entry field mirroring web `components/forms/TagInput`. Committed tags render as removable
 * chips; typing a [separators] character or pressing Done commits the buffered text (see
 * [addTags]), and Backspace on the empty input removes the last tag (see [removeLastTag]). Fully
 * controlled via [tags] + [onTagsChange].
 */
@Composable
fun TagInput(
    tags: List<String>,
    onTagsChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    hint: String = "Add a tag…",
    separators: Set<Char> = DEFAULT_TAG_SEPARATORS,
    allowDuplicates: Boolean = false,
    addLabel: String = "Add tag",
) {
    var input by remember { mutableStateOf("") }

    fun commit(raw: String) {
        if (raw.isNotBlank()) {
            onTagsChange(addTags(tags, raw, separators, allowDuplicates))
        }
        input = ""
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (tags.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                tags.forEachIndexed { index, tag ->
                    TagChip(tag = tag, onRemove = { onTagsChange(removeTagAt(tags, index)) })
                }
            }
        }
        OutlinedTextField(
            value = input,
            onValueChange = { next ->
                if (next.any { it in separators }) {
                    commit(next)
                } else {
                    input = next
                }
            },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onKeyEvent { event ->
                        val backspaceOnEmpty =
                            event.type == KeyEventType.KeyDown &&
                                event.key == Key.Backspace &&
                                input.isEmpty() &&
                                tags.isNotEmpty()
                        if (backspaceOnEmpty) {
                            onTagsChange(removeLastTag(tags))
                            true
                        } else {
                            false
                        }
                    },
            singleLine = true,
            label = { Text(label ?: hint) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { commit(input) }),
            trailingIcon = {
                IconButton(TeslaGlyphs.Plus, contentDescription = addLabel, onClick = { commit(input) }, size = IconSize.Sm)
            },
            shape = MaterialTheme.shapes.medium,
        )
    }
}

@Composable
private fun TagChip(
    tag: String,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.sm, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tag, style = MaterialTheme.typography.labelMedium)
            IconButton(TeslaGlyphs.Close, contentDescription = "Remove $tag", onClick = onRemove, size = IconSize.Xs)
        }
    }
}
