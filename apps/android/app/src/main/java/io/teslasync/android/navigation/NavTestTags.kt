package io.teslasync.android.navigation

/**
 * Stable Compose test tags for the three adaptive primary-navigation containers ([AppScaffold]).
 *
 * The shell always composes the (closed) modal drawer alongside the bottom bar / rail, so a
 * destination's label appears in more than one place and cannot identify the active affordance.
 * These tags let instrumented tests (`NavigationShellTest`) assert which affordance a given window
 * width actually renders. This is the only test seam the navigation shell exposes.
 */
object NavTestTags {
    const val BOTTOM_BAR = "nav-bottom-bar"
    const val RAIL = "nav-rail"
    const val PERMANENT_DRAWER = "nav-permanent-drawer"
}
