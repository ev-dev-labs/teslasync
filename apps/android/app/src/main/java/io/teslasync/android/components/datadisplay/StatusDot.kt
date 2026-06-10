package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Tiny colored dot for inline status (e.g. unread alert markers) — the Android counterpart of the
 * web `StatusDot`. Resolves any wire severity via [normalizeSeverity] and tints from tokens. Pass
 * a [label] to expose the dot's meaning to TalkBack; otherwise it is treated as decorative.
 */
@Composable
fun StatusDot(
    severity: String?,
    modifier: Modifier = Modifier,
    label: String? = null,
    size: Dp = 8.dp,
) {
    val color = severityColor(normalizeSeverity(severity))
    Box(
        modifier =
            modifier
                .size(size)
                .clip(CircleShape)
                .background(color)
                .clearAndSetSemantics {
                    if (label != null) {
                        contentDescription = label
                        role = Role.Image
                    }
                },
    )
}
