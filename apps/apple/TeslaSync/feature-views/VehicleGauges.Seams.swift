//
//  VehicleGauges.Seams.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The dependency seams the VehicleGauges view-model binds through, kept apart from the model
//  for the lint length budget: the surface identity, the P1/S11 telemetry contract, the P1/S8
//  source protocol + its in-memory double for previews/tests, and the P1/S10 i18n facade (web
//  `useTranslation`). None of this imports SwiftUI, so the pure + model layer compiles and
//  unit-tests with no rendering toolchain.
//

import Foundation
import OSLog

// MARK: - Surface identity

/// The surface's stable, non-identifying slug — used by the `view.opened` telemetry. Kept
/// SwiftUI-free (off the view struct) so the model + seams layer stays renderer-independent
/// for the isolated unit build.
public enum VehicleGaugesSurface {
    public static let slug = "VehicleGauges"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol VehicleGaugesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogVehicleGaugesTelemetry: VehicleGaugesTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - P1/S8 source protocol + in-memory double

/// The seam the view binds through. Production implements this over the shared P1/S8 state
/// holders — composing the vehicle-detail page's resolved vehicle state (web `useVehicleState`)
/// with the unit-preferences holder (web `useUnits`) and the live-state freshness. Previews and
/// tests use `InMemoryVehicleGaugesSource`. The view never talks to the network directly.
@MainActor
public protocol VehicleGaugesSource: AnyObject {
    var onUpdate: (@MainActor (VehicleGaugesInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying vehicle-state query (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVehicleGaugesSource: VehicleGaugesSource {
    public var onUpdate: (@MainActor (VehicleGaugesInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleGaugesInput?

    public init(initial: VehicleGaugesInput? = nil) {
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
    public func push(_ input: VehicleGaugesInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "VehicleGauges" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings without editing the shared catalog.
public enum VehicleGaugesStrings {
    public static let table = "VehicleGauges"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
