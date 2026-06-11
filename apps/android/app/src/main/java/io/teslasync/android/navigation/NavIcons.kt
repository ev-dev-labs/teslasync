package io.teslasync.android.navigation

import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.TeslaGlyphs

/**
 * Maps navigation groups (and therefore destinations) to a stroked [ImageVector]. Icons are a
 * presentation concern, so they live at the Compose boundary rather than in the [Destination]
 * data. Every [NavGroup] resolves to an icon, so navigation-bar/rail items (which require an icon
 * slot) always have one; [io.teslasync.android.navigation.NavIconsTest] guards exhaustiveness.
 */
private val GROUP_ICONS: Map<NavGroup, ImageVector> =
    mapOf(
        NavGroup.Dashboard to NavGlyphs.Dashboard,
        NavGroup.Vehicles to NavGlyphs.Car,
        NavGroup.Charging to NavGlyphs.Bolt,
        NavGroup.TripsDrives to NavGlyphs.Route,
        NavGroup.BatteryEnergy to NavGlyphs.Battery,
        NavGroup.Analytics to NavGlyphs.Chart,
        NavGroup.Maps to TeslaGlyphs.Pin,
        NavGroup.VehicleSystems to NavGlyphs.Sliders,
        NavGroup.Automations to NavGlyphs.Workflow,
        NavGroup.Notifications to NavGlyphs.Bell,
        NavGroup.Telemetry to NavGlyphs.Pulse,
        NavGroup.Diagnostics to TeslaGlyphs.Warning,
        NavGroup.Admin to NavGlyphs.Shield,
        NavGroup.PowerUser to NavGlyphs.Terminal,
        NavGroup.System to NavGlyphs.Server,
        NavGroup.Settings to NavGlyphs.Gear,
        NavGroup.Onboarding to NavGlyphs.Flag,
        NavGroup.Search to NavGlyphs.Search,
        NavGroup.Sharing to NavGlyphs.Share,
        NavGroup.Watch to NavGlyphs.Watch,
        NavGroup.NotFound to TeslaGlyphs.Help,
    )

/** The icon for a navigation [group]. */
fun navGroupIcon(group: NavGroup): ImageVector = GROUP_ICONS.getValue(group)

/** The icon for a destination. Drives/Vehicles get the road/car family; the rest use the group icon. */
fun navIcon(destination: Destination): ImageVector =
    when (destination.id) {
        "drives" -> NavGlyphs.Route
        "vehicles" -> NavGlyphs.Car
        "liveMap" -> TeslaGlyphs.Pin
        "search" -> NavGlyphs.Search
        else -> navGroupIcon(destination.group)
    }
