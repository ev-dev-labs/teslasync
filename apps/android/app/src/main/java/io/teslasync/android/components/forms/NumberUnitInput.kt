// File holds the numeric field family; parsing/formatting live in FormsLogic.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType

/**
 * Number-with-unit field mirroring web `components/forms/UnitInput`. Keeps a local text buffer so
 * typing is never interrupted; the buffer re-syncs to the canonical [value]'s formatted form only
 * while unfocused, and commits on blur / Done by parsing the text (see [parse]) and emitting the
 * canonical value via [onValueChange]. The [unitSymbol] is shown as a trailing suffix.
 */
@Composable
fun UnitInput(
    value: Double?,
    onValueChange: (Double?) -> Unit,
    unitSymbol: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    decimals: Int = 2,
    parse: (String) -> Double? = ::parseNumeric,
) {
    NumericField(
        value = value,
        onValueChange = onValueChange,
        format = { formatNumeric(it, decimals) },
        parse = parse,
        modifier = modifier,
        label = label,
        trailingSymbol = unitSymbol,
    )
}

/**
 * Currency field mirroring web `components/forms/CurrencyInput`. Same buffer/resync/commit contract
 * as [UnitInput] but parses accounting-aware currency text (see [parseCurrency]) and shows the
 * [currencySymbol] as a leading prefix.
 */
@Composable
fun CurrencyInput(
    value: Double?,
    onValueChange: (Double?) -> Unit,
    modifier: Modifier = Modifier,
    currencySymbol: String = "$",
    label: String? = null,
    decimals: Int = 2,
) {
    NumericField(
        value = value,
        onValueChange = onValueChange,
        format = { formatNumeric(it, decimals) },
        parse = ::parseCurrency,
        modifier = modifier,
        label = label,
        leadingSymbol = currencySymbol,
    )
}

@Composable
private fun NumericField(
    value: Double?,
    onValueChange: (Double?) -> Unit,
    format: (Double?) -> String,
    parse: (String) -> Double?,
    modifier: Modifier = Modifier,
    label: String? = null,
    leadingSymbol: String? = null,
    trailingSymbol: String? = null,
) {
    val display = format(value)
    var text by remember { mutableStateOf(display) }
    var focused by remember { mutableStateOf(false) }

    LaunchedEffect(display) {
        if (!focused) text = display
    }

    fun commit() {
        val parsed = parse(text)
        onValueChange(parsed)
        text = format(parsed)
    }

    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        modifier =
            modifier
                .fillMaxWidth()
                .onFocusChanged { state ->
                    if (focused && !state.isFocused) commit()
                    focused = state.isFocused
                },
        singleLine = true,
        label = label?.let { text2 -> { Text(text2) } },
        leadingIcon = leadingSymbol?.let { symbol -> { Text(symbol, style = MaterialTheme.typography.bodyMedium) } },
        trailingIcon = trailingSymbol?.let { symbol -> { Text(symbol, style = MaterialTheme.typography.bodyMedium) } },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        shape = MaterialTheme.shapes.medium,
    )
}
