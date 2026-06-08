//
//  VehicleUpgradesWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary.
//
//  NOTE: `DashboardWidgetSize` / `DashboardWidgetRegistration` are the canonical
//  dashboard-grid types declared once for the dashboard-widgets bundle (in
//  DigitalTwinWidget.Model.swift). This surface *references* them so it registers
//  with the same grid system — it must not redefine them (duplicate symbols).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol UpgradesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogUpgradesTelemetry: UpgradesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum UpgradesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum UpgradesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `VehicleUpgradesSource`: the raw upgrade
/// envelope + cached share-link DTOs + the display-formatting context + their
/// load/connection status. The model turns this into the `UpgradesProjection`.
public struct VehicleUpgradesUpdate: Sendable, Equatable {
    public var status: UpgradesLoadStatus
    public var connection: UpgradesConnection
    public var envelope: UpgradeEnvelope
    public var shareLinks: [ShareLinkInput]
    public var format: UpgradesFormatting
    public var updatedAt: Date?

    public init(
        status: UpgradesLoadStatus = .loading,
        connection: UpgradesConnection = .live,
        envelope: UpgradeEnvelope = .none,
        shareLinks: [ShareLinkInput] = [],
        format: UpgradesFormatting = .default,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.envelope = envelope
        self.shareLinks = shareLinks
        self.format = format
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useVehicleUpgrades` / `useShareLinks` /
/// `useDrives` equivalents — `StateHolderModel<LoadableState<…>>` over the KMP
/// `VehicleStore` / `SharingStore` / `DrivingStore`); previews and tests use
/// `InMemoryUpgradesSource`. The view never talks to the network directly.
@MainActor
public protocol VehicleUpgradesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (VehicleUpgradesUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VehicleUpgradesSource`,
/// recomputes the `UpgradesProjection` via `UpgradesProjectionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class VehicleUpgradesModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: UpgradesConnection = .live
    public private(set) var projection: UpgradesProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleUpgradesSource
    @ObservationIgnored private let telemetry: any UpgradesTelemetry
    @ObservationIgnored private var started = false

    public init(source: any VehicleUpgradesSource, telemetry: any UpgradesTelemetry = OSLogUpgradesTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleUpgradesWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached projection stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: VehicleUpgradesUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = UpgradesProjectionBuilder.build(
            envelope: update.envelope,
            shareLinks: update.shareLinks,
            format: update.format
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when nothing resolved; whenever any data is known
    /// the content renders (cached values stay visible behind refresh/errors).
    static func resolvePhase(status: UpgradesLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryUpgradesSource: VehicleUpgradesSource {
    public var onUpdate: (@MainActor (VehicleUpgradesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleUpgradesUpdate?

    public init(initial: VehicleUpgradesUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: VehicleUpgradesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VehicleUpgradesWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum UpgradesStrings {
    public static let table = "VehicleUpgradesWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget body. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum UpgradesAccessibility {
    public static func summary(for projection: UpgradesProjection) -> String {
        var parts: [String] = []
        if projection.hasUpgrades {
            parts.append(
                UpgradesStrings.count(
                    "widget.upgrades.availableCount",
                    "%lld upgrades available",
                    projection.upgrades.count
                )
            )
            parts.append(
                UpgradesStrings.count("widget.upgrades.eligibleCount", "%lld eligible", projection.eligibleCount)
            )
        } else {
            parts.append(UpgradesStrings.string("widget.upgrades.allApplied", "All upgrades applied"))
        }

        if projection.hasActiveShareLinks {
            parts.append(
                UpgradesStrings.count(
                    "widget.upgrades.activeLinksCount",
                    "%lld active share links",
                    projection.activeShareLinkCount
                )
            )
            if let expiry = projection.nearestExpiryText {
                let label = UpgradesStrings.string("widget.upgrades.nearestExpiry", "Nearest expiry")
                parts.append("\(label): \(expiry)")
            }
        } else {
            parts.append(UpgradesStrings.string("widget.upgrades.noShareLinks", "No active share links"))
        }
        return parts.joined(separator: ". ")
    }
}
