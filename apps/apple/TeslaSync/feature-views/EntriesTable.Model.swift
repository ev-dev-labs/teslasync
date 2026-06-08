//
//  EntriesTable.Model.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  View state, the data-binding seam (P1/S8), the `@Observable` model the SwiftUI view
//  renders, the `view.opened` diagnostics seam (P1/S11), and the freshness presentation.
//  Kept KMP-free so the surface host-compiles + host-tests in isolation; production wiring
//  adapts a shared-core DLQ state holder into an `EntriesTableProvider`.
//

import Observation
import os

// MARK: - View state + data seam

/// Cache-then-network state the view switches over (ADR-013). Mirrors the facade
/// `LoadableState` semantics — a cached page stays visible behind a refresh — while staying
/// Shared-free. The `WidgetFreshness` on the resolved states drives the live / stale /
/// offline chip so the surface never presents stale data as live.
public enum EntriesTableViewState: Equatable {
    /// A load is in flight; `cached` is the last page to keep on screen, if any.
    case loading(cached: [DLQEntryRow]?)
    /// A page is available, flagged with how fresh it is.
    case loaded([DLQEntryRow], freshness: WidgetFreshness)
    /// The load resolved with no rows (the "pipeline is clean" empty state).
    case empty(freshness: WidgetFreshness)
    /// The load failed; `cached` is the last page to keep on screen, if any.
    case failed(message: String?, cached: [DLQEntryRow]?)
}

/// The data seam: the view binds to an injected provider (a state holder), never to HTTP.
/// Production wiring adapts the shared KMP DLQ feed into this protocol; previews and tests
/// inject a controlled provider.
@MainActor
public protocol EntriesTableProvider: AnyObject {
    func start(onState: @escaping (EntriesTableViewState) -> Void)
    func stop()
    func refresh()
}

/// `@Observable` model the SwiftUI view renders. It owns no networking — it republishes
/// whatever its injected provider emits, on the main actor.
@MainActor
@Observable
public final class EntriesTableModel {
    public private(set) var state: EntriesTableViewState

    @ObservationIgnored private let provider: EntriesTableProvider

    public init(
        provider: EntriesTableProvider,
        initialState: EntriesTableViewState = .loading(cached: nil)
    ) {
        self.provider = provider
        state = initialState
    }

    public func start() {
        provider.start { [weak self] newState in
            self?.state = newState
        }
    }

    public func stop() {
        provider.stop()
    }

    public func refresh() {
        provider.refresh()
    }
}

// MARK: - Diagnostics (P1/S11)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view fires this in
/// `.onAppear` with the surface slug.
@MainActor
public protocol EntriesTableTelemetry: AnyObject {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` os_log event. The surface slug is a
/// static, non-identifying constant logged verbatim; no payload, VIN, topic, or location is
/// ever recorded.
@MainActor
public final class OSLogEntriesTableTelemetry: EntriesTableTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Freshness presentation

/// Presentation attributes for the freshness chip — derived from the reusable
/// `WidgetFreshness` so the surface matches the app-wide honesty model. The label is
/// pre-resolved (English fallback) so the view renders it verbatim.
struct EntriesFreshnessInfo: Equatable {
    let iconName: String
    let label: String
    let tone: TSTone
}

enum EntriesTableFreshness {
    static func info(for freshness: WidgetFreshness) -> EntriesFreshnessInfo {
        switch freshness {
        case .fresh:
            EntriesFreshnessInfo(iconName: "clock", label: EntriesTableStrings.freshnessLive, tone: .success)
        case .stale:
            EntriesFreshnessInfo(
                iconName: "clock.badge.exclamationmark",
                label: EntriesTableStrings.freshnessStale,
                tone: .warning
            )
        case .offline:
            EntriesFreshnessInfo(iconName: "wifi.slash", label: EntriesTableStrings.freshnessOffline, tone: .neutral)
        }
    }
}
