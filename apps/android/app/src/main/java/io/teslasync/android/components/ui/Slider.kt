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
import androidx.compose.material3.Slider as M3Slider

/**
 * Single-thumb slider mirroring web `components/ui/Slider`. Renders an optional label row with
 * a right-aligned live [valueText] (format it unit-aware in the caller), then a Material 3
 * [M3Slider]. [steps] gives discrete stops (0 = continuous); [onValueChangeFinished] fires when
 * the drag/keyboard interaction settles.
 */
@Composable
fun Slider(
    value: Float,
    onValueChange: (Float) -> Unit,
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
        M3Slider(
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
