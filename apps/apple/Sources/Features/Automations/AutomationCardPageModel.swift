import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/automations/pages/AutomationCard.tsx`.
//
// The web component is a pure presentational leaf: the `/automations` page (`AutomationsList`)
// maps one `Automation` row plus the live `isFiring` flag and an optional `vehicleName` into the
// card's props and supplies the four callbacks (onToggle / onReEnable / onDelete / onTestRun). It
// performs no I/O. Per the parity manifest this unit "renders from navigation values / local
// state" (no API data sources), so the standalone navigable screen resolves a typed
// `AutomationCardState` over an injectable snapshot seam and applies the web callbacks as local
// optimistic mutations — no networking lives here (ADR-004). The value types
// (`AutomationCardData`, `AutomationCardState`, `AutomationCardActions`,
// `AutomationLiveConnection`) are the shared feature-view contracts, reused verbatim.

// MARK: - Snapshot (web props from the parent query + SSE stream)

/// One coalesced snapshot of the card's inputs — the native mirror of the web props the
/// `/automations` page passes down (`automation`, `isFiring` via `connection`, `vehicleName`).
public struct AutomationCardSnapshot: Sendable, Equatable {
    /// The automation to render, or `nil` when the parent has nothing to show (→ empty card).
    public var automation: AutomationCardData?
    /// Freshness of the live `isFiring` flag (web SSE), driving the firing/stale/offline chip.
    public var connection: AutomationLiveConnection
    /// Whether the parent's automation query is still in flight (→ skeleton card).
    public var isLoading: Bool

    public init(
        automation: AutomationCardData? = nil,
        connection: AutomationLiveConnection = .live,
        isLoading: Bool = false
    ) {
        self.automation = automation
        self.connection = connection
        self.isLoading = isLoading
    }
}

// MARK: - Snapshot seam (web props supplier)

/// Supplies the card snapshot. The production host (the `/automations` page) implements this over
/// its automations query + `useAutomationEvents` SSE stream; previews + tests use stubs. The view
/// never talks to the network directly (ADR-004).
public protocol AutomationCardProviding: Sendable {
    func snapshot() async -> AutomationCardSnapshot
}

/// The default snapshot used by the standalone navigable screen — a representative local
/// automation (the navigation/local-state values the web parent would pass). Vehicle-agnostic
/// reference state, no networking.
public struct DefaultAutomationCard: AutomationCardProviding {
    public init() {}

    public func snapshot() async -> AutomationCardSnapshot {
        AutomationCardSnapshot(
            automation: AutomationCardData(
                id: 1,
                name: "Precondition before commute",
                description: "Warm the cabin on weekday mornings before 8 AM",
                enabled: true,
                lastTriggeredAt: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -22 * 60)),
                executionCount: 142,
                failureCount: 0,
                nextFireTime: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: 16 * 3600)),
                conflicts: [
                    AutomationConflictData(
                        id: 9,
                        automationName: "Close windows at dusk",
                        reason: "both control the windows",
                        severity: "warning"
                    )
                ],
                isFiring: false,
                vehicleName: "Model 3",
                isPinned: true
            ),
            connection: .live
        )
    }
}

// MARK: - Page model

/// The `@Observable` state holder the standalone `AutomationCardPage` binds to. Resolves the
/// card's render state from an injectable snapshot seam and applies the web callbacks
/// (onToggle / onReEnable / onDelete / onTestRun, plus the embedded PinButton) as local
/// optimistic mutations. Holds no networking or business logic (ADR-004).
@MainActor
@Observable
public final class AutomationCardPageModel {
    /// The card's render state — loading / empty / error / loaded, every state rendered.
    public private(set) var state: AutomationCardState = .loading
    /// Live-flag freshness (web SSE), surfaced to the card as the firing/stale/offline chip.
    public private(set) var connection: AutomationLiveConnection = .live

    @ObservationIgnored private let provider: any AutomationCardProviding
    @ObservationIgnored private let now: @Sendable () -> Date

    public init(
        provider: any AutomationCardProviding = DefaultAutomationCard(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.provider = provider
        self.now = now
    }

    /// The currently loaded automation, if any (convenience for the view + tests).
    public var automation: AutomationCardData? {
        state.automation
    }

    /// Loads the snapshot and resolves the terminal render state.
    public func load() async {
        state = .loading
        let snapshot = await provider.snapshot()
        apply(snapshot)
    }

    /// Re-runs the load (error-state retry / pull-to-refresh).
    public func refresh() async {
        await load()
    }

    private func apply(_ snapshot: AutomationCardSnapshot) {
        connection = snapshot.connection
        if snapshot.isLoading {
            state = .loading
        } else if let automation = snapshot.automation {
            state = .loaded(automation)
        } else {
            state = .empty
        }
    }

    // MARK: Web callbacks (applied as local optimistic mutations)

    /// The action bag handed to the card — the web card's four required props plus the embedded
    /// PinButton and the native error-state retry. Rebuilt per access so each closure captures the
    /// current model; only ever read + invoked on the main actor.
    public var actions: AutomationCardActions {
        AutomationCardActions(
            onToggle: { [weak self] id, enabled in self?.toggle(id: id, enabled: enabled) },
            onReEnable: { [weak self] id in self?.reEnable(id: id) },
            onDelete: { [weak self] id in self?.delete(id: id) },
            onTestRun: { [weak self] id in self?.testRun(id: id) },
            onTogglePin: { [weak self] id in self?.togglePin(id: id) },
            onRetry: { [weak self] in Task { await self?.load() } }
        )
    }

    /// Web `onToggle(id, checked)` — flips the enabled flag.
    public func toggle(id: Int64, enabled: Bool) {
        mutate(id) { $0.copy(enabled: enabled) }
    }

    /// Web `onReEnable(id)` — clears the auto-disabled lock and turns the automation back on.
    public func reEnable(id: Int64) {
        mutate(id) { $0.copy(enabled: true, autoDisabled: false, autoDisabledReason: .some(nil)) }
    }

    /// Web `onDelete(id)` — removes the automation; the standalone screen falls to its empty state.
    public func delete(id: Int64) {
        guard automation?.id == id else { return }
        state = .empty
    }

    /// Web `onTestRun(id)` — runs the automation once; the stats row reflects the new run locally.
    public func testRun(id: Int64) {
        let stamp = ISO8601DateFormatter().string(from: now())
        mutate(id) { $0.copy(lastTriggeredAt: .some(stamp), executionCount: $0.executionCount + 1) }
    }

    /// Embedded web `<PinButton>` — toggles the pinned flag.
    public func togglePin(id: Int64) {
        mutate(id) { $0.copy(isPinned: !$0.isPinned) }
    }

    private func mutate(_ id: Int64, _ transform: (AutomationCardData) -> AutomationCardData) {
        guard case let .loaded(current) = state, current.id == id else { return }
        state = .loaded(transform(current))
    }
}

// MARK: - Immutable copy helper

private extension AutomationCardData {
    /// Returns a copy with the given fields overridden. A `nil` outer optional means "leave
    /// unchanged"; `.some(nil)` clears a nullable field — the standard nested-optional copy idiom.
    func copy(
        enabled: Bool? = nil,
        autoDisabled: Bool? = nil,
        autoDisabledReason: String?? = nil,
        lastTriggeredAt: String?? = nil,
        executionCount: Int64? = nil,
        isPinned: Bool? = nil
    ) -> AutomationCardData {
        AutomationCardData(
            id: id,
            name: name,
            description: description,
            enabled: enabled ?? self.enabled,
            autoDisabled: autoDisabled ?? self.autoDisabled,
            autoDisabledReason: autoDisabledReason ?? self.autoDisabledReason,
            lastTriggeredAt: lastTriggeredAt ?? self.lastTriggeredAt,
            executionCount: executionCount ?? self.executionCount,
            failureCount: failureCount,
            nextFireTime: nextFireTime,
            conflicts: conflicts,
            isFiring: isFiring,
            vehicleName: vehicleName,
            isPinned: isPinned ?? self.isPinned
        )
    }
}
