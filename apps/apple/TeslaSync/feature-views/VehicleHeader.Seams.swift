//
//  VehicleHeader.Seams.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  The dependency seams the VehicleHeader view-model binds through, kept apart from the
//  model for the lint length budget: the surface identity, the P1/S11 telemetry
//  contract, the navigation seam (web `<Link to="/vehicles">` back affordance), the
//  wake-command seam (web `useWakeVehicle`), the P1/S8 source protocol + its in-memory
//  double for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the
//  VoiceOver string facade. None of this imports SwiftUI, so the pure + model layer
//  compiles and unit-tests with no rendering toolchain.
//

import Foundation
import OSLog

// MARK: - Surface identity

/// The surface's stable, non-identifying slug — used by the `view.opened` telemetry and
/// the navigation log. Kept SwiftUI-free (off the view struct) so the model + seams
/// layer stays renderer-independent for the isolated unit build.
public enum VehicleHeaderSurface {
    public static let slug = "VehicleHeader"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics sink (consent-gated + redacted there).
public protocol VehicleHeaderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogVehicleHeaderTelemetry: VehicleHeaderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Navigation seam (web `<Link to="/vehicles">`)

/// The back-navigation intent (web `<Link to="/vehicles">` on the header's leading
/// arrow). Keeps routing out of the view; production injects an adapter that pops to the
/// vehicle list, previews/tests use the logging / recording defaults.
public protocol VehicleHeaderNavigator: Sendable {
    func openVehicleList()
}

/// `os.Logger`-backed default that records the navigation intent without routing, so
/// previews render the back button safely.
public struct OSLogVehicleHeaderNavigator: VehicleHeaderNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func openVehicleList() {
        logger.info("navigate route=/vehicles source=\(VehicleHeaderSurface.slug, privacy: .public)")
    }
}

// MARK: - Wake-command seam (web `onWake`)

/// The wake-command intent (web `useWakeVehicle` → `POST /vehicles/{id}/wake`). Keeps
/// the mutation out of the view; production injects an adapter that fires the wake
/// mutation (whose pending flag flows back as `waking` in the next snapshot) and
/// re-fetches state after it lands (web `onRefetchState`), previews/tests use the
/// recording default.
public protocol VehicleHeaderWakeCommand: Sendable {
    func wake()
}

/// `os.Logger`-backed default that records the wake intent without issuing a command, so
/// previews render the wake button safely.
public struct OSLogVehicleHeaderWakeCommand: VehicleHeaderWakeCommand {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "command")
    }

    public func wake() {
        logger.info("command=wake source=\(VehicleHeaderSurface.slug, privacy: .public)")
    }
}

// MARK: - P1/S8 source protocol + in-memory double

/// The seam the view binds through. Production implements this over the shared P1/S8
/// state holders — composing the vehicle query + the live FSM status (web `useVehicles`
/// + `getVehicleStatus(state)`) with the wake mutation's pending flag and the live-state
/// freshness. Previews/tests use `InMemoryVehicleHeaderSource`. The view never talks to
/// the network directly.
@MainActor
public protocol VehicleHeaderSource: AnyObject {
    var onUpdate: (@MainActor (VehicleHeaderInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying vehicle/state query (web refetch / the stale auto-refresh
    /// and the post-wake `refetchState`).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVehicleHeaderSource: VehicleHeaderSource {
    public var onUpdate: (@MainActor (VehicleHeaderInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleHeaderInput?

    public init(initial: VehicleHeaderInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: VehicleHeaderInput) {
        onUpdate?(input)
    }
}

/// A composed wake + back-navigation seam, so one injected adapter (and the test
/// recording double) can satisfy both intents the header forwards.
public protocol VehicleHeaderActions: VehicleHeaderWakeCommand, VehicleHeaderNavigator {}

/// Records every wake/navigate call for tests, with no side effects.
public final class RecordingVehicleHeaderActions: VehicleHeaderActions, @unchecked Sendable {
    public private(set) var wakeCount = 0
    public private(set) var openListCount = 0

    public init() {}

    public func wake() {
        wakeCount += 1
    }

    public func openVehicleList() {
        openListCount += 1
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "VehicleHeader" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum VehicleHeaderStrings {
    public static let table = "VehicleHeader"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
