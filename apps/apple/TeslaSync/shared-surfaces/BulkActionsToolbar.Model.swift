//
//  BulkActionsToolbar.Model.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the bulk-action toolbar. The view binds through `BulkActionsToolbarModel`; no
//  networking lives in the view. The web `BulkActionsToolbar` keeps only local state — a per-action
//  `pending` map and the `useConfirm` dialog — and is otherwise driven entirely by its props
//  (`selectedIds` / `total` / `onClear` / `actions` / `itemNoun`). The native model keeps the same
//  contract: a source emits the current selection snapshot plus the parent's loading / error /
//  connectivity state, the model owns the per-action in-flight set + the confirm dialog, and the
//  projection derives the render phase so the view is a pure function of the resolved state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol BulkActionsToolbarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogBulkActionsToolbarTelemetry: BulkActionsToolbarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound selection feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum BulkActionsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Action descriptor (web `BulkAction` — carries the async `onClick`)

/// One bulk action — the native mirror of the web `BulkAction`. Carries the display fields plus the
/// `run` closure (the web `onClick`, resolving when the mutation completes so the toolbar can drive a
/// per-action spinner). Holds a closure, so it is `Identifiable & Sendable` but not `Equatable`; the
/// projected `BulkActionViewState` is the Equatable display peer.
public struct BulkActionDescriptor: Identifiable, Sendable {
    public let id: String
    public let label: String
    public let systemImage: String?
    public let variant: BulkActionVariant
    public let confirm: BulkActionConfirm?
    public let isDisabled: Bool
    public let run: @Sendable ([BulkSelectionID]) async -> Void

    public init(
        id: String,
        label: String,
        systemImage: String? = nil,
        variant: BulkActionVariant = .default,
        confirm: BulkActionConfirm? = nil,
        isDisabled: Bool = false,
        run: @escaping @Sendable ([BulkSelectionID]) async -> Void
    ) {
        self.id = id
        self.label = label
        self.systemImage = systemImage
        self.variant = variant
        self.confirm = confirm
        self.isDisabled = isDisabled
        self.run = run
    }
}

// MARK: - Input snapshot (web props: selectedIds + total + onClear + actions + itemNoun)

/// One coalesced snapshot of the toolbar's inputs — the native mirror of the web props (the current
/// `selection`, the optional `total`, the `onClear` callback, the `actions`, and the `itemNoun`)
/// plus the parent's lifecycle (`isLoading`, an error message, and connectivity). Carries callbacks,
/// so it is `Sendable` but not `Equatable`.
public struct BulkActionsInput: Sendable {
    public var selection: [BulkSelectionID]
    public var total: Int?
    public var itemNoun: BulkItemNoun?
    public var actions: [BulkActionDescriptor]
    public var onClear: @Sendable () -> Void
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: BulkActionsConnection

    public init(
        selection: [BulkSelectionID] = [],
        total: Int? = nil,
        itemNoun: BulkItemNoun? = nil,
        actions: [BulkActionDescriptor] = [],
        onClear: @escaping @Sendable () -> Void = {},
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: BulkActionsConnection = .live
    ) {
        self.selection = selection
        self.total = total
        self.itemNoun = itemNoun
        self.actions = actions
        self.onClear = onClear
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Pending confirm (web `useConfirm` `dialogProps`)

/// The active confirmation dialog — the native mirror of the web `useConfirm` `dialogProps`. Present
/// while an action that declared a `confirm` payload is awaiting the user's decision; the view binds
/// a `.confirmationDialog` to it.
public struct BulkPendingConfirm: Sendable, Equatable, Identifiable {
    public let actionID: String
    public let title: String
    public let message: String
    public let confirmLabel: String
    public let isDestructive: Bool

    public var id: String {
        actionID
    }

    public init(actionID: String, title: String, message: String, confirmLabel: String, isDestructive: Bool) {
        self.actionID = actionID
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.isDestructive = isDestructive
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `BulkActionsToolbarSource`, recomputes the
/// resolved projection, owns the per-action in-flight set + the confirm dialog, exposes a render
/// `phase`, the resolved view-state, and the `connection` axis, emits `view.opened` once, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class BulkActionsToolbarModel {
    public private(set) var resolved: BulkActionsResolved
    public private(set) var connection: BulkActionsConnection = .live
    public private(set) var pendingConfirm: BulkPendingConfirm?

    public var phase: BulkActionsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any BulkActionsToolbarSource
    @ObservationIgnored private let telemetry: any BulkActionsToolbarTelemetry
    @ObservationIgnored private var input: BulkActionsInput?
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BulkActionsToolbarSource,
        telemetry: any BulkActionsToolbarTelemetry = OSLogBulkActionsToolbarTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = BulkActionsProjection.resolve(BulkActionsInput(isLoading: true))
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: BulkActionsToolbar.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Clears the current selection — the web `onClear` (wired to the Clear button + the Escape key).
    public func clear() {
        input?.onClear()
    }

    /// Runs an action by id — the web `runAction`: ignore while in-flight, gate through the confirm
    /// dialog when the action declares one, else perform it immediately.
    public func runAction(_ id: String) async {
        guard let action = action(for: id), !inFlight.contains(id), !action.isDisabled else { return }
        if let confirm = action.confirm {
            pendingConfirm = BulkPendingConfirm(
                actionID: id,
                title: confirm.title,
                message: confirm.message,
                confirmLabel: confirm.confirmLabel
                    ?? BulkActionsToolbarStrings.string("bulk.confirm.defaultConfirm", "Confirm"),
                isDestructive: action.variant == .danger
            )
            return
        }
        await perform(action)
    }

    /// Confirms the pending action — the web `<ConfirmDialog>` confirm button resolving `true`.
    public func confirmPending() async {
        guard let pending = pendingConfirm, let action = action(for: pending.actionID) else {
            pendingConfirm = nil
            return
        }
        pendingConfirm = nil
        await perform(action)
    }

    /// Dismisses the pending confirm without acting — the web confirm resolving `false`.
    public func cancelPending() {
        pendingConfirm = nil
    }

    private func perform(_ action: BulkActionDescriptor) async {
        guard !inFlight.contains(action.id) else { return }
        let selection = input?.selection ?? []
        inFlight.insert(action.id)
        recompute()
        await action.run(selection)
        inFlight.remove(action.id)
        recompute()
    }

    private func action(for id: String) -> BulkActionDescriptor? {
        input?.actions.first { $0.id == id }
    }

    private func apply(_ input: BulkActionsInput) {
        self.input = input
        connection = input.connection
        pruneState(for: input)
        recompute()
        handleAutoRefresh(for: input.connection)
    }

    private func recompute() {
        guard let input else { return }
        resolved = BulkActionsProjection.resolve(input, inFlight: inFlight)
    }

    /// Drops in-flight / pending-confirm entries whose action vanished after an update.
    private func pruneState(for input: BulkActionsInput) {
        let ids = Set(input.actions.map(\.id))
        inFlight.formIntersection(ids)
        if let pendingConfirm, !ids.contains(pendingConfirm.actionID) {
            self.pendingConfirm = nil
        }
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: BulkActionsConnection) {
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

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "BulkActionsToolbar" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum BulkActionsToolbarStrings {
    public static let table = "BulkActionsToolbar"

    public static let string: BulkActionsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
