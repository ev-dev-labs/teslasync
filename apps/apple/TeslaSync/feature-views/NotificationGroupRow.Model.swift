//
//  NotificationGroupRow.Model.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  i18n facade (P1/S10) + telemetry seam (P1/S11) + the observable state holder for
//  the notification-thread surface. The view binds through `NotificationGroupRowModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/notifications/components/NotificationGroupRow.tsx. The source seam +
//  in-memory source + snapshot inputs live in NotificationGroupRow.Source.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "NotificationGroupRow" table
/// (the per-surface `.strings`), folded into the app `Localizable.xcstrings` catalog
/// at integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum NotificationGroupStrings {
    public static let table = "NotificationGroupRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol NotificationGroupRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogNotificationGroupRowTelemetry: NotificationGroupRowTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `NotificationGroupRowSource`,
/// projects each snapshot into a render `NotificationGroupPhase` + the thread
/// projection + the expanded member region, owns the expand/collapse + lazy
/// member-load + group mark-read side-effects, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class NotificationGroupRowModel {
    public private(set) var phase: NotificationGroupPhase = .loading
    public private(set) var connection: NotificationConnection = .live
    public private(set) var group: NotificationGroupProjection?
    public private(set) var membersPhase: NotificationMembersPhase = .idle
    public private(set) var expanded = false
    public private(set) var marking = false
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var toast: NotificationGroupToast?

    @ObservationIgnored private let source: any NotificationGroupRowSource
    @ObservationIgnored private let telemetry: any NotificationGroupRowTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var membersRequested = false
    @ObservationIgnored private var lastMembersStatus: NotificationLoadStatus = .loading
    @ObservationIgnored private var lastMembers: [NotificationLogProjection] = []

    public init(
        source: any NotificationGroupRowSource,
        telemetry: any NotificationGroupRowTelemetry = OSLogNotificationGroupRowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
        source.onMembersUpdate = { [weak self] update in self?.applyMembers(update) }
    }

    /// The combined VoiceOver summary for the thread (latest row + counts).
    public var accessibilitySummary: String {
        guard let group else {
            return NotificationGroupStrings.string("notifications.group.empty", "No notifications")
        }
        return NotificationGroupAccessibility.groupSummary(group, localize: NotificationGroupStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NotificationGroupRowSurface.slug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying group query (web refetch) — the error-state retry.
    public func refresh() {
        source.refresh()
    }

    /// Toggles the expanded member region. On the first expand of a non-singleton
    /// thread it triggers the lazy member load (web `useGroupMembers` enabled gate);
    /// collapsing never tears the loaded list down.
    public func toggleExpanded() {
        guard let group, !group.isSingleton else { return }
        expanded.toggle()
        guard expanded else { return }
        if !membersRequested {
            membersRequested = true
            membersPhase = .loading
            source.loadMembers()
        }
    }

    /// Runs the group-scoped mark-read mutation and raises the matching toast (web
    /// `handleMarkGroupRead`). No-op for singletons (web `if (!gk) return`).
    public func markGroupRead() async {
        guard let group, group.groupKey != nil, !marking else { return }
        marking = true
        defer { marking = false }
        let result = await source.markGroupRead()
        switch result {
        case let .success(updated):
            toast = NotificationGroupToast(
                kind: .success,
                message: NotificationGroupCopy.markReadSuccess(
                    count: updated,
                    localize: NotificationGroupStrings.string
                )
            )
        case let .failure(message):
            let base = NotificationGroupCopy.markReadError(localize: NotificationGroupStrings.string)
            let detail = message.flatMap { $0.isEmpty ? nil : $0 }
            toast = NotificationGroupToast(
                kind: .error,
                message: detail.map { "\(base) — \($0)" } ?? base
            )
        }
    }

    /// Dismisses the active toast (auto-dismiss timer / tap).
    public func dismissToast() {
        toast = nil
    }

    // MARK: - Snapshot application

    private func apply(_ update: NotificationGroupUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        group = update.group?.projected(archived: update.archived)
        phase = NotificationGroupProjector.resolvePhase(update.status, hasGroup: group != nil)
        if group?.isSingleton == true {
            // A singleton can never expand — keep the region inert (web grouping
            // chrome hidden) so a thread that collapses to one row shows no caret.
            expanded = false
            membersPhase = .idle
        }
        handleAutoRefresh(for: update.connection)
    }

    private func applyMembers(_ update: NotificationMembersUpdate) {
        lastMembersStatus = update.status
        lastMembers = update.members.map { $0.projected() }
        recomputeMembersPhase()
    }

    /// Recomputes the member region against the current latest id (web
    /// `otherMembers = members.filter(m => m.id !== latest.id)`).
    private func recomputeMembersPhase() {
        guard let latestId = group?.latest.id else {
            membersPhase = membersRequested ? .loading : .idle
            return
        }
        membersPhase = NotificationMembersProjector.project(
            status: lastMembersStatus,
            members: lastMembers,
            latestId: latestId
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached thread on screen and does not refetch.
    private func handleAutoRefresh(for connection: NotificationConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
