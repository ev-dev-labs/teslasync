package io.teslasync.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.R

/**
 * Announces the current destination's title to screen readers on every navigation, mirroring the
 * web `RouteAnnouncer` (WCAG 2.4.2 / ADR-015). Renders a visually negligible node marked as a
 * polite live region; when its [contentDescription] changes, TalkBack speaks the new screen name
 * without stealing focus.
 */
@Composable
fun RouteAnnouncer(destination: Destination) {
    val title = navTitle(destination)
    val announcement = stringResource(R.string.nav_route_announcement, title)
    Box(
        modifier =
            Modifier
                .size(1.dp)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = announcement
                },
    )
}
