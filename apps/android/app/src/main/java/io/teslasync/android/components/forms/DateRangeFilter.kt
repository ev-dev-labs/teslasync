// File holds the date-range + numeric-range filters; co-located enum is a supporting type.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.LocalDate

/** Which end of a [DateRangeFilter] a picker dialog is editing. */
enum class DateField { Start, End }

/**
 * Start/end date-range filter mirroring web `components/forms/DateRangeFilter`. Combines quick
 * [DatePresetChips] with two date buttons that open Material 3 [DatePicker] dialogs. Dates are
 * carried as inclusive epoch-days; [onRangeChange] receives the updated `(start, end)` pair.
 */
@Composable
fun DateRangeFilter(
    startEpochDay: Long?,
    endEpochDay: Long?,
    onRangeChange: (Long?, Long?) -> Unit,
    modifier: Modifier = Modifier,
    activePreset: DatePreset? = null,
    todayEpochDay: Long = LocalDate.now().toEpochDay(),
) {
    var picking by remember { mutableStateOf<DateField?>(null) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        DatePresetChips(
            onSelect = { _, range -> onRangeChange(range.startEpochDay, range.endEpochDay) },
            activePreset = activePreset,
            todayEpochDay = todayEpochDay,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                "Start: ${formatEpochDay(startEpochDay)}",
                onClick = { picking = DateField.Start },
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            )
            Button(
                "End: ${formatEpochDay(endEpochDay)}",
                onClick = { picking = DateField.End },
                modifier = Modifier.weight(1f),
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            )
        }
    }

    val field = picking
    if (field != null) {
        val current = if (field == DateField.Start) startEpochDay else endEpochDay
        DatePickerPopup(
            initialEpochDay = current,
            onDismiss = { picking = null },
            onConfirm = { day ->
                if (field == DateField.Start) onRangeChange(day, endEpochDay) else onRangeChange(startEpochDay, day)
                picking = null
            },
        )
    }
}

@Composable
private fun DatePickerPopup(
    initialEpochDay: Long?,
    onDismiss: () -> Unit,
    onConfirm: (Long?) -> Unit,
) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initialEpochDay?.let { it * MILLIS_PER_DAY })
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button("OK", onClick = {
                onConfirm(state.selectedDateMillis?.let { it / MILLIS_PER_DAY })
            }, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
        },
        dismissButton = {
            Button("Cancel", onClick = onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
    ) {
        DatePicker(state = state)
    }
}

/**
 * Numeric min/max range filter mirroring web `components/forms/RangePicker`. Two [UnitInput]s feed
 * a normalized range (swapped when inverted, see [normalizeNumericRange]) back through
 * [onRangeChange]; an optional [unitSymbol] is shown as a suffix on both fields.
 */
@Composable
fun RangePicker(
    min: Double?,
    max: Double?,
    onRangeChange: (Double?, Double?) -> Unit,
    modifier: Modifier = Modifier,
    minLabel: String = "Min",
    maxLabel: String = "Max",
    unitSymbol: String = "",
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        UnitInput(
            value = min,
            onValueChange = { newMin ->
                val range = normalizeNumericRange(newMin, max)
                onRangeChange(range.min, range.max)
            },
            unitSymbol = unitSymbol,
            modifier = Modifier.weight(1f),
            label = minLabel,
        )
        UnitInput(
            value = max,
            onValueChange = { newMax ->
                val range = normalizeNumericRange(min, newMax)
                onRangeChange(range.min, range.max)
            },
            unitSymbol = unitSymbol,
            modifier = Modifier.weight(1f),
            label = maxLabel,
        )
    }
}

private fun formatEpochDay(epochDay: Long?): String = epochDay?.let { LocalDate.ofEpochDay(it).toString() } ?: "—"

private const val MILLIS_PER_DAY = 86_400_000L
