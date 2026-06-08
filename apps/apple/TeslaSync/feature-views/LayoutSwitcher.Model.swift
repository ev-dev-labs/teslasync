//
//  LayoutSwitcher.Model.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11 `view.opened`),
//  i18n facade (P1/S10), and the pure input value types for the SwiftUI parity of
//  web/src/features/dashboard/components/LayoutSwitcher.tsx.
//
//  The web component is purely presentational: it receives the `dashboards`
//  array + `activeId` + the `dirty`/`editMode` flags and a handful of callbacks,
//  and reads the selected vehicle + translations + a confirm dialog through
//  hooks. It performs no I/O. The native surface mirrors that exactly: it binds
//  no store and does no networking — the parent dashboard page maps the shared
//  S8 holders (`useSelectedVehicle`, the saved-dashboard collection) into
//  `LayoutSwitcherData` and supplies the callbacks. The confirm dialog
//  (`useConfirm`) and the save-as prompt (`window.prompt`) are realised natively
//  with SwiftUI `.alert`s owned by the view. Dashboard ids arrive as opaque
//  strings; the value types carry only the fields this control reads.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `LayoutSwitcher` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum LayoutSwitcherSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "LayoutSwitcher"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any LayoutSwitcherTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the
/// view can emit from its `.task` without a main-actor hop.
public protocol LayoutSwitcherTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no layout name, VIN, or
/// payload is ever recorded.
public struct OSLogLayoutSwitcherTelemetry: LayoutSwitcherTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t('dashboard', key, default)`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no hardcoded literals. Keys live in the "LayoutSwitcher" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The
/// web source keys (`layout.*`, `common.cancel`) are preserved verbatim so a
/// shared catalog resolves identically across web and native.
public enum LayoutSwitcherStrings {
    public static let table = "LayoutSwitcher"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{name}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Saved dashboard (web `SavedDashboard`)

/// One saved dashboard layout — the projection of the web `SavedDashboard` shape
/// (`../widgets/types`) down to the fields this switcher reads: the opaque id,
/// the display name, the optional per-vehicle scope, and the shipped-default
/// flag. The parent maps the stored collection into these; the control never
/// touches the network.
public struct SavedDashboardSummary: Equatable, Sendable, Identifiable {
    /// Opaque layout id (web `id: string`) — stable identity for the rendered row.
    public let id: String
    /// Display name (web `name`), rendered verbatim.
    public let name: String
    /// Per-vehicle scope (web `vehicleId?: number | null`): `nil` ⇒ user-global
    /// (visible for every vehicle); a value ⇒ pinned to that vehicle id.
    public let vehicleID: Int64?
    /// Whether this is the shipped default layout (web `isDefault`).
    public let isDefault: Bool

    public init(id: String, name: String, vehicleID: Int64? = nil, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.vehicleID = vehicleID
        self.isDefault = isDefault
    }
}

// MARK: - Selected vehicle (web `useSelectedVehicle()` → { vehicleId, vehicle })

/// The currently-selected vehicle projection (web `useSelectedVehicle`). A `nil`
/// holder means "no vehicle selected" (web `vehicleId == null`). The pinned-label
/// builder reads `displayName`/`vin`; the visibility + pin logic read `id`.
public struct LayoutSwitcherVehicle: Equatable, Sendable, Identifiable {
    /// The selected vehicle id (web `vehicleId`).
    public let id: Int64
    /// The vehicle's display name (web `vehicle.display_name`), or `nil`.
    public let displayName: String?
    /// The vehicle's VIN (web `vehicle.vin`), the secondary label fallback.
    public let vin: String?

    public init(id: Int64, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }
}

// MARK: - Control input (web props + the resolved selected vehicle)

/// The pure, `Equatable` input for the `LayoutSwitcher` — the projection of the
/// web props (`dashboards`, `activeId`, `dirty`, `editMode`) plus the resolved
/// `useSelectedVehicle` value. The parent maps the stored collection + the S8
/// selected-vehicle holder into this; the control never touches the network.
public struct LayoutSwitcherData: Equatable, Sendable {
    /// All saved layouts (web `dashboards`), before the per-vehicle visibility filter.
    public let dashboards: [SavedDashboardSummary]
    /// The active layout id (web `activeId`).
    public let activeID: String
    /// Truthy while local state has unsaved changes pending sync (web `dirty`).
    public let dirty: Bool
    /// Whether the dashboard is currently in edit mode (web `editMode`).
    public let editMode: Bool
    /// The selected vehicle (web `useSelectedVehicle`), or `nil` when none is selected.
    public let selectedVehicle: LayoutSwitcherVehicle?

    public init(
        dashboards: [SavedDashboardSummary],
        activeID: String,
        dirty: Bool = false,
        editMode: Bool = false,
        selectedVehicle: LayoutSwitcherVehicle? = nil
    ) {
        self.dashboards = dashboards
        self.activeID = activeID
        self.dirty = dirty
        self.editMode = editMode
        self.selectedVehicle = selectedVehicle
    }

    /// The selected vehicle id (web `vehicleId`), or `nil` when none is selected.
    public var selectedVehicleID: Int64? {
        selectedVehicle?.id
    }
}

// MARK: - Freshness (live / stale / offline) for the layout collection

/// Freshness of the saved-layout collection the parent fed in, mirroring
/// `LiveConnectionState` (ADR-013). The control keeps the cached layouts usable
/// and surfaces a stale/offline chip on the trigger, never hiding the switcher.
public enum LayoutSwitcherConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Only a `live` connection renders no freshness chip; stale/offline annotate
    /// the trigger so the UI never implies data is fresher than it can prove.
    public var isLive: Bool {
        self == .live
    }
}

// MARK: - Control state (every state renders — no hidden surfaces)

/// The render state for the `LayoutSwitcher`. The web control is always `loaded`;
/// the native surface additionally renders the load/empty/error chrome required
/// of every P4 surface so the parent never has to special-case the toolbar slot.
public enum LayoutSwitcherState: Equatable, Sendable {
    /// Initial fetch of the saved layouts — skeleton trigger.
    case loading
    /// Resolved with no layouts at all — friendly empty trigger, never blank.
    case empty
    /// The saved layouts failed to load — message + retry affordance.
    case error(message: String?)
    /// The layouts resolved — the full switcher with every web branch.
    case loaded(LayoutSwitcherData)

    /// The resolved data, if any (convenience for the view/tests).
    public var data: LayoutSwitcherData? {
        if case let .loaded(data) = self { return data }
        return nil
    }
}

// MARK: - Action seam (web callbacks)

/// The callbacks the switcher invokes — the native port of the web component's
/// props. The three web-optional callbacks (`onToggleEdit`, `onDuplicate`,
/// `onPinToVehicle`) stay optional so their presence drives the same conditional
/// affordances the web renders. No mutation logic lives in the control: the
/// parent owns the store-backed effects, exactly like the web component. A plain
/// value bag (used from the MainActor view and constructed directly in tests).
public struct LayoutSwitcherActions {
    /// Web `onSwitch(id)`.
    public let onSwitch: (String) -> Void
    /// Web `onCreate(name) → string | undefined` (the new layout id, or `nil`).
    public let onCreate: (String) -> String?
    /// Web `onReset()`.
    public let onReset: () -> Void
    /// Native-only retry for the error chrome.
    public let onRetry: () -> Void
    /// Web `onToggleEdit?()` — present ⇒ the Edit toggle renders.
    public let onToggleEdit: (() -> Void)?
    /// Web `onDuplicate?(id)` — present ⇒ Save-as duplicates instead of creating.
    public let onDuplicate: ((String) -> Void)?
    /// Web `onPinToVehicle?(id, vehicleId)` — present ⇒ the pin control renders.
    public let onPinToVehicle: ((String, Int64?) -> Void)?

    public init(
        onSwitch: @escaping (String) -> Void,
        onCreate: @escaping (String) -> String?,
        onReset: @escaping () -> Void,
        onRetry: @escaping () -> Void = {},
        onToggleEdit: (() -> Void)? = nil,
        onDuplicate: ((String) -> Void)? = nil,
        onPinToVehicle: ((String, Int64?) -> Void)? = nil
    ) {
        self.onSwitch = onSwitch
        self.onCreate = onCreate
        self.onReset = onReset
        self.onRetry = onRetry
        self.onToggleEdit = onToggleEdit
        self.onDuplicate = onDuplicate
        self.onPinToVehicle = onPinToVehicle
    }
}
