package io.teslasync.android.navigation

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.launch

/**
 * The adaptive Material 3 shell hosting [TeslaSyncNavHost]. The primary navigation affordance
 * follows the window width (ADR-002 native, Material 3 adaptive guidance):
 *
 * - Compact  -> bottom [NavigationBar] (top-5) + a modal drawer for the full taxonomy.
 * - Medium   -> [NavigationRail] (section leads) + a modal drawer for the full taxonomy.
 * - Expanded -> a permanent drawer ([PermanentDrawerSheet]) with the full grouped taxonomy.
 *
 * Standalone destinations (shared-drive, watch, onboarding, …) render full-bleed with no chrome,
 * mirroring the web routes that live outside `<Layout>`. The [TeslaSyncNavHost] stays at a stable
 * position in the tree across layouts so the back stack and per-destination state survive resizes.
 */
@Composable
fun AppScaffold(
    navController: NavHostController,
    width: WindowWidth,
    modifier: Modifier = Modifier,
) {
    val layout = AdaptiveNav.navLayout(width)
    val backStackEntry by navController.currentBackStackEntryAsState()
    val current = RouteTable.forRoute(backStackEntry?.destination?.route)
    val showChrome = current.chrome == Chrome.Full
    val snackbarHostState = remember { SnackbarHostState() }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val gate = LocalOnboardingGate.current

    // A4 hook point: an authenticated first-run session is routed to onboarding before its target.
    LaunchedRouteToOnboarding(gate, navController)

    // Notification-tap deep links (ADR-009): a tapped push feeds its teslasync://app/... URI through
    // the DeepLinkRouter into this graph once the signed-in shell exists.
    NotificationDeepLinkHandler(navController)

    // Predictive/legacy back closes the modal drawer first; route pops are handled by the NavHost.
    BackHandler(enabled = drawerState.isOpen) { scope.launch { drawerState.close() } }

    val modalNavEnabled = showChrome && layout != NavLayout.Drawer
    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = modalNavEnabled,
        drawerContent = {
            if (modalNavEnabled) {
                ModalDrawerSheet {
                    NavDrawerList(
                        current = current,
                        onSelect = { destination ->
                            scope.launch { drawerState.close() }
                            navController.navigateTo(destination)
                        },
                    )
                }
            }
        },
    ) {
        Scaffold(
            modifier = modifier,
            topBar = {
                if (showChrome) {
                    AppTopBar(
                        current = current,
                        showUp = AdaptiveNav.showUp(current),
                        showMenu = layout != NavLayout.Drawer,
                        onUp = { navController.navigateUp() },
                        onMenu = { scope.launch { drawerState.open() } },
                        onSearch = { navController.navigateTo(Destinations.require("search")) },
                    )
                }
            },
            bottomBar = {
                if (showChrome && layout == NavLayout.BottomBar) {
                    AppBottomBar(current = current, onSelect = navController::navigateTo)
                }
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) { innerPadding ->
            Row(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
                if (showChrome && layout == NavLayout.Rail) {
                    AppNavRail(
                        current = current,
                        onSelect = navController::navigateTo,
                        onMore = { scope.launch { drawerState.open() } },
                    )
                }
                if (showChrome && layout == NavLayout.Drawer) {
                    AppPermanentDrawer(current = current, onSelect = navController::navigateTo)
                }
                Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    TeslaSyncNavHost(navController = navController, modifier = Modifier.fillMaxSize())
                }
            }
        }
    }

    RouteAnnouncer(current)
}

@Composable
private fun LaunchedRouteToOnboarding(
    gate: OnboardingGate,
    navController: NavHostController,
) {
    LaunchedEffect(gate) {
        if (gate.isOnboardingRequired()) {
            navController.navigate(Destinations.require("onboarding").route) { launchSingleTop = true }
        }
    }
}

@Composable
private fun NotificationDeepLinkHandler(navController: NavHostController) {
    val router = LocalDeepLinkRouter.current ?: return
    val context = LocalContext.current
    val pending by router.links.collectAsStateWithLifecycle()
    LaunchedEffect(pending) {
        val uri = pending ?: return@LaunchedEffect
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
        navController.handleDeepLink(intent)
        router.consume()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppTopBar(
    current: Destination,
    showUp: Boolean,
    showMenu: Boolean,
    onUp: () -> Unit,
    onMenu: () -> Unit,
    onSearch: () -> Unit,
) {
    TopAppBar(
        title = { Text(text = navTitle(current)) },
        navigationIcon = {
            when {
                showUp ->
                    IconActionButton(TeslaGlyphs.ChevronLeft, stringResource(R.string.nav_back), onUp)
                showMenu ->
                    IconActionButton(NavGlyphs.Menu, stringResource(R.string.nav_menu_open), onMenu)
            }
        },
        actions = {
            IconActionButton(NavGlyphs.Search, stringResource(R.string.nav_search_action), onSearch)
        },
    )
}

@Composable
private fun AppBottomBar(
    current: Destination,
    onSelect: (Destination) -> Unit,
) {
    NavigationBar {
        RouteTable.bottomBar.forEach { destination ->
            NavigationBarItem(
                selected = current.id == destination.id,
                onClick = { onSelect(destination) },
                icon = { Icon(navIcon(destination), contentDescription = null) },
                label = { Text(navTitle(destination)) },
            )
        }
    }
}

@Composable
private fun AppNavRail(
    current: Destination,
    onSelect: (Destination) -> Unit,
    onMore: () -> Unit,
) {
    NavigationRail {
        RouteTable.rail.forEach { destination ->
            NavigationRailItem(
                selected = current.id == destination.id,
                onClick = { onSelect(destination) },
                icon = { Icon(navIcon(destination), contentDescription = null) },
                label = { Text(navTitle(destination)) },
            )
        }
        NavigationRailItem(
            selected = false,
            onClick = onMore,
            icon = { Icon(NavGlyphs.Menu, contentDescription = null) },
            label = { Text(stringResource(R.string.nav_more)) },
        )
    }
}

@Composable
private fun AppPermanentDrawer(
    current: Destination,
    onSelect: (Destination) -> Unit,
) {
    PermanentDrawerSheet(modifier = Modifier.width(DRAWER_WIDTH).fillMaxHeight()) {
        NavDrawerList(current = current, onSelect = onSelect)
    }
}

@Composable
private fun NavDrawerList(
    current: Destination,
    onSelect: (Destination) -> Unit,
) {
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.sm),
    ) {
        Text(
            text = stringResource(R.string.nav_drawer_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(Spacing.md),
        )
        RouteTable.drawerSections.forEach { section ->
            Text(
                text = navGroupTitle(section.group),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = Spacing.md, top = Spacing.md, bottom = Spacing.xs),
            )
            section.items.forEach { destination ->
                NavigationDrawerItem(
                    label = { Text(navTitle(destination)) },
                    selected = current.id == destination.id,
                    onClick = { onSelect(destination) },
                    icon = { Icon(navIcon(destination), contentDescription = null) },
                    modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                )
            }
        }
    }
}

@Composable
private fun IconActionButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick) {
        Icon(icon, contentDescription = contentDescription)
    }
}

private val DRAWER_WIDTH = 280.dp
