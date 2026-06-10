//
//  NotificationRow.Model.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  i18n facade (P1/S10) + telemetry seam (P1/S11) + the observable state holder for
//  the inbox notification-row surface. The view binds through `NotificationRowModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/notifications/components/NotificationRow.tsx. The source seam + in-memory
//  source + snapshot inputs live in NotificationRow.Source.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "NotificationRow" table (the
/// per-surface `.strings`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum NotificationRowStrings {
    public static let table = "NotificationRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol NotificationRowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogNotificationRowTelemetry: NotificationRowTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `NotificationRowSource`,
/// projects each snapshot into a render `NotificationRowPhase` + the row projection +
/// the selection / capability state, owns the per-row mark-read / archive / selection
/// / activation / drill-through side-effects, and emits the `view.opened` diagnostics
/// event once on first appearance.
@MainActor
@Observable
public final class NotificationRowModel {
    public private(set) var phase: NotificationRowPhase = .loading
    public private(set) var connection: NotificationRowConnection = .live
    public private(set) var row: NotificationRowProjection?
    public private(set) var selected = false
    public private(set) var capabilities = NotificationRowCapabilities()
    public private(set) var busy: NotificationRowActionKind?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var toast: NotificationRowToast?

    @ObservationIgnored private let source: any NotificationRowSource
    @ObservationIgnored private let telemetry: any NotificationRowTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any NotificationRowSource,
        telemetry: any NotificationRowTelemetry = OSLogNotificationRowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver value for the row (severity + read-state + meta + title).
    public var accessibilitySummary: String {
        guard let row else {
            return NotificationRowStrings.string("notifications.inbox.row.empty", "No notification")
        }
        return NotificationRowAccessibility.rowLabel(row, localize: NotificationRowStrings.string)
    }

    /// The selection-checkbox VoiceOver value (web `aria-checked`).
    public var selectionAccessibilityValue: String {
        NotificationRowAccessibility.selectionValue(selected: selected, localize: NotificationRowStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NotificationRowSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying row query (web refetch) — the error-state retry.
    public func refresh() {
        source.refresh()
    }

    /// Toggles the row selection (web `onSelectionChange(log.id, checked)`),
    /// optimistically updating local state before notifying the source.
    public func setSelected(_ value: Bool) {
        selected = value
        source.setSelected(value)
    }

    /// Fires the row-body activation intent (web `onActivate(log)`). No-op when the
    /// parent did not supply the handler (web optional `onActivate`).
    public func activate() {
        guard capabilities.activate else { return }
        source.activate()
    }

    /// Navigates to the drill-through context page (web `<Link to={drillHref}>`).
    /// No-op when the row has no rule (web `drillHref` is `null`).
    public func openContext() {
        guard let target = row?.drillthrough else { return }
        source.openContext(target)
    }

    /// Runs the mark-read mutation (web `onMarkRead(log.id)`).
    public func markRead() async {
        await runAction(.markRead) { await self.source.markRead() }
    }

    /// Runs the mark-unread mutation (web `onMarkUnread(log.id)`).
    public func markUnread() async {
        await runAction(.markUnread) { await self.source.markUnread() }
    }

    /// Runs the archive mutation (web `onArchive(log.id)`).
    public func archive() async {
        await runAction(.archive) { await self.source.archive() }
    }

    /// Runs the restore mutation (web `onUnarchive(log.id)`).
    public func unarchive() async {
        await runAction(.unarchive) { await self.source.unarchive() }
    }

    /// Dismisses the active toast (auto-dismiss timer / tap).
    public func dismissToast() {
        toast = nil
    }

    // MARK: - Action runner

    /// Runs a per-row mutation guarded by the in-flight `busy` flag (so a button is
    /// disabled while its mutation runs) and raises an inline error toast on failure
    /// (success is reflected by the source's next snapshot — web parent refetch).
    private func runAction(
        _ kind: NotificationRowActionKind,
        _ operation: @MainActor () async -> NotificationRowActionResult
    ) async {
        guard busy == nil else { return }
        busy = kind
        defer { busy = nil }
        let result = await operation()
        if case let .failure(message) = result {
            let base = NotificationRowStrings.string(
                "notifications.inbox.row.actionFailed",
                "Couldn't update notification"
            )
            let detail = message.flatMap { $0.isEmpty ? nil : $0 }
            toast = NotificationRowToast(kind: .error, message: detail.map { "\(base) — \($0)" } ?? base)
        }
    }

    // MARK: - Snapshot application

    private func apply(_ update: NotificationRowUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        selected = update.selected
        capabilities = update.capabilities
        row = update.row?.projected()
        phase = NotificationRowProjector.resolvePhase(update.status, hasRow: row != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached row on screen and does not refetch.
    private func handleAutoRefresh(for connection: NotificationRowConnection) {
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
