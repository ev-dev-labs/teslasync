//
//  CommandQuickActionsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  State-holder seam (P1/S8) + command-dispatch seam (web `useVehicleCommand`) +
//  telemetry seam (P1/S11) + registry + i18n facade (P1/S10). Vendor-agnostic and
//  SwiftUI-free so the model logic compiles and runs on a plain host (the surface
//  view layers SwiftUI chrome on top in CommandQuickActionsWidget.swift).
//
//  Parity target: features/dashboard/widgets/CommandQuickActionsWidget.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there. This is the native binding of
/// the web widget's `view.opened` diagnostics emission.
public protocol CommandQuickActionsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogCommandQuickActionsTelemetry: CommandQuickActionsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's vehicle data, mirroring the shared
/// `LoadableState` cases the production source projects from the TanStack
/// `useVehicles()` query the web widget consumes.
public enum CommandQuickActionsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying vehicles query, mirroring `LiveConnectionState`
/// (ADR-013) and the web `DataFreshness` chip the `WidgetShell` renders from
/// `isFetching` / `isStale` / `isError`.
public enum CommandQuickActionsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The result of a dispatched command — the native parity of the web
/// `CommandResult` (`{ success, message }`) returned by `useVehicleCommand`'s
/// `POST /vehicles/{vehicleId}/command`.
public struct CommandDispatchResult: Sendable, Equatable {
    public var success: Bool
    public var message: String

    public init(success: Bool, message: String = "") {
        self.success = success
        self.message = message
    }
}

/// One coalesced snapshot pushed by a `CommandQuickActionsSource`: the resolved
/// active vehicle id (web `vehicleId ?? vehicles[0].id ?? 0`) plus the query's
/// load/connection status. The model turns this into a render `Phase`. The source
/// owns vehicle resolution; the view never reads the store directly.
public struct CommandQuickActionsUpdate: Sendable, Equatable {
    public var status: CommandQuickActionsLoadStatus
    public var connection: CommandQuickActionsConnection
    public var isFetching: Bool
    /// The resolved active vehicle id. `nil` or `0` → the "No vehicle selected"
    /// empty surface (web `id ? grid : EmptyState`).
    public var vehicleID: Int64?
    public var updatedAt: Date?

    public init(
        status: CommandQuickActionsLoadStatus = .loading,
        connection: CommandQuickActionsConnection = .live,
        isFetching: Bool = false,
        vehicleID: Int64? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.vehicleID = vehicleID
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `VehicleStore` for resolution + a command
/// gateway for dispatch); previews and tests use `InMemoryCommandQuickActionsSource`.
/// The view never talks to the network directly.
///
/// `send(vehicleID:command:)` is the native parity of the web `useVehicleCommand`
/// mutation (`POST /vehicles/{vehicleId}/command`). It is `async` and returns the
/// command result so the model can surface success/failure exactly as the web
/// `onSuccess` / `onError` toast does.
@MainActor
public protocol CommandQuickActionsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (CommandQuickActionsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func send(vehicleID: Int64, command: String) async -> CommandDispatchResult
}

/// The resolved outcome of the most recent dispatch — the native parity of the web
/// success/error toast decision. Pure value so the model's feedback can be tested.
public struct CommandDispatchOutcome: Sendable, Equatable {
    public var command: String
    public var success: Bool
    public var message: String

    public init(command: String, success: Bool, message: String) {
        self.command = command
        self.success = success
        self.message = message
    }
}

/// The widget's observable view-model. Subscribes to a `CommandQuickActionsSource`,
/// resolves the render `Phase` + freshness for SwiftUI to switch over, and owns the
/// command-dispatch lifecycle (web `activeCommand` + `mutation` + `onSettled`).
@MainActor
@Observable
public final class CommandQuickActionsModel {
    /// The mutually-exclusive render branches (web shell loading + body grid/empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CommandQuickActionsConnection = .live
    public private(set) var isFetching = false
    public private(set) var vehicleID: Int64?
    public private(set) var updatedAt: Date?

    /// The command currently in flight (web `activeCommand`). `nil` when idle. While
    /// non-nil every button is disabled (web `disabled={!!activeCommand}`) and the
    /// matching button shows a spinner (web `isRunning = activeCommand === cmd`).
    public private(set) var activeCommand: String?

    /// The most recent dispatch outcome (web success/error toast parity). Surfaced
    /// as an inline status line + VoiceOver announcement; cleared on the next dispatch.
    public private(set) var lastOutcome: CommandDispatchOutcome?

    @ObservationIgnored private let source: any CommandQuickActionsSource
    @ObservationIgnored private let telemetry: any CommandQuickActionsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any CommandQuickActionsSource,
        telemetry: any CommandQuickActionsTelemetry = OSLogCommandQuickActionsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether a renderable active vehicle is resolved (web `id` truthy). An id of
    /// `0`/`nil` is the "No vehicle selected" empty case.
    public var hasVehicle: Bool {
        Self.hasVehicle(vehicleID)
    }

    /// Whether any command is mid-flight — every button is disabled while true
    /// (web `disabled={!!activeCommand}`).
    public var isDispatching: Bool {
        activeCommand != nil
    }

    /// Whether `command` is the one currently in flight (web `isRunning`).
    public func isRunning(_ command: String) -> Bool {
        activeCommand == command
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandQuickActionsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a vehicles refresh (cached id stays visible). Wired to the retry /
    /// refresh affordances and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched
    /// — the native parity of the web `DataFreshnessAuto` self-refresh on stale.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    /// Dispatches a vehicle command — the native parity of the web `handleCommand`:
    /// guards a resolved vehicle (web `if (!id) return`), guards re-entrancy while a
    /// command is already in flight (web disables all buttons), marks the command
    /// active, awaits the result, then clears the active command on settle (web
    /// `onSettled`) and records the success/failure outcome (web toast).
    public func dispatch(_ command: String) async {
        guard let vehicleID, Self.hasVehicle(vehicleID) else { return }
        guard activeCommand == nil else { return }
        activeCommand = command
        let result = await source.send(vehicleID: vehicleID, command: command)
        activeCommand = nil
        lastOutcome = CommandFeedback.outcome(command: command, result: result)
    }

    private func apply(_ update: CommandQuickActionsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        vehicleID = update.vehicleID
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(status: update.status, hasVehicle: Self.hasVehicle(update.vehicleID))
    }

    /// Whether the snapshot carries a renderable active vehicle — the web
    /// `id ? grid : empty` predicate (`id` is `0` when no vehicle is selected).
    ///
    /// `nonisolated` because it is pure; lets the predicate be unit-tested off the
    /// main actor under Swift 6 strict concurrency.
    public nonisolated static func hasVehicle(_ vehicleID: Int64?) -> Bool {
        guard let vehicleID else { return false }
        return vehicleID != 0
    }

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows
    /// only on the initial fetch before a vehicle resolves; the "No vehicle selected"
    /// empty state shows when the query has loaded with no active vehicle; whenever a
    /// vehicle is known the command grid renders (a cached id stays visible behind a
    /// refresh/transient failure so an offline or stale pod still shows the actions).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the
    /// phase logic be unit-tested from a non-isolated context under strict concurrency.
    public nonisolated static func resolvePhase(
        status: CommandQuickActionsLoadStatus,
        hasVehicle: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasVehicle ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasVehicle ? .content : .empty
        case let .failed(message):
            hasVehicle ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + unit/UI tests)

/// In-memory source for previews + tests. Drive the read side with `push(_:)`; the
/// command side returns a configurable `CommandDispatchResult` and records every
/// dispatched `(vehicleID, command)` pair so the dispatch contract can be asserted.
@MainActor
public final class InMemoryCommandQuickActionsSource: CommandQuickActionsSource {
    public var onUpdate: (@MainActor (CommandQuickActionsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var sent: [(vehicleID: Int64, command: String)] = []

    /// Hook invoked the instant a `send` begins (before any suspension) — lets a test
    /// observe the model's in-flight (`activeCommand`) state deterministically. Set it
    /// after the model is constructed so it can capture the bound model's state.
    public var onSendStarted: (@MainActor () -> Void)?

    private let initial: CommandQuickActionsUpdate?
    private let result: CommandDispatchResult
    private let dispatchDelay: Duration?

    public init(
        initial: CommandQuickActionsUpdate? = nil,
        result: CommandDispatchResult = CommandDispatchResult(success: true, message: ""),
        dispatchDelay: Duration? = nil
    ) {
        self.initial = initial
        self.result = result
        self.dispatchDelay = dispatchDelay
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

    public func send(vehicleID: Int64, command: String) async -> CommandDispatchResult {
        sent.append((vehicleID: vehicleID, command: command))
        onSendStarted?()
        if let dispatchDelay {
            try? await Task.sleep(for: dispatchDelay)
        }
        return result
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: CommandQuickActionsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/commands.ts → "command-quick-actions")

/// Diagnostics slug + canonical dashboard registration for this surface, kept out of
/// the SwiftUI view so the model compiles and tests without SwiftUI.
/// `CommandQuickActionsWidget` re-exposes these as `surfaceSlug` / `registration`
/// for API parity with the other surfaces.
public enum CommandQuickActionsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "CommandQuickActionsWidget"

    /// Canonical registry metadata (registry/commands.ts → "command-quick-actions").
    public static let registration = DashboardWidgetRegistration(
        id: "command-quick-actions",
        nameKey: "widget.quickActions.title",
        descriptionKey: "widget.quickActions.description",
        category: "commands",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "CommandQuickActionsWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
/// `string`/`format` are Foundation-only so the adapter's labels + accessibility copy
/// can use them; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum CommandQuickActionsStrings {
    public static let table = "CommandQuickActionsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `t(key, default, { …interpolation })` parity. The native fallback uses printf
    /// tokens (`%@`) in place of the web `{{name}}` interpolation token so the
    /// rendered text matches.
    public static func format(_ key: String, _ fallbackFormat: String, _ arguments: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: arguments)
    }
}
