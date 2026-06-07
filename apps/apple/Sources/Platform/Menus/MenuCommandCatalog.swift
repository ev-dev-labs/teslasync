import Foundation

/// The seven top-level macOS command menus TeslaSync completes.
public enum AppMenuCategory: String, CaseIterable, Sendable, Identifiable {
    case file, view, navigate, vehicle, commands, window, help

    public var id: String {
        rawValue
    }

    public var titleKey: String {
        "menu.category.\(rawValue)"
    }
}

/// A keyboard-shortcut specification, free of SwiftUI so menu shortcuts can be
/// asserted (uniqueness, coverage) in pure unit tests. Bridged to SwiftUI's
/// `KeyboardShortcut` at the call site.
public struct MenuShortcut: Hashable, Sendable {
    public let key: String
    public let modifiers: Set<MenuModifier>

    public init(_ key: String, _ modifiers: Set<MenuModifier> = [.command]) {
        self.key = key
        self.modifiers = modifiers
    }

    /// The shortcut rendered with the standard modifier glyphs, e.g. `⌘⇧R`.
    public var displaySymbols: String {
        var result = ""
        if modifiers.contains(.control) { result += "⌃" }
        if modifiers.contains(.option) { result += "⌥" }
        if modifiers.contains(.shift) { result += "⇧" }
        if modifiers.contains(.command) { result += "⌘" }
        result += key.uppercased()
        return result
    }
}

public enum MenuModifier: String, CaseIterable, Sendable {
    case command, shift, option, control
}

/// One menu command. `route` is set for Navigate items, `command` for the
/// Commands menu. `isSystemProvided` marks the standard macOS items (New Window,
/// Close, Toggle Sidebar, the whole Window menu, Help search) that AppKit renders
/// automatically — they are catalogued for completeness but not re-declared.
public struct MenuCommandSpec: Identifiable, Sendable, Equatable {
    public let id: String
    public let category: AppMenuCategory
    public let titleKey: String
    public let shortcut: MenuShortcut?
    public let route: AppRoute?
    public let command: VehicleCommandKind?
    public let isSystemProvided: Bool

    public init(
        id: String,
        category: AppMenuCategory,
        titleKey: String,
        shortcut: MenuShortcut? = nil,
        route: AppRoute? = nil,
        command: VehicleCommandKind? = nil,
        isSystemProvided: Bool = false
    ) {
        self.id = id
        self.category = category
        self.titleKey = titleKey
        self.shortcut = shortcut
        self.route = route
        self.command = command
        self.isSystemProvided = isSystemProvided
    }
}

/// The single source of truth for TeslaSync's macOS menu structure + keyboard
/// shortcuts. Drives the `AppMenuCommands` view and the menu-completeness /
/// shortcut-uniqueness tests, so the two can never silently disagree.
public enum MenuCommandCatalog {
    /// Quick-nav shortcuts mirroring the primary tabs (⌘1–⌘4).
    public static let navigationShortcuts: [AppRoute: MenuShortcut] = [
        .dashboard: MenuShortcut("1"),
        .vehicles: MenuShortcut("2"),
        .charging: MenuShortcut("3"),
        .analytics: MenuShortcut("4")
    ]

    /// Vehicle commands surfaced in the Commands menu (the full safe set).
    public static let menuCommandKinds: [VehicleCommandKind] = VehicleCommandKind.allCases

    /// The complete catalogue across all seven categories.
    public static let all: [MenuCommandSpec] = buildAll()

    /// Catalogued commands for one category, in declaration order.
    public static func commands(in category: AppMenuCategory) -> [MenuCommandSpec] {
        all.filter { $0.category == category }
    }

    /// App-declared (non-system) commands for a category — what `AppMenuCommands`
    /// actually renders.
    public static func appCommands(in category: AppMenuCategory) -> [MenuCommandSpec] {
        commands(in: category).filter { !$0.isSystemProvided }
    }

    /// Every assigned shortcut (system + app), for the uniqueness gate.
    public static var allShortcuts: [MenuShortcut] {
        all.compactMap(\.shortcut)
    }

    /// True when no two commands share a keyboard shortcut.
    public static var hasUniqueShortcuts: Bool {
        Set(allShortcuts).count == allShortcuts.count
    }

    /// True when every category has at least one catalogued command.
    public static var coversAllCategories: Bool {
        AppMenuCategory.allCases.allSatisfy { !commands(in: $0).isEmpty }
    }

    private static func buildAll() -> [MenuCommandSpec] {
        fileCommands() + viewCommands() + navigateCommands() + vehicleCommands()
            + commandMenuCommands() + windowCommands() + helpCommands()
    }

    /// File — Export/Print are app-declared; New Window/Close are system.
    private static func fileCommands() -> [MenuCommandSpec] {
        [
            MenuCommandSpec(
                id: "file.newWindow",
                category: .file,
                titleKey: "menu.file.newWindow",
                shortcut: MenuShortcut("n"),
                isSystemProvided: true
            ),
            MenuCommandSpec(
                id: "file.export",
                category: .file,
                titleKey: "menu.file.export",
                shortcut: MenuShortcut("e"),
                route: .sharing
            ),
            MenuCommandSpec(
                id: "file.print",
                category: .file,
                titleKey: "menu.file.print",
                shortcut: MenuShortcut("p")
            ),
            MenuCommandSpec(
                id: "file.close",
                category: .file,
                titleKey: "menu.file.close",
                shortcut: MenuShortcut("w"),
                isSystemProvided: true
            )
        ]
    }

    /// View — Refresh is app-declared; Sidebar toggle is system.
    private static func viewCommands() -> [MenuCommandSpec] {
        [
            MenuCommandSpec(
                id: "view.toggleSidebar",
                category: .view,
                titleKey: "menu.view.toggleSidebar",
                shortcut: MenuShortcut("s", [.control, .command]),
                isSystemProvided: true
            ),
            MenuCommandSpec(
                id: "view.refresh",
                category: .view,
                titleKey: "menu.view.refresh",
                shortcut: MenuShortcut("r")
            ),
            MenuCommandSpec(id: "view.commandPalette", category: .view, titleKey: "command.palette")
        ]
    }

    /// Navigate — one per route; primary tabs carry ⌘1–⌘4.
    private static func navigateCommands() -> [MenuCommandSpec] {
        AppRoute.allCases.map { route in
            MenuCommandSpec(
                id: "navigate.\(route.rawValue)",
                category: .navigate,
                titleKey: "route.\(route.rawValue)",
                shortcut: navigationShortcuts[route],
                route: route
            )
        }
    }

    private static func vehicleCommands() -> [MenuCommandSpec] {
        [
            MenuCommandSpec(
                id: "vehicle.refreshState",
                category: .vehicle,
                titleKey: "menu.vehicle.refreshState",
                shortcut: MenuShortcut("r", [.shift, .command])
            ),
            MenuCommandSpec(
                id: "vehicle.charging",
                category: .vehicle,
                titleKey: "menu.vehicle.charging",
                route: .charging
            ),
            MenuCommandSpec(
                id: "vehicle.liveMap",
                category: .vehicle,
                titleKey: "menu.vehicle.liveMap",
                route: .maps
            ),
            MenuCommandSpec(
                id: "vehicle.energy",
                category: .vehicle,
                titleKey: "menu.vehicle.energy",
                route: .energy
            )
        ]
    }

    /// Commands — every safe vehicle command; Wake carries ⌘⇧W.
    private static func commandMenuCommands() -> [MenuCommandSpec] {
        menuCommandKinds.map { kind in
            MenuCommandSpec(
                id: "command.\(kind.rawValue)",
                category: .commands,
                titleKey: "intent.command.\(kind.rawValue)",
                shortcut: kind == .wake ? MenuShortcut("w", [.shift, .command]) : nil,
                command: kind
            )
        }
    }

    /// Window — system-provided standard menu.
    private static func windowCommands() -> [MenuCommandSpec] {
        [
            MenuCommandSpec(
                id: "window.minimize",
                category: .window,
                titleKey: "menu.window.minimize",
                shortcut: MenuShortcut("m"),
                isSystemProvided: true
            ),
            MenuCommandSpec(
                id: "window.zoom",
                category: .window,
                titleKey: "menu.window.zoom",
                isSystemProvided: true
            ),
            MenuCommandSpec(
                id: "window.bringAllToFront",
                category: .window,
                titleKey: "menu.window.bringAllToFront",
                isSystemProvided: true
            )
        ]
    }

    private static func helpCommands() -> [MenuCommandSpec] {
        [
            MenuCommandSpec(id: "help.guide", category: .help, titleKey: "menu.help.guide"),
            MenuCommandSpec(id: "help.shortcuts", category: .help, titleKey: "menu.help.shortcuts")
        ]
    }
}
