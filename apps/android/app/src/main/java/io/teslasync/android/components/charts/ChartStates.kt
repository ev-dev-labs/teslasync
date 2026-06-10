package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The non-data states every chart must show — loading, empty, and error — so a
 * chart never collapses to a blank region. These are self-contained (Material 3
 * progress + the A1 typography wrappers) because the shared `components/feedback`
 * category is a later prompt; the chart layer owns its own state surfaces.
 */
@Composable
internal fun ChartLoadingState(
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
) {
    ChartStateBox(modifier, height) {
        CircularProgressIndicator(
            strokeWidth = 2.dp,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
internal fun ChartEmptyState(
    message: String,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
) {
    ChartStateBox(modifier, height) {
        Caption(message)
    }
}

@Composable
internal fun ChartErrorState(
    message: String,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    retryLabel: String? = null,
    onRetry: (() -> Unit)? = null,
) {
    ChartStateBox(modifier, height) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            ErrorText(message)
            if (onRetry != null && retryLabel != null) {
                Button(retryLabel, onClick = onRetry, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
            }
        }
    }
}

/** A fixed-height, centered container shared by the three states. */
@Composable
private fun ChartStateBox(
    modifier: Modifier,
    height: Dp,
    content: @Composable () -> Unit,
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .height(height)
                .padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}
