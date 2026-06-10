package io.teslasync.android.components.feedback

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/*
 * Navigation-affordance surfaces mirroring web `SkipToContent` and `GotoIndicator`. [SkipToContent]
 * is the accessibility "jump to main content" action; [GotoIndicator] shows the pending keyboard
 * quick-nav key sequence (see [appendGotoKey]/[matchGotoRoute]) and hides itself when empty.
 */

/** Accessibility skip-link mirroring web `SkipToContent`. Tapping jumps focus to the main content. */
@Composable
fun SkipToContent(
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Skip to content",
    icon: ImageVector = FeedbackGlyphs.ArrowRight,
) {
    Button(label, onClick = onSkip, modifier = modifier, variant = ButtonVariant.Secondary, size = ButtonSize.Sm, leadingIcon = icon)
}

/**
 * Keyboard quick-nav sequence indicator mirroring web `GotoIndicator`. Shows the in-progress goto
 * [buffer] (e.g. after pressing `g`) as a small chip; renders nothing when the buffer is empty.
 */
@Composable
fun GotoIndicator(
    buffer: String,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(visible = buffer.isNotEmpty()) {
        Surface(
            modifier = modifier,
            shape = RoundedCornerShape(Radius.sm),
            color = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(FeedbackGlyphs.ArrowRight, contentDescription = null, size = IconSize.Xs)
                CodeText(buffer)
            }
        }
    }
}
