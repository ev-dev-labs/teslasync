package io.teslasync.android.navigation

/**
 * Coarse window-width buckets, mapped from Material 3 `WindowWidthSizeClass` at the Compose edge
 * (see [io.teslasync.android.navigation.windowWidthOf]). Kept framework-free so the adaptive
 * decisions below are covered by JVM unit tests (AdaptiveNavTest).
 */
enum class WindowWidth { Compact, Medium, Expanded }

/** The primary navigation affordance the adaptive shell shows for a given width. */
enum class NavLayout { BottomBar, Rail, Drawer }

/** Pure adaptive-navigation decisions for the Material 3 shell. */
object AdaptiveNav {
    /** Compact -> bottom bar, Medium -> navigation rail, Expanded -> permanent drawer. */
    fun navLayout(width: WindowWidth): NavLayout =
        when (width) {
            WindowWidth.Compact -> NavLayout.BottomBar
            WindowWidth.Medium -> NavLayout.Rail
            WindowWidth.Expanded -> NavLayout.Drawer
        }

    /** List/detail two-pane is used from medium width up (tablets, foldables, large screens). */
    fun useTwoPane(width: WindowWidth): Boolean = width != WindowWidth.Compact

    /** Whether the expanded-width permanent drawer is shown (vs a modal/dismissible drawer). */
    fun usesPermanentDrawer(width: WindowWidth): Boolean = width == WindowWidth.Expanded

    /** Whether the top app bar shows an Up affordance for [destination] (non-root destinations). */
    fun showUp(destination: Destination): Boolean = !RouteTable.isTopLevel(destination)
}
