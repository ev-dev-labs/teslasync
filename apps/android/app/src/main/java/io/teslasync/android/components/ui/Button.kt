package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.Spacing
import androidx.compose.material3.Button as M3Button
import androidx.compose.material3.Icon as M3Icon

/** Visual emphasis, mapped onto Material 3 button containers. */
enum class ButtonVariant { Primary, Secondary, Outline, Danger, Ghost }

/** Size scale. [Auto] follows the ambient [UiDensity]. */
enum class ButtonSize { Sm, Md, Lg, Auto }

/**
 * Labeled button — the common case. Mirrors web `components/ui/Button`: variants, sizes, a
 * [loading] spinner that also disables the control, and an optional [leadingIcon]. Material 3
 * enforces the 48 dp minimum touch target automatically.
 */
@Composable
fun Button(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.Md,
    enabled: Boolean = true,
    loading: Boolean = false,
    leadingIcon: ImageVector? = null,
) {
    Button(onClick, modifier, variant, size, enabled, loading) {
        ButtonLeading(loading, leadingIcon)
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/** Slot variant for buttons whose content isn't a plain label (e.g. icon + value chips). */
@Composable
fun Button(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.Md,
    enabled: Boolean = true,
    loading: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    val padding = buttonPadding(size)
    val active = enabled && !loading
    when (variant) {
        ButtonVariant.Primary ->
            M3Button(onClick, modifier, active, contentPadding = padding, content = content)
        ButtonVariant.Secondary ->
            FilledTonalButton(onClick, modifier, active, contentPadding = padding, content = content)
        ButtonVariant.Outline ->
            OutlinedButton(onClick, modifier, active, contentPadding = padding, content = content)
        ButtonVariant.Ghost ->
            TextButton(onClick, modifier, active, contentPadding = padding, content = content)
        ButtonVariant.Danger ->
            M3Button(onClick, modifier, active, colors = dangerColors(), contentPadding = padding, content = content)
    }
}

@Composable
private fun ButtonLeading(
    loading: Boolean,
    leadingIcon: ImageVector?,
) {
    when {
        loading -> {
            CircularProgressIndicator(
                modifier = Modifier.size(LEADING_SIZE),
                strokeWidth = 2.dp,
                color = LocalContentColor.current,
            )
            Spacer(Modifier.width(Spacing.sm))
        }
        leadingIcon != null -> {
            M3Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(LEADING_SIZE))
            Spacer(Modifier.width(Spacing.sm))
        }
    }
}

@Composable
private fun buttonPadding(size: ButtonSize): PaddingValues =
    when (size) {
        ButtonSize.Sm -> PaddingValues(horizontal = Spacing.md, vertical = Spacing.xs)
        ButtonSize.Md -> ButtonDefaults.ContentPadding
        ButtonSize.Lg -> PaddingValues(horizontal = Spacing.xl2, vertical = Spacing.sm)
        ButtonSize.Auto -> {
            val metrics = LocalUiDensity.current.metrics()
            PaddingValues(horizontal = metrics.paddingX, vertical = metrics.paddingY)
        }
    }

@Composable
private fun dangerColors(): ButtonColors =
    ButtonDefaults.buttonColors(
        containerColor = MaterialTheme.colorScheme.error,
        contentColor = MaterialTheme.colorScheme.onError,
    )

private val LEADING_SIZE = 18.dp
