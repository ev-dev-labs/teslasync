package io.teslasync.android.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink

/**
 * The single Navigation-Compose graph. Every destination in [Destinations] is registered with its
 * path arguments and deep-link URI patterns, so deep links resolve for every web path + alias and
 * unknown routes fall through to [RouteTable.notFound]. Screen content comes from [PageHosts] when
 * an A7 page has wired it; otherwise the route renders the shared [NotFoundScreen] — the route is
 * recorded as metadata, never as a fabricated page.
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
    }
}
