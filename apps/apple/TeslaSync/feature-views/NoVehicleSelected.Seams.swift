//
//  NoVehicleSelected.Seams.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  The dependency seams the NoVehicleSelected view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n facade
//  (web `useTranslation`), the onboarding-navigation seam (web `useNavigate` →
//  `/onboarding`), the coalesced source snapshot, the P1/S8 source protocol, and the
//  in-memory source for previews/tests. No networking lives in the view.
//

import Foundation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol NoVehicleSelectedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogNoVehicleSelectedTelemetry: NoVehicleSelectedTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold
/// no hardcoded literals. Keys live in the "NoVehicleSelected" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings without editing the shared catalog.
public enum NoVehicleSelectedStrings {
    public static let table = "NoVehicleSelected"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Onboarding navigation seam (web `useNavigate`)

/// The single navigation the surface drives: the empty-state CTA routes into onboarding
/// (web `navigate('/onboarding')`). The seam keeps routing out of the view so the redirect
/// is unit-testable with a spy; production injects the app router, previews/tests record
/// the intent.
public protocol NoVehicleSelectedNavigator: Sendable {
    /// Routes the user into the onboarding flow (web `EmptyState` action → `/onboarding`).
    func goToOnboarding()
}

/// `os.Logger`-backed default that records the onboarding intent without routing, so
/// previews render the CTA safely.
public struct OSLogNoVehicleSelectedNavigator: NoVehicleSelectedNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func goToOnboarding() {
        logger.info("navigate path=\(NoVehicleSelectedRoute.onboarding, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `NoVehicleSelectedSource`: the selection feed phase
/// plus the live-state freshness + last-update time the freshness chip / banner read.
public struct NoVehicleSelectedUpdate: Sendable, Equatable {
    public var feed: SelectedVehicleFeedPhase
    public var connection: NoVehicleSelectedConnection
    public var updatedAt: Date?

    public init(
        feed: SelectedVehicleFeedPhase,
        connection: NoVehicleSelectedConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.feed = feed
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// selected-vehicle state holder (web `useSelectedVehicle()`); previews/tests use
/// `InMemoryNoVehicleSelectedSource`. The view never talks to the network directly.
@MainActor
public protocol NoVehicleSelectedSource: AnyObject {
    var onUpdate: (@MainActor (NoVehicleSelectedUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the selection (web refetch) — the error-state retry + the stale
    /// auto-refresh.
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryNoVehicleSelectedSource: NoVehicleSelectedSource {
    public var onUpdate: (@MainActor (NoVehicleSelectedUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: NoVehicleSelectedUpdate?

    public init(initial: NoVehicleSelectedUpdate? = nil) {
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
    public func push(_ update: NoVehicleSelectedUpdate) {
        onUpdate?(update)
    }
}
