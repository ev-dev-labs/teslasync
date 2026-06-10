// File named after its primary @Composable; the co-located helpers are supporting declarations.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Generic error panel mirroring web `components/feedback/ErrorDisplay`. A centered danger icon,
 * [title], [message], and an optional retry CTA. Use for unexpected failures that aren't a
 * classified query error (those should use [QueryError]).
 */
@Composable
fun ErrorDisplay(
    message: String,
    modifier: Modifier = Modifier,
    title: String = "Something went wrong",
    icon: ImageVector = TeslaGlyphs.Octagon,
    onRetry: (() -> Unit)? = null,
    retryLabel: String = "Retry",
) {
    ErrorStateColumn(
        modifier = modifier,
        icon = icon,
        iconTint = TeslaTokens.status.danger,
        title = title,
        message = message,
        onAction = onRetry,
        actionLabel = retryLabel,
    )
}

/**
 * Failure panel for a query, mirroring web `components/feedback/QueryError`. The [kind] (resolve
 * it via [classifyQueryError]) selects actionable recovery copy: not-found shows a Back-to-list
 * CTA when [onBackToList] is set; unauthorized shows Sign-in; server/network show Retry; offline
 * disables Retry until reconnect. A [resourceName] personalises the not-found title.
 */
@Composable
fun QueryError(
    kind: QueryErrorKind,
    modifier: Modifier = Modifier,
    resourceName: String = "Resource",
    onRetry: (() -> Unit)? = null,
    onBackToList: (() -> Unit)? = null,
) {
    val tint = queryErrorColor(kind)
    when (kind) {
        QueryErrorKind.Waiting ->
            ErrorStateColumn(modifier, FeedbackGlyphs.Clock, tint, "Waiting for upstream", WAITING_MESSAGE)
        QueryErrorKind.NotFound ->
            ErrorStateColumn(
                modifier,
                FeedbackGlyphs.Browser,
                tint,
                "$resourceName not found",
                "It may have been deleted or the link is wrong.",
                onAction = onBackToList,
                actionLabel = "Back to list",
            )
        QueryErrorKind.Unauthorized ->
            ErrorStateColumn(
                modifier,
                FeedbackGlyphs.Lock,
                tint,
                "Sign in required",
                "Your session has expired. Please sign in again.",
                onAction = onRetry,
                actionLabel = "Sign in",
            )
        QueryErrorKind.ServerError ->
            ErrorStateColumn(
                modifier,
                TeslaGlyphs.Octagon,
                tint,
                "Server error",
                "Something went wrong on our end. Please try again.",
                onAction = onRetry,
                actionLabel = "Retry",
            )
        QueryErrorKind.Offline ->
            ErrorStateColumn(
                modifier,
                FeedbackGlyphs.WifiOff,
                tint,
                "You're offline",
                "We'll retry automatically when your connection returns.",
                onAction = onRetry,
                actionLabel = "Retry when online",
                actionEnabled = false,
            )
        QueryErrorKind.Network ->
            ErrorStateColumn(
                modifier,
                TeslaGlyphs.Warning,
                tint,
                "Can't reach server",
                "Check your internet connection and try again.",
                onAction = onRetry,
                actionLabel = "Retry",
            )
    }
}

@Composable
private fun ErrorStateColumn(
    modifier: Modifier,
    icon: ImageVector,
    iconTint: Color,
    title: String,
    message: String,
    onAction: (() -> Unit)? = null,
    actionLabel: String = "Retry",
    actionEnabled: Boolean = true,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xl2, horizontal = Spacing.lg)
                .semantics { contentDescription = title },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Xl, tint = iconTint)
        PanelTitle(title)
        BodyText(
            message,
            modifier = Modifier.widthIn(max = ERROR_TEXT_MAX_WIDTH),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (onAction != null) {
            Button(
                actionLabel,
                onClick = onAction,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = actionEnabled,
            )
        }
    }
}

private const val WAITING_MESSAGE = "We're pausing requests briefly. Data will refresh automatically."
private val ERROR_TEXT_MAX_WIDTH = 360.dp
