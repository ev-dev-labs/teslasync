package io.teslasync.android.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import io.teslasync.android.system.help.HelpPageRegistration

/**
 * Route key for the DiagnosticPage system surface (P3-A7 system/Diagnostic). The web page is UNROUTED (no
 * `web/src/App.tsx` route, so no [Destinations] row), so it is registered here as an explicit, standalone
 * Navigation-Compose destination keyed by its page slug and resolved through [PageHosts] — keeping this module
 * decoupled from the feature page exactly as the per-destination loop is. Must match
 * `DiagnosticPageRegistration.ROUTE_ID` in the system.diagnostic surface.
 */
private const val DIAGNOSTIC_PAGE_ROUTE = "DiagnosticPage"

/**
 * The single Navigation-Compose graph. Every destination in [Destinations] is registered with its
 * path arguments and deep-link URI patterns, so deep links resolve for every web path + alias and
 * unknown routes fall through to [RouteTable.notFound]. Screen content comes from [PageHosts] when
 * an A7 page has wired it; otherwise the route renders the shared [NotFoundScreen] — the route is
 * recorded as metadata, never as a fabricated page. Unrouted A7 surfaces (e.g. DiagnosticPage) are
 * registered as explicit standalone destinations after the metadata-driven loop.
 */
@Composable
fun TeslaSyncNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = RouteTable.start.route,
        modifier = modifier,
    ) {
        Destinations.all.forEach { destination ->
            composable(
                route = destination.route,
                arguments = destination.args.map { argName -> navArgument(argName) { type = NavType.StringType } },
                deepLinks = RouteTable.deepLinkUris(destination).map { uri -> navDeepLink { uriPattern = uri } },
            ) { entry ->
                val host = PageHosts.hostFor(destination.id)
                if (host != null) {
                    host(entry)
                } else {
                    NotFoundScreen(
                        attemptedPath = if (destination.id == "notFound") null else destination.webPath,
                        onNavigateHome = { navController.navigateTopLevel(RouteTable.start) },
                    )
                }
            }
        }

        // DiagnosticPage is an unrouted web surface (no App.tsx route, so no Destinations row). It is still
        // reachable as an explicit Navigation-Compose destination keyed by its page slug, wired through the same
        // PageHosts seam so this module stays decoupled from the feature page (P3-A7 system/Diagnostic).
        composable(route = DIAGNOSTIC_PAGE_ROUTE) { entry ->
            val host = PageHosts.hostFor(DIAGNOSTIC_PAGE_ROUTE)
            if (host != null) {
                host(entry)
            } else {
                NotFoundScreen(
                    attemptedPath = null,
                    onNavigateHome = { navController.navigateTopLevel(RouteTable.start) },
                )
            }
        }
    }
}