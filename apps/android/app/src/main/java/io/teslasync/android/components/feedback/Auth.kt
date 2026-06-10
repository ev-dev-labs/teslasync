// File holds the auth/navigation-guard family; the co-located state holder is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity

/**
 * Capability gate mirroring web `components/feedback/RequiresAuth`. Renders [content] only when
 * [authorized]; otherwise renders [fallback] (a non-blank "access restricted" [EmptyState] by
 * default) so a gated region is never silently empty.
 */
@Composable
fun RequiresAuth(
    authorized: Boolean,
    modifier: Modifier = Modifier,
    deniedTitle: String = "Access restricted",
    deniedMessage: String = "You don't have permission to view this.",
    fallback: @Composable () -> Unit = {
        EmptyState(message = deniedMessage, modifier = modifier, icon = FeedbackGlyphs.Lock, title = deniedTitle)
    },
    content: @Composable () -> Unit,
) {
    if (authorized) {
        content()
    } else {
        fallback()
    }
}

/**
 * Unsaved-changes navigation guard state mirroring web `NavigationGuardProvider`. Set [blocking]
 * true while a form is dirty; [attempt] then defers the navigation as a [pending] action until the
 * user confirms (or runs it immediately when not blocking). [confirm]/[cancel] resolve the prompt.
 */
class NavigationGuardState {
    var blocking by mutableStateOf(false)

    var pending by mutableStateOf<(() -> Unit)?>(null)
        private set

    fun attempt(action: () -> Unit) {
        if (blocking) pending = action else action()
    }

    fun confirm() {
        val action = pending
        pending = null
        action?.invoke()
    }

    fun cancel() {
        pending = null
    }
}

/** Remembers a [NavigationGuardState] for the lifetime of the composition. */
@Composable
fun rememberNavigationGuardState(): NavigationGuardState = remember { NavigationGuardState() }

/**
 * Hosts guarded navigation mirroring web `NavigationGuardProvider`. Renders [content] and, when a
 * blocked navigation is [NavigationGuardState.pending], shows a discard-changes [ConfirmDialog].
 */
@Composable
fun NavigationGuardProvider(
    state: NavigationGuardState,
    content: @Composable () -> Unit,
    confirmTitle: String = "Discard unsaved changes?",
    confirmMessage: String = "You have unsaved changes. Leaving now will discard them.",
) {
    content()
    if (state.pending != null) {
        ConfirmDialog(
            title = confirmTitle,
            message = confirmMessage,
            confirmLabel = "Discard",
            cancelLabel = "Stay",
            onConfirm = { state.confirm() },
            onCancel = { state.cancel() },
            severity = ConfirmSeverity.Warning,
        )
    }
}

/**
 * Navigation affordance that routes through a [NavigationGuardState] mirroring web `GuardedLink`.
 * Tapping calls [NavigationGuardState.attempt] with [onNavigate], so a dirty form prompts before
 * the navigation runs.
 */
@Composable
fun GuardedLink(
    label: String,
    onNavigate: () -> Unit,
    guard: NavigationGuardState,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
) {
    Button(label, onClick = { guard.attempt(onNavigate) }, modifier = modifier, variant = variant, size = size)
}
