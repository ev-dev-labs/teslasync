//
//  GeofenceDrawer.Seams.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The dependency seams the GeofenceDrawer view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the create / edit / delete control seam
//  (web `onCreate` / `onEdit` / `onDelete`), the coalesced source snapshot, the P1/S8 source
//  protocol (production wraps the shared map state holder — the web `useMap` parent-map handle is a
//  passive map reference, NOT an HTTP hook, so there is no networking in the view), the in-memory
//  source for previews/tests, the P1/S10 i18n facade, and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol GeofenceDrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogGeofenceDrawerTelemetry: GeofenceDrawerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Create/edit/delete control seam (web `onCreate` / `onEdit` / `onDelete`)

/// The drawer's command seam. `create` is the web `onCreate(NewGeofence)`, `edit` the web
/// `onEdit(id, NewGeofence)`, `delete` the web `onDelete(id)`. Keeps the geofence store out of the
/// view; the production app injects an adapter that drives the real persistence mutation, while
/// previews/tests use the logging / spy defaults.
public protocol GeofenceDrawerController: Sendable {
    func create(_ geofence: NewGeofence)
    func edit(id: String, geofence: NewGeofence)
    func delete(id: String)
}

/// `os.Logger`-backed default that records the intents without mutating a store, so previews run
/// safely.
public struct OSLogGeofenceDrawerController: GeofenceDrawerController {
    private let logger: Logger
    private let surface = GeofenceDrawerSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "geofence")
    }

    public func create(_ geofence: NewGeofence) {
        let shape = geofence.shape.rawValue
        logger.info("geofence.create shape=\(shape, privacy: .public) surface=\(surface, privacy: .public)")
    }

    public func edit(id: String, geofence: NewGeofence) {
        logger.info("geofence.edit id=\(id, privacy: .public) shape=\(geofence.shape.rawValue, privacy: .public)")
    }

    public func delete(id: String) {
        logger.info("geofence.delete id=\(id, privacy: .public) surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `GeofenceDrawerSource`: the load status, the persisted fences
/// (web `fences`), the allowed draw modes (web `modes`), the map's focus center (web `useMap`
/// camera), the live-state freshness, and the in-flight flag. `fences == nil` means "not resolved
/// yet" so the surface can show its first-load skeleton.
public struct GeofenceDrawerUpdate: Sendable, Equatable {
    public var status: GeofenceDrawerLoadStatus
    public var fences: [GeofenceItem]?
    public var modes: [GeofenceDrawerMode]
    public var center: GeofencePoint?
    public var connection: GeofenceDrawerConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: GeofenceDrawerLoadStatus = .loading,
        fences: [GeofenceItem]? = nil,
        modes: [GeofenceDrawerMode] = GeofenceDrawerMode.defaultModes,
        center: GeofencePoint? = nil,
        connection: GeofenceDrawerConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.fences = fences
        self.modes = modes
        self.center = center
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders
/// — resolving the persisted fences, the allowed modes, the map focus, and the live-state freshness,
/// plus a refresh affordance. Previews/tests use `InMemoryGeofenceDrawerSource`. The view never
/// reads persistence directly.
@MainActor
public protocol GeofenceDrawerSource: AnyObject {
    var onUpdate: (@MainActor (GeofenceDrawerUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the fences + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryGeofenceDrawerSource: GeofenceDrawerSource {
    public var onUpdate: (@MainActor (GeofenceDrawerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GeofenceDrawerUpdate?

    public init(initial: GeofenceDrawerUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: GeofenceDrawerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with a web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "GeofenceDrawer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum GeofenceDrawerStrings {
    public static let table = "GeofenceDrawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// One-token substitution convenience (`{{token}}` → value) over the resolved string.
    public static func string(_ key: String, _ fallback: String, _ token: String, _ value: String) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum GeofenceDrawerAccessibility {
    /// The dialog summary (web `aria` heading equivalent).
    public static func summary(localize: (String, String) -> String) -> String {
        localize("geofence.title", "Geofences")
    }

    /// The map canvas label.
    public static func mapLabel(localize: (String, String) -> String) -> String {
        localize("geofence.map.label", "Geofence map")
    }

    /// One draw-mode control's VoiceOver label, with the selected state appended.
    public static func modeLabel(
        _ mode: GeofenceDrawerMode,
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        let name = localize(mode.labelKey, mode.labelFallback)
        guard selected else { return name }
        return "\(name), \(localize("geofence.selected", "selected"))"
    }

    /// The step-by-step hint guiding the active draw (the native analog of the leaflet-draw
    /// tooltip), keyed by mode + how many points are placed.
    public static func draftHint(_ draft: GeofenceDraft, localize: (String, String) -> String) -> String {
        switch draft.mode {
        case .circle:
            return draft.points.isEmpty
                ? localize("geofence.hint.circle.center", "Tap the map to set the circle center")
                : localize("geofence.hint.circle.radius", "Adjust the slider to set the radius")
        case .rectangle:
            switch draft.points.count {
            case 0: return localize("geofence.hint.rectangle.first", "Tap the first corner")
            case 1: return localize("geofence.hint.rectangle.second", "Tap the opposite corner")
            default: return localize("geofence.hint.rectangle.ready", "Rectangle ready — tap Add")
            }
        case .polygon:
            let remaining = max(0, 3 - draft.points.count)
            guard remaining > 0 else {
                return localize("geofence.hint.polygon.ready", "Polygon ready — tap Add")
            }
            return localize("geofence.hint.polygon.more", "Tap to add a vertex ({{count}} more needed)")
                .replacingOccurrences(of: "{{count}}", with: String(remaining))
        }
    }
}
