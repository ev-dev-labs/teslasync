// File named after its primary @Composable; the co-located route-pattern helpers are supporting fns.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.motion

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * Route patterns where the page cross-fade is suppressed (list ↔ detail drill-ins feel
 * snappier instant). Mirrors the web `DEFAULT_SKIP_PATTERNS`; `:param` segments match any value.
 */
val DEFAULT_SKIP_ROUTE_PATTERNS: List<String> =
    listOf(
        "/drives/:id",
        "/drives/:id/replay",
        "/charging/:id",
        "/vehicles/:id",
        "/vehicles/:id/access",
        "/trips/:id",
    )

private const val SLIDE_DIVISOR = 16

/**
 * True when [pattern] matches [path] exactly, treating `:param` segments as wildcards. The
 * Android equivalent of react-router's `matchPath({ end: true })`.
 */
fun matchesRoutePattern(
    pattern: String,
    path: String,
): Boolean {
    val patternSegments = pattern.trim('/').split('/')
    val pathSegments = path.trim('/').split('/')
    if (patternSegments.size != pathSegments.size) return false
    return patternSegments.indices.all { i ->
        patternSegments[i].startsWith(":") || patternSegments[i] == pathSegments[i]
    }
}

/** True when either the previous or next route matches a skip pattern (back-nav included). */
fun shouldSkipTransition(
    previous: String,
    next: String,
    patterns: List<String> = DEFAULT_SKIP_ROUTE_PATTERNS,
): Boolean = patterns.any { matchesRoutePattern(it, previous) || matchesRoutePattern(it, next) }

/**
 * Cross-fades + subtly slides [content] when [routeKey] changes — wrap it around the page body
 * (not the chrome) so only the page animates. The Android counterpart of the web
 * `RouteTransition`. Honors reduced motion and the [skipPatterns] list (both collapse the
 * animation to an instant swap). The first render never animates.
 */
@Composable
fun RouteTransition(
    routeKey: String,
    modifier: Modifier = Modifier,
    durationMs: Int = MotionDefaults.TRANSITION_MS,
    skipPatterns: List<String> = DEFAULT_SKIP_ROUTE_PATTERNS,
    content: @Composable (String) -> Unit,
) {
    val reduce = rememberReducedMotion()
    var previous by remember { mutableStateOf(routeKey) }
    val effective = effectiveDurationMs(reduce || shouldSkipTransition(previous, routeKey, skipPatterns), durationMs)
    SideEffect { previous = routeKey }
    AnimatedContent(
        targetState = routeKey,
        modifier = modifier,
        transitionSpec = {
            val spec = tween<Float>(effective)
            val slideSpec = tween<androidx.compose.ui.unit.IntOffset>(effective)
            (fadeIn(spec) + slideInVertically(slideSpec) { it / SLIDE_DIVISOR }) togetherWith
                (fadeOut(spec) + slideOutVertically(slideSpec) { -it / SLIDE_DIVISOR })
        },
        label = "route-transition",
    ) { key ->
        content(key)
    }
}
