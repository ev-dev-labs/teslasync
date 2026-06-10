package io.teslasync.android.components.forms

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

/**
 * Debounced search field mirroring web `components/forms/SearchInput`. Local typing is buffered
 * and [onValueChange] fires only after [debounceMs] of quiet (see [shouldEmitSearch]); a leading
 * magnifier and a trailing clear button frame the field. When [history] is supplied and the empty
 * field is focused, a recent-searches dropdown appears (see [searchHistoryVisible]); selecting an
 * entry emits immediately via [onSelectHistory].
 */
@Composable
fun SearchInput(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    hint: String = "Search",
    debounceMs: Long = 250,
    history: List<String> = emptyList(),
    onSelectHistory: ((String) -> Unit)? = null,
    clearLabel: String = "Clear",
    historyTitle: String = "Recent searches",
) {
    var local by remember { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }

    LaunchedEffect(value) {
        if (value != local) local = value
    }
    LaunchedEffect(local, value, debounceMs) {
        if (shouldEmitSearch(local, value)) {
            delay(debounceMs)
            onValueChange(local)
        }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = local,
            onValueChange = { local = it },
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
            singleLine = true,
            label = { Text(hint) },
            leadingIcon = { Icon(FormsGlyphs.Search, contentDescription = null) },
            trailingIcon =
                if (local.isNotEmpty()) {
                    {
                        IconButton(
                            TeslaGlyphs.Close,
                            contentDescription = clearLabel,
                            onClick = {
                                local = ""
                                onValueChange("")
                            },
                            size = IconSize.Sm,
                        )
                    }
                } else {
                    null
                },
            shape = MaterialTheme.shapes.medium,
        )
        val showHistory =
            onSelectHistory != null && searchHistoryVisible(history.isNotEmpty(), focused, local, history.size)
        if (showHistory) {
            SearchHistory(history = history, title = historyTitle, onSelect = onSelectHistory)
        }
    }
}

@Composable
private fun SearchHistory(
    history: List<String>,
    title: String,
    onSelect: ((String) -> Unit)?,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.sm)) {
            Caption(title)
            history.forEach { entry ->
                BodyText(
                    entry,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable { onSelect?.invoke(entry) }
                            .padding(vertical = Spacing.xs),
                )
            }
        }
    }
}
