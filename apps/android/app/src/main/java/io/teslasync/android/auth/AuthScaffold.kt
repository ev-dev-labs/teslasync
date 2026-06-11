// File holds the auth gate plus its co-located state surfaces (supporting @Composables).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.auth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Gates the app shell behind the auth state machine (ADR-008). While the session is live (or
 * transparently refreshing) the [content] shell is shown; otherwise the matching auth surface is
 * rendered. The whole set covers the A4 states — loading/authorizing, signed-out, expired, reauth,
 * and error — each with an action so the user is never stuck. Sign-in/out logic stays in the shared
 * core via [AuthController]; pages never touch tokens.
 */
@Composable
fun AuthScaffold(
    controller: AuthController,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(controller) { controller.start() }
    val uiState by controller.uiState.collectAsState()
    when (val state = uiState) {
        AuthUiState.Authenticated, AuthUiState.Refreshing -> content()
        AuthUiState.Authorizing -> AuthorizingSurface(modifier)
        AuthUiState.SignedOut -> SignInSurface(onSignIn = controller::signIn, modifier = modifier)
        AuthUiState.Expired -> ExpiredSurface(onRetry = controller::refresh, modifier = modifier)
        AuthUiState.ReauthRequired -> ReauthSurface(onSignIn = controller::signIn, modifier = modifier)
        is AuthUiState.Error -> AuthErrorSurface(message = state.message, onRetry = controller::signIn, modifier = modifier)
    }
}

@Composable
private fun AuthorizingSurface(modifier: Modifier = Modifier) {
    PageLoader(modifier = modifier, label = stringResource(R.string.auth_authorizing))
}

@Composable
private fun SignInSurface(
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthCenter(modifier) {
        Icon(
            FeedbackGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(Spacing.md))
        PageTitle(stringResource(R.string.auth_welcome_title), modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(Spacing.sm))
        BodyText(
            stringResource(R.string.auth_welcome_body),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Spacing.lg))
        Button(
            stringResource(R.string.auth_sign_in),
            onClick = onSignIn,
            leadingIcon = FeedbackGlyphs.Lock,
            size = ButtonSize.Lg,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.sm))
        Caption(stringResource(R.string.auth_secure_note))
    }
}

@Composable
private fun ExpiredSurface(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthCenter(modifier) {
        Spinner(size = SpinnerSize.Lg, accessibleLabel = stringResource(R.string.auth_expired_title))
        Spacer(Modifier.height(Spacing.md))
        PanelTitle(stringResource(R.string.auth_expired_title), modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(Spacing.xs))
        BodyText(
            stringResource(R.string.auth_expired_body),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Spacing.md))
        Button(
            stringResource(R.string.auth_expired_retry),
            onClick = onRetry,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun ReauthSurface(
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.lg), contentAlignment = Alignment.Center) {
        EmptyState(
            message = stringResource(R.string.auth_reauth_body),
            icon = FeedbackGlyphs.Lock,
            title = stringResource(R.string.auth_reauth_title),
            action =
                EmptyStateAction(
                    label = stringResource(R.string.auth_reauth_action),
                    onClick = onSignIn,
                ),
        )
    }
}

@Composable
private fun AuthErrorSurface(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.lg), contentAlignment = Alignment.Center) {
        ErrorDisplay(
            message = message,
            title = stringResource(R.string.auth_error_title),
            icon = FeedbackGlyphs.Lock,
            onRetry = onRetry,
            retryLabel = stringResource(R.string.auth_error_retry),
        )
    }
}

@Composable
private fun AuthCenter(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        FadeIn {
            GlassPanel(modifier = Modifier.widthIn(max = AUTH_PANEL_MAX_WIDTH)) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    content = content,
                )
            }
        }
    }
}

private val AUTH_PANEL_MAX_WIDTH = 420.dp
