//
//  AlertStudioPage.Sources.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The P1/S8 state-holder seams the AlertStudioPage view-model binds through — kept
//  Shared-free so the surface host-compiles and every state is unit-testable. It
//  carries the cache-then-network load model (mirroring the facade
//  `LoadableState`/`FacadeError` SHAPE, ADR-013), the generic list snapshot +
//  presentation resolver that renders every P4 state (loading / empty / error /
//  stale / offline / content), the three concrete read sources (web `useAlertRules`,
//  `useNotificationChannels`, `useAlertMetrics`) with their in-memory doubles +
//  `@Observable` models, and the CRUD mutator seam (web `useSaveAlertRule` /
//  `useDeleteAlertRule` / `useToggleAlertRule` / `useTestAlertRule` /
//  `useSnoozeAlertRule` / `useBulkEnableRules` / `useBulkDisableRules`). No SwiftUI
//  and no direct networking live here.
//

import Foundation
import Observation
import OSLog

// MARK: - Freshness + error taxonomy (ADR-013 + facade `FacadeError` shape)

/// Whether the displayed data is live, older than the freshness window, or served from
/// cache while offline.
public enum ASConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The failure modes a source surfaces, mirroring the shared `FacadeError` shape
/// (offline keeps cached rows; decode is non-retryable; network/api retry).
public enum ASLoadError: Sendable, Equatable {
    case offline
    case network(message: String)
    case decode(message: String)
    case api(status: Int, code: String?, body: String?)

    /// Whether a retry affordance should be offered (web `QueryError` retry).
    public var isRetryable: Bool {
        switch self {
        case .offline, .network, .api: true
        case .decode: false
        }
    }
}

/// The coalesced load status of a list feed.
public enum ASLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed
}

// MARK: - List snapshot + presentation (every state renders — no hidden surfaces)

/// One coalesced snapshot a list source pushes: the status, the resolved rows, the
/// live-state freshness, the in-flight refresh flag, the error (when failed), and the
/// last-updated time.
public struct ASListSnapshot<Element: Sendable & Equatable>: Sendable, Equatable {
    public var status: ASLoadStatus
    public var items: [Element]
    public var connection: ASConnection
    public var refreshing: Bool
    public var error: ASLoadError?
    public var updatedAt: Date?

    public init(
        status: ASLoadStatus = .loading,
        items: [Element] = [],
        connection: ASConnection = .live,
        refreshing: Bool = false,
        error: ASLoadError? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.error = error
        self.updatedAt = updatedAt
    }

    /// Convenience: a loaded snapshot (empty list folds to `.empty`).
    public static func loaded(_ items: [Element], connection: ASConnection = .live) -> ASListSnapshot {
        ASListSnapshot(status: items.isEmpty ? .empty : .loaded, items: items, connection: connection)
    }
}

/// The resolved render branch for a list feed — the native states the P4 contract
/// requires. Pure projection from the raw snapshot (web `data ?? []` widened with the
/// stale / offline / error chrome).
public enum ASListPresentation<Element: Sendable & Equatable>: Sendable, Equatable {
    case loading
    case content([Element], ASConnection, refreshing: Bool)
    case empty(ASConnection)
    case offlineNoData
    case error(retryable: Bool)

    public static func resolve(_ snapshot: ASListSnapshot<Element>) -> ASListPresentation {
        switch snapshot.status {
        case .loading:
            if !snapshot.items.isEmpty {
                return .content(snapshot.items, snapshot.connection, refreshing: true)
            }
            return .loading
        case .loaded:
            if snapshot.items.isEmpty { return .empty(snapshot.connection) }
            return .content(snapshot.items, snapshot.connection, refreshing: snapshot.refreshing)
        case .empty:
            return .empty(snapshot.connection)
        case .failed:
            if !snapshot.items.isEmpty {
                let freshness: ASConnection = snapshot.error == .offline ? .offline : .stale
                return .content(snapshot.items, freshness, refreshing: false)
            }
            if snapshot.error == .offline { return .offlineNoData }
            return .error(retryable: snapshot.error?.isRetryable ?? true)
        }
    }
}

// MARK: - Read sources (web `useAlertRules` / `useNotificationChannels` / `useAlertMetrics`)

/// The alert-rules feed seam (web `useAlertRules`, GET `/alerts/rules`). Production
/// implements this over the shared P1/S8 rules state holder; previews/tests use
/// `ASInMemoryRulesSource`. The view never talks to the network.
@MainActor
public protocol ASRulesSource: AnyObject {
    var onUpdate: (@MainActor (ASListSnapshot<ASAlertRule>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The notification-channels feed seam (web `useNotificationChannels`, GET
/// `/notifications`).
@MainActor
public protocol ASChannelsSource: AnyObject {
    var onUpdate: (@MainActor (ASListSnapshot<ASNotificationChannel>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The computed-metric registry feed seam (web `useAlertMetrics`, GET
/// `/alerts/metrics`).
@MainActor
public protocol ASMetricsSource: AnyObject {
    var onUpdate: (@MainActor (ASListSnapshot<ASComputedMetricSummary>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory rules source for previews + unit tests. Seeds an optional snapshot on
/// `start()`; `push(_:)` drives further snapshots.
@MainActor
public final class ASInMemoryRulesSource: ASRulesSource {
    public var onUpdate: (@MainActor (ASListSnapshot<ASAlertRule>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    private let initial: ASListSnapshot<ASAlertRule>?

    public init(initial: ASListSnapshot<ASAlertRule>? = nil) {
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

    public func push(_ snapshot: ASListSnapshot<ASAlertRule>) {
        onUpdate?(snapshot)
    }
}

/// In-memory channels source for previews + unit tests.
@MainActor
public final class ASInMemoryChannelsSource: ASChannelsSource {
    public var onUpdate: (@MainActor (ASListSnapshot<ASNotificationChannel>) -> Void)?
    public private(set) var startCount = 0
    private let initial: ASListSnapshot<ASNotificationChannel>?

    public init(initial: ASListSnapshot<ASNotificationChannel>? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {}
    public func refresh() {}
    public func push(_ snapshot: ASListSnapshot<ASNotificationChannel>) {
        onUpdate?(snapshot)
    }
}

/// In-memory computed-metric registry source for previews + unit tests.
@MainActor
public final class ASInMemoryMetricsSource: ASMetricsSource {
    public var onUpdate: (@MainActor (ASListSnapshot<ASComputedMetricSummary>) -> Void)?
    public private(set) var startCount = 0
    private let initial: ASListSnapshot<ASComputedMetricSummary>?

    public init(initial: ASListSnapshot<ASComputedMetricSummary>? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {}
    public func refresh() {}
    public func push(_ snapshot: ASListSnapshot<ASComputedMetricSummary>) {
        onUpdate?(snapshot)
    }
}
