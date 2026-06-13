// The native Jetpack Compose + Material 3 BottomTabBar shared surface — a parity port of
// web/src/components/layout/BottomTabBar.tsx. The web component is the mobile bottom navigation bar: a fixed
// row of the five most-trafficked routes (Dashboard → Drives → Charging → Battery → Map), each an icon + label
// that links to its section, with the one tab owning the current route highlighted. This surface is the native
// equivalent, built on the Material 3 `NavigationBar` (the Android-idiomatic primitive for exactly this role)
// rather than a port of the web's Tailwind chrome.
//
// All data flows through the shared [BottomTabBarViewModel] over the [BottomTabBarSource] seam (P1/S8) — the
// view performs NO HTTP and never reaches into the navigation controller directly. Every derivation flows
// through the pure [BottomTabBarProjection]; the composable is a thin render layer. The faithful mapping of
// the web behaviour:
//   • `useLocation().pathname` → the current route path, re-shared by the ViewModel into
//     [BottomTabBarViewModel.currentPath] (never HTTP / never a router reach-through from the view).
//   • the per-tab `isActive` derivation → [BottomTabBarProjection.isActive] (root-exact vs exact-or-descendant).
//   • the web `<PrefetchLink to={tab.path} />` tap target → the `NavigationBarItem` `onClick`, raised to the
//     host as `onSelect(destination)` so navigation policy stays with the scaffold.
//   • the web `aria-label={t('nav.quickNav')}` on the `<nav>` landmark → the bar's container
//     `contentDescription`; each `t(tab.i18nKey)` label → the item's visible label, which Material merges into
//     the item's accessibility node so every tab is individually announced.
//
// States reproduced (every one renders the full five-tab bar — nothing is ever hidden): each of the five tabs
// active in turn, a descendant route lighting its section's tab (e.g. `/charging/123` → Charging), and the
// no-tab-active case where the current route lives outside all five sections (e.g. `/settings`). The generic
// network data-states (loading / error / stale / offline) do not apply — this surface fetches nothing; it is
// router-driven navigation chrome — and modelling them would invent behaviour the web spec lacks (see the
// model header; honesty covenant, sibling RouteAnnouncer precedent). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BottomTabBar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bottomtabbar

import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.navIcon
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the bar container so on-device UI tests can locate the rendered bar in any state. */
const val BOTTOM_TAB_BAR_TEST_TAG: String = "bottom-tab-bar"

/** Per-tab test tag so a UI test can target an individual tab regardless of its localized label. */
fun bottomTabItemTestTag(tab: BottomTab): String = "bottom-tab-item-${tab.name}"

/**
 * Stateful entry point bound to the router state-holder — the faithful port of the web `BottomTabBar` reading
 * `useLocation()`. Binds the [BottomTabBarViewModel], records the one-shot `view.opened` diagnostic (P1/S11),
 * collects the current route path, projects it together with the localized labels, and renders the bar.
 *
 * @param viewModel the state holder bound to the shared router-state-holder seam ([BottomTabBarSource]).
 * @param onSelect invoked with the tapped tab's destination; the host applies its navigation policy (web
 *   `<PrefetchLink to={tab.path} />`).
 * @param modifier optional layout modifier for the bar container.
 */
@Composable
fun BottomTabBar(
    viewModel: BottomTabBarViewModel,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val currentPath by viewModel.currentPath.collectAsStateWithLifecycle()
    val strings = rememberBottomTabBarStrings()
    val display = remember(currentPath, strings) { BottomTabBarProjection.project(currentPath, strings) }
    BottomTabBarContent(display = display, onSelect = onSelect, modifier = modifier)
}

/**
 * Stateful entry point driven directly by the owning scaffold's current route — the convenience overload the
 * navigation shell uses when it already holds the live path (from `currentBackStackEntryAsState`), mirroring
 * the sibling RouteAnnouncer's destination-driven overload. Records the one-shot `view.opened` diagnostic,
 * projects the path, and renders the bar; no ViewModel instance is required.
 *
 * @param currentPath the current route path (web `useLocation().pathname`).
 * @param onSelect invoked with the tapped tab's destination; the host applies its navigation policy.
 * @param modifier optional layout modifier for the bar container.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun BottomTabBar(
    currentPath: String,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BottomTabBarDiagnostics.recordViewOpened(logger) }
    val strings = rememberBottomTabBarStrings()
    val display = remember(currentPath, strings) { BottomTabBarProjection.project(currentPath, strings) }
    BottomTabBarContent(display = display, onSelect = onSelect, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the full five-tab Material 3
 * `NavigationBar` from a fully resolved [display]: every tab is always shown (never hidden), the active tab is
 * selected, and the bar carries the localized landmark label (web `aria-label={t('nav.quickNav')}`). Each tab
 * is an icon + label; the icon is decorative and the visible label is the tab's accessibility name, so every
 * interactive element is announced. A tap raises [onSelect] with the tab's destination.
 */
@Composable
fun BottomTabBarContent(
    display: BottomTabBarDisplay,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier =
            modifier
                .testTag(BOTTOM_TAB_BAR_TEST_TAG)
                .semantics { contentDescription = display.navLabel },
    ) {
        display.items.forEach { item ->
            NavigationBarItem(
                selected = item.active,
                onClick = { onSelect(item.destination) },
                icon = { Icon(navIcon(item.destination), contentDescription = null) },
                label = { Text(item.label) },
                modifier = Modifier.testTag(bottomTabItemTestTag(item.tab)),
            )
        }
    }
}

/** Builds the localized labels from the P1/S10 catalog using the web component's exact i18n keys. */
@Composable
private fun rememberBottomTabBarStrings(): BottomTabBarStrings =
    BottomTabBarStrings(
        navLabel = stringResource(R.string.translation_nav_quickNav),
        dashboard = stringResource(R.string.translation_nav_dashboard),
        drives = stringResource(R.string.translation_nav_drives),
        charging = stringResource(R.string.translation_nav_charging),
        battery = stringResource(R.string.translation_nav_battery),
        liveMap = stringResource(R.string.translation_nav_liveMap),
    )

// ── Previews — one per rendered state (each tab active, a descendant route, and no tab active). ─────────────

private fun previewStrings(): BottomTabBarStrings =
    BottomTabBarStrings(
        navLabel = "Quick navigation",
        dashboard = "Dashboard",
        drives = "Drives",
        charging = "Charging",
        battery = "Battery Health",
        liveMap = "Live Map",
    )

@Composable
private fun BottomTabBarPreviewAt(path: String) {
    TeslaSyncTheme(dynamicColor = false) {
        BottomTabBarContent(
            display = BottomTabBarProjection.project(path, previewStrings()),
            onSelect = {},
        )
    }
}

@Preview(name = "BottomTabBar · Dashboard active", showBackground = true)
@Composable
private fun BottomTabBarDashboardPreview() {
    BottomTabBarPreviewAt("/")
}

@Preview(name = "BottomTabBar · Charging active", showBackground = true)
@Composable
private fun BottomTabBarChargingPreview() {
    BottomTabBarPreviewAt("/charging")
}

@Preview(name = "BottomTabBar · Charging descendant active", showBackground = true)
@Composable
private fun BottomTabBarChargingDescendantPreview() {
    BottomTabBarPreviewAt("/charging/123")
}

@Preview(name = "BottomTabBar · Battery active", showBackground = true)
@Composable
private fun BottomTabBarBatteryPreview() {
    BottomTabBarPreviewAt("/battery")
}

@Preview(name = "BottomTabBar · no tab active", showBackground = true)
@Composable
private fun BottomTabBarNoActivePreview() {
    BottomTabBarPreviewAt("/settings")
}
