//
//  CommandPalette.Items.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The pure palette-row builders — the SwiftUI-free port of the web component's `useMemo` item factories
//  (`navItems`, `commandItems`, `vehicleSwitchItems`, `registryItems`, `mostUsedItems`, `recentPageItems`,
//  `searchResultItems`, `vehicleItems`) plus the `allItems` concatenation and the `displayItems` mode switch.
//  Each builder takes the host's already-resolved feed (the snapshot) + the localized copy bundle and returns
//  `[PaletteItem]`, exactly mirroring the web ordering + id-prefixing + sublabel composition. No SwiftUI and no
//  `@Observable`, so every builder is unit-testable in isolation. The scoring / filtering / grouping that runs
//  over these rows lives in the sibling `CommandPalette.Projector.swift`.
//

import Foundation

// MARK: - Localized copy bundle (the web `t()` reads the builders need)

/// The relative-time copy for the "Recent" rows — the native bundle of the web `formatRecentVisitedAgo`
/// `t()` reads. Closures keep the pure core free of `NSLocalizedString`.
public struct PaletteRecentAgoCopy {
    public let justNow: String
    public let minutes: (Int) -> String
    public let hours: (Int) -> String
    public let days: (Int) -> String

    public init(
        justNow: String,
        minutes: @escaping (Int) -> String,
        hours: @escaping (Int) -> String,
        days: @escaping (Int) -> String
    ) {
        self.justNow = justNow
        self.minutes = minutes
        self.hours = hours
        self.days = days
    }
}

/// The localized copy the row builders consume — the native bundle of the web `t()` calls the item factories
/// make: the eight palette section labels, the command-label resolver (web `t(cfg.labelKey, fallback)`), and
/// the interpolated sublabels (`Switch to {name}`, `→ {name}`, `Select vehicle…`, the per-type search section,
/// the relative-time line, and the `unknown` state fallback). Injected by the model from the P1/S10 facade;
/// tests pass identity-fallback closures.
public struct PaletteCopy {
    public let pages, commands, vehicles, preferences, actions, mostUsed, recent, selectVehicle: String
    public let commandLabel: (String, String) -> String
    public let switchVehicleLabel: (String) -> String
    public let commandTarget: (String) -> String
    public let selectVehiclePrompt: String
    public let searchSection: (PaletteSearchHitType) -> String
    public let recentAgo: PaletteRecentAgoCopy
    public let unknownState: String

    public init(
        pages: String, commands: String, vehicles: String, preferences: String, actions: String,
        mostUsed: String, recent: String, selectVehicle: String,
        commandLabel: @escaping (String, String) -> String,
        switchVehicleLabel: @escaping (String) -> String,
        commandTarget: @escaping (String) -> String,
        selectVehiclePrompt: String,
        searchSection: @escaping (PaletteSearchHitType) -> String,
        recentAgo: PaletteRecentAgoCopy,
        unknownState: String
    ) {
        self.pages = pages
        self.commands = commands
        self.vehicles = vehicles
        self.preferences = preferences
        self.actions = actions
        self.mostUsed = mostUsed
        self.recent = recent
        self.selectVehicle = selectVehicle
        self.commandLabel = commandLabel
        self.switchVehicleLabel = switchVehicleLabel
        self.commandTarget = commandTarget
        self.selectVehiclePrompt = selectVehiclePrompt
        self.searchSection = searchSection
        self.recentAgo = recentAgo
        self.unknownState = unknownState
    }
}

// MARK: - CommandPaletteItems (the web item factories)

/// The pure row builders — the verbatim ports of the web `useMemo` item factories. Free of SwiftUI, a clock,
/// and a bundle so the unit tests reach every ordering / id-prefix / sublabel rule without a rendered view.
public enum CommandPaletteItems {
    /// A non-empty string or `nil` — the native peer of the JS `value || fallback` falsy short-circuit an
    /// empty string triggers (a present-but-empty `display_name` falls through to the `vin`).
    static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// The `{model} · {state}` sublabel (web `` `${v.model ?? ''} · ${v.state ?? 'unknown'}`.trim() ``).
    static func vehicleSublabel(_ vehicle: PaletteVehicle, copy: PaletteCopy) -> String {
        let model = vehicle.model ?? ""
        let state = vehicle.state ?? copy.unknownState
        return "\(model) · \(state)".trimmingCharacters(in: .whitespaces)
    }

    /// The nav pages (web `navItems`): every nav entry, auth-filtered like the sidebar, sectioned under
    /// "Pages" with a `{group} · {kw1, kw2, kw3}` sublabel.
    public static func navItems(
        _ entries: [PaletteNavEntry],
        isForwardAuth: Bool,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        entries
            .filter { !$0.requiresAuth || isForwardAuth }
            .map { entry in
                let sublabel = entry.keywords.isEmpty
                    ? entry.sectionTitle
                    : "\(entry.sectionTitle) · \(entry.keywords.prefix(3).joined(separator: ", "))"
                return PaletteItem(
                    id: entry.path,
                    label: entry.label,
                    section: copy.pages,
                    iconName: entry.iconName,
                    kind: .navigate,
                    sublabel: sublabel,
                    keywords: entry.keywords,
                    action: .navigate(path: entry.path)
                )
            }
    }

    /// The vehicle commands (web `commandItems`): the static catalog, sectioned under "Vehicle Commands",
    /// hidden when the fleet is empty. The sublabel previews the single-vehicle target or prompts to pick one.
    public static func commandItems(
        vehicles: [PaletteVehicle],
        configs: [PaletteCommandConfig] = PaletteCommandConfig.all,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        guard !vehicles.isEmpty else { return [] }
        let single = vehicles.count == 1
            ? (nonEmpty(vehicles[0].displayName) ?? nonEmpty(vehicles[0].vin))
            : nil
        return configs.map { cfg in
            let sublabel = single.map { copy.commandTarget($0) } ?? copy.selectVehiclePrompt
            return PaletteItem(
                id: "cmd-\(cfg.command)",
                label: copy.commandLabel(cfg.labelKey, cfg.labelFallback),
                section: copy.commands,
                iconName: cfg.iconName,
                kind: .command,
                sublabel: sublabel,
                keywords: cfg.keywords,
                action: .selectCommand(command: cfg.command)
            )
        }
    }

    /// The vehicle-switch rows (web `vehicleSwitchItems`): one row per fleet vehicle other than the active
    /// one, hidden for a 0/1-vehicle fleet (nothing to switch to).
    public static func vehicleSwitchItems(
        vehicles: [PaletteVehicle],
        activeID: Int?,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        guard vehicles.count >= 2 else { return [] }
        return vehicles
            .filter { $0.id != activeID }
            .map { vehicle in
                let name = nonEmpty(vehicle.displayName) ?? nonEmpty(vehicle.vin) ?? ""
                let keywords = ["switch", "vehicle", "select", vehicle.displayName ?? "", vehicle.vin ?? ""]
                    .filter { !$0.isEmpty }
                return PaletteItem(
                    id: "switch-vehicle-\(vehicle.id)",
                    label: copy.switchVehicleLabel(name),
                    section: copy.vehicles,
                    iconName: "arrow.left.arrow.right",
                    kind: .vehicleSwitch,
                    sublabel: vehicleSublabel(vehicle, copy: copy),
                    keywords: keywords,
                    action: .switchVehicle(id: vehicle.id)
                )
            }
    }

    /// The static registry rows (web `registryItems`): theme / refresh / navigate-to-feature commands,
    /// sectioned by their declared registry section.
    public static func registryItems(_ entries: [PaletteRegistryEntry], copy: PaletteCopy) -> [PaletteItem] {
        entries.map { entry in
            let section: String = switch entry.section {
            case .preferences: copy.preferences
            case .actions: copy.actions
            case .pages: copy.pages
            case .vehicles: copy.vehicles
            }
            return PaletteItem(
                id: entry.id,
                label: entry.label,
                section: section,
                iconName: entry.iconName,
                kind: .registry,
                shortcut: entry.shortcut,
                keywords: entry.keywords,
                action: .runRegistry(id: entry.id)
            )
        }
    }

    /// The frecency-ranked "Most Used" rows (web `mostUsedItems`): the top-N candidates with a positive score,
    /// re-keyed with a `most-used-` prefix so they never collide with their canonical entry below.
    public static func mostUsedItems(
        candidates: [PaletteItem],
        scores: [String: Double],
        copy: PaletteCopy
    ) -> [PaletteItem] {
        let ranked = candidates
            .map { (item: $0, score: scores[$0.id] ?? 0) }
            .filter { $0.score > 0 }
            .sorted { $0.score > $1.score }
            .prefix(CommandPaletteSurface.mostUsedMaxDisplay)
        return ranked.map { entry in
            reKey(entry.item, id: "most-used-\(entry.item.id)", section: copy.mostUsed)
        }
    }

    /// The recently-visited pages (web `recentPageItems`): strict-recency navigation rows, re-keyed with a
    /// `recent-page-` prefix, captioned with the relative-time line.
    public static func recentPageItems(
        pages: [PaletteRecentPage],
        now: Date,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        pages.prefix(CommandPaletteSurface.recentPagesDisplayLimit).map { entry in
            PaletteItem(
                id: "recent-page-\(entry.path)",
                label: entry.title,
                section: copy.recent,
                iconName: recentPageIconName(entry.kind),
                kind: .navigate,
                sublabel: CommandPaletteProjector.recentAgo(visitedAt: entry.visitedAt, now: now, copy: copy.recentAgo),
                keywords: [entry.path, entry.kind.rawValue],
                action: .navigate(path: entry.path)
            )
        }
    }

    /// The server search hits (web `searchResultItems`): the live entity results, sectioned per entity type.
    public static func searchResultItems(_ hits: [PaletteSearchHit], copy: PaletteCopy) -> [PaletteItem] {
        hits.map { hit in
            PaletteItem(
                id: "search-\(hit.type.rawValue)-\(hit.id)",
                label: hit.title,
                section: copy.searchSection(hit.type),
                iconName: searchHitIconName(hit.type),
                kind: .searchHit,
                sublabel: hit.subtitle,
                action: .openSearchResult(url: hit.url)
            )
        }
    }

    /// The vehicle-select rows (web `vehicleItems`): one row per fleet vehicle that runs the pending command
    /// against it. A `nil` pending command yields inert rows (web no-op), matching the source.
    public static func vehicleItems(
        vehicles: [PaletteVehicle],
        pendingCommand: String?,
        copy: PaletteCopy
    ) -> [PaletteItem] {
        vehicles.map { vehicle in
            let name = nonEmpty(vehicle.displayName) ?? nonEmpty(vehicle.vin) ?? ""
            let action: PaletteAction = pendingCommand
                .map { .executeCommand(command: $0, vehicleID: vehicle.id) } ?? .noop
            return PaletteItem(
                id: "vehicle-\(vehicle.id)",
                label: name,
                section: copy.selectVehicle,
                iconName: "car.fill",
                kind: .navigate,
                sublabel: vehicleSublabel(vehicle, copy: copy),
                action: action
            )
        }
    }

    // MARK: Glyph mapping (web `searchHitIcon` / `recentPageIcon`)

    /// SF Symbol for a server search hit (web `searchHitIcon`).
    static func searchHitIconName(_ type: PaletteSearchHitType) -> String {
        switch type {
        case .vehicle: "car.fill"
        case .drive: "road.lanes"
        case .charging: "battery.100.bolt"
        case .alert: "bell.badge.fill"
        case .notification: "bell.fill"
        case .geofence: "mappin.and.ellipse"
        case .automation: "arrow.triangle.branch"
        case .location: "mappin"
        case .trip: "safari"
        }
    }

    /// SF Symbol for a recently-visited page (web `recentPageIcon`).
    static func recentPageIconName(_ kind: PaletteRecentKind) -> String {
        switch kind {
        case .vehicle: "car.fill"
        case .drive: "road.lanes"
        case .charging: "battery.100.bolt"
        case .trip: "safari"
        case .geofence: "mappin.and.ellipse"
        case .yearReview: "calendar"
        case .page: "doc.text"
        }
    }

    /// Re-key a row under a new id + section, preserving every other field (web `{ ...item, id, section }`).
    private static func reKey(_ item: PaletteItem, id: String, section: String) -> PaletteItem {
        PaletteItem(
            id: id,
            label: item.label,
            section: section,
            iconName: item.iconName,
            kind: item.kind,
            sublabel: item.sublabel,
            shortcut: item.shortcut,
            keywords: item.keywords,
            action: item.action
        )
    }
}
