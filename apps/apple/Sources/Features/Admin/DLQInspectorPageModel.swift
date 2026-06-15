import Foundation
import Observation

/// The `@Observable` state holder the DLQ Inspector page binds to (ADR-004 — no networking
/// in the view). Owns the dead-letter list state, the global replay-audit state, the
/// drawer's selected row + lazy full-entry state, and the replay interaction state (the
/// confirm target, the in-flight flag, the env-gate banner), reading + writing the four
/// feeds through the injected `DLQInspectorDataSource` seam. Mirrors the sibling
/// `FeatureFlagsPageModel`.
@MainActor
@Observable
public final class DLQInspectorPageModel {
    /// Web `useDLQAudit(null, 50)` — the recent replay-audit window.
    public static let auditLimit = 50

    public private(set) var listState: DLQListState = .loading
    public private(set) var auditState: DLQAuditState = .loading

    /// Web `selected` — the inspected summary row. Drives both the drawer sheet and the
    /// scoped full-entry fetch. A settable var so the drawer's dismissal clears it.
    public var selected: DLQEntrySummary?
    public private(set) var entryState: DLQEntryState = .loading

    /// Web `pendingReplay` — the row awaiting replay confirmation (drives the confirm sheet).
    public var pendingReplay: DLQEntrySummary?
    public private(set) var isReplaying = false

    /// Web `replayDisabledBanner` — the persistent env-gate warning (`DLQ_REPLAY_ENABLED`).
    public var replayDisabledBanner = false

    /// The last non-gate replay failure (web mutation toast), surfaced beside the confirm.
    public private(set) var replayError: String?

    @ObservationIgnored private let dataSource: any DLQInspectorDataSource

    public init(dataSource: any DLQInspectorDataSource = SampleDLQInspectorDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived state

    /// The loaded entries (empty unless the list is `.loaded`).
    public var entries: [DLQEntrySummary] {
        if case let .loaded(result) = listState { return result.entries }
        return []
    }

    /// The loaded audit rows (empty unless the audit feed is `.loaded`).
    public var auditRows: [DLQReplayAuditRecord] {
        if case let .loaded(rows) = auditState { return rows }
        return []
    }

    /// The server `replay_enabled` flag (web `list.data?.replay_enabled ?? false`).
    public var replayEnabled: Bool {
        if case let .loaded(result) = listState { return result.replayEnabled }
        return false
    }

    /// Total DLQ entry count (web `data?.count ?? 0`).
    public var totalCount: Int {
        if case let .loaded(result) = listState { return result.count }
        return 0
    }

    /// Replayable-entry count (web `entries.filter(e => e.replayable).length`).
    public var replayableCount: Int {
        entries.filter(\.replayable).count
    }

    /// Whether the list is still loading (drives the status header em-dash).
    public var isListLoading: Bool {
        if case .loading = listState { return true }
        return false
    }

    /// Whether the full entry is still loading (drives the drawer payload spinner + the CTA).
    public var isEntryLoading: Bool {
        if case .loading = entryState { return true }
        return false
    }

    /// Web `replayDisabled = !replayEnabled || !head?.replayable || replayInFlight || loading`.
    public var replayCTADisabled: Bool {
        !replayEnabled || !(selected?.replayable ?? false) || isReplaying || isEntryLoading
    }

    // MARK: - Loading (web `useDLQList` + `useDLQAudit`)

    /// Mounts both feeds (web renders the list + global audit queries side-by-side).
    public func load() async {
        await reloadList()
        await reloadAudit()
    }

    /// Re-runs the list query (web `useDLQList → GET /system/dlq`).
    public func reloadList() async {
        listState = .loading
        do {
            let result = try await dataSource.loadList()
            listState = result.entries.isEmpty ? .empty : .loaded(result)
        } catch {
            listState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the global audit query (web `useDLQAudit → GET /system/dlq/audit`).
    public func reloadAudit() async {
        auditState = .loading
        do {
            let rows = try await dataSource.loadAudit(limit: Self.auditLimit)
            auditState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            auditState = .error(error.localizedDescription)
        }
    }

    // MARK: - Inspect (web `handleInspect` + `useDLQEntry`)

    /// Web `handleInspect(row)` — opens the drawer on a summary row. The full entry is
    /// lazy-loaded by the drawer's lifecycle task (web `useDLQEntry(id, !!selected)`).
    public func inspect(_ row: DLQEntrySummary) {
        selected = row
        entryState = .loading
    }

    /// Web `useDLQEntry → GET /system/dlq/{numericId}` — the drawer's lazy full-entry fetch.
    public func loadEntry(_ id: Int64) async {
        entryState = .loading
        do {
            let full = try await dataSource.loadEntry(id: id)
            entryState = .loaded(full)
        } catch {
            entryState = .error(error.localizedDescription)
        }
    }

    /// Web drawer `onClose` — dismisses the drawer and resets the scoped entry state.
    public func closeDrawer() {
        selected = nil
        entryState = .loading
    }

    // MARK: - Replay (web `handleAskReplay` / `handleConfirmReplay` + `useDLQReplay`)

    /// Web `handleAskReplay` — stages the open entry for the replay confirmation.
    public func askReplay() {
        guard let selected else { return }
        replayError = nil
        pendingReplay = selected
    }

    /// Web confirm-dialog `onCancel` (ignored while a replay is in flight).
    public func cancelReplay() {
        guard !isReplaying else { return }
        pendingReplay = nil
        replayError = nil
    }

    /// Web `handleConfirmReplay` — replays the entry (sudo-gated). A `disabled` result (soft
    /// flag) or a `DLQReplayDisabledError` (HTTP 403 env gate) raises the persistent banner;
    /// an `ok` result closes the drawer. Other failures keep the dialog open for retry. The
    /// list + audit feeds refresh so the new audit row and updated state render.
    public func confirmReplay() async {
        guard let target = pendingReplay, !isReplaying else { return }
        isReplaying = true
        replayError = nil
        do {
            let outcome = try await dataSource.replay(id: target.id)
            isReplaying = false
            replayDisabledBanner = outcome.result == .disabled
            pendingReplay = nil
            if outcome.result == .ok {
                selected = nil
                entryState = .loading
            }
            await reloadList()
            await reloadAudit()
        } catch is DLQReplayDisabledError {
            replayDisabledBanner = true
            pendingReplay = nil
            isReplaying = false
        } catch {
            replayError = error.localizedDescription
            isReplaying = false
        }
    }

    /// Web banner `onClose`.
    public func dismissReplayBanner() {
        replayDisabledBanner = false
    }
}
