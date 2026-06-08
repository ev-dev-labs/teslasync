//
//  SuperchargerHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `SuperchargerHistoryModel`; no networking lives in the view. Mirrors the
//  established `LocationFavoritesModel` / `MileageStatsModel` seams so every
//  dashboard surface plugs into the same P4-core state-holder + diagnostics
//  contracts.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which
/// is consent-gated and redacted there.
public protocol SuperchargerHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSuperchargerHistoryTelemetry: SuperchargerHistoryTelemetry {
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
public enum SuperchargerHistoryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip and the stale / offline banners.
public enum SuperchargerHistoryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SuperchargerHistorySource`: the cached
/// DTO inputs (sessions + summary), the active display preferences, and their
/// load/connection status. The model turns this into the render projection.
public struct SuperchargerHistoryUpdate: Sendable, Equatable {
    public var status: SuperchargerHistoryLoadStatus
    public var connection: SuperchargerHistoryConnection
    public var sessions: [SuperchargerSession]
    public var summary: SuperchargerSummary?
    public var options: SuperchargerFormatOptions
    public var updatedAt: Date?

    public init(
        status: SuperchargerHistoryLoadStatus = .loading,
        connection: SuperchargerHistoryConnection = .live,
        sessions: [SuperchargerSession] = [],
        summary: SuperchargerSummary? = nil,
        options: SuperchargerFormatOptions = SuperchargerFormatOptions(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.sessions = sessions
        self.summary = summary
        self.options = options
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useTeslaChargingHistory` projected from the KMP
/// `ChargingStore`, with the user `Settings` supplying the format options);
/// previews and tests use `InMemorySuperchargerHistorySource`.
@MainActor
public protocol SuperchargerHistorySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SuperchargerHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `SuperchargerHistorySource`, recomputes the ranked-sessions + totals
/// projection, and exposes a render `Phase` + freshness for SwiftUI to switch
/// over.
@MainActor
@Observable
public final class SuperchargerHistoryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SuperchargerHistoryConnection = .live
    public private(set) var projection = SuperchargerHistoryProjection(
        items: [],
        totalEnergyText: "",
        totalSpendText: "",
        compactSpendText: "",
        currencyUnit: "$"
    )
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SuperchargerHistorySource
    @ObservationIgnored private let telemetry: any SuperchargerHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SuperchargerHistorySource,
        telemetry: any SuperchargerHistoryTelemetry = OSLogSuperchargerHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the sessions list has at least one row — the web
    /// `entries.length > 0` switch.
    public var hasSessions: Bool {
        projection.hasSessions
    }

    /// Whether a one-column instance collapses to the compact spend hero — the
    /// web `size.cols <= 1` branch.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SuperchargerHistoryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SuperchargerHistoryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = SuperchargerHistoryAdapter.project(
            sessions: update.sessions,
            summary: update.summary,
            options: update.options
        )
        phase = Self.resolvePhase(update.status, hasSessions: projection.hasSessions)
    }

    /// Resolves the render phase. Whenever there are sessions to show, the
    /// content renders and cached values stay visible behind refresh/errors. The
    /// top-level empty state is reserved for a resolved load with no sessions —
    /// the web `entries.length > 0 ? … : <EmptyState/>` switch.
    static func resolvePhase(_ status: SuperchargerHistoryLoadStatus, hasSessions: Bool) -> Phase {
        switch status {
        case .loading:
            hasSessions ? .content : .loading
        case .loaded, .empty:
            hasSessions ? .content : .empty
        case let .failed(message):
            hasSessions ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySuperchargerHistorySource: SuperchargerHistorySource {
    public var onUpdate: (@MainActor (SuperchargerHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SuperchargerHistoryUpdate?

    public init(initial: SuperchargerHistoryUpdate? = nil) {
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
    public func push(_ update: SuperchargerHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SuperchargerHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum SuperchargerHistoryStrings {
    public static let table = "SuperchargerHistoryWidget"

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

/// Builds the VoiceOver value spoken for the widget. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum SuperchargerHistoryAccessibility {
    /// The full-size summary: title · session count · 30-day energy + spend.
    public static func summary(
        sessionCount: Int,
        totalEnergyText: String,
        totalSpendText: String
    ) -> String {
        var parts = [SuperchargerHistoryStrings.string("widget.superchargerHistory.title", "Supercharger History")]
        if sessionCount > 0 {
            parts.append(SuperchargerHistoryStrings.count(
                "widget.superchargerHistory.sessionCountA11y",
                "%lld sessions",
                sessionCount
            ))
            parts.append(SuperchargerHistoryStrings.string(
                "widget.superchargerHistory.totalsA11y",
                "30-day totals %1$@, %2$@"
            )
            .replacingOccurrences(of: "%1$@", with: totalEnergyText)
            .replacingOccurrences(of: "%2$@", with: totalSpendText))
        } else {
            parts.append(SuperchargerHistoryStrings.string(
                "widget.superchargerHistory.noData",
                "No Supercharger sessions"
            ))
        }
        return parts.joined(separator: ". ")
    }

    /// The compact summary: the 30-day Supercharger spend hero.
    public static func compactSummary(currencyUnit: String, spendText: String) -> String {
        let label = SuperchargerHistoryStrings.string(
            "widget.superchargerHistory.compactLabel",
            "30-day Supercharger"
        )
        return "\(label). \(currencyUnit)\(spendText)"
    }
}
