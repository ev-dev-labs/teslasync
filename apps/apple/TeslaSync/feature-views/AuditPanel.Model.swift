//
//  AuditPanel.Model.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `AuditReplayAuditSource` the view
//  binds through), the cache-then-network load state + error taxonomy, the
//  observable view-model, the P1/S10 i18n facade, and the testable accessibility
//  summary. No SwiftUI view code and no direct networking live here.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError`
/// shape so the production binding is a 1:1 map (offline keeps cached rows;
/// decode is non-retryable; network/api are retryable).
public enum AuditPanelError: Equatable, Sendable {
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

// MARK: - Load state (cache-then-network + stale flag, ADR-013)

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the
/// last cached value to keep on screen behind a refresh/error and the ADR-013
/// `stale` flag. Mirrors the facade `LoadableState` without importing `Shared`,
/// so the surface host-compiles and every branch is unit-testable.
public enum AuditPanelLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(AuditPanelError, cached: Value?, stale: Bool)
}

extension AuditPanelLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the DLQ replay-audit feed, projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryAuditReplayAuditSource`.
@MainActor
public protocol AuditReplayAuditSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (AuditPanelLoadState<[AuditPanelDLQReplayRecord]>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAuditReplayAuditSource: AuditReplayAuditSource {
    public var onUpdate: (@MainActor (AuditPanelLoadState<[AuditPanelDLQReplayRecord]>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>?

    public init(initial: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>? = nil) {
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
    public func push(_ state: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to an `AuditReplayAuditSource`
/// and republishes its load state for SwiftUI to switch over. The view performs
/// no networking; `start`/`stop`/`refresh` delegate to the source. `scopedDlqId`
/// mirrors the web prop that selects the scoped vs global empty message.
@MainActor
@Observable
public final class AuditPanelModel {
    /// The current cache-then-network state for the replay-audit feed.
    public private(set) var state: AuditPanelLoadState<[AuditPanelDLQReplayRecord]> = .idle

    /// The DLQ entry the panel is scoped to, or `nil` when global (web `scopedDlqId`).
    public let scopedDlqId: Int?

    @ObservationIgnored private let source: any AuditReplayAuditSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared replay-audit feed.
    public init(source: any AuditReplayAuditSource, scopedDlqId: Int? = nil) {
        self.source = source
        self.scopedDlqId = scopedDlqId
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>, scopedDlqId: Int? = nil) {
        let inMemory = InMemoryAuditReplayAuditSource(initial: previewState)
        source = inMemory
        self.scopedDlqId = scopedDlqId
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component receives `rows` + `loading`. Maps the
    /// two web props onto the cache-then-network load state so the native surface
    /// renders the identical loading / empty / content branches.
    public convenience init(rows: [AuditPanelDLQReplayRecord], loading: Bool, scopedDlqId: Int? = nil) {
        self.init(previewState: AuditPanelModel.loadState(rows: rows, loading: loading), scopedDlqId: scopedDlqId)
    }

    /// Pure web-prop → load-state mapping (unit-tested): `loading` keeps any rows
    /// as cache (web shows the table with "Loading audit log…" while fetching);
    /// otherwise empty rows become the `EmptyState` and present rows the table.
    /// `nonisolated` because it touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        rows: [AuditPanelDLQReplayRecord],
        loading: Bool
    ) -> AuditPanelLoadState<[AuditPanelDLQReplayRecord]> {
        if loading { return .loading(cached: rows.isEmpty ? nil : rows, stale: false) }
        return rows.isEmpty ? .empty(stale: false) : .loaded(rows, stale: false)
    }

    /// Begins observing the upstream feed (idempotent).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh; any cached rows stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// view holds a hardcoded literal. Keys live in the per-surface "AuditPanel"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time
/// (kept separate so parallel surface prompts never collide on the shared catalog).
public enum AuditPanelStrings {
    public static let table = "AuditPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver label spoken for one audit row. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum AuditPanelAccessibility {
    public static func rowSummary(for row: AuditRowItem) -> String {
        let parts = [
            field("admin.dlq.audit.cols.replayedAt", "Replayed at", row.replayedAtText),
            field("admin.dlq.audit.cols.actor", "Actor", row.actorText),
            field("admin.dlq.audit.cols.dlqId", "DLQ ID", row.dlqIdText),
            field("admin.dlq.audit.cols.result", "Result", row.resultLabel)
        ]
        return parts.joined(separator: ", ")
    }

    private static func field(_ key: String, _ fallback: String, _ value: String) -> String {
        "\(AuditPanelStrings.string(key, fallback)) \(value)"
    }
}
