package io.teslasync.android.navigation

/**
 * Top-level navigation taxonomy, mirroring the route groups of `web/src/App.tsx` (the web
 * sidebar sections). Used to bucket destinations into the expanded-width drawer's grouped
 * navigation and to resolve a section header title via [navGroupTitle].
 *
 * Declaration order is the display order in the drawer.
 */
enum class NavGroup {
    Dashboard,
    Vehicles,
    Charging,
    TripsDrives,
    BatteryEnergy,
    Analytics,
    Maps,
    VehicleSystems,
    Automations,
    Notifications,
    Telemetry,
    Diagnostics,
    Admin,
    PowerUser,
    System,
    Settings,
    Onboarding,
    Search,
    Sharing,
    Watch,
    NotFound,
}
