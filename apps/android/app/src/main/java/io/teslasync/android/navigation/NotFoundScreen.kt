package io.teslasync.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.ui.TeslaGlyphs

/**
 * The shared not-found screen, rendered for unknown URLs and for any registered destination that
 * has no A7 page host yet. It is a real, complete screen (title, explanation, the requested path,
 * and a return-home action) — never a fabricated stand-in for the intended page.
 */
@Composable
fun NotFoundScreen(
    attemptedPath: String?,
    onNavigateHome: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val body = stringResource(R.string.nav_not_found_body)
    val message =
        if (attemptedPath.isNullOrBlank()) {
            body
        } else {
            body + "\n" + stringResource(R.string.nav_not_found_path, attemptedPath)
        }
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        EmptyState(
            message = message,
            icon = TeslaGlyphs.Help,
            title = stringResource(R.string.nav_not_found),
            action =
                EmptyStateAction(
                    label = stringResource(R.string.nav_go_home),
                    onClick = onNavigateHome,
                ),
        )
    }
}
