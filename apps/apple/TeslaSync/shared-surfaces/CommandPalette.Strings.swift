//
//  CommandPalette.Strings.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The localization facade (P1/S10) for the command palette — the native shape of the web `t(key, default)`.
//  Every string the surface renders resolves here by key with the web English fallback, so the Swift sources
//  hold no hardcoded prose. The first block mirrors the web `t()` calls verbatim (the section labels, the
//  scope chips, the recent-time buckets, the empty / footer copy); the second block is the native a11y +
//  leaf-state copy the web gets "for free" from the DOM (the dialog role, the freshness chip, the retry
//  tile). Keys live in the "CommandPalette" table, folded into the app `Localizable.xcstrings` at integration
//  time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping labels
//  deterministic. The `makeCopy()` factory assembles the pure ``PaletteCopy`` the projector consumes.
//

import Foundation

/// The command palette's localization facade. All accessors resolve through ``string(_:_:)`` so the views and
/// the projector copy stay bundle-driven and translatable.
public enum CommandPaletteStrings {
    public static let table = "CommandPalette"

    /// Resolve a key with an English fallback (web `t(key, default)`).
    public static let string: CommandPaletteResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Palette section labels (web `palette.section.*`)

    public static var pages: String {
        string("palette.section.pages", "Pages")
    }

    public static var commands: String {
        string("palette.section.commands", "Vehicle Commands")
    }

    public static var vehicles: String {
        string("palette.section.vehicles", "Vehicles")
    }

    public static var preferences: String {
        string("palette.section.preferences", "Preferences")
    }

    public static var actions: String {
        string("palette.section.actions", "Actions")
    }

    public static var mostUsed: String {
        string("palette.section.mostUsed", "Most Used")
    }

    public static var recent: String {
        string("palette.section.recent", "Recent")
    }

    public static var selectVehicle: String {
        string("palette.section.selectVehicle", "Select Vehicle")
    }

    // MARK: Search section labels (web `search.section.*`)

    /// The per-entity search section heading (web `searchSectionLabel`).
    public static func searchSection(_ type: PaletteSearchHitType) -> String {
        switch type {
        case .vehicle: string("search.section.vehicle", "Vehicles")
        case .drive: string("search.section.drive", "Drives")
        case .charging: string("search.section.charging", "Charging")
        case .alert: string("search.section.alert", "Alerts")
        case .notification: string("search.section.notification", "Notifications")
        case .geofence: string("search.section.geofence", "Geofences")
        case .automation: string("search.section.automation", "Automations")
        case .location: string("search.section.location", "Locations")
        case .trip: string("search.section.trip", "Trips")
        }
    }

    // MARK: Recent-time buckets (web `palette.recent.*`)

    public static var justNow: String {
        string("palette.recent.justNow", "Just now")
    }

    public static func minutesAgo(_ count: Int) -> String {
        String(format: string("palette.recent.minutesAgo", "%dm ago"), locale: .current, count)
    }

    public static func hoursAgo(_ count: Int) -> String {
        String(format: string("palette.recent.hoursAgo", "%dh ago"), locale: .current, count)
    }

    public static func daysAgo(_ count: Int) -> String {
        String(format: string("palette.recent.daysAgo", "%dd ago"), locale: .current, count)
    }

    // MARK: Sublabels (web `→ {name}` / `palette.cmd.*`)

    /// The vehicle-command target preview (web `` `→ ${vehicleName}` ``).
    public static func commandTarget(_ name: String) -> String {
        String(format: string("palette.cmd.target", "→ %@"), locale: .current, name)
    }

    /// The pick-a-vehicle prompt (web `t('palette.cmd.selectVehicle', 'Select vehicle…')`).
    public static var selectVehiclePrompt: String {
        string("palette.cmd.selectVehicle", "Select vehicle…")
    }

    /// The vehicle-switch label (web `t('palette.cmd.switchVehicle', { name, default: 'Switch to {name}' })`).
    public static func switchVehicle(_ name: String) -> String {
        String(format: string("palette.cmd.switchVehicle", "Switch to %@"), locale: .current, name)
    }

    /// The `{state}` fallback for a vehicle with no live state (web literal `'unknown'`).
    public static var unknownState: String {
        string("palette.vehicle.unknownState", "unknown")
    }

    // MARK: Scope chips (web `palette.scope.*` / `palette.placeholder.*`)

    /// The scope label (web `t('palette.scope.{scope}', meta.label)`).
    public static func scopeLabel(_ scope: PaletteScope) -> String {
        string("palette.scope.\(scope.rawValue)", PaletteScopes.meta(for: scope).label)
    }

    /// The active-scope placeholder (web `t('palette.placeholder.{scope}', meta.placeholder)`).
    public static func scopePlaceholder(_ scope: PaletteScope) -> String {
        string("palette.placeholder.\(scope.rawValue)", PaletteScopes.meta(for: scope).placeholder)
    }

    /// The default placeholder (web `t('palette.placeholder', 'Search pages, commands…')`).
    public static var placeholder: String {
        string("palette.placeholder", "Search pages, commands…")
    }

    /// The clear-scope-chip accessible label (web `t('palette.clearScope', { scope, default: 'Clear {scope}
    /// filter' })`).
    public static func clearScope(_ scope: PaletteScope) -> String {
        String(format: string("palette.clearScope", "Clear %@ filter"), locale: .current, scopeLabel(scope))
    }

    // MARK: Header / empty / footer (web `palette.*` + `search.palette.viewAll`)

    /// The vehicle-select header (web `t('palette.selectVehicleFor', { command, default: 'Send "{command}"
    /// to…' })`).
    public static func selectVehicleFor(_ command: String) -> String {
        String(format: string("palette.selectVehicleFor", "Send \"%@\" to…"), locale: .current, command)
    }

    /// The vehicle-select empty message (web `t('palette.noVehicles', 'No vehicles available')`).
    public static var noVehicles: String {
        string("palette.noVehicles", "No vehicles available")
    }

    /// The active-scope empty message (web `t('palette.scope.{scope}.empty', 'No {scope} available')`).
    public static func scopeEmpty(_ scope: PaletteScope) -> String {
        let fallback = "No \(PaletteScopes.meta(for: scope).label.lowercased()) available"
        return string("palette.scope.\(scope.rawValue).empty", fallback)
    }

    /// The no-results message (web `t('palette.noResults', { query, default: 'No results for "{query}"' })`).
    public static func noResults(_ query: String) -> String {
        String(format: string("palette.noResults", "No results for \"%@\""), locale: .current, query)
    }

    /// The view-all-results affordance (web `t('search.palette.viewAll', { query, default: 'View all results
    /// for "{query}"' })`).
    public static func viewAllResults(_ query: String) -> String {
        String(format: string("search.palette.viewAll", "View all results for \"%@\""), locale: .current, query)
    }

    /// The row shortcut a11y label (web `t('palette.shortcut', { keys, default: 'Shortcut: {keys}' })`).
    public static func shortcut(_ keys: String) -> String {
        String(format: string("palette.shortcut", "Shortcut: %@"), locale: .current, keys)
    }

    public static var navigate: String {
        string("palette.navigate", "Navigate")
    }

    public static var select: String {
        string("palette.select", "Select")
    }

    public static var back: String {
        string("palette.back", "Back")
    }

    public static var clearFilter: String {
        string("palette.clearFilter", "Clear filter")
    }

    public static var close: String {
        string("palette.close", "Close")
    }

    public static var vehicleSingular: String {
        string("palette.vehicle", "vehicle")
    }

    public static var vehiclePlural: String {
        string("palette.vehicles", "vehicles")
    }

    public static var filterBy: String {
        string("palette.filterBy", "Filter")
    }

    /// The footer fleet-count line (web `{n} {n === 1 ? 'vehicle' : 'vehicles'}`).
    public static func vehicleCount(_ count: Int) -> String {
        "\(count) \(count == 1 ? vehicleSingular : vehiclePlural)"
    }

    // MARK: Native a11y + leaf-state copy (no web peer — never a blank box)

    /// The dialog's accessible name (the spoken peer of the web `data-role="command-palette"` card).
    public static var dialogTitle: String {
        string("commandPalette.a11y.title", "Command palette")
    }

    /// The search field's accessible label.
    public static var searchFieldLabel: String {
        string("commandPalette.a11y.searchField", "Search pages, commands, and vehicles")
    }

    /// The row select hint announced to VoiceOver.
    public static var rowSelectHint: String {
        string("commandPalette.a11y.rowHint", "Activate")
    }

    /// The back-button accessible label (vehicle-select → search).
    public static var backButton: String {
        string("commandPalette.a11y.back", "Back to search")
    }

    /// The close-button accessible label.
    public static var closeButton: String {
        string("commandPalette.a11y.close", "Close command palette")
    }

    /// The trigger-button label (web `CommandPaletteTrigger` `Search...`).
    public static var triggerLabel: String {
        string("commandPalette.trigger", "Search…")
    }

    public static var loadingA11y: String {
        string("commandPalette.loadingA11y", "Loading commands")
    }

    public static var errorTitle: String {
        string("commandPalette.errorTitle", "Couldn't load commands")
    }

    public static var retry: String {
        string("commandPalette.retry", "Retry")
    }

    public static var live: String {
        string("commandPalette.live", "Live")
    }

    public static var stale: String {
        string("commandPalette.stale", "Stale")
    }

    public static var offline: String {
        string("commandPalette.offline", "Offline")
    }

    public static var staleA11y: String {
        string("commandPalette.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("commandPalette.offlineA11y", "Offline — showing the last loaded commands")
    }

    // MARK: Copy factory (the pure projector bundle)

    /// Assemble the pure ``PaletteCopy`` the projector + item builders consume, resolving every section /
    /// interpolation through this facade.
    public static func makeCopy() -> PaletteCopy {
        PaletteCopy(
            pages: pages,
            commands: commands,
            vehicles: vehicles,
            preferences: preferences,
            actions: actions,
            mostUsed: mostUsed,
            recent: recent,
            selectVehicle: selectVehicle,
            commandLabel: { key, fallback in string(key, fallback) },
            switchVehicleLabel: { switchVehicle($0) },
            commandTarget: { commandTarget($0) },
            selectVehiclePrompt: selectVehiclePrompt,
            searchSection: { searchSection($0) },
            recentAgo: PaletteRecentAgoCopy(
                justNow: justNow,
                minutes: { minutesAgo($0) },
                hours: { hoursAgo($0) },
                days: { daysAgo($0) }
            ),
            unknownState: unknownState
        )
    }
}
