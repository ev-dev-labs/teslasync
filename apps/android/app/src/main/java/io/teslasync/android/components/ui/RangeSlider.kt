package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing
import androidx.compose.material3.RangeSlider as M3RangeSlider

/**
 * Dual-thumb range slider mirroring web `components/ui/RangeSlider`. The Material 3 range slider
 * keeps the `[low, high]` tuple sorted (thumb swap) and exposes each thumb to accessibility
 * individually. [valueText] is the caller-formatted "low – high" summary shown on the right.
 */
@Composable
fun RangeSlider(
    value: ClosedFloatingPointRange<Float>,
    onValueChange: (ClosedFloatingPointRange<Float>) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    valueText: String? = null,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    enabled: Boolean = true,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        if (label != null) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                FieldLabelText(label, modifier = Modifier.weight(1f))
                if (valueText != null) Caption(valueText)
            }
            Spacer(Modifier.height(Spacing.xs))
        }
        M3RangeSlider(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            valueRange = valueRange,
            steps = steps,
            onValueChangeFinished = onValueChangeFinished,
        )
    }
}
