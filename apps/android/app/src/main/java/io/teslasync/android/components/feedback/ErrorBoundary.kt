// File named after its primary @Composable; the co-located state holder is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * Recoverable error-boundary state. Compose cannot intercept exceptions thrown during the
 * composition phase the way a React error boundary can, so the native idiom is to [report]
 * failures caught in event handlers / effects / coroutine bodies and surface a fallback. [reset]
 * clears the captured error so the guarded content re-renders (mirrors the web boundary's reset).
 */
class ErrorBoundaryState {
    var error by mutableStateOf<Throwable?>(null)
        private set

    fun report(throwable: Throwable) {
        error = throwable
    }

    fun reset() {
        error = null
    }
}

/** Remembers an [ErrorBoundaryState] for the lifetime of the composition. */
@Composable
fun rememberErrorBoundaryState(): ErrorBoundaryState = remember { ErrorBoundaryState() }

/**
 * Error boundary mirroring web `components/feedback/ErrorBoundary`. Renders [content] while
 * healthy; when [state] holds a reported error it renders [fallback] with the throwable and a
 * reset callback. The default fallback is an [ErrorDisplay] whose Retry resets the boundary.
 */
@Composable
fun ErrorBoundary(
    state: ErrorBoundaryState,
    modifier: Modifier = Modifier,
    fallback: @Composable (Throwable, () -> Unit) -> Unit = { throwable, reset ->
        ErrorDisplay(
            message = throwable.message ?: DEFAULT_ERROR_MESSAGE,
            modifier = modifier,
            onRetry = reset,
        )
    },
    content: @Composable () -> Unit,
) {
    val error = state.error
    if (error != null) {
        fallback(error, state::reset)
    } else {
        content()
    }
}

/**
 * Full-screen error boundary mirroring web `PageErrorBoundary` — centers the fallback so a failed
 * route never renders an empty screen.
 */
@Composable
fun PageErrorBoundary(
    state: ErrorBoundaryState,
    modifier: Modifier = Modifier,
    title: String = "This page failed to load",
    content: @Composable () -> Unit,
) {
    ErrorBoundary(
        state = state,
        fallback = { throwable, reset ->
            Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                ErrorDisplay(message = throwable.message ?: DEFAULT_ERROR_MESSAGE, title = title, onRetry = reset)
            }
        },
        content = content,
    )
}

/**
 * Inline section error boundary mirroring web `SectionErrorBoundary` — keeps the rest of the page
 * alive while one section shows a compact, retryable error.
 */
@Composable
fun SectionErrorBoundary(
    state: ErrorBoundaryState,
    modifier: Modifier = Modifier,
    title: String = "This section failed to load",
    content: @Composable () -> Unit,
) {
    ErrorBoundary(
        state = state,
        fallback = { throwable, reset ->
            ErrorDisplay(
                message = throwable.message ?: DEFAULT_ERROR_MESSAGE,
                modifier = modifier,
                title = title,
                onRetry = reset,
            )
        },
        content = content,
    )
}

private const val DEFAULT_ERROR_MESSAGE = "An unexpected error occurred."
