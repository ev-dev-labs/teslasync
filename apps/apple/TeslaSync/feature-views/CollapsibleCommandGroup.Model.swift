//
//  CollapsibleCommandGroup.Model.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  The value layer behind the SwiftUI parity of
//  features/system/components/CollapsibleCommandGroup.tsx. The web component is a
//  pure presentational disclosure container: it fetches nothing, its only hook is
//  `useTranslation`, and the one piece of state it owns is the per-(vehicle,
//  category) open flag it mirrors into `sessionStorage`. Everything host-free
//  lives here so the XCTest suite can cover it without a rendering host:
//
//    • CollapsibleCommandCategory — the native port of the web `CommandCategory`
//      union + `CATEGORY_META` (label key, English fallback, decorative icon),
//      kept in the exact web `CATEGORY_ORDER`.
//    • CollapsibleCommandGroupAdapter — the "cache → projection" seam: the
//      `sessionStorage` key derivation and the stored-flag → initial-expansion
//      resolution (the web `stored !== null ? stored === 'true' : defaultOpen`).
//    • CollapsibleCommandGroupProjection — the Equatable render config the view
//      and its tests share so the two never drift.
//    • CollapsibleCommandGroupStrings — the P1/S10 i18n facade (web `t(key, default)`).
//    • CollapsibleCommandGroupSurface — the P1/S11 `view.opened` identity.
//

import SwiftUI

// MARK: - Category (web `CommandCategory` + `CATEGORY_META`)

/// The command category a group represents — the native port of the web
/// `CommandCategory` string union. Raw values are the verbatim web identifiers so
/// the persisted `sessionStorage` key (and any cross-platform contract) matches
/// byte-for-byte. Declaration order is the web `CATEGORY_ORDER`, so
/// `allCases` is the canonical ordering.
public enum CollapsibleCommandCategory: String, CaseIterable, Sendable {
    case security
    case climate
    case climateProtection = "climate_protection"
    case charging
    case doors
    case drive
    case windows
    case sunroof
    case schedules
    case alerts
    case navigation
    case software
    case vehicle
    case media

    /// The P1/S10 catalog key for the group label (web `CATEGORY_META[c].labelKey`).
    public var labelKey: String {
        switch self {
        case .security: "commands.cat.security"
        case .climate: "commands.cat.climate"
        case .climateProtection: "commands.cat.climateProtect"
        case .charging: "commands.cat.charging"
        case .doors: "commands.cat.doors"
        case .drive: "commands.cat.drive"
        case .windows: "commands.cat.windows"
        case .sunroof: "commands.cat.sunroof"
        case .schedules: "commands.cat.schedules"
        case .alerts: "commands.cat.alerts"
        case .navigation: "commands.cat.navigation"
        case .software: "commands.cat.software"
        case .vehicle: "commands.cat.vehicle"
        case .media: "commands.cat.media"
        }
    }

    /// The English fallback for ``labelKey`` (web `CATEGORY_META[c].fallback`),
    /// passed to `NSLocalizedString(value:)` so the view holds no literal.
    public var labelFallback: String {
        switch self {
        case .security: "Security & Access"
        case .climate: "Climate & Comfort"
        case .climateProtection: "Climate Protection"
        case .charging: "Charging"
        case .doors: "Doors & Trunk"
        case .drive: "Drive"
        case .windows: "Windows"
        case .sunroof: "Sunroof"
        case .schedules: "Schedules"
        case .alerts: "Alerts & Location"
        case .navigation: "Navigation"
        case .software: "Software"
        case .vehicle: "Vehicle"
        case .media: "Media"
        }
    }

    /// The decorative SF Symbol for the group header — the native analogue of the
    /// web Lucide `CATEGORY_META[c].icon`. Its meaning is carried by the adjacent
    /// label, so the view hides it from VoiceOver.
    public var systemImage: String {
        switch self {
        case .security: "lock.shield"
        case .climate: "wind"
        case .climateProtection: "exclamationmark.shield"
        case .charging: "bolt.fill"
        case .doors: "door.left.hand.open"
        case .drive: "car.fill"
        case .windows: "wind"
        case .sunroof: "arrow.up.to.line"
        case .schedules: "calendar.badge.plus"
        case .alerts: "speaker.wave.2.fill"
        case .navigation: "location.north.fill"
        case .software: "arrow.down.circle"
        case .vehicle: "car.fill"
        case .media: "play.fill"
        }
    }

    /// The position of this category in the web `CATEGORY_ORDER` list.
    public var webOrder: Int {
        Self.allCases.firstIndex(of: self) ?? 0
    }

    /// Resolves a category from the verbatim web identifier (e.g. the value
    /// embedded in a persisted key), returning `nil` for anything unknown.
    public init?(web raw: String) {
        self.init(rawValue: raw)
    }
}

// MARK: - Surface identity (P1/S11 `view.opened`)

/// Stable, non-identifying identity for the `CollapsibleCommandGroup` feature
/// view. The slug is emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum CollapsibleCommandGroupSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "CollapsibleCommandGroup"

    /// Reports the surface becoming visible. This is the exact path the view runs
    /// from its `.task`, factored out so it is unit-testable without a host.
    public static func reportOpen(to telemetry: any CollapsibleCommandGroupTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Adapter (web `sessionStorage` cache → render projection)

/// The pure "cache → projection" seam for the disclosure group. The web source's
/// only persisted state is a per-(vehicle, category) `sessionStorage` string, and
/// its only derived decision is the initial open flag; both are reproduced here
/// as host-free, unit-testable functions.
public enum CollapsibleCommandGroupAdapter {
    /// The persisted-flag values the web writes via `String(next)`.
    public static let expandedFlag = "true"
    public static let collapsedFlag = "false"

    /// The `sessionStorage` key the web derives as
    /// `` `teslasync-cat-${vehicleId}-${category}` ``. Reproduced verbatim so the
    /// native scene-storage key matches the web contract byte-for-byte.
    public static func storageKey(vehicleID: Int, category: CollapsibleCommandCategory) -> String {
        "teslasync-cat-\(vehicleID)-\(category.rawValue)"
    }

    /// Resolves the initial open state from the persisted flag, mirroring the web
    /// `stored !== null ? stored === 'true' : defaultOpen`. A `nil` stored value
    /// (key absent) defers to `defaultOpen`; any present value is truthy only when
    /// it equals ``expandedFlag``.
    public static func resolveExpansion(stored: String?, defaultOpen: Bool) -> Bool {
        guard let stored else { return defaultOpen }
        return stored == expandedFlag
    }

    /// The flag string to persist for a new open state (web `String(next)`).
    public static func flag(forExpanded expanded: Bool) -> String {
        expanded ? expandedFlag : collapsedFlag
    }

    /// Projects the raw inputs into the value the view renders.
    public static func project(
        category: CollapsibleCommandCategory,
        vehicleID: Int,
        commandCount: Int
    ) -> CollapsibleCommandGroupProjection {
        CollapsibleCommandGroupProjection(
            category: category,
            vehicleID: vehicleID,
            commandCount: max(0, commandCount)
        )
    }
}

// MARK: - Projection (pure render config shared by view + tests)

/// The `Equatable` projection of a group's inputs into the structural decisions
/// the view renders. Keeping these in a value type lets the XCTest suite cover the
/// label/count/empty/accessibility policy without a snapshot library — the same
/// approach `ToolCard` and the dashboard-widget surfaces use.
public struct CollapsibleCommandGroupProjection: Equatable, Sendable {
    /// The category this group represents.
    public let category: CollapsibleCommandCategory
    /// The owning vehicle's identifier (web `vehicleId`).
    public let vehicleID: Int
    /// The number of commands in the group (web `count`), clamped to `>= 0`.
    public let commandCount: Int

    public init(category: CollapsibleCommandCategory, vehicleID: Int, commandCount: Int) {
        self.category = category
        self.vehicleID = vehicleID
        self.commandCount = max(0, commandCount)
    }

    /// The label catalog key (web `meta.labelKey`).
    public var labelKey: String {
        category.labelKey
    }

    /// The label English fallback (web `meta.fallback`).
    public var labelFallback: String {
        category.labelFallback
    }

    /// The decorative header icon (web `meta.icon`).
    public var systemImage: String {
        category.systemImage
    }

    /// The persisted scene-storage key (web `sessionStorage` key).
    public var storageKey: String {
        CollapsibleCommandGroupAdapter.storageKey(vehicleID: vehicleID, category: category)
    }

    /// Whether the group has no commands. When expanded in this state the view
    /// shows a friendly empty state rather than a blank grid (P4 leaf contract).
    public var isEmpty: Bool {
        commandCount <= 0
    }

    /// The localized group label (web `t(meta.labelKey, meta.fallback)`).
    public var label: String {
        CollapsibleCommandGroupStrings.categoryLabel(category)
    }

    /// The parenthesised count shown beside the label (web `({count})`).
    public var countBadge: String {
        "(\(commandCount))"
    }

    /// The VoiceOver label: the group name plus its command count, so the control
    /// is announced coherently (web exposes both via the button text).
    public var accessibilityLabel: String {
        let commands = String(
            format: CollapsibleCommandGroupStrings.string(
                "collapsibleGroup.a11y.countCommands", "%lld commands"
            ),
            commandCount
        )
        return "\(label), \(commands)"
    }

    /// The VoiceOver value for the disclosure state (web `aria-expanded`).
    public func accessibilityValue(expanded: Bool) -> String {
        expanded
            ? CollapsibleCommandGroupStrings.string("collapsibleGroup.a11y.expanded", "Expanded")
            : CollapsibleCommandGroupStrings.string("collapsibleGroup.a11y.collapsed", "Collapsed")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "CollapsibleCommandGroup"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum CollapsibleCommandGroupStrings {
    public static let table = "CollapsibleCommandGroup"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized group label for a category (web `t(meta.labelKey, meta.fallback)`).
    public static func categoryLabel(_ category: CollapsibleCommandCategory) -> String {
        string(category.labelKey, category.labelFallback)
    }
}
