//
//  LayoutSwitcher.Adapter.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  The pure, testable projection core for the LayoutSwitcher surface: the web
//  `active` resolution, the per-vehicle `visible` filter, the active/pinned
//  labels, the save-as suggestion + `handleSaveAs` branch, the `handlePinToggle`
//  branch + its disabled rule, the reset `ConfirmDialog` content, the edit-toggle
//  copy, the stale/offline freshness chip, the per-row metadata, and the
//  VoiceOver summaries. No SwiftUI and no I/O — every branch the web source
//  carries is decided here so the XCTest suite can cover it without a rendering
//  host (the same approach the sibling feature views use).
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `LayoutSwitcherStrings` facade (real catalog + English fallback),
/// tests/previews pass `echo` (returns the fallback / formats it directly).
public struct LayoutSwitcherLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = LayoutSwitcherLocalizer(
        string: LayoutSwitcherStrings.string,
        format: LayoutSwitcherStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = LayoutSwitcherLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Row metadata (one rendered dropdown entry)

/// The projection of one visible layout into the metadata the dropdown row + its
/// VoiceOver label need — the port of the web menu item (name + default badge +
/// pin glyph + active check).
public struct LayoutRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// Web `d.isDefault` → the "default" badge.
    public let isDefault: Bool
    /// Web `d.vehicleId != null` → the pin glyph.
    public let isPinned: Bool
    /// Web `d.id === active?.id` → the trailing check + selected styling.
    public let isActive: Bool

    public init(id: String, name: String, isDefault: Bool, isPinned: Bool, isActive: Bool) {
        self.id = id
        self.name = name
        self.isDefault = isDefault
        self.isPinned = isPinned
        self.isActive = isActive
    }
}

// MARK: - Save-as outcome (web `handleSaveAs`)

/// The settled outcome of the save-as prompt — the port of the web `handleSaveAs`
/// branch: an empty/blank name is a no-op; otherwise, when an `onDuplicate`
/// handler + an active layout exist the current layout is duplicated (the typed
/// name is ignored, exactly like the web), else a fresh layout is created.
public enum LayoutSaveAsOutcome: Equatable, Sendable {
    case none
    case duplicate(id: String)
    case create(name: String)
}

// MARK: - Pin toggle (web `handlePinToggle`)

/// The settled outcome of the pin toggle — the port of the web `handlePinToggle`:
/// a layout already pinned to a vehicle is unpinned (scope → `nil`); an unpinned
/// layout is pinned to the selected vehicle; with neither pinned nor a vehicle
/// selected the control is inert.
public enum LayoutPinOutcome: Equatable, Sendable {
    case unpin(id: String)
    case pin(id: String, vehicleID: Int64)
}

/// The rendered state of the pin control — label + the web `disabled` rule.
public struct LayoutPinControl: Equatable, Sendable {
    /// Web `active.vehicleId != null` (pinned ⇒ the row offers "Unpin").
    public let isPinned: Bool
    /// Web `disabled={active.vehicleId == null && vehicleId == null}`.
    public let isDisabled: Bool

    public var labelKey: String {
        isPinned ? "layout.unpin" : "layout.pin"
    }

    public var labelFallback: String {
        isPinned ? "Unpin from vehicle" : "Pin to current vehicle"
    }

    public var systemImage: String {
        isPinned ? "pin.slash" : "pin"
    }
}

// MARK: - Reset confirmation (web `useConfirm` danger dialog)

/// The resolved reset-confirmation content — the port of the web `confirm({...})`
/// props (title, message, confirm + cancel labels).
public struct LayoutResetConfirm: Equatable, Sendable {
    public let title: String
    public let message: String
    public let confirmLabel: String
    public let cancelLabel: String

    public static func build(localize: LayoutSwitcherLocalizer) -> LayoutResetConfirm {
        LayoutResetConfirm(
            title: localize.string("layout.resetTitle", "Reset dashboard to default?"),
            message: localize.string(
                "layout.resetMessage",
                """
                This removes all customizations and restores the shipped default \
                dashboard. Your other saved layouts are not affected.
                """
            ),
            confirmLabel: localize.string("layout.resetConfirm", "Reset"),
            cancelLabel: localize.string("common.cancel", "Cancel")
        )
    }
}

// MARK: - Edit toggle (web Edit button copy)

/// The edit-toggle copy — the port of the web button's label (`Done`/`Edit`) and
/// its `title` tooltip (`Exit edit (E)` / `Edit dashboard (E)`).
public struct LayoutEditLabel: Equatable, Sendable {
    public let label: String
    public let title: String
    public let systemImage: String

    public static func build(editMode: Bool, localize: LayoutSwitcherLocalizer) -> LayoutEditLabel {
        LayoutEditLabel(
            label: editMode
                ? localize.string("layout.editExit", "Done")
                : localize.string("layout.editEnter", "Edit"),
            title: editMode
                ? localize.string("layout.editTitle", "Exit edit (E)")
                : localize.string("layout.editTitle", "Edit dashboard (E)"),
            systemImage: "pencil"
        )
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The trigger freshness chip — `live` shows none, `stale`/`offline` annotate the
/// switcher so it never implies the layout collection is fresher than proven.
public enum LayoutFreshnessChip: Equatable, Sendable {
    case stale
    case offline

    public static func project(_ connection: LayoutSwitcherConnection) -> LayoutFreshnessChip? {
        switch connection {
        case .live: nil
        case .stale: .stale
        case .offline: .offline
        }
    }

    public var labelKey: String {
        switch self {
        case .stale: "layout.freshness.stale"
        case .offline: "layout.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Projections (the web component body, decided without SwiftUI)

/// Pure projections of the web `LayoutSwitcher` body — every conditional render
/// branch the source carries, decided here so the view is a thin renderer and the
/// tests need no host.
public enum LayoutSwitcherProjection {
    /// Web `dashboards.find((d) => d.id === activeId) ?? dashboards[0]`.
    public static func active(
        _ dashboards: [SavedDashboardSummary],
        activeID: String
    ) -> SavedDashboardSummary? {
        dashboards.first { $0.id == activeID } ?? dashboards.first
    }

    /// Web visibility filter: a user-global layout (`scope == null`) is always
    /// visible; a pinned layout shows only when its vehicle is the selected one.
    public static func visible(
        _ dashboards: [SavedDashboardSummary],
        selectedVehicleID: Int64?
    ) -> [SavedDashboardSummary] {
        dashboards.filter { dashboard in
            guard let scope = dashboard.vehicleID else { return true }
            guard let selected = selectedVehicleID else { return false }
            return scope == selected
        }
    }

    /// The visible layouts projected into rendered rows (active flag included).
    public static func rows(
        _ dashboards: [SavedDashboardSummary],
        activeID: String,
        selectedVehicleID: Int64?
    ) -> [LayoutRow] {
        let resolved = active(dashboards, activeID: activeID)
        return visible(dashboards, selectedVehicleID: selectedVehicleID).map { dashboard in
            LayoutRow(
                id: dashboard.id,
                name: dashboard.name,
                isDefault: dashboard.isDefault,
                isPinned: dashboard.vehicleID != nil,
                isActive: dashboard.id == resolved?.id
            )
        }
    }

    /// Web `active?.name ?? t('layout.untitled', 'Untitled')`.
    public static func activeName(
        _ active: SavedDashboardSummary?,
        localize: LayoutSwitcherLocalizer
    ) -> String {
        active?.name ?? localize.string("layout.untitled", "Untitled")
    }

    /// Web `active?.vehicleId != null && vehicle ? (display_name ?? vin ?? "#id") : null`.
    public static func pinnedLabel(
        active: SavedDashboardSummary?,
        vehicle: LayoutSwitcherVehicle?
    ) -> String? {
        guard let scope = active?.vehicleID, let vehicle else { return nil }
        if let displayName = vehicle.displayName, !displayName.isEmpty { return displayName }
        if let vin = vehicle.vin, !vin.isEmpty { return vin }
        return "#\(scope)"
    }

    /// Web save-as suggestion: `"${active.name} (Copy)"` or the new-layout default.
    public static func saveAsSuggestion(
        active: SavedDashboardSummary?,
        localize: LayoutSwitcherLocalizer
    ) -> String {
        guard let active else { return localize.string("layout.newLayoutDefault", "New Layout") }
        return localize.format("layout.copySuffix", "%@ (Copy)", active.name)
    }

    /// Web `handleSaveAs`: blank ⇒ no-op; duplicate when a duplicator + active
    /// layout exist (typed name ignored, as in the web); otherwise create.
    public static func saveAsOutcome(
        name: String,
        active: SavedDashboardSummary?,
        hasDuplicate: Bool
    ) -> LayoutSaveAsOutcome {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .none }
        if hasDuplicate, let active { return .duplicate(id: active.id) }
        return .create(name: trimmed)
    }

    /// The rendered pin control (label + web `disabled` rule).
    public static func pinControl(
        active: SavedDashboardSummary?,
        selectedVehicleID: Int64?
    ) -> LayoutPinControl {
        let isPinned = active?.vehicleID != nil
        let isDisabled = active?.vehicleID == nil && selectedVehicleID == nil
        return LayoutPinControl(isPinned: isPinned, isDisabled: isDisabled)
    }

    /// Web `handlePinToggle`: unpin a pinned layout, else pin to the selected
    /// vehicle, else inert (the disabled case).
    public static func pinOutcome(
        active: SavedDashboardSummary?,
        selectedVehicleID: Int64?
    ) -> LayoutPinOutcome? {
        guard let active else { return nil }
        if active.vehicleID != nil { return .unpin(id: active.id) }
        if let selectedVehicleID { return .pin(id: active.id, vehicleID: selectedVehicleID) }
        return nil
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the switcher announces as coherent elements
/// and the tests can assert label presence without a rendering host.
public enum LayoutSwitcherAccessibility {
    /// The trigger's combined label: "Layout", active name, "modified" (when
    /// dirty), and the pinned-vehicle label (when present).
    public static func triggerLabel(
        activeName: String,
        dirty: Bool,
        pinnedLabel: String?,
        localize: LayoutSwitcherLocalizer
    ) -> String {
        var parts = [localize.string("layout.label", "Layout"), activeName]
        if dirty { parts.append(localize.string("layout.modified", "modified")) }
        if let pinnedLabel { parts.append(pinnedLabel) }
        return parts.joined(separator: ", ")
    }

    /// One dropdown row's label: name, plus "default"/"pinned"/"selected" tags.
    public static func rowLabel(_ row: LayoutRow, localize: LayoutSwitcherLocalizer) -> String {
        var parts = [row.name]
        if row.isDefault { parts.append(localize.string("layout.defaultBadge", "default")) }
        if row.isPinned { parts.append(localize.string("layout.pinnedTag", "pinned")) }
        if row.isActive { parts.append(localize.string("layout.selectedTag", "selected")) }
        return parts.joined(separator: ", ")
    }
}
